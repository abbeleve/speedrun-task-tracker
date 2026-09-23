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
        'overtakeSec': 0,
    }

    # Upsert overwrites the day rather than accumulating
    client.put(
        '/api/history/2026-09-10',
        headers=auth_headers,
        json={'workSec': 100, 'restSec': 0, 'sessions': 1},
    )
    got = client.get('/api/history', headers=auth_headers).json()
    assert got['2026-09-10']['workSec'] == 100

    # A partial PUT (just the overtake, as the overtake engine sends it) keeps
    # the rest of the row untouched instead of zeroing it.
    client.put(
        '/api/history/2026-09-10',
        headers=auth_headers,
        json={'overtakeSec': 900},
    )
    got = client.get('/api/history', headers=auth_headers).json()
    assert got['2026-09-10'] == {
        'date': '2026-09-10',
        'workSec': 100,
        'restSec': 0,
        'sessions': 1,
        'overtakeSec': 900,
    }

    client.delete('/api/history/2026-09-10', headers=auth_headers)
    assert client.get('/api/history', headers=auth_headers).json() == {}


def test_sleep_crud(client, auth_headers):
    put = client.put(
        '/api/sleep/2026-09-10',
        headers=auth_headers,
        json={'hours': [23, 0, 1, 2], 'quality': 4, 'bed': 23 * 60 + 40, 'wake': 2 * 60 + 15},
    )
    assert put.status_code == 200

    got = client.get('/api/sleep', headers=auth_headers).json()
    assert got['2026-09-10']['hours'] == [23, 0, 1, 2]
    assert got['2026-09-10']['quality'] == 4
    assert got['2026-09-10']['bed'] == 23 * 60 + 40
    assert got['2026-09-10']['wake'] == 2 * 60 + 15

    # Sending an empty body removes the entry
    client.put('/api/sleep/2026-09-10', headers=auth_headers, json={})
    assert client.get('/api/sleep', headers=auth_headers).json() == {}


def test_sleep_entry_without_minutes(client, auth_headers):
    # A client that only tracks whole hours still round-trips; the minutes come
    # back empty for the reader to derive from the hours.
    client.put(
        '/api/sleep/2026-09-11', headers=auth_headers, json={'hours': [1, 2, 3]}
    )
    got = client.get('/api/sleep', headers=auth_headers).json()['2026-09-11']
    assert got['hours'] == [1, 2, 3]
    assert got['bed'] is None
    assert got['wake'] is None


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


def test_color_presets_persist_in_order_and_allow_intentional_empty_list(client, auth_headers):
    from app import db

    url = '/api/color-presets'
    assert client.get(url, headers=auth_headers).json() is None
    presets = [
        {'id': 'call', 'name': 'Созвон', 'color': '#2ecc71'},
        {'id': 'math', 'name': 'Матан', 'color': '#e74c3c'},
    ]
    assert client.put(url, headers=auth_headers, json=presets).status_code == 200
    db.init_db()  # Re-running startup migration must keep stored presets.
    assert client.get(url, headers=auth_headers).json() == presets

    reordered = [presets[1], presets[0]]
    assert client.put(url, headers=auth_headers, json=reordered).status_code == 200
    assert client.get(url, headers=auth_headers).json() == reordered

    assert client.put(url, headers=auth_headers, json=[]).status_code == 200
    assert client.get(url, headers=auth_headers).json() == []
    assert client.put(url, headers=auth_headers, json=[presets[0], presets[0]]).status_code == 422
    assert client.get(url, headers=auth_headers).json() == []


def test_color_preset_avatar_and_gradient_round_trip(client, auth_headers):
    preset = {
        'id': 'focus', 'name': 'Focus', 'color': '#3498db', 'emoji': '🚀',
        'colorAnimation': {
            'type': 'flow', 'colors': ['#3498db', '#7c4dff'],
            'direction': 135, 'durationSec': 8,
        },
    }
    solid = {
        'id': 'rest', 'name': 'Rest', 'color': '#2ecc71',
        'emoji': '☕', 'colorAnimation': None,
    }
    url = '/api/color-presets'
    assert client.put(url, headers=auth_headers, json=[preset, solid]).status_code == 200
    assert client.get(url, headers=auth_headers).json() == [preset, solid]


def test_color_presets_are_scoped_to_user(client):
    alice = register(client, username='alice', password='secret123')['token']
    bob = register(client, username='bob', password='secret123')['token']
    alice_h = {'Authorization': f'Bearer {alice}'}
    bob_h = {'Authorization': f'Bearer {bob}'}
    presets = [{'id': 'math', 'name': 'Матан', 'color': '#e74c3c'}]
    assert client.put('/api/color-presets', headers=alice_h, json=presets).status_code == 200
    assert client.get('/api/color-presets', headers=bob_h).json() is None
    assert client.get('/api/color-presets', headers=alice_h).json() == presets


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
