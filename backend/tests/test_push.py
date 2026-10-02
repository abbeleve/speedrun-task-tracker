"""Tests for Web Push: the subscription endpoints and what the loop sends."""

from datetime import datetime
from zoneinfo import ZoneInfo

from pywebpush import WebPushException

from app import db, push
from tests.helpers import register

MSK = ZoneInfo('Europe/Moscow')
DAY = '2026-10-02'
SUB = {
    'endpoint': 'https://push.example/alice',
    'keys': {'p256dh': 'p256', 'auth': 'secret'},
    'timeZone': 'Europe/Moscow',
}


def at(day: str, hh: int, mm: int = 0, tz: ZoneInfo = MSK) -> float:
    return datetime.fromisoformat(f'{day}T{hh:02}:{mm:02}').replace(tzinfo=tz).timestamp() * 1000


def task(**fields) -> dict:
    base = {
        'id': 't1', 'name': 'Отчёт', 'emoji': '📋', 'plannedTime': 3600,
        'start': 10 * 60, 'day': DAY, 'status': 'in-progress', 'finishedAt': None,
        'type': 'task',
    }
    return {**base, **fields}


def rows() -> list:
    conn = db.get_conn()
    try:
        return [dict(r) for r in conn.execute('SELECT * FROM push_subscriptions')]
    finally:
        conn.close()


# ── what is due ─────────────────────────────────────────────────────

def test_a_block_starting_in_the_window_is_due():
    events = push.due_events([task()], MSK, at(DAY, 9, 59), at(DAY, 10, 0))
    assert events == [{'tag': 't1:start', 'title': '📋 Отчёт', 'body': 'Начинается · 10:00–11:00'}]


def test_the_window_takes_its_end_but_not_its_start():
    assert push.due_events([task()], MSK, at(DAY, 10, 0), at(DAY, 10, 1)) == []


def test_a_block_running_out_open_is_due():
    events = push.due_events([task()], MSK, at(DAY, 10, 59), at(DAY, 11, 0))
    assert [e['tag'] for e in events] == ['t1:end']
    assert events[0]['body'] == 'Время вышло · 10:00–11:00 — блок не закрыт'


def test_closed_and_backlog_blocks_say_nothing():
    tasks = [
        task(id='done', status='done', finishedAt=at(DAY, 9)),
        task(id='ticked', finishedAt=at(DAY, 9)),
        task(id='backlog', status='open'),
        task(id='unplaced', start=None),
    ]
    assert push.due_events(tasks, MSK, at(DAY, 9, 59), at(DAY, 11)) == []


def test_a_reminder_only_announces_its_start():
    reminder = task(type='reminder', start=17 * 60, plannedTime=5 * 3600)
    events = push.due_events([reminder], MSK, at(DAY, 16), at(DAY, 23))
    assert [(e['tag'], e['body']) for e in events] == [('t1:start', 'Напоминание · 17:00–22:00')]


def test_slots_are_read_in_the_browsers_time_zone():
    utc = ZoneInfo('UTC')
    # 10:00 in Moscow is 07:00 UTC.
    assert push.due_events([task()], utc, at(DAY, 9, 59), at(DAY, 10, 0)) == []
    assert len(push.due_events([task()], utc, at(DAY, 9, 59, utc), at(DAY, 10, 0, utc))) == 1


# ── endpoints ───────────────────────────────────────────────────────

def test_the_key_is_made_once(client, auth_headers):
    first = client.get('/api/push/key', headers=auth_headers).json()['publicKey']
    assert len(first) == 87  # 65-byte uncompressed P-256 point, base64url
    assert client.get('/api/push/key', headers=auth_headers).json()['publicKey'] == first


def test_push_needs_a_login(client):
    assert client.get('/api/push/key').status_code == 401
    assert client.put('/api/push/subscription', json=SUB).status_code == 401


def test_subscribing_rejects_bad_input(client, auth_headers):
    bad_zone = {**SUB, 'timeZone': 'Mars/Olympus'}
    assert client.put('/api/push/subscription', headers=auth_headers, json=bad_zone).status_code == 422
    plain_http = {**SUB, 'endpoint': 'http://127.0.0.1:8000/api/health'}
    assert client.put('/api/push/subscription', headers=auth_headers, json=plain_http).status_code == 422
    assert rows() == []


