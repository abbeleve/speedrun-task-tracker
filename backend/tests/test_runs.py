import pytest

from tests.helpers import register


def test_runs_accepts_fractional_timestamps(client, auth_headers):
    # `elapsed` on the client comes from performance.now(), so `endedAt` can
    # carry sub-millisecond precision. It used to be rejected with a 422,
    # silently dropping every run.
    resp = client.post(
        '/api/runs',
        headers=auth_headers,
        json={
            'date': '2026-09-10',
            'startedAt': 1_750_000_000_000.0,
            'endedAt': 1_750_036_000_000.8875,
            'workSec': 600,
            'restSec': 60,
        },
    )
    assert resp.status_code == 204

    runs = client.get('/api/runs', headers=auth_headers).json()
    assert len(runs) == 1
    assert runs[0]['endedAt'] == pytest.approx(1_750_036_000_000.8875)


def test_run_stores_session_snapshot(client, auth_headers):
    # The plan is snapshotted onto the run so a day can show each session's
    # tasks and percent after the per-day tracker state is cleared.
    resp = client.post(
        '/api/runs',
        headers=auth_headers,
        json={
            'date': '2026-09-10',
            'startedAt': 1_750_000_000_000,
            'endedAt': 1_750_000_600_000,
            'workSec': 600,
            'restSec': 0,
            'plannedSec': 1800,
            'tasks': [
                {
                    'id': 't1',
                    'name': 'Dev',
                    'plannedTime': 900,
                    'completedAt': 300,
                    'order': 0,
                    'emoji': '🛠',
                    'color': '#fff',
                    'type': 'task',
                },
                {
                    'id': 't2',
                    'name': 'Review',
                    'plannedTime': 900,
                    'completedAt': None,
                    'order': 1,
                    'emoji': '👀',
                    'color': '#fff',
                    'type': 'task',
                },
            ],
        },
    )
    assert resp.status_code == 204

    run = client.get('/api/runs', headers=auth_headers).json()[0]
    assert run['plannedSec'] == 1800
    assert [t['name'] for t in run['tasks']] == ['Dev', 'Review']
    assert run['tasks'][0]['completedAt'] == 300
    assert run['tasks'][1]['completedAt'] is None


def test_migrates_old_run_sessions_table(tmp_path, monkeypatch):
    # A database created before run snapshots existed (user_version 1, no
    # planned_sec/tasks columns) must be upgraded in place.
    import sqlite3

    from app import db

    path = tmp_path / 'old.db'
    conn = sqlite3.connect(path)
    conn.executescript(
        """
        CREATE TABLE users (id INTEGER PRIMARY KEY);
        CREATE TABLE run_sessions (
            id INTEGER PRIMARY KEY,
            user_id INTEGER,
            date TEXT,
            started_at INTEGER,
            ended_at INTEGER,
            work_sec INTEGER,
            rest_sec INTEGER
        );
        PRAGMA user_version = 1;
        """
    )
    conn.commit()
    conn.close()

    monkeypatch.setenv('DATABASE_PATH', str(path))
    db.init_db()

    conn = sqlite3.connect(path)
    cols = {row[1] for row in conn.execute('PRAGMA table_info(run_sessions)')}
    assert {'planned_sec', 'tasks'} <= cols
    assert conn.execute('PRAGMA user_version').fetchone()[0] == 2


def test_runs_empty(client, auth_headers):
    resp = client.get('/api/runs', headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json() == []


def test_runs_crud_multiple_per_day(client, auth_headers):
    # Two runs on the same day
    for started, ended in ((1_750_000_000_000, 1_750_036_000_000), (1_750_050_000_000, 1_750_090_000_000)):
        resp = client.post(
            '/api/runs',
            headers=auth_headers,
            json={
                'date': '2026-09-10',
                'startedAt': started,
                'endedAt': ended,
                'workSec': 600,
                'restSec': 60,
            },
        )
        assert resp.status_code == 204

    # A run on another day
    client.post(
        '/api/runs',
        headers=auth_headers,
        json={'date': '2026-09-11', 'startedAt': 1_750_100_000_000, 'endedAt': 1_750_120_000_000},
    )

    runs = client.get('/api/runs', headers=auth_headers).json()
    assert len(runs) == 3
    # Ordered by date then started_at
    assert [r['date'] for r in runs] == ['2026-09-10', '2026-09-10', '2026-09-11']
    first = runs[0]
    assert first['workSec'] == 600
    assert first['restSec'] == 60
    assert first['startedAt'] == 1_750_000_000_000
    assert first['endedAt'] == 1_750_036_000_000
    assert 'id' in first


def test_runs_user_isolation(client):
    alice = register(client, username='alice', password='secret123')['token']
    bob = register(client, username='bob', password='secret123')['token']
    alice_h = {'Authorization': f'Bearer {alice}'}
    bob_h = {'Authorization': f'Bearer {bob}'}

    client.post(
        '/api/runs',
        headers=alice_h,
        json={'date': '2026-09-10', 'startedAt': 1_750_000_000_000, 'endedAt': 1_750_036_000_000},
    )

    assert client.get('/api/runs', headers=bob_h).json() == []
    assert len(client.get('/api/runs', headers=alice_h).json()) == 1
