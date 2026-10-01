"""Tests for the home page's colour palettes kept in the per-user prefs.

The endpoint itself (empty start, merging, auth) is covered in test_prefs.py.
"""

from tests.helpers import register

SPRING = {'id': 'u-abc123', 'name': 'Весна', 'base': '#22a35a', 'accent': '#ee5a24'}


def test_palettes_and_the_choice_round_trip(client, auth_headers):
    body = {'dashPalette': 'u-abc123', 'dashPalettes': [SPRING]}
    resp = client.put('/api/prefs', headers=auth_headers, json=body)
    assert resp.status_code == 200
    assert client.get('/api/prefs', headers=auth_headers).json() == body


def test_choosing_a_built_in_palette_keeps_the_users_own(client, auth_headers):
    client.put('/api/prefs', headers=auth_headers, json={'dashPalette': 'u-abc123', 'dashPalettes': [SPRING]})
    client.put('/api/prefs', headers=auth_headers, json={'dashPalette': 'ocean'})
    assert client.get('/api/prefs', headers=auth_headers).json() == {
        'dashPalette': 'ocean',
        'dashPalettes': [SPRING],
    }


def test_the_palette_never_resets_other_choices(client, auth_headers):
    client.put('/api/prefs', headers=auth_headers, json={'calendarDesign': 'classic'})
    client.put('/api/prefs', headers=auth_headers, json={'dashPalette': 'mint'})
    assert client.get('/api/prefs', headers=auth_headers).json() == {
        'calendarDesign': 'classic',
        'dashPalette': 'mint',
    }


def test_malformed_palettes_are_rejected(client, auth_headers):
    bad = [
        {**SPRING, 'base': 'green'},
        {**SPRING, 'id': 'ocean'},  # would shadow a built-in palette
        {**SPRING, 'name': '   '},
        {**SPRING, 'name': 'x' * 31},
    ]
    for palette in bad:
        resp = client.put('/api/prefs', headers=auth_headers, json={'dashPalettes': [palette]})
        assert resp.status_code == 422, palette
    resp = client.put('/api/prefs', headers=auth_headers, json={'dashPalettes': [SPRING] * 25})
    assert resp.status_code == 422
    assert client.get('/api/prefs', headers=auth_headers).json() == {}


def test_palettes_are_kept_per_user(client, auth_headers):
    client.put('/api/prefs', headers=auth_headers, json={'dashPalettes': [SPRING]})

    other = register(client, username='bob', password='secret456')
    other_headers = {'Authorization': f"Bearer {other['token']}"}
    assert client.get('/api/prefs', headers=other_headers).json() == {}
