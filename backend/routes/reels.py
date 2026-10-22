from services.moderation import is_platform_admin
"""مقاطع فيديو قصيرة تجريبية: رفع محدود، خلاصة عمودية، مشاهدات وإعجابات."""
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from database.db import get_db
from middleware.auth_dependency import get_current_user
from models.models import Reel, ReelLike, ReelView, User
from services.content_access import can_view_account_content, visible_account_author_ids
from schemas.schemas import Message, ReelOut
from utils.files import delete_video, save_video

router = APIRouter(prefix="/api/reels", tags=["Reels"])


def _serialize_many(db: Session, reels: list[Reel], viewer: User) -> list[ReelOut]:
    """Serialize a page with bounded aggregate queries instead of 5 queries per reel."""
    if not reels:
        return []
    ids = [reel.id for reel in reels]
    likes = dict(db.query(ReelLike.reel_id, func.count(ReelLike.id)).filter(ReelLike.reel_id.in_(ids)).group_by(ReelLike.reel_id).all())
    views = dict(db.query(ReelView.reel_id, func.count(ReelView.id)).filter(ReelView.reel_id.in_(ids)).group_by(ReelView.reel_id).all())
    liked = {row[0] for row in db.query(ReelLike.reel_id).filter(ReelLike.reel_id.in_(ids), ReelLike.user_id == viewer.id).all()}
    viewed = {row[0] for row in db.query(ReelView.reel_id).filter(ReelView.reel_id.in_(ids), ReelView.viewer_id == viewer.id).all()}
    return [ReelOut(id=reel.id, caption=reel.caption, video_url=(f"/api/private-media/reels/{reel.id}/video" if reel.author and ((reel.author.account_visibility or "public") == "private" or (reel.author.content_visibility or "everyone") != "everyone") else reel.video_url), mood_key=reel.mood_key,
                    created_at=reel.created_at, author=reel.author, likes_count=likes.get(reel.id, 0),
                    liked_by_me=reel.id in liked, views_count=views.get(reel.id, 0), viewed_by_me=reel.id in viewed)
            for reel in reels]

def _serialize(db: Session, reel: Reel, viewer: User) -> ReelOut:
    likes = db.query(func.count(ReelLike.id)).filter(ReelLike.reel_id == reel.id).scalar() or 0
    views = db.query(func.count(ReelView.id)).filter(ReelView.reel_id == reel.id).scalar() or 0
    liked = db.query(ReelLike.id).filter(ReelLike.reel_id == reel.id, ReelLike.user_id == viewer.id).first() is not None
    viewed = db.query(ReelView.id).filter(ReelView.reel_id == reel.id, ReelView.viewer_id == viewer.id).first() is not None
    return ReelOut(id=reel.id, caption=reel.caption, video_url=(f"/api/private-media/reels/{reel.id}/video" if reel.author and ((reel.author.account_visibility or "public") == "private" or (reel.author.content_visibility or "everyone") != "everyone") else reel.video_url), mood_key=reel.mood_key,
                   created_at=reel.created_at,
                   author=reel.author, likes_count=likes, liked_by_me=liked, views_count=views, viewed_by_me=viewed)


@router.get("/feed", response_model=list[ReelOut])
def reels_feed(skip: int = 0, limit: int = 20, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    skip = max(0, min(skip, 1_000_000))
    limit = max(1, min(limit, 30))
    rows = (db.query(Reel).join(User, Reel.author_id == User.id).options(joinedload(Reel.author))
            .filter(User.is_active.is_(True), User.is_banned.is_(False), Reel.author_id.in_(visible_account_author_ids(db, current_user)))
            .order_by(Reel.created_at.desc()).offset(skip).limit(limit).all())
    rows = [r for r in rows if can_view_account_content(db, r.author, current_user)]
    return _serialize_many(db, rows, current_user)


@router.post("", response_model=ReelOut, status_code=201)
async def create_reel(video: UploadFile = File(...), caption: str | None = Form(None),
                      mood_key: str | None = Form(None),
                      db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    text = (caption or "").strip()
    if len(text) > 500:
        raise HTTPException(status_code=400, detail="وصف الريل أطول من 500 حرف")
    mood_key = (mood_key or "").strip().lower() or None
    if mood_key not in {None, "happy", "sad"}:
        raise HTTPException(status_code=400, detail="اختر مزاجًا صالحًا: سعيد أو حزين")
    video_url = await save_video(video)
    reel = Reel(author_id=current_user.id, caption=text or None, video_url=video_url, mood_key=mood_key)
    try:
        db.add(reel)
        db.commit()
        db.refresh(reel)
    except Exception:
        db.rollback()
        delete_video(video_url)
        raise
    return _serialize(db, reel, current_user)


@router.post("/{reel_id}/view")
def mark_reel_viewed(reel_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    reel = db.query(Reel).filter(Reel.id == reel_id).first()
    if not reel:
        raise HTTPException(status_code=404, detail="الريل غير موجود")
    if not can_view_account_content(db, reel.author, current_user):
        raise HTTPException(status_code=404, detail="الريل غير موجود")
    existing = db.query(ReelView.id).filter(ReelView.reel_id == reel_id, ReelView.viewer_id == current_user.id).first()
    if not existing:
        db.add(ReelView(reel_id=reel_id, viewer_id=current_user.id))
        db.commit()
    count = db.query(func.count(ReelView.id)).filter(ReelView.reel_id == reel_id).scalar() or 0
    return {"views_count": count}


@router.post("/{reel_id}/like", response_model=Message)
def like_reel(reel_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    reel = db.query(Reel).options(joinedload(Reel.author)).filter(Reel.id == reel_id).first()
    if not reel or not can_view_account_content(db, reel.author, current_user):
        raise HTTPException(status_code=404, detail="الريل غير موجود")
    existing = db.query(ReelLike).filter(ReelLike.reel_id == reel_id, ReelLike.user_id == current_user.id).first()
    if not existing:
        db.add(ReelLike(reel_id=reel_id, user_id=current_user.id))
        db.commit()
    return Message(message="تم الإعجاب بالريل")


@router.delete("/{reel_id}/like", response_model=Message)
def unlike_reel(reel_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    existing = db.query(ReelLike).filter(ReelLike.reel_id == reel_id, ReelLike.user_id == current_user.id).first()
    if existing:
        db.delete(existing)
        db.commit()
    return Message(message="تم إلغاء الإعجاب")


@router.delete("/{reel_id}", response_model=Message)
def delete_reel(reel_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    reel = db.query(Reel).filter(Reel.id == reel_id).first()
    if not reel:
        raise HTTPException(status_code=404, detail="الريل غير موجود")
    if reel.author_id != current_user.id and not is_platform_admin(current_user):
        raise HTTPException(status_code=403, detail="لا يمكنك حذف ريل لا يخصك")
    video_url = reel.video_url
    db.delete(reel)
    db.commit()
    delete_video(video_url)
    return Message(message="تم حذف الريل")
