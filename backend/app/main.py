"""FastAPI application for the SpeedRun Task Tracker backend.

All data is stored per-user in a SQLite file. Authentication uses opaque bearer
tokens; every read/write endpoint is scoped to the authenticated user.
"""

import json
import sqlite3
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials

from . import db, security
from .deps import bearer_scheme, get_current_user, get_db
from .schemas import (
    DayStatsIn,
    LoginIn,
    RegisterIn,
    SleepIn,
    TaskTemplateIn,
    TemplateIn,
    TokenOut,
    UserOut,
)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    db.init_db()
    yield


app = FastAPI(title='SpeedRun Task Tracker API', lifespan=lifespan)


@app.get('/api/health')
def health() -> dict:
    return {'status': 'ok'}


# ── Auth ────────────────────────────────────────────────────────────

@app.post('/api/register', response_model=TokenOut)
def register(body: RegisterIn, conn: sqlite3.Connection = Depends(get_db)):
    username = body.username.strip()
    if len(username) < 3:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, 'Username is too short')
    existing = conn.execute(
        'SELECT id FROM users WHERE username = ?', (username,)
    ).fetchone()
    if existing:
        raise HTTPException(status.HTTP_409_CONFLICT, 'Username is already taken')
    password_hash = security.hash_password(body.password)
    cur = conn.execute(
        'INSERT INTO users (username, password_hash) VALUES (?, ?)',
        (username, password_hash),
    )
    conn.commit()
    token = security.new_token()
    conn.execute(
        'INSERT INTO sessions (token, user_id) VALUES (?, ?)',
        (token, cur.lastrowid),
    )
    conn.commit()
    return TokenOut(token=token, username=username)


@app.post('/api/login', response_model=TokenOut)
def login(body: LoginIn, conn: sqlite3.Connection = Depends(get_db)):
    user = conn.execute(
        'SELECT * FROM users WHERE username = ?', (body.username.strip(),)
    ).fetchone()
    if user is None or not security.verify_password(body.password, user['password_hash']):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, 'Invalid username or password')
    token = security.new_token()
    conn.execute(
        'INSERT INTO sessions (token, user_id) VALUES (?, ?)',
        (token, user['id']),
    )
    conn.commit()
    return TokenOut(token=token, username=user['username'])


@app.post('/api/logout', status_code=204)
def logout(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    conn: sqlite3.Connection = Depends(get_db),
):
    if credentials is not None:
        conn.execute('DELETE FROM sessions WHERE token = ?', (credentials.credentials,))
        conn.commit()
    return None


@app.get('/api/me', response_model=UserOut)
def me(user=Depends(get_current_user)):
    return UserOut(id=user['id'], username=user['username'])


# ── History (daily sprints) ─────────────────────────────────────────

@app.get('/api/history')
def get_history(user=Depends(get_current_user), conn: sqlite3.Connection = Depends(get_db)):
    rows = conn.execute(
        'SELECT date, work_sec, rest_sec, sessions FROM history WHERE user_id = ?',
        (user['id'],),
    ).fetchall()
    return {
        r['date']: {
            'date': r['date'],
            'workSec': r['work_sec'],
            'restSec': r['rest_sec'],
            'sessions': r['sessions'],
        }
        for r in rows
    }


@app.put('/api/history/{date}')
def put_history(
    date: str,
    body: DayStatsIn,
    user=Depends(get_current_user),
    conn: sqlite3.Connection = Depends(get_db),
):
    conn.execute(
        """
        INSERT INTO history (user_id, date, work_sec, rest_sec, sessions)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(user_id, date) DO UPDATE SET
            work_sec = excluded.work_sec,
            rest_sec = excluded.rest_sec,
            sessions = excluded.sessions
        """,
        (user['id'], date, body.workSec, body.restSec, body.sessions),
    )
    conn.commit()
    return {'ok': True}


