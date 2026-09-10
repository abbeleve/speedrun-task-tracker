"""FastAPI application for the SpeedRun Task Tracker backend.

All data is stored per-user in a SQLite file. Authentication uses opaque bearer
tokens; every read/write endpoint is scoped to the authenticated user.
"""

import json
import os
import sqlite3
from contextlib import asynccontextmanager
from urllib.parse import quote

from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.responses import FileResponse
from fastapi.security import HTTPAuthorizationCredentials

from . import db, security
from .deps import bearer_scheme, get_current_user, get_db
from .schemas import (
    DayStateIn,
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
    # Ensure the pictures directory exists so it is a clear drop-in target.
    os.makedirs(motivation_dir(), exist_ok=True)
    yield


app = FastAPI(title='SpeedRun Task Tracker API', lifespan=lifespan)


@app.get('/api/health')
def health() -> dict:
    return {'status': 'ok'}


# ── Motivational pictures ───────────────────────────────────────────
# Served from a plain directory so pictures live outside git and can be dropped
# in on the server. The endpoints are public: an `<img>` tag cannot send the
# bearer token, and the pictures are not user data.

_IMAGE_EXTS = {'.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'}


def motivation_dir() -> str:
    """Directory the motivational pictures are served from.

    Configurable via ``MOTIVATION_DIR``; defaults to ``data/motivation`` next to
    the backend package.
    """
    path = os.environ.get('MOTIVATION_DIR')
    if path:
        return os.path.abspath(path)
    return os.path.abspath(
        os.path.join(os.path.dirname(__file__), '..', 'data', 'motivation')
    )


def _list_motivation() -> list[str]:
    directory = motivation_dir()
    try:
        names = sorted(os.listdir(directory))
    except FileNotFoundError:
        return []
    return [
        name
        for name in names
        if os.path.splitext(name)[1].lower() in _IMAGE_EXTS
        and os.path.isfile(os.path.join(directory, name))
    ]


@app.get('/api/motivation')
def get_motivation() -> list[str]:
    """URLs of the available motivational pictures."""
    return [f'/api/motivation/{quote(name)}' for name in _list_motivation()]


@app.get('/api/motivation/{filename}')
def get_motivation_image(filename: str):
    name = os.path.basename(filename)
    path = os.path.join(motivation_dir(), name)
    if os.path.splitext(name)[1].lower() not in _IMAGE_EXTS or not os.path.isfile(path):
        raise HTTPException(status.HTTP_404_NOT_FOUND, 'Image not found')
    return FileResponse(path)


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


# ── Per-day tracker state (tasks + timeline progress) ───────────────

_EMPTY_DAY = {
    'tasks': [],
    'elapsedMs': 0,
    'timeCredit': 0,
    'sessionState': 'idle',
    'startedAt': None,
}


@app.get('/api/day-dates')
def get_day_dates(
    user=Depends(get_current_user), conn: sqlite3.Connection = Depends(get_db)
):
    rows = conn.execute(
        'SELECT date FROM day_state WHERE user_id = ? ORDER BY date', (user['id'],)
    ).fetchall()
    return [r['date'] for r in rows]


@app.get('/api/days')
def get_days(
    user=Depends(get_current_user), conn: sqlite3.Connection = Depends(get_db)
):
    rows = conn.execute(
        'SELECT date, data FROM day_state WHERE user_id = ? ORDER BY date', (user['id'],)
    ).fetchall()
    return {r['date']: {'date': r['date'], **json.loads(r['data'])} for r in rows}


@app.get('/api/day/{date}')
def get_day(
    date: str,
    user=Depends(get_current_user),
    conn: sqlite3.Connection = Depends(get_db),
):
    row = conn.execute(
        'SELECT data FROM day_state WHERE user_id = ? AND date = ?', (user['id'], date)
    ).fetchone()
    if row is None:
        return {'date': date, **_EMPTY_DAY}
    return {'date': date, **json.loads(row['data'])}


@app.put('/api/day/{date}')
def put_day(
    date: str,
    body: DayStateIn,
    user=Depends(get_current_user),
    conn: sqlite3.Connection = Depends(get_db),
):
    conn.execute(
        """
        INSERT INTO day_state (user_id, date, data, updated_at)
        VALUES (?, ?, ?, datetime('now'))
        ON CONFLICT(user_id, date) DO UPDATE SET
            data = excluded.data,
            updated_at = excluded.updated_at
        """,
        (user['id'], date, body.model_dump_json()),
    )
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
