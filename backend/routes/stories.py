from services.moderation import is_platform_admin
"""قصص مؤقتة للنصوص والصور، تنتهي بعد 24 ساعة."""
from datetime import timedelta

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from database.db import get_db
from middleware.auth_dependency import get_current_user
from models.models import Follower, Story, StoryView, User, utcnow_naive
from services.content_access import can_view_account_content
from schemas.schemas import Message, StoryOut
from utils.files import delete_image, save_image, delete_video, save_video

router = APIRouter(prefix="/api/stories", tags=["Stories"])
STORY_HOURS = 24


def _remove_expired(db: Session) -> None:
    expired = db.query(Story).filter(Story.expires_at <= utcnow_naive(), Story.is_archived == False).all()
    if not expired:
        return
    # Expiration is an archive transition, not deletion: owners must retain
    # reliable access to their story and its media from the archive.
    for story in expired:
        story.is_archived = True
    db.commit()


def _serialize(db: Session, story: Story, viewer: User) -> StoryOut:
    views_count = db.query(func.count(StoryView.id)).filter(StoryView.story_id == story.id).scalar() or 0
    viewed = db.query(StoryView.id).filter(StoryView.story_id == story.id, StoryView.viewer_id == viewer.id).first() is not None
    protected = ((story.author.content_visibility or "everyone") != "everyone" or (story.author.account_visibility or "public") == "private")
    image_url, video_url = story.image_url, story.video_url
    if protected:
        if viewer and (viewer.id == story.author_id or can_view_account_content(db, story.author, viewer)):
            image_url = f"/api/private-media/stories/{story.id}/image" if story.image_url else None
            video_url = f"/api/private-media/stories/{story.id}/video" if story.video_url else None
        else:
            image_url = video_url = None
    return StoryOut(id=story.id, caption=story.caption, image_url=image_url,
                    video_url=video_url, mood_key=story.mood_key, created_at=story.created_at,
                    expires_at=story.expires_at, author=story.author, views_count=views_count, viewed_by_me=viewed)


@router.get("/feed", response_model=list[StoryOut])
def story_feed(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _remove_expired(db)
    following_ids = [row[0] for row in db.query(Follower.following_id).filter(Follower.follower_id == current_user.id).all()]
    following_ids.append(current_user.id)
    rows = (db.query(Story).join(User, Story.author_id == User.id).options(joinedload(Story.author))
            .filter(Story.author_id.in_(following_ids), Story.expires_at > utcnow_naive(), Story.is_archived == False, User.is_active.is_(True), User.is_banned.is_(False))
            .order_by(Story.created_at.desc()).limit(100).all())
    return [_serialize(db, row, current_user) for row in rows if can_view_account_content(db, row.author, current_user)]


@router.post("", response_model=StoryOut, status_code=201)
async def create_story(caption: str | None = Form(None), image: UploadFile | None = File(None),
                       video: UploadFile | None = File(None), mood_key: str | None = Form(None),
                       db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    text = (caption or "").strip()
    if len(text) > 500:
        raise HTTPException(status_code=400, detail="نص القصة أطول من 500 حرف")
    if image and image.filename and video and video.filename:
        raise HTTPException(status_code=400, detail="اختر صورة أو فيديو واحدًا فقط")
    mood_key = (mood_key or "").strip().lower() or None
    if mood_key not in {None, "happy", "sad"}:
        raise HTTPException(status_code=400, detail="اختر مزاجًا صالحًا: سعيد أو حزين")
    if not text and not ((image is not None and image.filename) or (video is not None and video.filename)):
        raise HTTPException(status_code=400, detail="أضف نصًا أو صورة أو فيديو للقصة")
    image_url = await save_image(image, "stories") if image is not None and image.filename else None
    video_url = await save_video(video, "stories") if video is not None and video.filename else None
    now = utcnow_naive()
    story = Story(author_id=current_user.id, caption=text or None, image_url=image_url,
                  video_url=video_url, mood_key=mood_key,
                  created_at=now, expires_at=now + timedelta(hours=STORY_HOURS))
    try:
        db.add(story)
        db.commit()
        db.refresh(story)
    except Exception:
        db.rollback()
        if image_url:
            delete_image(image_url)
        if video_url:
            delete_video(video_url)
        raise
    return _serialize(db, story, current_user)


@router.post("/{story_id}/view")
def mark_story_viewed(story_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    story = db.query(Story).filter(Story.id == story_id).first()
    if not story or story.is_archived or story.expires_at <= utcnow_naive():
        raise HTTPException(status_code=404, detail="القصة غير موجودة أو انتهت صلاحيتها")
    if not can_view_account_content(db, story.author, current_user):
        raise HTTPException(status_code=404, detail="القصة غير موجودة")
    if story.author_id != current_user.id:
        existing = db.query(StoryView.id).filter(StoryView.story_id == story_id, StoryView.viewer_id == current_user.id).first()
        if not existing:
            db.add(StoryView(story_id=story_id, viewer_id=current_user.id))
            db.commit()
    count = db.query(func.count(StoryView.id)).filter(StoryView.story_id == story_id).scalar() or 0
    return {"views_count": count}


@router.delete("/{story_id}", response_model=Message)
def delete_story(story_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    story = db.query(Story).filter(Story.id == story_id).first()
    if not story:
        raise HTTPException(status_code=404, detail="القصة غير موجودة")
    if story.author_id != current_user.id and not is_platform_admin(current_user):
        raise HTTPException(status_code=403, detail="لا يمكنك حذف قصة لا تخصك")
    image_url = story.image_url
    video_url = story.video_url
    db.delete(story)
    db.commit()
    if image_url:
        delete_image(image_url)
    if video_url:
        delete_video(video_url)
    return Message(message="تم حذف القصة")
