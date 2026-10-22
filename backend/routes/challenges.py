"""التحديات اليومية والأسبوعية بمشاركات مرتبطة بالمنشورات الحقيقية."""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from database.db import get_db
from middleware.auth_dependency import get_current_admin, get_current_user, get_current_user_optional
from models.models import Challenge, ChallengeAchievement, Like, Post, User
from schemas.schemas import ChallengeCreate, ChallengeSubmissionOut, ChallengeUpdate, Message
from routes.posts import _serialize_post
from services.content_access import can_view_account_content, can_view_post

router = APIRouter(prefix="/api/challenges", tags=["Challenges"])


def _utc_naive(value: datetime) -> datetime:
    return value.astimezone(timezone.utc).replace(tzinfo=None) if value.tzinfo else value


def _state(challenge: Challenge) -> str:
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    if not challenge.is_active:
        return "paused"
    if challenge.starts_at > now:
        return "upcoming"
    if challenge.ends_at < now:
        return "ended"
    return "active"


def _challenge_out(db: Session, challenge: Challenge, viewer: User | None) -> dict:
    post_count = db.query(func.count(Post.id)).filter(Post.challenge_id == challenge.id).scalar() or 0
    participant_count = db.query(func.count(func.distinct(Post.author_id))).filter(Post.challenge_id == challenge.id).scalar() or 0
    likes_count = db.query(func.count(Like.id)).join(Post, Like.post_id == Post.id).filter(Post.challenge_id == challenge.id).scalar() or 0
    entry = db.query(Post.id).filter(Post.challenge_id == challenge.id, Post.author_id == viewer.id).first() if viewer else None
    return {
        "id": challenge.id, "title": challenge.title, "description": challenge.description,
        "image_url": challenge.image_url, "period": challenge.period,
        "starts_at": challenge.starts_at, "ends_at": challenge.ends_at,
        "is_active": challenge.is_active, "state": _state(challenge), "created_at": challenge.created_at,
        "posts_count": post_count, "participants_count": participant_count, "likes_count": likes_count,
        "my_post_id": entry[0] if entry else None,
    }


def _get_challenge(db: Session, challenge_id: int) -> Challenge:
    challenge = db.query(Challenge).filter(Challenge.id == challenge_id).first()
    if not challenge:
        raise HTTPException(status_code=404, detail="التحدي غير موجود")
    return challenge


def _validate_window(starts_at: datetime, ends_at: datetime) -> tuple[datetime, datetime]:
    starts_at, ends_at = _utc_naive(starts_at), _utc_naive(ends_at)
    if ends_at <= starts_at:
        raise HTTPException(status_code=422, detail="موعد نهاية التحدي يجب أن يكون بعد بدايته")
    return starts_at, ends_at


@router.get("")
def list_challenges(state: str = "all", skip: int = 0, limit: int = 20, db: Session = Depends(get_db), viewer: User | None = Depends(get_current_user_optional)):
    if state not in {"all", "active", "upcoming", "ended", "paused"}:
        raise HTTPException(status_code=400, detail="حالة التحدي غير صالحة")
    rows = db.query(Challenge).order_by(Challenge.starts_at.desc()).offset(max(skip, 0)).limit(max(1, min(limit, 50))).all()
    if state != "all":
        rows = [challenge for challenge in rows if _state(challenge) == state]
    return [_challenge_out(db, challenge, viewer) for challenge in rows]


@router.get("/mine/achievements")
def my_achievements(db: Session = Depends(get_db), viewer: User = Depends(get_current_user)):
    rows = db.query(ChallengeAchievement).options(joinedload(ChallengeAchievement.challenge)).filter(
        ChallengeAchievement.user_id == viewer.id
    ).order_by(ChallengeAchievement.earned_at.desc()).limit(100).all()
    return [{
        "id": row.id, "badge": row.badge, "earned_at": row.earned_at,
        "challenge": {"id": row.challenge.id, "title": row.challenge.title,
                      "starts_at": row.challenge.starts_at, "ends_at": row.challenge.ends_at},
    } for row in rows]


@router.post("")
def create_challenge(data: ChallengeCreate, db: Session = Depends(get_db), admin: User = Depends(get_current_admin)):
    starts_at, ends_at = _validate_window(data.starts_at, data.ends_at)
    challenge = Challenge(
        title=data.title, description=data.description, image_url=data.image_url, period=data.period,
        starts_at=starts_at, ends_at=ends_at, is_active=data.is_active, created_by=admin.id,
    )
    db.add(challenge)
    db.commit()
    db.refresh(challenge)
    return _challenge_out(db, challenge, admin)


@router.get("/{challenge_id}")
def get_challenge(challenge_id: int, db: Session = Depends(get_db), viewer: User | None = Depends(get_current_user_optional)):
    return _challenge_out(db, _get_challenge(db, challenge_id), viewer)


@router.put("/{challenge_id}")
def update_challenge(challenge_id: int, data: ChallengeUpdate, db: Session = Depends(get_db), admin: User = Depends(get_current_admin)):
    challenge = _get_challenge(db, challenge_id)
    starts_at = _utc_naive(data.starts_at) if data.starts_at is not None else challenge.starts_at
    ends_at = _utc_naive(data.ends_at) if data.ends_at is not None else challenge.ends_at
    starts_at, ends_at = _validate_window(starts_at, ends_at)
    for field in ("title", "description", "image_url", "period", "is_active"):
        value = getattr(data, field)
        if value is not None:
            setattr(challenge, field, value)
    challenge.starts_at, challenge.ends_at = starts_at, ends_at
    db.commit()
    db.refresh(challenge)
    return _challenge_out(db, challenge, admin)


@router.put("/{challenge_id}/pause", response_model=Message)
def pause_challenge(challenge_id: int, db: Session = Depends(get_db), _admin: User = Depends(get_current_admin)):
    challenge = _get_challenge(db, challenge_id)
    challenge.is_active = False
    db.commit()
    return Message(message="تم إيقاف التحدي؛ بقيت المشاركات والبيانات محفوظة")


@router.put("/{challenge_id}/resume", response_model=Message)
def resume_challenge(challenge_id: int, db: Session = Depends(get_db), _admin: User = Depends(get_current_admin)):
    challenge = _get_challenge(db, challenge_id)
    challenge.is_active = True
    db.commit()
    return Message(message="تمت إعادة تفعيل التحدي")


@router.get("/{challenge_id}/posts", response_model=list[ChallengeSubmissionOut])
def challenge_posts(challenge_id: int, skip: int = 0, limit: int = 50, db: Session = Depends(get_db), viewer: User | None = Depends(get_current_user_optional)):
    challenge = _get_challenge(db, challenge_id)
    posts = [p for p in db.query(Post).options(joinedload(Post.author)).filter(Post.challenge_id == challenge.id, Post.is_archived.is_(False)).all() if can_view_post(db, p, viewer)]
    scored = []
    for post in posts:
        engagement = db.query(func.count(Like.id)).filter(Like.post_id == post.id).scalar() or 0
        scored.append((post, engagement))
    scored.sort(key=lambda row: (row[1], row[0].created_at), reverse=True)
    start, stop = max(skip, 0), max(skip, 0) + max(1, min(limit, 50))
    return [
        {"post": _serialize_post(db, post, viewer), "rank": index + 1, "engagement_count": engagement}
        for index, (post, engagement) in enumerate(scored[start:stop], start=start)
    ]
