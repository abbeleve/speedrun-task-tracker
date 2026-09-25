"""Tests for the habit tracker endpoints (habits + habit entries + task link)."""

HABIT = {
    'id': 'h1',
    'name': 'Отжимания',
    'emoji': '💪',
    'color': '#2ecc71',
    'format': 'count',
    'target': 10,
    'unit': 'раз',
    'order': 0,
}


def test_habits_empty_and_upsert(client, auth_headers):
    assert client.get('/api/habits', headers=auth_headers).json() == []

    resp = client.put('/api/habits/h1', headers=auth_headers, json=HABIT)
    assert resp.status_code == 200
    # A habit sent without a quota history reads back with one version that
    # has applied from the beginning.
    assert client.get('/api/habits', headers=auth_headers).json() == [
        {**HABIT, 'targets': [{'since': '', 'target': 10}]}
    ]


def test_habit_update_keeps_one_row(client, auth_headers):
    client.put('/api/habits/h1', headers=auth_headers, json=HABIT)
    edited = {**HABIT, 'target': 15}
    client.put('/api/habits/h1', headers=auth_headers, json=edited)

    habits = client.get('/api/habits', headers=auth_headers).json()
    assert len(habits) == 1
    assert habits[0]['target'] == 15


def test_habit_target_history_round_trips_sorted(client, auth_headers):
    targets = [
        {'since': '2026-09-20', 'target': 15},
        {'since': '', 'target': 10},
        {'since': '2026-10-01', 'target': 20},
    ]
    resp = client.put(
        '/api/habits/h1', headers=auth_headers, json={**HABIT, 'target': 1, 'targets': targets}
    )
    assert resp.status_code == 200

    habit = client.get('/api/habits', headers=auth_headers).json()[0]
    assert [t['since'] for t in habit['targets']] == ['', '2026-09-20', '2026-10-01']
    # `target` always mirrors the latest version, whatever the client sent.
    assert habit['target'] == 20


def test_habit_target_history_rejects_duplicate_dates(client, auth_headers):
    targets = [{'since': '', 'target': 10}, {'since': '', 'target': 12}]
    resp = client.put('/api/habits/h1', headers=auth_headers, json={**HABIT, 'targets': targets})
    assert resp.status_code == 422


def test_habit_target_history_rejects_malformed_dates(client, auth_headers):
    targets = [{'since': '', 'target': 10}, {'since': '20.09.2026', 'target': 12}]
    resp = client.put('/api/habits/h1', headers=auth_headers, json={**HABIT, 'targets': targets})
    assert resp.status_code == 422


def test_legacy_put_keeps_history_while_the_quota_is_unchanged(client, auth_headers):
    """A client that predates versioning re-sends habits on a reorder; that
    must not wipe the quota history it does not know about."""
    targets = [{'since': '', 'target': 10}, {'since': '2026-09-20', 'target': 15}]
    client.put('/api/habits/h1', headers=auth_headers, json={**HABIT, 'target': 15, 'targets': targets})

    client.put('/api/habits/h1', headers=auth_headers, json={**HABIT, 'target': 15, 'order': 3})

    habit = client.get('/api/habits', headers=auth_headers).json()[0]
    assert habit['order'] == 3
    assert habit['targets'] == targets


def test_legacy_put_with_a_new_quota_replaces_the_history(client, auth_headers):
    targets = [{'since': '', 'target': 10}, {'since': '2026-09-20', 'target': 15}]
    client.put('/api/habits/h1', headers=auth_headers, json={**HABIT, 'target': 15, 'targets': targets})

    client.put('/api/habits/h1', headers=auth_headers, json={**HABIT, 'target': 25})

    habit = client.get('/api/habits', headers=auth_headers).json()[0]
    assert habit['target'] == 25
    assert habit['targets'] == [{'since': '', 'target': 25}]


def test_habit_delete_removes_its_entries(client, auth_headers):
    client.put('/api/habits/h1', headers=auth_headers, json=HABIT)
    client.put('/api/habit-entries/h1/2026-09-10', headers=auth_headers, json={'manual': 7})

    resp = client.delete('/api/habits/h1', headers=auth_headers)
    assert resp.status_code == 200
    assert client.get('/api/habits', headers=auth_headers).json() == []
    assert client.get('/api/habit-entries', headers=auth_headers).json() == []


def test_habit_entries_round_trip(client, auth_headers):
    client.put('/api/habit-entries/h1/2026-09-10', headers=auth_headers, json={'manual': 7})
    entries = client.get('/api/habit-entries', headers=auth_headers).json()
    assert entries == [{'habitId': 'h1', 'date': '2026-09-10', 'manual': 7}]

    # A manual of 0 clears the entry — an untouched day leaves no row behind.
    client.put('/api/habit-entries/h1/2026-09-10', headers=auth_headers, json={'manual': 0})
    assert client.get('/api/habit-entries', headers=auth_headers).json() == []


def test_habit_entries_are_scoped_per_user(client, auth_headers):
    client.put('/api/habit-entries/h1/2026-09-10', headers=auth_headers, json={'manual': 7})

    from tests.helpers import register

    other = register(client, username='bob', password='secret456')
    other_headers = {'Authorization': f"Bearer {other['token']}"}
    assert client.get('/api/habit-entries', headers=other_headers).json() == []


def test_day_state_round_trips_task_habit_link(client, auth_headers):
    """A task may carry habitId; it is part of the per-day JSON blob."""
    task = {
        'id': 't1',
        'name': 'Занятие',
        'plannedTime': 18000,
        'completedAt': None,
        'start': 540,
        'finishedAt': None,
        'order': 0,
        'emoji': '⏱',
        'color': '#3498db',
        'type': 'task',
        'status': 'in-progress',
        'habitId': 'h1',
    }
    day = {'tasks': [task], 'elapsedMs': 0, 'timeCredit': 0, 'sessionState': 'idle', 'startedAt': None}
    resp = client.put('/api/day/2026-09-10', headers=auth_headers, json=day)
    assert resp.status_code == 200

    got = client.get('/api/day/2026-09-10', headers=auth_headers).json()
    assert got['tasks'][0]['habitId'] == 'h1'
