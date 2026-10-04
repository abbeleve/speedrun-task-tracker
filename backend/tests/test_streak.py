"""Tests for habit streaks and the pushes that warn a streak is about to burn."""

import json
from datetime import datetime
from zoneinfo import ZoneInfo

from app import push, streak
from tests.helpers import register
from tests.test_push import SUB, FakePush, save_day

MSK = ZoneInfo('Europe/Moscow')
DAY = '2026-10-05'

HABIT = {
    'id': 'h1', 'name': 'Отжимания', 'emoji': '💪', 'color': '#e74c3c',
    'format': 'count', 'target': 10, 'unit': 'раз', 'order': 0, 'streak': True,
}


def at(day: str, hh: int, mm: int = 0, tz: ZoneInfo = MSK) -> float:
    return datetime.fromisoformat(f'{day}T{hh:02}:{mm:02}').replace(tzinfo=tz).timestamp() * 1000


def time_habit(**fields) -> dict:
    return {**HABIT, 'id': 'h2', 'format': 'time', 'target': 30, 'unit': '', **fields}


def block(day: str, minutes: int, **fields) -> dict:
    base = {
        'id': f'b-{day}-{minutes}', 'name': 'Чтение', 'emoji': '📚', 'plannedTime': minutes * 60,
        'start': 8 * 60, 'day': day, 'status': 'done', 'finishedAt': at(day, 9), 'type': 'task',
        'habitId': 'h2',
    }
    return {**base, **fields}


# ── counting ────────────────────────────────────────────────────────

def test_a_streak_counts_the_met_days_before_the_day():
    totals = {'2026-10-02': 10, '2026-10-03': 12, '2026-10-04': 10}
    assert streak.streak_before(HABIT, DAY, totals) == 3


def test_a_missed_day_breaks_the_streak():
    totals = {'2026-10-01': 10, '2026-10-02': 9, '2026-10-03': 10, '2026-10-04': 10}
    assert streak.streak_before(HABIT, DAY, totals) == 2
    assert streak.streak_before(HABIT, DAY, {}) == 0


def test_each_day_is_judged_by_its_own_quota():
    raised = {**HABIT, 'targets': [{'since': '', 'target': 10}, {'since': '2026-10-04', 'target': 15}]}
    totals = {'2026-10-03': 10, '2026-10-04': 15}
    assert streak.streak_before(raised, DAY, totals) == 2
    assert streak.streak_before(raised, DAY, {**totals, '2026-10-04': 12}) == 0


def test_closed_linked_blocks_feed_a_time_habit_in_minutes():
    habit = time_habit()
    tasks = [
        block(DAY, 20),
        block(DAY, 10, id='b2'),
        block(DAY, 45, id='open', status='in-progress', finishedAt=None),
        block(DAY, 45, id='other', habitId='h1'),
    ]
    totals = streak.daily_totals(habit, tasks, {DAY: 5})
    assert totals == {DAY: 35}
    assert streak.is_met(habit, DAY, totals)


def test_a_count_habit_takes_one_unit_per_closed_linked_block():
    tasks = [block(DAY, 20, habitId='h1'), block(DAY, 30, id='b2', habitId='h1')]
    assert streak.daily_totals(HABIT, tasks, {DAY: 3}) == {DAY: 5}


def test_minutes_are_rounded_half_up_like_the_frontend():
    habit = time_habit()
    assert streak.daily_totals(habit, [block(DAY, 0, plannedTime=150)], {}) == {DAY: 3}


def test_the_warning_reads_the_streak_and_what_is_left():
    assert streak.warning_text(HABIT, 12, 4, 3) == 'Серия 12 дней сгорит через 3 ч — осталось 4 раз'
    assert streak.warning_text(HABIT, 1, 0.5, 1) == 'Серия 1 день сгорит через 1 ч — осталось 0.5 раз'
    assert streak.warning_text(HABIT, 22, 4, 2).startswith('Серия 22 дня')
    assert streak.warning_text(time_habit(), 0, 25, 2) == 'До конца дня 2 ч — осталось 25 мин. Начни серию!'


