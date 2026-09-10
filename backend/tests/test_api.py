from tests.helpers import register


def test_history_empty(client, auth_headers):
    resp = client.get('/api/history', headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json() == {}


def test_history_crud(client, auth_headers):
    put = client.put(
        '/api/history/2026-09-10',
        headers=auth_headers,
        json={'workSec': 3600, 'restSec': 600, 'sessions': 2},
    )
    assert put.status_code == 200

    got = client.get('/api/history', headers=auth_headers).json()
    assert got['2026-09-10'] == {
        'date': '2026-09-10',
        'workSec': 3600,
        'restSec': 600,
        'sessions': 2,
    }

    # Upsert overwrites the day rather than accumulating
    client.put(
        '/api/history/2026-09-10',
        headers=auth_headers,
        json={'workSec': 100, 'restSec': 0, 'sessions': 1},
    )
    got = client.get('/api/history', headers=auth_headers).json()
    assert got['2026-09-10']['workSec'] == 100

    client.delete('/api/history/2026-09-10', headers=auth_headers)
    assert client.get('/api/history', headers=auth_headers).json() == {}


def test_sleep_crud(client, auth_headers):
    put = client.put(
        '/api/sleep/2026-09-10',
        headers=auth_headers,
        json={'hours': [23, 0, 1, 2], 'quality': 4},
    )
    assert put.status_code == 200

    got = client.get('/api/sleep', headers=auth_headers).json()
    assert got['2026-09-10']['hours'] == [23, 0, 1, 2]
    assert got['2026-09-10']['quality'] == 4

    # Sending an empty body removes the entry
    client.put('/api/sleep/2026-09-10', headers=auth_headers, json={})
    assert client.get('/api/sleep', headers=auth_headers).json() == {}


def test_run_templates_crud(client, auth_headers):
    body = {
        'id': 'tpl-1',
        'name': 'My splits',
        'tasks': [
            {'name': 'Dev', 'plannedTime': 1800, 'emoji': '💻', 'color': '#3498db', 'type': 'task'}
        ],
    }
    assert client.put('/api/templates/tpl-1', headers=auth_headers, json=body).status_code == 200

    got = client.get('/api/templates', headers=auth_headers).json()
    assert len(got) == 1
    assert got[0]['id'] == 'tpl-1'
    assert got[0]['name'] == 'My splits'

    assert client.delete('/api/templates/tpl-1', headers=auth_headers).status_code == 200
    assert client.get('/api/templates', headers=auth_headers).json() == []


def test_task_templates_crud(client, auth_headers):
    body = {
        'id': 'tt-1',
        'name': 'Quick task',
        'plannedTime': 300,
        'emoji': '⚡',
        'color': '#2ecc71',
        'type': 'rest',
    }
    assert client.put('/api/task-templates/tt-1', headers=auth_headers, json=body).status_code == 200
    got = client.get('/api/task-templates', headers=auth_headers).json()
    assert len(got) == 1
    assert got[0]['name'] == 'Quick task'
    assert got[0]['type'] == 'rest'

    assert client.delete('/api/task-templates/tt-1', headers=auth_headers).status_code == 200
    assert client.get('/api/task-templates', headers=auth_headers).json() == []


def test_user_isolation(client):
    alice = register(client, username='alice', password='secret123')['token']
    bob = register(client, username='bob', password='secret123')['token']
    alice_h = {'Authorization': f'Bearer {alice}'}
    bob_h = {'Authorization': f'Bearer {bob}'}

    client.put('/api/history/2026-09-10', headers=alice_h, json={'workSec': 7200, 'restSec': 0, 'sessions': 3})
    client.put('/api/sleep/2026-09-10', headers=alice_h, json={'hours': [22, 23, 0, 1], 'quality': 5})
    client.put('/api/templates/a', headers=alice_h, json={'id': 'a', 'name': 'Run', 'tasks': []})

    # Bob sees none of Alice's data
    assert client.get('/api/history', headers=bob_h).json() == {}
    assert client.get('/api/sleep', headers=bob_h).json() == {}
    assert client.get('/api/templates', headers=bob_h).json() == []

    # Alice still sees hers
    assert len(client.get('/api/history', headers=alice_h).json()) == 1
    assert len(client.get('/api/templates', headers=alice_h).json()) == 1