def test_a_browser_belongs_to_the_last_login_that_subscribed_it(client, auth_headers):
    assert client.put('/api/push/subscription', headers=auth_headers, json=SUB).status_code == 204
    bob = register(client, username='bob', password='secret456')
    bob_headers = {'Authorization': f"Bearer {bob['token']}"}
    client.put('/api/push/subscription', headers=bob_headers, json={**SUB, 'timeZone': 'UTC'})
    [row] = rows()
    assert row['session_token'] == bob['token']
    assert row['time_zone'] == 'UTC'


def test_unsubscribing_only_touches_your_own_browser(client, auth_headers):
    client.put('/api/push/subscription', headers=auth_headers, json=SUB)
    bob = register(client, username='bob', password='secret456')
    bob_headers = {'Authorization': f"Bearer {bob['token']}"}
    client.request('DELETE', '/api/push/subscription', headers=bob_headers, json={'endpoint': SUB['endpoint']})
    assert len(rows()) == 1
    resp = client.request('DELETE', '/api/push/subscription', headers=auth_headers, json={'endpoint': SUB['endpoint']})
    assert resp.status_code == 204
    assert rows() == []


def test_logging_out_stops_the_pushes(client, auth_headers):
    client.put('/api/push/subscription', headers=auth_headers, json=SUB)
    client.post('/api/logout', headers=auth_headers)
    assert rows() == []


# ── sending ─────────────────────────────────────────────────────────

class FakePush:
    def __init__(self, fail_status=None):
        self.sent = []
        self.fail_status = fail_status

    def __call__(self, subscription_info, data, vapid_private_key, vapid_claims, **_):
        assert 'aud' not in vapid_claims  # the real webpush writes it in
        vapid_claims['aud'] = 'https://push.example'
        self.sent.append((subscription_info['endpoint'], data))
        if self.fail_status:
            response = type('Response', (), {'status_code': self.fail_status, 'text': ''})()
            raise WebPushException('push refused', response=response)


def save_day(client, headers, day, tasks):
    resp = client.put(f'/api/day/{day}', headers=headers, json={'tasks': tasks})
    assert resp.status_code == 200, resp.text


def test_each_due_block_is_pushed_to_its_owners_browsers(client, auth_headers, monkeypatch):
    save_day(client, auth_headers, DAY, [task(), task(id='t2', start=10 * 60)])
    client.put('/api/push/subscription', headers=auth_headers, json=SUB)
    bob = register(client, username='bob', password='secret456')
    bob_headers = {'Authorization': f"Bearer {bob['token']}"}
    client.put('/api/push/subscription', headers=bob_headers, json={**SUB, 'endpoint': 'https://push.example/bob'})

    fake = FakePush()
    monkeypatch.setattr(push, 'webpush', fake)
    push.send_due(at(DAY, 10) - 30_000, at(DAY, 10))
    assert [endpoint for endpoint, _ in fake.sent] == [SUB['endpoint'], SUB['endpoint']]
    assert '"t1:start"' in fake.sent[0][1] and '"t2:start"' in fake.sent[1][1]


def test_a_block_from_yesterday_running_out_after_midnight_is_pushed(client, auth_headers, monkeypatch):
    save_day(client, auth_headers, '2026-10-01', [task(day='2026-10-01', start=23 * 60 + 30)])
    client.put('/api/push/subscription', headers=auth_headers, json=SUB)
    fake = FakePush()
    monkeypatch.setattr(push, 'webpush', fake)
    push.send_due(at(DAY, 0, 30) - 30_000, at(DAY, 0, 30))
    assert len(fake.sent) == 1 and '"t1:end"' in fake.sent[0][1]


def test_a_browser_that_dropped_the_subscription_is_forgotten(client, auth_headers, monkeypatch):
    save_day(client, auth_headers, DAY, [task(), task(id='t2')])
    client.put('/api/push/subscription', headers=auth_headers, json=SUB)
    fake = FakePush(fail_status=410)
    monkeypatch.setattr(push, 'webpush', fake)
    push.send_due(at(DAY, 9, 59), at(DAY, 10, 0))
    assert len(fake.sent) == 1  # not tried again for the second block
    assert rows() == []


def test_other_failures_keep_the_subscription(client, auth_headers, monkeypatch):
    save_day(client, auth_headers, DAY, [task()])
    client.put('/api/push/subscription', headers=auth_headers, json=SUB)
    monkeypatch.setattr(push, 'webpush', FakePush(fail_status=500))
    push.send_due(at(DAY, 9, 59), at(DAY, 10, 0))
    assert len(rows()) == 1
