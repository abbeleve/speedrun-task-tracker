"""Tests for the dashboard's look kept in the per-user prefs: the colour
palettes, and the pages besides the home page that wear it.

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


def test_the_pages_wearing_the_look_round_trip(client, auth_headers):
    client.put('/api/prefs', headers=auth_headers, json={'dashPalette': 'ocean'})
    resp = client.put(
        '/api/prefs', headers=auth_headers, json={'dashGlass': {'calendar': False, 'tracker': True}}
    )
    assert resp.status_code == 200
    assert client.get('/api/prefs', headers=auth_headers).json() == {
        'dashPalette': 'ocean',
        'dashGlass': {'calendar': False, 'tracker': True},
    }


def test_malformed_page_choices_are_rejected(client, auth_headers):
    bad = [
        {'calendar': True},  # every page is named
        {'calendar': 'yes', 'tracker': True},
        {'calendar': 1, 'tracker': 0},
        'all',
    ]
    for glass in bad:
        resp = client.put('/api/prefs', headers=auth_headers, json={'dashGlass': glass})
        assert resp.status_code == 422, glass
    assert client.get('/api/prefs', headers=auth_headers).json() == {}


def test_palettes_are_kept_per_user(client, auth_headers):
    client.put('/api/prefs', headers=auth_headers, json={'dashPalettes': [SPRING], 'dashBackdropSeed': 123456})

    other = register(client, username='bob', password='secret456')
    other_headers = {'Authorization': f"Bearer {other['token']}"}
    assert client.get('/api/prefs', headers=other_headers).json() == {}


def test_backdrop_positions_round_trip_and_reset_without_changing_the_palette(client, auth_headers):
    client.put('/api/prefs', headers=auth_headers, json={'dashPalette': 'ocean'})
    resp = client.put('/api/prefs', headers=auth_headers, json={'dashBackdropSeed': 4294967295})
    assert resp.status_code == 200
    assert client.get('/api/prefs', headers=auth_headers).json() == {
        'dashPalette': 'ocean', 'dashBackdropSeed': 4294967295,
    }
    client.put('/api/prefs', headers=auth_headers, json={'calendarDesign': 'classic'})
    assert client.get('/api/prefs', headers=auth_headers).json()['dashBackdropSeed'] == 4294967295
    resp = client.put('/api/prefs', headers=auth_headers, json={'dashBackdropSeed': 0})
    assert resp.status_code == 200
    assert client.get('/api/prefs', headers=auth_headers).json() == {
        'dashPalette': 'ocean', 'calendarDesign': 'classic', 'dashBackdropSeed': 0,
    }


def test_malformed_backdrop_seeds_are_rejected(client, auth_headers):
    for seed in [-1, 4294967296, 1.5, '123', True, [], {}]:
        resp = client.put('/api/prefs', headers=auth_headers, json={'dashBackdropSeed': seed})
        assert resp.status_code == 422, seed
    assert client.get('/api/prefs', headers=auth_headers).json() == {}
