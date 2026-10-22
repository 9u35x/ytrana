"""Real API privacy regressions; all state lives in test_api's disposable database."""
import io
import uuid
from datetime import timedelta
from pathlib import Path

from test_api import app, SessionLocal
from fastapi.testclient import TestClient
from PIL import Image
from models.models import Story, StoryView, ReelView, utcnow_naive

client = TestClient(app)

def register():
    name = 'privacy_' + uuid.uuid4().hex[:12]
    response = client.post('/api/auth/register', json={'username': name, 'email': name+'@example.com', 'full_name': name, 'password': 'Password123'})
    assert response.status_code == 201, response.text
    data = response.json()
    return name, {'Authorization': 'Bearer '+data['access_token']}, data['user']['id']

def patch(headers, **values):
    response = client.patch('/api/account/settings', headers=headers, json=values)
    assert response.status_code == 200, response.text
    return response.json()

def image_bytes():
    data = io.BytesIO()
    Image.new('RGB', (12, 12), 'blue').save(data, format='PNG')
    return data.getvalue()

def make_content(headers):
    post = client.post('/api/posts', headers=headers, data={'content':'private post text'}, files={'image':('image.png', image_bytes(), 'image/png')})
    story = client.post('/api/stories', headers=headers, data={'caption':'private story text'}, files={'image':('story.png', image_bytes(), 'image/png')})
    video = (Path(__file__).parent/'fixtures/reel-smoke.mp4').read_bytes()
    reel = client.post('/api/reels', headers=headers, data={'caption':'private reel text'}, files={'video':('video.mp4', video, 'video/mp4')})
    for response in (post, story, reel):
        assert response.status_code == 201, response.text
    return post.json(), story.json(), reel.json()

def test_private_content_all_direct_media_and_revocation_paths():
    owner, own, _ = register()
    follower, accepted, _ = register()
    _, stranger, _ = register()
    assert client.post(f'/api/users/{owner}/follow', headers=accepted).status_code == 200
    post, story, reel = make_content(own)
    patch(own, account_visibility='private')
    for headers in ({}, stranger):
        assert client.get(f'/api/posts/{post["id"]}', headers=headers).status_code == 404
        assert not any(p['id']==post['id'] for p in client.get('/api/posts/explore?limit=50',headers=headers).json())
        assert client.get(f'/api/posts/user/{owner}',headers=headers).json() == []
        for raw in (post['image_url'], story['image_url'], reel['video_url']):
            assert client.get(raw,headers=headers).status_code == 404
    for path in (f'/api/private-media/posts/{post["id"]}/image', f'/api/private-media/stories/{story["id"]}/image', f'/api/private-media/reels/{reel["id"]}/video'):
        assert client.get(path,headers=stranger).status_code == 404
        assert client.get(path,headers=accepted).status_code == 200
    for path in (f'/api/posts/{post["id"]}/like', f'/api/stories/{story["id"]}/view', f'/api/reels/{reel["id"]}/view', f'/api/reels/{reel["id"]}/like'):
        assert client.post(path,headers=stranger).status_code == 404
    assert client.post(f'/api/posts/{post["id"]}/comments',headers=stranger,json={'content':'no access'}).status_code == 404
    assert client.get(f'/api/posts/{post["id"]}/comments',headers=stranger).status_code == 404
    assert client.post(f'/api/posts/{post["id"]}/comments',headers=accepted,json={'content':'allowed'}).status_code == 201
    assert client.get(f'/api/posts/{post["id"]}',headers=accepted).status_code == 200
    assert any(p['id']==reel['id'] for p in client.get('/api/reels/feed?limit=30',headers=accepted).json())
    assert client.delete(f'/api/users/{owner}/follow',headers=accepted).status_code == 200
    assert client.get(f'/api/posts/{post["id"]}',headers=accepted).status_code == 404
    assert client.get(f'/api/private-media/reels/{reel["id"]}/video',headers=accepted).status_code == 404
    with SessionLocal() as db:
        assert db.query(StoryView).filter_by(story_id=story['id']).count()==0
        assert db.query(ReelView).filter_by(reel_id=reel['id']).count()==0


