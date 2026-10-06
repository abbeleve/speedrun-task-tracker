"""Streaks: how many days in a row a habit's daily quota has been met — the
server's half of frontend/src/streak.ts. push.py uses it to warn, with 3, 2
and 1 hours of the day left, that a streak habit's quota is still not met.

A day's progress is the hand-entered part (``habit_entries``) plus what that
day's closed blocks linked to the habit add (habits.ts's habitAuto): their
minutes for a 'time' habit, one each for a 'count' habit. Each day is judged
against the quota it had then (habits.ts's habitTargetOn).

Savers: one a week, Monday-first, from the day the streak was switched on
(``streakSince``); the unused ones pile up. A day that ends short of its quota
while a streak is running spends one, and the streak is kept rather than
broken. Before ``streakSince`` there were none, so a miss there breaks it.
"""

import json
import sqlite3
from datetime import date, timedelta

# How many hours before midnight the warnings go out.
WARN_HOURS = (3, 2, 1)
_TITLE_MAX = 120
# Habits that had the streak on before savers existed collect them from the
# week savers first came (streak.ts's STREAK_SAVERS_FROM).
SAVERS_FROM = '2026-10-05'


def target_on(habit: dict, day: str) -> float:
    """The quota a habit had on ``day``: the latest version started by then."""
    versions = habit.get('targets') or [{'since': '', 'target': habit.get('target', 1)}]
    target = versions[0]['target']
    for version in versions:
        if version['since'] > day:
            break
        target = version['target']
    return target


def _is_done(task: dict) -> bool:
    return task.get('status') == 'done' or task.get('finishedAt') is not None


def daily_totals(habit: dict, tasks: list[dict], manual: dict[str, float]) -> dict[str, float]:
    """Each day's progress for the habit, in its own units.

    ``tasks`` carry their ``day``; ``manual`` maps a day to its hand-entered part.
    """
    totals = dict(manual)
    seconds: dict[str, float] = {}
    for task in tasks:
        if task.get('habitId') != habit['id'] or not _is_done(task):
            continue
        day = task.get('day') or ''
        if habit.get('format') == 'time':
            seconds[day] = seconds.get(day, 0) + max(0, task.get('plannedTime') or 0)
        else:
            totals[day] = totals.get(day, 0) + 1
    for day, sec in seconds.items():
        # Rounded per day and half up, as habitAuto's Math.round does.
        totals[day] = totals.get(day, 0) + int(sec / 60 + 0.5)
    return totals


def is_met(habit: dict, day: str, totals: dict[str, float]) -> bool:
    target = target_on(habit, day)
    return target > 0 and totals.get(day, 0) >= target


def _gains_saver(day: date, since: date) -> bool:
    return day == since or day.weekday() == 0


def streak_before(habit: dict, day: str, totals: dict[str, float]) -> tuple[int, int]:
    """The streak carried into ``day`` — days in a row the quota was met up to
    the day before, through the days a saver covered — and the savers in hand
    on ``day``, the one it brings included."""
    today = date.fromisoformat(day)
    since = date.fromisoformat(habit.get('streakSince') or SAVERS_FROM)
    first = min(since, today)
    # Up to the first day with savers the run is counted back plainly…
    run = 0
    current = first - timedelta(days=1)
    while is_met(habit, str(current), totals):
        run += 1
        current -= timedelta(days=1)
    # …and from there walked forward, savers arriving and spent day by day.
    savers = 0
    current = first
    while current < today:
        if _gains_saver(current, since):
            savers += 1
        if is_met(habit, str(current), totals):
            run += 1
        elif run > 0 and savers > 0:
            savers -= 1
        else:
            run = 0
        current += timedelta(days=1)
    if today >= since and _gains_saver(today, since):
        savers += 1
    return run, savers


def plural_days(n: int) -> str:
    if n % 10 == 1 and n % 100 != 11:
        return 'день'
    if 2 <= n % 10 <= 4 and not 12 <= n % 100 <= 14:
        return 'дня'
    return 'дней'


def _number(n: float) -> str:
    rounded = round(n, 2)
    return str(int(rounded)) if rounded == int(rounded) else str(rounded)


def warning_text(habit: dict, streak: int, left: float, hours: int, savers: int = 0) -> str:
    """The body of a warning — the same words as streak.ts's streakWarningText."""
    unit = habit.get('unit') or ('мин' if habit.get('format') == 'time' else '')
    rest = f"осталось {_number(left)}{' ' + unit if unit else ''}"
    if streak > 0 and savers > 0:
        return f'Серию {streak} {plural_days(streak)} через {hours} ч спасёт заморозка — {rest}'
    if streak > 0:
        return f'Серия {streak} {plural_days(streak)} сгорит через {hours} ч — {rest}'
    return f'До конца дня {hours} ч — {rest}. Начни серию!'


def warning_events(conn: sqlite3.Connection, user_id: int, moments: list[tuple[str, int]]) -> list[dict]:
    """The pushes for ``moments`` — (day, hours left) pairs — about the user's
    streak habits whose quota for that day is not met yet."""
    if not moments:
        return []
    habits = [
        habit
        for habit in (json.loads(r['data']) for r in conn.execute(
            'SELECT data FROM habits WHERE user_id = ?', (user_id,)
        ))
        if habit.get('streak')
    ]
    if not habits:
        return []
    # Every day the user planned: a streak may reach far back.
    tasks = []
    for row in conn.execute('SELECT date, data FROM day_state WHERE user_id = ?', (user_id,)):
        for task in json.loads(row['data']).get('tasks', []):
            tasks.append({**task, 'day': task.get('day') or row['date']})
    manual: dict[str, dict[str, float]] = {}
    for row in conn.execute(
        'SELECT habit_id, date, manual FROM habit_entries WHERE user_id = ?', (user_id,)
    ):
        manual.setdefault(row['habit_id'], {})[row['date']] = row['manual']

    events = []
    for habit in sorted(habits, key=lambda h: h.get('order', 0)):
        totals = daily_totals(habit, tasks, manual.get(habit['id'], {}))
        for day, hours in moments:
            if is_met(habit, day, totals):
                continue
            left = max(0, target_on(habit, day) - totals.get(day, 0))
            run, savers = streak_before(habit, day, totals)
            title = f"🔥 {habit.get('emoji') or ''} {habit.get('name') or 'Привычка'}"
            events.append({
                # One per habit and day: a later warning replaces the earlier one.
                'tag': f"streak:{habit['id']}:{day}",
                'title': ' '.join(title.split())[:_TITLE_MAX],
                'body': warning_text(habit, run, left, hours, savers),
            })
    return events
