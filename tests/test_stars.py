"""اختبارات نجوم الحساب: الحساب، SQL filtering، وعقد الخصوصية HTTP."""
from datetime import datetime, timedelta
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from test_api import app, SessionLocal
from models.models import BusinessPage, Circle, Follower, FollowRequest, Post, Reel, User
from services.stars import (
    ACTIVE_DAY_THRESHOLDS,
    FOLLOWER_THRESHOLDS,
    LEVELS,
    _active_days,
    _followers_count,
    _level_for,
    _progress,
    build_stars,
)

client = TestClient(app)


def register(label=None):
    name = "stars_" + (label or uuid4().hex[:12])
    response = client.post("/api/auth/register", json={
        "username": name, "email": name + "@example.com", "full_name": name,
        "password": "Password123",
    })
    assert response.status_code == 201, response.text
    data = response.json()
    return name, {"Authorization": "Bearer " + data["access_token"]}, data["user"]["id"]


@pytest.mark.parametrize("followers,days,expected", [
    (0, 0, 1), (99_999, 1, 1), (100_000, 1, 2),
    (500_000, 3, 3), (1_000_000, 7, 4), (2_500_000, 14, 5),
    (5_000_000, 30, 6), (10_000_000, 60, 7), (20_000_000, 90, 8),
    (35_000_000, 180, 9), (49_999_999, 365, 9),
    (50_000_000, 365, 10), (50_000_000, 364, 9),
])
def test_level_boundaries_are_exact_and_require_both_dimensions(followers, days, expected):
    assert _level_for(followers, days) == expected


def test_schema_colors_icons_names_and_proposed_bonuses_are_stable():
    assert [row[3] for row in LEVELS] == list(range(5, 51, 5))
    assert [row[1] for row in LEVELS] == [
        "#FFD700", "#FFD700", "#C0C0C0", "#D4AF37", "#E0115F",
        "#50C878", "#00BCD4", "#9B59B6", "#E15AA9", "#D8B4FE",
    ]
    assert all(row[2] == "★" for row in LEVELS[:-1])
    assert LEVELS[-1][2] == "◆"
    assert "Black Crystal Star" in LEVELS[-1][0]


def test_progress_is_minimum_ratio_capped_and_max_is_100():
    assert _progress(50_000, 1, 1) == 50.0
    assert _progress(50_000, 0, 1) == 0.0
    assert _progress(50_000_000, 365, 10) == 100.0
    assert _progress(99_000_000, 999, 10) == 100.0


def test_active_days_sql_union_deduplicates_and_excludes_private_future_archived_and_deleted():
    _, _, user_id = register("activity")
    now = datetime.utcnow()
    with SessionLocal() as db:
        circle = Circle(name="activity circle", creator_id=user_id)
        business = BusinessPage(name="activity business", owner_id=user_id)
        db.add_all([circle, business])
        db.flush()
        db.add_all([
            Post(author_id=user_id, content="same day", created_at=now - timedelta(days=1), is_archived=False),
            Reel(author_id=user_id, video_url="/r1", created_at=now - timedelta(days=1)),
            Post(author_id=user_id, content="archived", created_at=now - timedelta(days=2), is_archived=True),
            Post(author_id=user_id, content="circle", created_at=now - timedelta(days=3), circle_id=circle.id, is_archived=False),
            Post(author_id=user_id, content="business", created_at=now - timedelta(days=4), business_id=business.id, is_archived=False),
            Reel(author_id=user_id, video_url="/future", created_at=now + timedelta(days=2)),
        ])
        db.commit()
        assert _active_days(db, user_id) == 1
        deleted = db.query(Post).filter(Post.content == "same day").one()
        db.delete(deleted)
        db.commit()
        assert _active_days(db, user_id) == 1  # Reel on that date remains evidence.
        db.query(Reel).filter(Reel.video_url == "/r1").delete()
        db.commit()
        assert _active_days(db, user_id) == 0


