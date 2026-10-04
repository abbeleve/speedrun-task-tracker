"""Streaks: how many days in a row a habit's daily quota has been met — the
server's half of frontend/src/streak.ts. push.py uses it to warn, with 3, 2
and 1 hours of the day left, that a streak habit's quota is still not met.

A day's progress is the hand-entered part (``habit_entries``) plus what that
day's closed blocks linked to the habit add (habits.ts's habitAuto): their
minutes for a 'time' habit, one each for a 'count' habit. Each day is judged
against the quota it had then (habits.ts's habitTargetOn).
"""

import json
import sqlite3
from datetime import date, timedelta

# How many hours before midnight the warnings go out.
WARN_HOURS = (3, 2, 1)
_TITLE_MAX = 120


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


def streak_before(habit: dict, day: str, totals: dict[str, float]) -> int:
    """Days in a row the quota was met, counting back from the day before ``day``."""
    count = 0
    current = date.fromisoformat(day) - timedelta(days=1)
    while is_met(habit, str(current), totals):
        count += 1
        current -= timedelta(days=1)
    return count


def plural_days(n: int) -> str:
    if n % 10 == 1 and n % 100 != 11:
        return 'день'
    if 2 <= n % 10 <= 4 and not 12 <= n % 100 <= 14:
        return 'дня'
    return 'дней'


def _number(n: float) -> str:
    rounded = round(n, 2)
    return str(int(rounded)) if rounded == int(rounded) else str(rounded)


def warning_text(habit: dict, streak: int, left: float, hours: int) -> str:
    """The body of a warning — the same words as streak.ts's streakWarningText."""
    unit = habit.get('unit') or ('мин' if habit.get('format') == 'time' else '')
    rest = f"осталось {_number(left)}{' ' + unit if unit else ''}"
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
            title = f"🔥 {habit.get('emoji') or ''} {habit.get('name') or 'Привычка'}"
            events.append({
                # One per habit and day: a later warning replaces the earlier one.
                'tag': f"streak:{habit['id']}:{day}",
                'title': ' '.join(title.split())[:_TITLE_MAX],
                'body': warning_text(habit, streak_before(habit, day, totals), left, hours),
            })
    return events