@app.delete('/api/history/{date}')
def delete_history(
    date: str,
    user=Depends(get_current_user),
    conn: sqlite3.Connection = Depends(get_db),
):
    conn.execute('DELETE FROM history WHERE user_id = ? AND date = ?', (user['id'], date))
    conn.commit()
    return {'ok': True}


# ── Sleep log ───────────────────────────────────────────────────────

@app.get('/api/sleep')
def get_sleep(user=Depends(get_current_user), conn: sqlite3.Connection = Depends(get_db)):
    rows = conn.execute(
        'SELECT date, hours, quality FROM sleep_log WHERE user_id = ?', (user['id'],)
    ).fetchall()
    return {
        r['date']: {'hours': json.loads(r['hours']), 'quality': r['quality']}
        for r in rows
    }


@app.put('/api/sleep/{date}')
def put_sleep(
    date: str,
    body: SleepIn,
    user=Depends(get_current_user),
    conn: sqlite3.Connection = Depends(get_db),
):
    conn.execute('DELETE FROM sleep_log WHERE user_id = ? AND date = ?', (user['id'], date))
    has_data = bool(body.hours) or body.quality is not None
    if has_data:
        conn.execute(
            'INSERT INTO sleep_log (user_id, date, hours, quality) VALUES (?, ?, ?, ?)',
            (user['id'], date, json.dumps(body.hours or []), body.quality),
        )
    conn.commit()
    return {'ok': True}


# ── Saved run templates ─────────────────────────────────────────────

@app.get('/api/templates')
def get_templates(user=Depends(get_current_user), conn: sqlite3.Connection = Depends(get_db)):
    rows = conn.execute(
        'SELECT data FROM templates WHERE user_id = ?', (user['id'],)
    ).fetchall()
    return [json.loads(r['data']) for r in rows]


@app.put('/api/templates/{tpl_id}')
def put_template(
    tpl_id: str,
    body: TemplateIn,
    user=Depends(get_current_user),
    conn: sqlite3.Connection = Depends(get_db),
):
    conn.execute(
        """
        INSERT INTO templates (user_id, id, data) VALUES (?, ?, ?)
        ON CONFLICT(user_id, id) DO UPDATE SET data = excluded.data
        """,
        (user['id'], tpl_id, body.model_dump_json()),
    )
    conn.commit()
    return {'ok': True}


@app.delete('/api/templates/{tpl_id}')
def delete_template(
    tpl_id: str,
    user=Depends(get_current_user),
    conn: sqlite3.Connection = Depends(get_db),
):
    conn.execute(
        'DELETE FROM templates WHERE user_id = ? AND id = ?', (user['id'], tpl_id)
    )
    conn.commit()
    return {'ok': True}


# ── Task templates (sidebar) ────────────────────────────────────────

@app.get('/api/task-templates')
def get_task_templates(
    user=Depends(get_current_user), conn: sqlite3.Connection = Depends(get_db)
):
    rows = conn.execute(
        'SELECT data FROM task_templates WHERE user_id = ?', (user['id'],)
    ).fetchall()
    return [json.loads(r['data']) for r in rows]


@app.put('/api/task-templates/{tpl_id}')
def put_task_template(
    tpl_id: str,
    body: TaskTemplateIn,
    user=Depends(get_current_user),
    conn: sqlite3.Connection = Depends(get_db),
):
    conn.execute(
        """
        INSERT INTO task_templates (user_id, id, data) VALUES (?, ?, ?)
        ON CONFLICT(user_id, id) DO UPDATE SET data = excluded.data
        """,
        (user['id'], tpl_id, body.model_dump_json()),
    )
    conn.commit()
    return {'ok': True}


@app.delete('/api/task-templates/{tpl_id}')
def delete_task_template(
    tpl_id: str,
    user=Depends(get_current_user),
    conn: sqlite3.Connection = Depends(get_db),
):
    conn.execute(
        'DELETE FROM task_templates WHERE user_id = ? AND id = ?', (user['id'], tpl_id)
    )
    conn.commit()
    return {'ok': True}