def test_followers_count_excludes_self_pending_inactive_banned_and_frozen():
    _, _, owner_id = register("owner")
    names = [register(x) for x in ("good", "pending", "inactive", "banned", "frozen", "self")]
    with SessionLocal() as db:
        owner = db.query(User).get(owner_id)
        ids = {name.split("_", 1)[1]: uid for name, _, uid in names}
        for key in ("good", "inactive", "banned", "frozen"):
            db.add(Follower(follower_id=ids[key], following_id=owner_id))
        db.add(Follower(follower_id=owner_id, following_id=owner_id))
        db.add(FollowRequest(requester_id=ids["pending"], target_id=owner_id, status="pending"))
        db.query(User).filter(User.id == ids["inactive"]).one().is_active = False
        db.query(User).filter(User.id == ids["banned"]).one().is_banned = True
        frozen = db.query(User).filter(User.id == ids["frozen"]).one()
        frozen.frozen_at = datetime.utcnow() - timedelta(hours=1)
        frozen.frozen_until = datetime.utcnow() + timedelta(hours=1)
        db.commit()
        # pending is not a Follower row; self and invalid account states are excluded.
        assert _followers_count(db, owner_id) == 1
        frozen.frozen_until = None  # indefinite freeze must remain ineligible
        db.commit()
        assert _followers_count(db, owner_id) == 1
        frozen.frozen_until = datetime.utcnow() - timedelta(minutes=1)
        db.commit()
        assert _followers_count(db, owner_id) == 2
        db.query(Follower).filter_by(follower_id=ids["good"], following_id=owner_id).delete()
        db.commit()
        assert _followers_count(db, owner_id) == 1


def test_http_contract_has_progress_levels_and_does_not_change_feed():
    username, auth, user_id = register("contract")
    post = client.post("/api/posts", headers=auth, data={"content": "feed sentinel"})
    assert post.status_code == 201, post.text
    before = client.get("/api/posts/feed", headers=auth).json()
    response = client.get(f"/api/users/{username}/stars", headers=auth)
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["level"] == 1 and data["next_level"] == 2
    assert data["reward"]["applied"] is False
    assert len(data["levels"]) == 10
    assert "Black Crystal Star" in data["levels"][-1]["name"]
    assert data["levels"][-1]["icon"] == "◆"
    assert client.get("/api/posts/feed", headers=auth).json() == before


@pytest.mark.parametrize("setting", [
    {"account_visibility": "private"},
    {"content_visibility": "followers"},
])
def test_http_privacy_denies_stranger_but_allows_owner_and_accepted_follower(setting):
    username, owner_auth, owner_id = register()
    _, follower_auth, follower_id = register()
    _, stranger_auth, _ = register()
    assert client.patch("/api/account/settings", headers=owner_auth, json=setting).status_code == 200
    assert client.post(f"/api/users/{username}/follow", headers=follower_auth).status_code == 200
    if setting.get("account_visibility") == "private":
        # Private account follow is pending until owner approves.
        with SessionLocal() as db:
            req = db.query(FollowRequest).filter_by(requester_id=follower_id, target_id=owner_id).one()
            req.status = "accepted"
            db.add(Follower(follower_id=follower_id, following_id=owner_id))
            db.commit()
    assert client.get(f"/api/users/{username}/stars", headers=owner_auth).status_code == 200
    assert client.get(f"/api/users/{username}/stars", headers=stranger_auth).status_code == 404
    assert client.get(f"/api/users/{username}/stars", headers=follower_auth).status_code == 200


def test_http_disabled_frozen_banned_and_nonexistent_are_404():
    username, auth, uid = register()
    with SessionLocal() as db:
        user = db.query(User).get(uid)
        user.is_active = False
        db.commit()
    assert client.get(f"/api/users/{username}/stars", headers=auth).status_code == 404
    with SessionLocal() as db:
        user = db.query(User).get(uid)
        user.is_active = True
        user.is_banned = True
        db.commit()
    assert client.get(f"/api/users/{username}/stars", headers=auth).status_code == 404
    with SessionLocal() as db:
        user = db.query(User).get(uid)
        user.is_banned = False
        user.frozen_at = datetime.utcnow() - timedelta(minutes=1)
        user.frozen_until = datetime.utcnow() + timedelta(hours=1)
        db.commit()
    assert client.get(f"/api/users/{username}/stars", headers=auth).status_code == 404
    assert client.get("/api/users/does-not-exist/stars").status_code == 404
