"""Account settings, status, archive, and owner activity history."""
from datetime import datetime
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy import desc
from sqlalchemy.orm import Session
from database.db import get_db
from middleware.auth_dependency import get_current_user
from models.models import User, Post, Story, Comment, Like, Follower, FollowRequest, utcnow_naive
from models.account import AccountActivity
from services.content_access import can_view_post
router = APIRouter(prefix="/api/account", tags=["Account"])
class SettingsPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    account_visibility: Literal["public", "private"] | None = None
    comment_privacy: Literal["everyone", "followers", "following", "nobody"] | None = None
    show_activity_status: bool | None = None
    message_privacy: Literal["everyone", "following", "followers", "nobody"] | None = None
    content_visibility: Literal["everyone", "followers"] | None = None
class ArchiveItem(BaseModel):
    id: int
    kind: Literal["post", "story"]
    text: str | None = None
    created_at: datetime
    is_archived: bool = True
    can_restore: bool = True
    image_url: str | None = None
    video_url: str | None = None
def _settings(user: User) -> dict:
    visibility = getattr(user, "account_visibility", None) or ("private" if user.is_private else "public")
    return {"id": user.id, "username": user.username, "email": user.email,
            "is_active": user.is_active, "message_privacy": user.message_privacy or "everyone",
            "content_visibility": user.content_visibility or "everyone",
            "account_visibility": visibility, "comment_privacy": user.comment_privacy or "everyone",
            "show_activity_status": user.show_activity_status if user.show_activity_status is not None else True}

