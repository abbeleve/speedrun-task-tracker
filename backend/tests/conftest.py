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
def client(db_file, tmp_path):
    """A fresh TestClient backed by a private, temporary SQLite file."""
    old = os.environ.get('DATABASE_PATH')
    old_motivation = os.environ.get('MOTIVATION_DIR')
    os.environ['DATABASE_PATH'] = db_file
    os.environ['MOTIVATION_DIR'] = str(tmp_path)
    from app.main import app

    with TestClient(app) as c:
        yield c

    if old is None:
        os.environ.pop('DATABASE_PATH', None)
    else:
        os.environ['DATABASE_PATH'] = old
    if old_motivation is None:
        os.environ.pop('MOTIVATION_DIR', None)
    else:
        os.environ['MOTIVATION_DIR'] = old_motivation


@pytest.fixture
def auth_headers(client):
    """Register a user and return Authorization headers for them."""
    from tests.helpers import register

    data = register(client)
    return {'Authorization': f"Bearer {data['token']}"}
