"""
مسارات المستخدمين: الملف الشخصي، التعديل، تغيير كلمة المرور، حذف الحساب، البحث،
المتابعة/إلغاء المتابعة، قوائم المتابعين والمتابَعين.
"""
import os

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, status
from sqlalchemy.orm import Session
from sqlalchemy import func, or_

from database.db import get_db
from middleware.auth_dependency import get_current_user, get_current_user_optional
from models.models import User, Follower, Post, Notification, NotificationType
from schemas.schemas import (
    UserProfile, UserPublic, UserUpdate, PasswordChange, AccountDelete, Message
)
from utils.security import verify_password, hash_password
from utils.files import save_image, delete_image

router = APIRouter(prefix="/api/users", tags=["Users"])


def _followers_count(db: Session, user_id: int) -> int:
    return db.query(func.count(Follower.id)).filter(Follower.following_id == user_id).scalar() or 0


def _following_count(db: Session, user_id: int) -> int:
    return db.query(func.count(Follower.id)).filter(Follower.follower_id == user_id).scalar() or 0


def _posts_count(db: Session, user_id: int) -> int:
    return db.query(func.count(Post.id)).filter(Post.author_id == user_id).scalar() or 0


def _is_followed_by(db: Session, viewer_id: int | None, target_id: int) -> bool:
    if not viewer_id:
        return False
    return db.query(Follower).filter(
        Follower.follower_id == viewer_id, Follower.following_id == target_id
    ).first() is not None


def build_profile(db: Session, user: User, viewer: User | None) -> UserProfile:
    return UserProfile(
        id=user.id,
        username=user.username,
        full_name=user.full_name,
        bio=user.bio,
        avatar_url=user.avatar_url,
        is_banned=user.is_banned,
        created_at=user.created_at,
        followers_count=_followers_count(db, user.id),
        following_count=_following_count(db, user.id),
        posts_count=_posts_count(db, user.id),
        is_followed_by_me=_is_followed_by(db, viewer.id if viewer else None, user.id),
    )


@router.get("/search", response_model=list[UserPublic])
def search_users(q: str, db: Session = Depends(get_db)):
    q = q.strip().lower()
    if len(q) < 1:
        return []
    users = (
        db.query(User)
        .filter(
            or_(User.username.contains(q), func.lower(User.full_name).contains(q)),
            User.is_banned == False,  # noqa: E712
        )
        .limit(20)
        .all()
    )
    return users


@router.get("/{username}", response_model=UserProfile)
def get_user_profile(
    username: str,
    db: Session = Depends(get_db),
    viewer: User | None = Depends(get_current_user_optional),
):
    user = db.query(User).filter(User.username == username.lower()).first()
    if not user:
        raise HTTPException(status_code=404, detail="المستخدم غير موجود")
    return build_profile(db, user, viewer)


@router.put("/me", response_model=UserProfile)
def update_profile(
    data: UserUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if data.full_name is not None:
        current_user.full_name = data.full_name
    if data.bio is not None:
        current_user.bio = data.bio
    db.commit()
    db.refresh(current_user)
    return build_profile(db, current_user, current_user)


@router.post("/me/avatar", response_model=UserProfile)
async def upload_avatar(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    old_avatar = current_user.avatar_url
    new_url = await save_image(file, "avatars")
    current_user.avatar_url = new_url
    db.commit()
    db.refresh(current_user)
    if old_avatar:
        delete_image(old_avatar)
    return build_profile(db, current_user, current_user)


@router.put("/me/password", response_model=Message)
def change_password(
    data: PasswordChange,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not verify_password(data.current_password, current_user.hashed_password):
        raise HTTPException(status_code=400, detail="كلمة المرور الحالية غير صحيحة")
    current_user.hashed_password = hash_password(data.new_password)
    db.commit()
    return Message(message="تم تغيير كلمة المرور بنجاح")


@router.delete("/me", response_model=Message)
def delete_account(
    data: AccountDelete,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not verify_password(data.password, current_user.hashed_password):
        raise HTTPException(status_code=400, detail="كلمة المرور غير صحيحة")
    db.delete(current_user)
    db.commit()
    return Message(message="تم حذف الحساب بنجاح")


@router.post("/{username}/follow", response_model=Message)
def follow_user(
    username: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    target = db.query(User).filter(User.username == username.lower()).first()
    if not target:
        raise HTTPException(status_code=404, detail="المستخدم غير موجود")
    if target.id == current_user.id:
        raise HTTPException(status_code=400, detail="لا يمكنك متابعة نفسك")

    existing = db.query(Follower).filter(
        Follower.follower_id == current_user.id, Follower.following_id == target.id
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="أنت تتابع هذا المستخدم بالفعل")

    db.add(Follower(follower_id=current_user.id, following_id=target.id))
    db.add(Notification(
        recipient_id=target.id, actor_id=current_user.id, type=NotificationType.follow
    ))
    db.commit()
    return Message(message="تمت المتابعة بنجاح")


@router.delete("/{username}/follow", response_model=Message)
def unfollow_user(
    username: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    target = db.query(User).filter(User.username == username.lower()).first()
    if not target:
        raise HTTPException(status_code=404, detail="المستخدم غير موجود")

    existing = db.query(Follower).filter(
        Follower.follower_id == current_user.id, Follower.following_id == target.id
    ).first()
    if not existing:
        raise HTTPException(status_code=400, detail="أنت لا تتابع هذا المستخدم")

    db.delete(existing)
    db.commit()
    return Message(message="تم إلغاء المتابعة بنجاح")


@router.get("/{username}/followers", response_model=list[UserPublic])
def get_followers(username: str, db: Session = Depends(get_db)):
    target = db.query(User).filter(User.username == username.lower()).first()
    if not target:
        raise HTTPException(status_code=404, detail="المستخدم غير موجود")
    rows = db.query(Follower).filter(Follower.following_id == target.id).all()
    return [r.follower for r in rows]


@router.get("/{username}/following", response_model=list[UserPublic])
def get_following(username: str, db: Session = Depends(get_db)):
    target = db.query(User).filter(User.username == username.lower()).first()
    if not target:
        raise HTTPException(status_code=404, detail="المستخدم غير موجود")
    rows = db.query(Follower).filter(Follower.follower_id == target.id).all()
    return [r.following for r in rows]
