import pytest
from tests.helpers import register


def deadline(**changes):
    return {'id': 'launch', 'name': 'Launch website', 'dueDay': '2026-10-02',
            'dueTime': 1080, 'completedAt': None, **changes}


def block(task_id, day, **changes):
    return {'id': task_id, 'name': 'Work', 'day': day, 'plannedTime': 3600,
            'start': 540, 'status': 'in-progress', 'deadlineId': 'launch', **changes}


def test_deadline_completion_is_independent_of_work_across_days(client, auth_headers):
    assert client.get('/api/deadlines', headers=auth_headers).json() == []
    assert client.put('/api/deadlines/launch', headers=auth_headers, json=deadline()).status_code == 200
    for day in ('2026-09-30', '2026-10-01'):
        task = block(day, day, status='done', finishedAt=123456)
        assert client.put(f'/api/day/{day}', headers=auth_headers, json={'tasks': [task]}).status_code == 200
    assert client.get('/api/deadlines', headers=auth_headers).json()[0]['completedAt'] is None
    # Explicit close/reopen changes neither work history nor task placement.
    before = client.get('/api/days', headers=auth_headers).json()
    client.put('/api/deadlines/launch', headers=auth_headers, json=deadline(completedAt=123999))
    assert client.get('/api/deadlines', headers=auth_headers).json()[0]['completedAt'] == 123999
    assert client.get('/api/days', headers=auth_headers).json() == before
    client.put('/api/deadlines/launch', headers=auth_headers, json=deadline())
    assert client.get('/api/deadlines', headers=auth_headers).json()[0]['completedAt'] is None


def test_moving_work_does_not_move_its_deadline(client, auth_headers):
    client.put('/api/deadlines/launch', headers=auth_headers, json=deadline())
    client.put('/api/day/2026-10-01', headers=auth_headers, json={'tasks': [block('a', '2026-10-01')]})
    client.put('/api/day/2026-10-01', headers=auth_headers, json={'tasks': []})
    client.put('/api/day/2026-10-03', headers=auth_headers, json={'tasks': [block('a', '2026-10-03', start=800)]})
    stored = client.get('/api/deadlines', headers=auth_headers).json()[0]
    assert (stored['dueDay'], stored['dueTime'], stored['completedAt']) == ('2026-10-02', 1080, None)


def test_deadline_delete_clears_links_without_deleting_work(client, auth_headers):
    client.put('/api/deadlines/launch', headers=auth_headers, json=deadline())
    for day in ('2026-09-30', '2026-10-01'):
        client.put(f'/api/day/{day}', headers=auth_headers, json={'tasks': [block(day, day, status='done', finishedAt=12345)]})
    before = client.get('/api/days', headers=auth_headers).json()
    assert client.delete('/api/deadlines/launch', headers=auth_headers).status_code == 200
    assert client.get('/api/deadlines', headers=auth_headers).json() == []
    after = client.get('/api/days', headers=auth_headers).json()
    for day in before:
        expected = before[day]
        expected['tasks'][0]['deadlineId'] = None
        assert after[day] == expected


def test_deadlines_and_links_are_scoped_to_the_account(client, auth_headers):
    client.put('/api/deadlines/launch', headers=auth_headers, json=deadline())
    other = register(client, username='other', password='secret456')
    headers = {'Authorization': f"Bearer {other['token']}"}
    assert client.get('/api/deadlines', headers=headers).json() == []
    assert client.put('/api/day/2026-10-01', headers=headers, json={'tasks': [block('a', '2026-10-01')]}).status_code == 422
    client.delete('/api/deadlines/launch', headers=headers)
    assert len(client.get('/api/deadlines', headers=auth_headers).json()) == 1
    client.put('/api/deadlines/launch', headers=headers, json=deadline(name='Other result'))
    assert client.get('/api/deadlines', headers=auth_headers).json()[0]['name'] == 'Launch website'


@pytest.mark.parametrize('changes', [
    {'dueDay': '2026-02-30'}, {'dueTime': -1}, {'dueTime': 1440},
    {'dueTime': 0.5}, {'completedAt': -1}, {'name': '   '}, {'name': ''},
])
def test_invalid_deadline_is_rejected(client, auth_headers, changes):
    assert client.put('/api/deadlines/launch', headers=auth_headers, json=deadline(**changes)).status_code == 422
    assert client.get('/api/deadlines', headers=auth_headers).json() == []


def test_date_only_midnight_and_description_round_trip(client, auth_headers):
    for due_time in (None, 0, 1439):
        body = deadline(dueTime=due_time, description='Deliver after final review')
        assert client.put('/api/deadlines/launch', headers=auth_headers, json=body).status_code == 200
        assert client.get('/api/deadlines', headers=auth_headers).json()[0] == body


def test_url_id_must_match_the_record(client, auth_headers):
    assert client.put('/api/deadlines/other', headers=auth_headers, json=deadline()).status_code == 400


def test_deadline_routes_require_auth(client):
    assert client.get('/api/deadlines').status_code == 401
    assert client.put('/api/deadlines/launch', json=deadline()).status_code == 401
    assert client.delete('/api/deadlines/launch').status_code == 401
