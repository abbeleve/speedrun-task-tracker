def test_motivation_empty(client):
    resp = client.get('/api/motivation')
    assert resp.status_code == 200
    assert resp.json() == []


def test_motivation_lists_and_serves_images(client, tmp_path):
    (tmp_path / 'cat.png').write_bytes(b'PNGDATA')
    (tmp_path / 'notes.txt').write_text('not an image')

    resp = client.get('/api/motivation')
    assert resp.status_code == 200
    assert resp.json() == ['/api/motivation/cat.png']

    img = client.get('/api/motivation/cat.png')
    assert img.status_code == 200
    assert img.content == b'PNGDATA'


def test_motivation_rejects_non_images_and_missing(client, tmp_path):
    (tmp_path / 'notes.txt').write_text('not an image')
    assert client.get('/api/motivation/notes.txt').status_code == 404
    assert client.get('/api/motivation/missing.png').status_code == 404
