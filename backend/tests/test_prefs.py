"""Tests for the per-user display preferences (/api/prefs)."""

from tests.helpers import register


def test_prefs_start_empty(client, auth_headers):
    assert client.get('/api/prefs', headers=auth_headers).json() == {}


def test_prefs_round_trip_and_merge(client, auth_headers):
    resp = client.put('/api/prefs', headers=auth_headers, json={'activityChart': 'race'})
    assert resp.status_code == 200
    assert client.get('/api/prefs', headers=auth_headers).json() == {'activityChart': 'race'}

    # A PUT without the key leaves the stored choice alone.
    client.put('/api/prefs', headers=auth_headers, json={})
    assert client.get('/api/prefs', headers=auth_headers).json() == {'activityChart': 'race'}

    client.put('/api/prefs', headers=auth_headers, json={'activityChart': 'wave'})
    assert client.get('/api/prefs', headers=auth_headers).json() == {'activityChart': 'wave'}


def test_prefs_reject_unknown_chart(client, auth_headers):
    resp = client.put('/api/prefs', headers=auth_headers, json={'activityChart': 'pie'})
    assert resp.status_code == 422


def test_prefs_are_scoped_per_user(client, auth_headers):
    client.put('/api/prefs', headers=auth_headers, json={'activityChart': 'wave'})

    other = register(client, username='bob', password='secret456')
    other_headers = {'Authorization': f"Bearer {other['token']}"}
    assert client.get('/api/prefs', headers=other_headers).json() == {}


def test_prefs_require_auth(client):
    assert client.get('/api/prefs').status_code == 401
