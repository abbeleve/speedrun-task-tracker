import sqlite3
from typing import Generator

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .db import get_conn

# auto_error=False lets us issue our own 401 body/logic.
bearer_scheme = HTTPBearer(auto_error=False)


def get_db() -> Generator[sqlite3.Connection, None, None]:
    conn = get_conn()
    try:
        yield conn
    finally:
        conn.close()


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    conn: sqlite3.Connection = Depends(get_db),
) -> sqlite3.Row:
    if credentials is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, 'Not authenticated')
    row = conn.execute(
        'SELECT user_id FROM sessions WHERE token = ?', (credentials.credentials,)
    ).fetchone()
    if row is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, 'Invalid token')
    user = conn.execute('SELECT * FROM users WHERE id = ?', (row['user_id'],)).fetchone()
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, 'Invalid token')
    return user
