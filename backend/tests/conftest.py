import os
import tempfile

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def db_file():
    fd, path = tempfile.mkstemp(suffix='.db')
    os.close(fd)
    yield path
    if os.path.exists(path):
        os.remove(path)


@pytest.fixture
def client(db_file):
    """A fresh TestClient backed by a private, temporary SQLite file."""
    old = os.environ.get('DATABASE_PATH')
    os.environ['DATABASE_PATH'] = db_file
    from app.main import app

    with TestClient(app) as c:
        yield c

    if old is None:
        os.environ.pop('DATABASE_PATH', None)
    else:
        os.environ['DATABASE_PATH'] = old


@pytest.fixture
def auth_headers(client):
    """Register a user and return Authorization headers for them."""
    from tests.helpers import register

    data = register(client)
    return {'Authorization': f"Bearer {data['token']}"}
