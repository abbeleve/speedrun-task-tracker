"""Tests for the calendar design choice kept in the per-user prefs (/api/prefs).

The endpoint itself (empty start, merging, auth) is covered in test_prefs.py.
"""

from tests.helpers import register


def test_calendar_design_round_trips(client, auth_headers):
    resp = client.put('/api/prefs', headers=auth_headers, json={'calendarDesign': 'classic'})
    assert resp.status_code == 200
    assert resp.json() == {'calendarDesign': 'classic'}
    assert client.get('/api/prefs', headers=auth_headers).json() == {'calendarDesign': 'classic'}

    client.put('/api/prefs', headers=auth_headers, json={'calendarDesign': 'cards'})
    assert client.get('/api/prefs', headers=auth_headers).json() == {'calendarDesign': 'cards'}


def test_the_design_and_the_layout_never_reset_each_other(client, auth_headers):
    client.put('/api/prefs', headers=auth_headers, json={'calendarLayout': 'horizontal'})
    client.put('/api/prefs', headers=auth_headers, json={'calendarDesign': 'classic'})
    assert client.get('/api/prefs', headers=auth_headers).json() == {
        'calendarLayout': 'horizontal',
        'calendarDesign': 'classic',
    }


def test_unknown_designs_are_rejected(client, auth_headers):
    resp = client.put('/api/prefs', headers=auth_headers, json={'calendarDesign': 'neon'})
    assert resp.status_code == 422
    assert client.get('/api/prefs', headers=auth_headers).json() == {}


def test_the_design_is_kept_per_user(client, auth_headers):
    client.put('/api/prefs', headers=auth_headers, json={'calendarDesign': 'classic'})

    other = register(client, username='bob', password='secret456')
    other_headers = {'Authorization': f"Bearer {other['token']}"}
    assert client.get('/api/prefs', headers=other_headers).json() == {}
