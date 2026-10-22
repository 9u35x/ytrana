"""تقديم وسائط الدوائر الخاصة عبر API مصادق بدلاً من كشف رابط الملف العام."""
import mimetypes
from pathlib import Path, PurePosixPath
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from config import settings
from database.db import get_db
from middleware.auth_dependency import get_current_user
from models.models import Circle, Post, User, Story, Reel, utcnow_naive
from services.content_access import can_view_circle, can_view_post, can_view_account_content
from services.account_privacy import can_view_content

router = APIRouter(prefix="/api/private-media", tags=["Private media"])


def _file_response(relative_url: str) -> FileResponse:
    parts = PurePosixPath(urlsplit(relative_url).path).parts
    if len(parts) != 4 or parts[0] != "/" or parts[1] != "uploads" or parts[2] not in {"posts", "circles", "stories", "reels"}:
        raise HTTPException(status_code=404, detail="الوسيط غير موجود")
    root = Path(settings.upload_dir).resolve()
    folder = (root / parts[2]).resolve()
    target = (folder / parts[3]).resolve()
    if not folder.is_relative_to(root) or target.parent != folder or not target.is_relative_to(root) or not target.is_file():
        raise HTTPException(status_code=404, detail="الوسيط غير موجود")
    media_type = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
    return FileResponse(target, media_type=media_type, headers={"Cache-Control": "private, no-store"})


@router.get("/posts/{post_id}/{asset}")
def private_post_media(post_id: int, asset: str, db: Session = Depends(get_db), viewer: User = Depends(get_current_user)):
    if asset not in {"image", "video"}:
        raise HTTPException(status_code=404, detail="الوسيط غير موجود")
    post = db.query(Post).filter(Post.id == post_id).first()
    # can_view_post deliberately permits only the owner for archived posts;
    # this is the archive access rule even if a circle was later removed.
    owner_archive = bool(post and post.is_archived and post.author_id == viewer.id)
    if not post or (not owner_archive and not can_view_post(db, post, viewer)):
        raise HTTPException(status_code=404, detail="الوسيط غير موجود")
    relative_url = post.image_url if asset == "image" else post.video_url
    if not relative_url:
        raise HTTPException(status_code=404, detail="الوسيط غير موجود")
    return _file_response(relative_url)


@router.get("/circles/{circle_id}/{asset}")
def private_circle_media(circle_id: int, asset: str, db: Session = Depends(get_db), viewer: User = Depends(get_current_user)):
    if asset not in {"image", "cover"}:
        raise HTTPException(status_code=404, detail="الوسيط غير موجود")
    circle = db.query(Circle).filter(Circle.id == circle_id).first()
    if not circle or not circle.is_private or not can_view_circle(db, circle, viewer):
        raise HTTPException(status_code=404, detail="الوسيط غير موجود")
    relative_url = circle.image_url if asset == "image" else circle.cover_url
    if not relative_url:
        raise HTTPException(status_code=404, detail="الوسيط غير موجود")
    return _file_response(relative_url)

@router.get("/stories/{story_id}/{asset}")
def private_story_media(story_id: int, asset: str, db: Session = Depends(get_db), viewer: User = Depends(get_current_user)):
    if asset not in {"image", "video"}:
        raise HTTPException(status_code=404, detail="الوسيط غير موجود")
    story = db.query(Story).filter(Story.id == story_id).first()
    if not story or story.author_id != viewer.id and (story.is_archived or story.expires_at <= utcnow_naive()):
        raise HTTPException(status_code=404, detail="الوسيط غير موجود")
    if story.author_id != viewer.id and not can_view_account_content(db, story.author, viewer):
        raise HTTPException(status_code=404, detail="الوسيط غير موجود")
    relative_url = story.image_url if asset == "image" else story.video_url
    if not relative_url:
        raise HTTPException(status_code=404, detail="الوسيط غير موجود")
    return _file_response(relative_url)


@router.get("/reels/{reel_id}/{asset}")
def private_reel_media(reel_id: int, asset: str, db: Session = Depends(get_db), viewer: User = Depends(get_current_user)):
    if asset != "video":
        raise HTTPException(status_code=404, detail="الوسيط غير موجود")
    reel = db.query(Reel).filter(Reel.id == reel_id).first()
    if not reel or not can_view_account_content(db, reel.author, viewer) or not reel.video_url:
        raise HTTPException(status_code=404, detail="الوسيط غير موجود")
    return _file_response(reel.video_url)
