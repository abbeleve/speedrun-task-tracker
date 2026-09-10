from tests.helpers import register


def test_day_state_empty(client, auth_headers):
    resp = client.get('/api/day/2026-09-10', headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json() == {
        'date': '2026-09-10',
        'tasks': [],
        'elapsedMs': 0,
        'timeCredit': 0,
        'sessionState': 'idle',
        'startedAt': None,
    }
    assert client.get('/api/day-dates', headers=auth_headers).json() == []


def test_day_state_crud(client, auth_headers):
    body = {
        'tasks': [
            {
                'id': 'a',
                'name': 'Dev',
                'plannedTime': 1800,
                'completedAt': 120.5,
                'order': 0,
                'emoji': '💻',
                'color': '#3498db',
                'type': 'task',
            },
            {
                'id': 'b',
                'name': 'Break',
                'plannedTime': 300,
                'completedAt': None,
                'order': 1,
                'emoji': '😴',
                'color': '#2ecc71',
                'type': 'rest',
            },
        ],
        'elapsedMs': 3_600_000,
        'timeCredit': 30,
        'sessionState': 'paused',
        'startedAt': 1_757_000_000_000,
    }
    assert client.put('/api/day/2026-09-10', headers=auth_headers, json=body).status_code == 200

    got = client.get('/api/day/2026-09-10', headers=auth_headers).json()
    assert got['date'] == '2026-09-10'
    assert got['elapsedMs'] == 3_600_000
    assert got['sessionState'] == 'paused'
    assert got['startedAt'] == 1_757_000_000_000
    assert [t['name'] for t in got['tasks']] == ['Dev', 'Break']
    assert got['tasks'][0]['completedAt'] == 120.5
    assert got['tasks'][1]['type'] == 'rest'

    assert client.get('/api/day-dates', headers=auth_headers).json() == ['2026-09-10']

    # Upsert overwrites the day rather than accumulating
    client.put(
        '/api/day/2026-09-10',
        headers=auth_headers,
        json={'tasks': [], 'elapsedMs': 0},
    )
    got = client.get('/api/day/2026-09-10', headers=auth_headers).json()
    assert got['tasks'] == []
    assert got['elapsedMs'] == 0
    assert got['sessionState'] == 'idle'  # back to the default


def test_day_state_dates_are_sorted(client, auth_headers):
    for date in ('2026-09-12', '2026-09-10', '2026-09-11'):
        client.put('/api/day/%s' % date, headers=auth_headers, json={'tasks': []})
    assert client.get('/api/day-dates', headers=auth_headers).json() == [
        '2026-09-10',
        '2026-09-11',
        '2026-09-12',
    ]


def test_days_list(client, auth_headers):
    client.put(
        '/api/day/2026-09-10',
        headers=auth_headers,
        json={
            'tasks': [{'id': 'a', 'name': 'Dev', 'plannedTime': 1800, 'completedAt': 60.0}],
            'elapsedMs': 60_000,
        },
    )
    client.put('/api/day/2026-09-09', headers=auth_headers, json={'tasks': []})

    got = client.get('/api/days', headers=auth_headers).json()
    assert set(got) == {'2026-09-09', '2026-09-10'}
    assert got['2026-09-10']['date'] == '2026-09-10'
    assert got['2026-09-10']['tasks'][0]['name'] == 'Dev'
    assert got['2026-09-10']['elapsedMs'] == 60_000
    assert got['2026-09-09']['tasks'] == []


def test_day_state_user_isolation(client):
    alice = register(client, username='alice', password='secret123')['token']
    bob = register(client, username='bob', password='secret123')['token']
    alice_h = {'Authorization': f'Bearer {alice}'}
    bob_h = {'Authorization': f'Bearer {bob}'}

    client.put(
        '/api/day/2026-09-10',
        headers=alice_h,
        json={'tasks': [{'id': 'a', 'name': 'Dev', 'plannedTime': 60}], 'elapsedMs': 1000},
    )

    # Bob sees no state of Alice's and no dates
    assert client.get('/api/day/2026-09-10', headers=bob_h).json()['tasks'] == []
    assert client.get('/api/day-dates', headers=bob_h).json() == []

    # Alice still sees hers
    assert client.get('/api/day/2026-09-10', headers=alice_h).json()['tasks'][0]['name'] == 'Dev'
    assert client.get('/api/day-dates', headers=alice_h).json() == ['2026-09-10']
