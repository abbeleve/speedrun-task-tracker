"""Web Push: a browser on a PC or an Android phone is told when a block on the
calendar starts, and when one runs out without being closed.

Each browser that turns notifications on stores its push subscription (see
``push_subscriptions`` in db.py). A loop started with the app reads the plan
every ``TICK_SEC`` seconds and pushes whatever started or ended since its
previous look. Nothing is recorded as sent: the windows it looks at follow one
another without gaps or overlaps, so each moment is looked at exactly once,
and moments while the server was down are skipped rather than pushed late.
That holds for a single server process, which is how the app is deployed.

Task slots are minutes from the local midnight of the task's day (the
frontend's schedule.ts), so each subscription carries its browser's time zone.
"""

import asyncio
import json
import logging
import os
import sqlite3
import time
from datetime import date, datetime, timedelta
from typing import Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from cryptography.hazmat.primitives import serialization
from py_vapid import Vapid02
from py_vapid.utils import b64urlencode
from pywebpush import WebPushException, webpush

from . import db

log = logging.getLogger(__name__)

TICK_SEC = 30
# A "starts now" that reaches the device later than this is no longer news.
TTL_SEC = 15 * 60
DEFAULT_SUBJECT = 'mailto:admin@example.com'
_TITLE_MAX = 120


def vapid_key(conn: sqlite3.Connection) -> Vapid02:
    row = conn.execute('SELECT private_pem FROM vapid_key WHERE id = 1').fetchone()
    if row is None:
        key = Vapid02()
        key.generate_keys()
        # Two first requests at once: the first insert wins and both read it.
        conn.execute(
            'INSERT OR IGNORE INTO vapid_key (id, private_pem) VALUES (1, ?)',
            (key.private_pem().decode(),),
        )
        conn.commit()
        row = conn.execute('SELECT private_pem FROM vapid_key WHERE id = 1').fetchone()
    return Vapid02.from_pem(row['private_pem'].encode())


def public_key(key: Vapid02) -> str:
    """The key in the form the browser's ``pushManager.subscribe`` takes."""
    raw = key.public_key.public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
    )
    return b64urlencode(raw)


def zone(name: str) -> Optional[ZoneInfo]:
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        return None


def _midnight_ms(day: str, tz: ZoneInfo) -> float:
    return datetime.combine(date.fromisoformat(day), datetime.min.time(), tzinfo=tz).timestamp() * 1000


def _clock(ms: float, tz: ZoneInfo) -> str:
    return datetime.fromtimestamp(ms / 1000, tz).strftime('%H:%M')


def due_events(tasks: list[dict], tz: ZoneInfo, since_ms: float, until_ms: float) -> list[dict]:
    """The pushes for the blocks in ``tasks`` that started or ran out in
    ``(since_ms, until_ms]``. Closed blocks and the backlog say nothing."""
    events = []
    for task in tasks:
        if task.get('status') == 'open' or task.get('start') is None:
            continue
        if task.get('status') == 'done' or task.get('finishedAt') is not None:
            continue
        try:
            midnight = _midnight_ms(task.get('day') or '', tz)
        except ValueError:
            continue
        # Same arithmetic as schedule.ts's taskStartMs / taskEndMs.
        start_ms = midnight + task['start'] * 60_000
        end_ms = start_ms + max(0, task.get('plannedTime') or 0) * 1000
        title = f"{task.get('emoji') or ''} {task.get('name') or 'Без названия'}".strip()[:_TITLE_MAX]
        span = f'{_clock(start_ms, tz)}–{_clock(end_ms, tz)}'
        reminder = task.get('type') == 'reminder'
        if since_ms < start_ms <= until_ms:
            events.append({
                'tag': f"{task['id']}:start",
                'title': title,
                'body': f'Напоминание · {span}' if reminder else f'Начинается · {span}',
            })
        # A reminder closes itself when its window ends: only its start is news.
        if not reminder and end_ms > start_ms and since_ms < end_ms <= until_ms:
            events.append({
                'tag': f"{task['id']}:end",
                'title': title,
                'body': f'Время вышло · {span} — блок не закрыт',
            })
    return events


def _tasks_around(
    conn: sqlite3.Connection, user_id: int, tz: ZoneInfo, since_ms: float, until_ms: float
) -> list[dict]:
    # From the day before: a block that started yesterday may end tonight.
    first = datetime.fromtimestamp(since_ms / 1000, tz).date() - timedelta(days=1)
    last = datetime.fromtimestamp(until_ms / 1000, tz).date()
    dates = [str(first + timedelta(days=i)) for i in range((last - first).days + 1)]
    rows = conn.execute(
        f"SELECT date, data FROM day_state WHERE user_id = ? AND date IN ({','.join('?' * len(dates))})",
        (user_id, *dates),
    ).fetchall()
    tasks = []
    for row in rows:
        for task in json.loads(row['data']).get('tasks', []):
            tasks.append({**task, 'day': task.get('day') or row['date']})
    return tasks


def _push(conn: sqlite3.Connection, key: Vapid02, sub: sqlite3.Row, event: dict) -> bool:
    """Send one push; False once the browser has dropped the subscription."""
    try:
        webpush(
            subscription_info={
                'endpoint': sub['endpoint'],
                'keys': {'p256dh': sub['p256dh'], 'auth': sub['auth']},
            },
            data=json.dumps(event),
            vapid_private_key=key,
            # A fresh dict each time: webpush writes the endpoint's origin into it.
            vapid_claims={'sub': os.environ.get('VAPID_SUBJECT') or DEFAULT_SUBJECT},
            ttl=TTL_SEC,
            timeout=10,
        )
    except WebPushException as e:
        if e.status_code in (404, 410):
            # Notifications turned off in the browser, or its data cleared.
            conn.execute('DELETE FROM push_subscriptions WHERE endpoint = ?', (sub['endpoint'],))
            conn.commit()
            return False
        log.warning('Push failed: %s', e)
    except Exception as e:  # network trouble — the next block gets its own try
        log.warning('Push failed: %s', e)
    return True


def send_due(since_ms: float, until_ms: float) -> None:
    conn = db.get_conn()
    try:
        subs = conn.execute(
            """
            SELECT p.*, s.user_id FROM push_subscriptions p
            JOIN sessions s ON s.token = p.session_token
            """
        ).fetchall()
        if not subs:
            return
        key = vapid_key(conn)
        groups: dict[tuple[int, str], list[sqlite3.Row]] = {}
        for sub in subs:
            groups.setdefault((sub['user_id'], sub['time_zone']), []).append(sub)
        for (user_id, tz_name), group in groups.items():
            tz = zone(tz_name)
            if tz is None:
                continue
            tasks = _tasks_around(conn, user_id, tz, since_ms, until_ms)
            for event in due_events(tasks, tz, since_ms, until_ms):
                group = [sub for sub in group if _push(conn, key, sub, event)]
    finally:
        conn.close()


async def run_forever() -> None:
    since = time.time() * 1000
    while True:
        await asyncio.sleep(TICK_SEC)
        until = time.time() * 1000
        try:
            await asyncio.to_thread(send_due, since, until)
        except Exception:
            log.exception('Push round failed')
        since = until
