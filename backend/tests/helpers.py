from fastapi.testclient import TestClient


def register(
    api: TestClient, username: str = 'alice', password: str = 'secret123'
) -> dict:
    resp = api.post('/api/register', json={'username': username, 'password': password})
    assert resp.status_code == 200, resp.text
    return resp.json()