def test_private_follow_request_real_profile_contract_and_authorization():
    owner, own, _ = register()
    requester, req, _ = register()
    _, stranger, _ = register()
    defaults = client.get('/api/account/settings',headers=own).json()
    assert defaults['account_visibility']=='public' and defaults['show_activity_status'] is True
    assert defaults['comment_privacy']==defaults['message_privacy']=='everyone'
    assert client.put('/api/users/me',headers=own,json={'bio':'hidden private biography'}).status_code==200
    patch(own, account_visibility='private')
    assert client.post(f'/api/users/{owner}/follow',headers=req).status_code==200
    profile = client.get(f'/api/users/{owner}',headers=req).json()
    assert profile['follow_request_status']=='pending' and profile['follow_request_pending'] is True
    assert profile['follow_status']=='pending' and profile['can_view_content'] is False and profile['bio']==''
    result = client.get(f'/api/users/search?q={owner}',headers=stranger).json()
    assert next(p for p in result if p['username']==owner)['bio']==''
    pending=client.get('/api/account/follow-requests',headers=own).json()
    request_id=next(p['id'] for p in pending if p['requester']['username']==requester)
    assert client.post(f'/api/account/follow-requests/{request_id}/approve',headers=req).status_code==404
    assert client.get(f'/api/users/{owner}/followers',headers=req).status_code==403
    assert client.post(f'/api/account/follow-requests/{request_id}/approve',headers=own).status_code==200
    profile=client.get(f'/api/users/{owner}',headers=req).json()
    assert profile['is_followed_by_me'] is True and profile['can_view_content'] is True and profile['bio']=='hidden private biography'
    assert client.get(f'/api/users/{owner}/followers?limit=1',headers=req).status_code==200
    assert client.get(f'/api/users/{owner}/following',headers=stranger).status_code==403


def test_comment_and_message_controls_and_existing_activity_status():
    owner, own, _ = register()
    _, other, _ = register()
    post=client.post('/api/posts',headers=own,data={'content':'visible but comments controlled'}).json()
    patch(own, comment_privacy='nobody',message_privacy='nobody',show_activity_status=False)
    assert client.post(f'/api/posts/{post["id"]}/comments',headers=other,json={'content':'blocked'}).status_code==403
    assert client.post(f'/api/posts/{post["id"]}/comments',headers=own,json={'content':'owner permitted'}).status_code==201
    assert client.post(f'/api/messages/{owner}',headers=other,json={'content':'blocked'}).status_code==403
    assert client.post(f'/api/users/{owner}/follow',headers=other).status_code==200
    mood=client.post('/api/moods',headers=own,json={'mood_key':'happy','note':'hidden activity note'})
    assert mood.status_code==201, mood.text
    assert not any(s['user']['username']==owner for s in client.get('/api/moods/feed',headers=other).json())
    assert client.get('/api/moods/me',headers=own).json()['note']=='hidden activity note'
    patch(own, comment_privacy='followers',message_privacy='followers',show_activity_status=True)
    assert client.post(f'/api/posts/{post["id"]}/comments',headers=other,json={'content':'accepted follower'}).status_code==201
    assert client.post(f'/api/messages/{owner}',headers=other,json={'content':'accepted follower'}).status_code==201


def test_archive_media_owner_only_expiration_retains_and_cannot_republish():
    _, own, _ = register()
    _, stranger, _ = register()
    post, story, _ = make_content(own)
    assert client.post(f'/api/account/archive/posts/{post["id"]}',headers=stranger).status_code==404
    archived=client.post(f'/api/account/archive/posts/{post["id"]}',headers=own).json()
    assert '/media/image' in archived['image_url']
    assert client.get(archived['image_url'],headers=own).status_code==200
    assert client.get(archived['image_url'],headers=stranger).status_code==404
    assert client.get(post['image_url']).status_code==404
    assert client.get(post['image_url'].replace('/posts/','/posts//')).status_code==404
    with SessionLocal() as db:
        row=db.query(Story).filter_by(id=story['id']).one()
        row.expires_at=utcnow_naive()-timedelta(seconds=1)
        db.commit()
    client.get('/api/stories/feed',headers=own)
    archived_story=next(r for r in client.get('/api/account/archive?kind=stories',headers=own).json() if r['id']==story['id'])
    assert archived_story['can_restore'] is False
    assert client.get(archived_story['image_url'],headers=own).status_code==200
    assert client.get(archived_story['image_url'],headers=stranger).status_code==404
    assert client.delete(f'/api/account/archive/stories/{story["id"]}',headers=own).status_code==409
    assert client.post(f'/api/stories/{story["id"]}/view',headers=stranger).status_code==404