@router.get("/follow-requests")
def follow_requests(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    rows = db.query(FollowRequest).filter(FollowRequest.target_id == current_user.id, FollowRequest.status == "pending").order_by(FollowRequest.id.asc()).all()
    return [{"id": r.id, "requester": {"id": r.requester.id, "username": r.requester.username, "full_name": r.requester.full_name, "avatar_url": r.requester.avatar_url, "is_verified": r.requester.is_verified}, "status": r.status, "created_at": r.created_at} for r in rows]

def _decide_follow_request(request_id: int, decision: str, db: Session, current_user: User):
    req = db.query(FollowRequest).filter(FollowRequest.id == request_id, FollowRequest.target_id == current_user.id, FollowRequest.status == "pending").first()
    if not req:
        raise HTTPException(status_code=404, detail="طلب المتابعة غير موجود")
    req.status = decision
    if decision == "accepted" and not db.query(Follower.id).filter(Follower.follower_id == req.requester_id, Follower.following_id == req.target_id).first():
        db.add(Follower(follower_id=req.requester_id, following_id=req.target_id))
    db.commit()
    return {"id": req.id, "status": req.status}

@router.post("/follow-requests/{request_id}/approve")
def approve_follow_request(request_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return _decide_follow_request(request_id, "accepted", db, current_user)

@router.post("/follow-requests/{request_id}/reject")
def reject_follow_request(request_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return _decide_follow_request(request_id, "rejected", db, current_user)
@router.get("/settings")
def get_settings(current_user: User = Depends(get_current_user)):
    return _settings(current_user)
@router.patch("/settings")
def update_settings(payload: SettingsPatch, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    changed = []
    for name in ("account_visibility", "comment_privacy", "show_activity_status", "message_privacy", "content_visibility"):
        value = getattr(payload, name)
        if value is not None:
            setattr(current_user, name, value); changed.append(name)
            if name == "account_visibility":
                current_user.is_private = value == "private"
    if changed:
        db.add(AccountActivity(user_id=current_user.id, activity_type="settings_updated", details=",".join(changed)))
    db.commit(); db.refresh(current_user)
    return _settings(current_user)
@router.get("/status")
def account_status(current_user: User = Depends(get_current_user)):
    return {"is_active": current_user.is_active, "is_banned": current_user.is_banned, "is_frozen": current_user.is_frozen, "is_verified": current_user.is_verified, "created_at": current_user.created_at}
def _archive_row(kind: str, ident: int, user: User, db: Session):
    model = Post if kind == "posts" else Story if kind == "stories" else None
    if model is None: raise HTTPException(status_code=422, detail="kind يجب أن يكون posts أو stories")
    row = db.query(model).filter(model.id == ident, model.author_id == user.id).first()
    if not row: raise HTTPException(status_code=404, detail="المحتوى غير موجود")
    return row
def _archive_item(row, kind: str, archived: bool | None = None) -> ArchiveItem:
    prefix = "posts" if kind == "posts" else "stories"
    return ArchiveItem(id=row.id, kind="post" if kind == "posts" else "story", text=getattr(row, "content", None) or getattr(row, "caption", None), created_at=row.created_at, is_archived=row.is_archived if archived is None else archived,
                       can_restore=kind == "posts" or row.expires_at > utcnow_naive(),
                       image_url=f"/api/account/archive/{prefix}/{row.id}/media/image" if getattr(row, "image_url", None) else None,
                       video_url=f"/api/account/archive/{prefix}/{row.id}/media/video" if getattr(row, "video_url", None) else None)
@router.get("/archive", response_model=list[ArchiveItem])
def list_archive(kind: Literal["posts", "stories"] = Query("posts"), include_active: bool = Query(False), offset: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=100), db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    model = Post if kind == "posts" else Story
    if kind == "stories":
        db.query(Story).filter(Story.author_id == current_user.id, Story.expires_at <= utcnow_naive(), Story.is_archived.is_(False)).update({Story.is_archived: True}, synchronize_session=False)
        db.commit()
    query = db.query(model).filter(model.author_id == current_user.id)
    if not include_active: query = query.filter(model.is_archived.is_(True))
    rows = query.order_by(desc(model.created_at), desc(model.id)).offset(offset).limit(limit).all()
    return [_archive_item(row, kind) for row in rows]
@router.post("/archive/{kind}/{item_id}", response_model=ArchiveItem)
def archive_item(kind: Literal["posts", "stories"], item_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    row = _archive_row(kind, item_id, current_user, db)
    if not row.is_archived:
        row.is_archived = True
        db.add(AccountActivity(user_id=current_user.id, activity_type="archived", target_type=("post" if kind == "posts" else "story"), target_id=item_id))
        db.commit(); db.refresh(row)
    return _archive_item(row, kind, True)
@router.delete("/archive/{kind}/{item_id}", response_model=ArchiveItem)
def restore_item(kind: Literal["posts", "stories"], item_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    row = _archive_row(kind, item_id, current_user, db)
    if kind == "stories" and row.expires_at <= utcnow_naive():
        raise HTTPException(status_code=409, detail="لا يمكن إعادة نشر قصة منتهية الصلاحية")
    if row.is_archived:
        row.is_archived = False
        db.add(AccountActivity(user_id=current_user.id, activity_type="restored", target_type=("post" if kind == "posts" else "story"), target_id=item_id))
        db.commit(); db.refresh(row)
    return _archive_item(row, kind, False)
@router.get("/activity")
def activity(kind: Literal["all", "comments", "likes"] = Query("all"), offset: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=100), db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    items = []
    if kind in ("all", "comments"):
        for c in db.query(Comment).filter(Comment.author_id == current_user.id).all():
            post = db.query(Post).filter(Post.id == c.post_id).first()
            if post is not None and can_view_post(db, post, current_user):
                items.append({"type": "comment", "id": c.id, "post_id": c.post_id, "text": c.content, "created_at": c.created_at})
    if kind in ("all", "likes"):
        for l in db.query(Like).filter(Like.user_id == current_user.id).all():
            post = db.query(Post).filter(Post.id == l.post_id).first()
            if post is not None and can_view_post(db, post, current_user):
                items.append({"type": "like", "id": l.id, "post_id": l.post_id, "created_at": l.created_at})
    if kind == "all":
        items.extend({"type": a.activity_type, "id": a.id, "target_type": a.target_type, "target_id": a.target_id, "details": a.details, "created_at": a.created_at} for a in db.query(AccountActivity).filter(AccountActivity.user_id == current_user.id).all())
    items.sort(key=lambda x: x["created_at"], reverse=True)
    return items[offset:offset + limit]


@router.get("/archive/{kind}/{item_id}/{asset}")
@router.get("/archive/{kind}/{item_id}/media/{asset}")
def archive_media(kind: Literal["posts", "stories"], item_id: int, asset: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Owner-only media access for archived or expired items; never a raw path."""
    if asset not in {"image", "video"}:
        raise HTTPException(status_code=404, detail="الوسيط غير موجود")
    model = Post if kind == "posts" else Story
    row = db.query(model).filter(model.id == item_id, model.author_id == current_user.id).first()
    if not row:
        raise HTTPException(status_code=404, detail="الوسيط غير موجود")
    relative_url = row.image_url if asset == "image" else row.video_url
    if not relative_url:
        raise HTTPException(status_code=404, detail="الوسيط غير موجود")
    from routes.private_media import _file_response
    return _file_response(relative_url)
