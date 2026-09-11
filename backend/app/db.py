"""SQLite persistence layer.

The database is a single SQLite file. The path is configurable through the
``DATABASE_PATH`` environment variable (used by tests), and defaults to a
``data/tracker.db`` file next to the backend package.
"""

import os
import sqlite3

_SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS history (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    work_sec INTEGER NOT NULL DEFAULT 0,
    rest_sec INTEGER NOT NULL DEFAULT 0,
    sessions INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, date)
);

-- One row per completed run (session), so a day can hold multiple runs and the
-- UI can show them individually. Tied to the day the run started (`date`).
CREATE TABLE IF NOT EXISTS run_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    ended_at INTEGER NOT NULL,
    work_sec INTEGER NOT NULL DEFAULT 0,
    rest_sec INTEGER NOT NULL DEFAULT 0,
    planned_sec INTEGER NOT NULL DEFAULT 0,
    tasks TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS day_state (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, date)
);

CREATE TABLE IF NOT EXISTS sleep_log (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    hours TEXT NOT NULL DEFAULT '[]',
    quality INTEGER,
    PRIMARY KEY (user_id, date)
);

CREATE TABLE IF NOT EXISTS templates (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY (user_id, id)
);

CREATE TABLE IF NOT EXISTS task_templates (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY (user_id, id)
);
"""


def default_db_path() -> str:
    return os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'data', 'tracker.db'))


def _db_path() -> str:
    path = os.environ.get('DATABASE_PATH')
    return path if path else default_db_path()


# Bumped whenever the schema changes. Stored in SQLite's built-in
# ``PRAGMA user_version`` so migrations run once per database.
_SCHEMA_VERSION = 2


def init_db() -> None:
    path = _db_path()
    dirname = os.path.dirname(path)
    if dirname and path != ':memory:':
        os.makedirs(dirname, exist_ok=True)
    with sqlite3.connect(path) as conn:
        _migrate(conn)


def _migrate(conn: sqlite3.Connection) -> None:
    """Bring an existing database up to the current schema version.

    The base schema is written with ``CREATE TABLE IF NOT EXISTS``, so it is
    idempotent and safe to run on both fresh and existing files. SQLite has no
    ``ALTER TABLE ... ADD COLUMN IF NOT EXISTS``, so future column changes get a
    numbered step guarded by the stored ``user_version`` — each runs exactly
    once. New tables alone need no step here; they are covered by ``_SCHEMA``.
    """
    version = conn.execute('PRAGMA user_version').fetchone()[0]
    conn.executescript(_SCHEMA)
    if version < 2:
        # Existing databases already have run_sessions from the previous
        # version, so ``_SCHEMA`` cannot add the new columns to them. Guard
        # each ADD COLUMN so a freshly created table (which already has them)
        # is left untouched.
        _add_column_if_missing(
            conn, 'run_sessions', 'planned_sec', 'INTEGER NOT NULL DEFAULT 0'
        )
        _add_column_if_missing(
            conn, 'run_sessions', 'tasks', "TEXT NOT NULL DEFAULT '[]'"
        )
    if version < _SCHEMA_VERSION:
        conn.execute(f'PRAGMA user_version = {_SCHEMA_VERSION}')


def _add_column_if_missing(
    conn: sqlite3.Connection, table: str, column: str, definition: str
) -> None:
    existing = {row[1] for row in conn.execute(f'PRAGMA table_info({table})')}
    if column not in existing:
        conn.execute(f'ALTER TABLE {table} ADD COLUMN {column} {definition}')


def get_conn() -> sqlite3.Connection:
    # FastAPI runs sync dependencies (get_db) through a threadpool, so setup and
    # teardown may happen in different threads. Each connection still belongs to
    # a single request and is never shared concurrently, so disabling the
    # same-thread check is safe and avoids the periodic "created in a thread"
    # error when the connection is closed.
    conn = sqlite3.connect(_db_path(), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA foreign_keys = ON')
    return conn
