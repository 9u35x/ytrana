"""Focused account settings/archive tests; uses a disposable SQLite database."""
from test_api import app
from fastapi.testclient import TestClient

client = TestClient(app)
def _auth(token): return {"Authorization": f"Bearer {token}"}
def _register(name):
    r=client.post('/api/auth/register', json={'username':name,'email':f'{name}@example.com','full_name':name,'password':'Password123'})
    assert r.status_code == 201, r.text
    return r.json()['access_token']

def test_settings_and_owner_archive():
    token = _register('accountowner')
    r=client.get('/api/account/settings', headers=_auth(token)); assert r.status_code == 200
    r=client.patch('/api/account/settings', headers=_auth(token), json={'message_privacy':'following','content_visibility':'followers'})
    assert r.status_code == 200 and r.json()['content_visibility']=='followers'
    post=client.post('/api/posts', data={'content':'archive me'}, headers=_auth(token)); assert post.status_code==201
    pid=post.json()['id']
    archived=client.post(f'/api/account/archive/posts/{pid}', headers=_auth(token)); assert archived.status_code==200
    assert client.get('/api/posts/feed', headers=_auth(token)).json()==[]
    assert client.get('/api/account/archive?kind=posts', headers=_auth(token)).json()[0]['id']==pid
    assert client.delete(f'/api/account/archive/posts/{pid}', headers=_auth(token)).status_code==200