# ── when the warnings go out ────────────────────────────────────────

def test_warnings_fall_three_two_and_one_hours_before_midnight():
    assert push.warning_moments(MSK, at(DAY, 20, 59), at(DAY, 21)) == [(DAY, 3)]
    assert push.warning_moments(MSK, at(DAY, 21), at(DAY, 21, 1)) == []
    assert push.warning_moments(MSK, at(DAY, 12), at(DAY, 23, 30)) == [(DAY, 3), (DAY, 2), (DAY, 1)]


def test_warning_moments_follow_the_browsers_time_zone():
    utc = ZoneInfo('UTC')
    # 21:00 UTC is midnight in Moscow: nothing is due there, the UTC day warns.
    assert push.warning_moments(MSK, at(DAY, 20, 59, utc), at(DAY, 21, 0, utc)) == []
    assert push.warning_moments(utc, at(DAY, 20, 59, utc), at(DAY, 21, 0, utc)) == [(DAY, 3)]


# ── pushing them ────────────────────────────────────────────────────

def setup(client, headers, habit=HABIT, entries=()):
    assert client.put(f"/api/habits/{habit['id']}", headers=headers, json=habit).status_code == 200
    for day, manual in entries:
        client.put(f"/api/habit-entries/{habit['id']}/{day}", headers=headers, json={'manual': manual})
    client.put('/api/push/subscription', headers=headers, json=SUB)


def sent(monkeypatch, since: float, until: float) -> list[dict]:
    fake = FakePush()
    monkeypatch.setattr(push, 'webpush', fake)
    push.send_due(since, until)
    return [json.loads(data) for _, data in fake.sent]


def test_an_unmet_streak_habit_is_warned_about(client, auth_headers, monkeypatch):
    setup(client, auth_headers, entries=[('2026-10-03', 10), ('2026-10-04', 10), (DAY, 6)])
    assert sent(monkeypatch, at(DAY, 20, 59), at(DAY, 21)) == [{
        'tag': f'streak:h1:{DAY}',
        'title': '🔥 💪 Отжимания',
        'body': 'Серия 2 дня сгорит через 3 ч — осталось 4 раз',
    }]


def test_a_met_quota_or_a_habit_without_a_streak_stays_quiet(client, auth_headers, monkeypatch):
    setup(client, auth_headers, entries=[(DAY, 10)])
    setup(client, auth_headers, habit={**HABIT, 'id': 'plain', 'streak': False})
    assert sent(monkeypatch, at(DAY, 20, 59), at(DAY, 21)) == []


def test_closed_linked_blocks_count_towards_the_quota(client, auth_headers, monkeypatch):
    setup(client, auth_headers, habit=time_habit())
    save_day(client, auth_headers, DAY, [block(DAY, 20)])
    [event] = sent(monkeypatch, at(DAY, 21, 59), at(DAY, 22))
    assert event['body'] == 'До конца дня 2 ч — осталось 10 мин. Начни серию!'
    save_day(client, auth_headers, DAY, [block(DAY, 20), block(DAY, 10, id='b2')])
    assert sent(monkeypatch, at(DAY, 22, 59), at(DAY, 23)) == []


def test_only_the_owners_browsers_are_warned(client, auth_headers, monkeypatch):
    setup(client, auth_headers)
    bob = register(client, username='bob', password='secret456')
    bob_headers = {'Authorization': f"Bearer {bob['token']}"}
    client.put('/api/push/subscription', headers=bob_headers, json={**SUB, 'endpoint': 'https://push.example/bob'})
    fake = FakePush()
    monkeypatch.setattr(push, 'webpush', fake)
    push.send_due(at(DAY, 22, 59), at(DAY, 23))
    assert [endpoint for endpoint, _ in fake.sent] == [SUB['endpoint']]
