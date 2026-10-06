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

def run_before(habit: dict, day: str, totals: dict) -> int:
    return streak.streak_before(habit, day, totals)[0]


def test_a_streak_counts_the_met_days_before_the_day():
    totals = {'2026-10-02': 10, '2026-10-03': 12, '2026-10-04': 10}
    assert run_before(HABIT, DAY, totals) == 3


def test_a_missed_day_breaks_the_streak():
    totals = {'2026-10-01': 10, '2026-10-02': 9, '2026-10-03': 10, '2026-10-04': 10}
    assert run_before(HABIT, DAY, totals) == 2
    assert run_before(HABIT, DAY, {}) == 0


def test_each_day_is_judged_by_its_own_quota():
    raised = {**HABIT, 'targets': [{'since': '', 'target': 10}, {'since': '2026-10-04', 'target': 15}]}
    totals = {'2026-10-03': 10, '2026-10-04': 15}
    assert run_before(raised, DAY, totals) == 2
    assert run_before(raised, DAY, {**totals, '2026-10-04': 12}) == 0


# ── savers ──────────────────────────────────────────────────────────

def met(*days: str) -> dict:
    return {day: 10 for day in days}


def test_a_saver_freezes_the_streak_over_a_missed_day():
    habit = {**HABIT, 'streakSince': '2026-10-05'}
    # Monday met, Tuesday missed — the week's saver covers it — then met again:
    # the missed day keeps the streak without growing it.
    totals = met('2026-10-05', '2026-10-07', '2026-10-08')
    assert streak.streak_before(habit, '2026-10-09', totals) == (3, 0)


def test_with_no_saver_left_a_missed_day_breaks_the_streak():
    habit = {**HABIT, 'streakSince': '2026-10-05'}
    totals = met('2026-10-05', '2026-10-08')
    assert streak.streak_before(habit, '2026-10-09', totals) == (1, 0)


def test_savers_come_weekly_and_pile_up():
    # From a Thursday: that day's, then every Monday's.
    habit = {**HABIT, 'streakSince': '2026-10-01'}
    assert streak.streak_before(habit, '2026-10-01', {}) == (0, 1)
    assert streak.streak_before(habit, '2026-10-04', {}) == (0, 1)
    assert streak.streak_before(habit, '2026-10-05', {}) == (0, 2)
    assert streak.streak_before(habit, '2026-10-20', {}) == (0, 4)


def test_mondays_saver_is_there_for_the_monday_itself():
    habit = {**HABIT, 'streakSince': '2026-10-07'}
    totals = met('2026-10-07', '2026-10-09', '2026-10-10', '2026-10-11')
    assert streak.streak_before(habit, '2026-10-12', totals) == (4, 1)
    assert streak.streak_before(habit, '2026-10-13', totals) == (4, 0)


def test_no_saver_is_spent_on_a_streak_already_out():
    habit = {**HABIT, 'streakSince': '2026-10-05'}
    assert streak.streak_before(habit, '2026-10-08', {}) == (0, 1)


def test_days_before_the_streak_was_switched_on_had_no_savers():
    habit = {**HABIT, 'streakSince': '2026-10-05'}
    totals = met('2026-10-01', '2026-10-02', '2026-10-04')
    assert streak.streak_before(habit, DAY, totals) == (1, 1)


def test_a_habit_from_before_savers_counts_them_from_their_first_week():
    assert streak.streak_before(HABIT, '2026-10-13', {}) == (0, 2)


def test_a_streak_switched_on_in_the_future_has_no_savers_yet():
    habit = {**HABIT, 'streakSince': '2026-10-10'}
    assert streak.streak_before(habit, DAY, met('2026-10-04')) == (1, 0)


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


def test_with_a_saver_in_hand_the_warning_says_it_will_step_in():
    assert streak.warning_text(HABIT, 12, 4, 3, savers=2) == (
        'Серию 12 дней через 3 ч спасёт заморозка — осталось 4 раз'
    )
    # No streak to keep: nothing to spend a saver on.
    assert streak.warning_text(HABIT, 0, 4, 3, savers=2).startswith('До конца дня 3 ч')


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
    # The week's saver went on Tuesday, so Wednesday's streak would burn.
    day = '2026-10-07'
    habit = {**HABIT, 'streakSince': '2026-10-05'}
    setup(client, auth_headers, habit=habit, entries=[('2026-10-04', 10), ('2026-10-05', 10), (day, 6)])
    assert sent(monkeypatch, at(day, 20, 59), at(day, 21)) == [{
        'tag': f'streak:h1:{day}',
        'title': '🔥 💪 Отжимания',
        'body': 'Серия 2 дня сгорит через 3 ч — осталось 4 раз',
    }]


def test_the_warning_says_when_a_saver_will_step_in(client, auth_headers, monkeypatch):
    setup(client, auth_headers, entries=[('2026-10-03', 10), ('2026-10-04', 10), (DAY, 6)])
    [event] = sent(monkeypatch, at(DAY, 20, 59), at(DAY, 21))
    assert event['body'] == 'Серию 2 дня через 3 ч спасёт заморозка — осталось 4 раз'


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