def test_public_circle_does_not_bypass_private_author_or_archive():
    owner, own, _ = register()
    _, viewer, _ = register()
    circle=client.post('/api/circles',headers=own,data={'name':'Private author public circle'}).json()
    post=client.post('/api/posts',headers=own,data={'content':'not public through circle','circle_id':circle['id']})
    assert post.status_code==201, post.text
    pid=post.json()['id']
    patch(own,account_visibility='private')
    assert not any(p['id']==pid for p in client.get(f'/api/circles/{circle["id"]}/posts',headers=viewer).json())
    patch(own,account_visibility='public')
    assert any(p['id']==pid for p in client.get(f'/api/circles/{circle["id"]}/posts',headers=viewer).json())
    assert client.post(f'/api/account/archive/posts/{pid}',headers=own).status_code==200
    assert not any(p['id']==pid for p in client.get(f'/api/circles/{circle["id"]}/posts',headers=viewer).json())


def test_additive_migration_preserves_existing_users_roles_posts_and_defaults():
    from sqlalchemy import create_engine, text
    from database.migrations import migrate_additive_media_columns
    engine=create_engine('sqlite:///:memory:')
    with engine.begin() as db:
        db.execute(text('CREATE TABLE users (id INTEGER PRIMARY KEY, username VARCHAR(30), is_admin BOOLEAN NOT NULL, bio TEXT)'))
        db.execute(text("INSERT INTO users VALUES (1,'404',1,'unchanged'),(3,'ytrana',1,'unchanged'),(8,'member',0,'unchanged')"))
        db.execute(text('CREATE TABLE posts (id INTEGER PRIMARY KEY, author_id INTEGER, content TEXT, image_url TEXT)'))
        db.execute(text("INSERT INTO posts VALUES(5,8,'preserve this post','/uploads/posts/existing.png')"))
    migrate_additive_media_columns(engine)
    migrate_additive_media_columns(engine)
    with engine.connect() as db:
        rows=db.execute(text('SELECT id,username,is_admin,bio,account_visibility,comment_privacy,message_privacy,show_activity_status,content_visibility FROM users ORDER BY id')).all()
        assert [tuple(r[:4]) for r in rows]==[(1,'404',1,'unchanged'),(3,'ytrana',1,'unchanged'),(8,'member',0,'unchanged')]
        assert all(tuple(r[4:])==('public','everyone','everyone',1,'everyone') for r in rows)
        assert tuple(db.execute(text('SELECT author_id,content,image_url FROM posts WHERE id=5')).one())==(8,'preserve this post','/uploads/posts/existing.png')
    engine.dispose()


def test_follow_request_rejection_cancellation_and_switch_to_public_do_not_leave_stale_grants():
    owner,own,_=register()
    requester,req,_=register()
    patch(own,account_visibility='private')
    def request_id():
        response=client.post(f'/api/users/{owner}/follow',headers=req)
        assert response.status_code==200,response.text
        return next(r['id'] for r in client.get('/api/account/follow-requests',headers=own).json() if r['requester']['username']==requester)
    rid=request_id()
    assert client.post(f'/api/account/follow-requests/{rid}/reject',headers=own).status_code==200
    assert client.get(f'/api/users/{owner}',headers=req).json()['can_view_content'] is False
    rid=request_id()
    assert client.delete(f'/api/users/{owner}/follow-request',headers=req).status_code==200
    assert client.post(f'/api/account/follow-requests/{rid}/approve',headers=own).status_code==404
    rid=request_id()
    patch(own,account_visibility='public')
    assert client.post(f'/api/users/{owner}/follow',headers=req).status_code==200
    assert not any(r['id']==rid for r in client.get('/api/account/follow-requests',headers=own).json())
    assert client.post(f'/api/account/follow-requests/{rid}/approve',headers=own).status_code==404
    assert client.delete(f'/api/users/{owner}/follow',headers=req).status_code==200
    patch(own,account_visibility='private')
    profile=client.get(f'/api/users/{owner}',headers=req).json()
    assert profile['is_followed_by_me'] is False and profile['follow_request_pending'] is False


def test_private_rows_are_filtered_before_feed_pagination():
    _,public,_=register()
    _,private,_=register()
    _,viewer,_=register()
    visible_post,_,visible_reel=make_content(public)
    make_content(private)
    patch(private,account_visibility='private')
    first=client.get('/api/posts/explore?skip=0&limit=1',headers=viewer).json()
    assert [r['id'] for r in first]==[visible_post['id']]
    first=client.get('/api/reels/feed?skip=0&limit=1',headers=viewer).json()
    assert [r['id'] for r in first]==[visible_reel['id']]
    assert all(r['id']!=visible_reel['id'] for r in client.get('/api/reels/feed?skip=1&limit=1',headers=viewer).json())
