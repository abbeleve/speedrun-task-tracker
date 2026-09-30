"""Tests for the calendar layout choice kept in the per-user prefs (/api/prefs).

The endpoint itself (empty start, merging, auth) is covered in test_prefs.py.
"""

from tests.helpers import register


def test_calendar_layout_round_trips(client, auth_headers):
    resp = client.put('/api/prefs', headers=auth_headers, json={'calendarLayout': 'horizontal'})
    assert resp.status_code == 200
    assert resp.json() == {'calendarLayout': 'horizontal'}
    assert client.get('/api/prefs', headers=auth_headers).json() == {'calendarLayout': 'horizontal'}

    client.put('/api/prefs', headers=auth_headers, json={'calendarLayout': 'vertical'})
    assert client.get('/api/prefs', headers=auth_headers).json() == {'calendarLayout': 'vertical'}


def test_the_layout_and_the_activity_chart_never_reset_each_other(client, auth_headers):
    client.put('/api/prefs', headers=auth_headers, json={'activityChart': 'wave'})
    client.put('/api/prefs', headers=auth_headers, json={'calendarLayout': 'horizontal'})
    assert client.get('/api/prefs', headers=auth_headers).json() == {
        'activityChart': 'wave',
        'calendarLayout': 'horizontal',
    }

    client.put('/api/prefs', headers=auth_headers, json={'activityChart': 'bars'})
    assert client.get('/api/prefs', headers=auth_headers).json() == {
        'activityChart': 'bars',
        'calendarLayout': 'horizontal',
    }


def test_unknown_layouts_are_rejected(client, auth_headers):
    resp = client.put('/api/prefs', headers=auth_headers, json={'calendarLayout': 'diagonal'})
    assert resp.status_code == 422
    assert client.get('/api/prefs', headers=auth_headers).json() == {}


def test_the_layout_is_kept_per_user(client, auth_headers):
    client.put('/api/prefs', headers=auth_headers, json={'calendarLayout': 'horizontal'})

    other = register(client, username='bob', password='secret456')
    other_headers = {'Authorization': f"Bearer {other['token']}"}
    assert client.get('/api/prefs', headers=other_headers).json() == {}


def test_saving_the_layout_requires_auth(client):
    assert client.put('/api/prefs', json={'calendarLayout': 'vertical'}).status_code == 401
