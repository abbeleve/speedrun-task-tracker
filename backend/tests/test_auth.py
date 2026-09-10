def test_health(client):
    resp = client.get('/api/health')
    assert resp.status_code == 200
    assert resp.json() == {'status': 'ok'}


def test_register_and_login_flow(client):
    reg = client.post(
        '/api/register', json={'username': 'bob', 'password': 'hunter22'}
    )
    assert reg.status_code == 200
    body = reg.json()
    assert body['username'] == 'bob'
    assert len(body['token']) > 0

    login = client.post(
        '/api/login', json={'username': 'bob', 'password': 'hunter22'}
    )
    assert login.status_code == 200
    assert login.json()['username'] == 'bob'


def test_login_wrong_password(client):
    client.post('/api/register', json={'username': 'kim', 'password': 'secret123'})
    resp = client.post('/api/login', json={'username': 'kim', 'password': 'nope'})
    assert resp.status_code == 401


def test_login_unknown_user(client):
    resp = client.post('/api/login', json={'username': 'ghost', 'password': 'x'})
    assert resp.status_code == 401


def test_register_duplicate_username(client):
    client.post('/api/register', json={'username': 'alice', 'password': 'secret123'})
    resp = client.post('/api/register', json={'username': 'alice', 'password': 'other99'})
    assert resp.status_code == 409


def test_protected_endpoint_requires_token(client):
    resp = client.get('/api/me')
    assert resp.status_code == 401


def test_me_returns_user(client, auth_headers):
    resp = client.get('/api/me', headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()['username'] == 'alice'


def test_invalid_token_rejected(client):
    resp = client.get('/api/me', headers={'Authorization': 'Bearer bogus'})
    assert resp.status_code == 401


def test_logout_invalidates_token(client):
    data = client.post(
        '/api/register', json={'username': 'tom', 'password': 'secret123'}
    ).json()
    headers = {'Authorization': f"Bearer {data['token']}"}
    assert client.get('/api/me', headers=headers).status_code == 200
    assert client.post('/api/logout', headers=headers).status_code == 204
    assert client.get('/api/me', headers=headers).status_code == 401
