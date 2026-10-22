"""
مسارات المستخدمين: الملف الشخصي، التعديل، تغيير كلمة المرور، حذف الحساب، البحث،
المتابعة/إلغاء المتابعة، قوائم المتابعين والمتابَعين.
"""
import unicodedata

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query, status
from sqlalchemy.orm import Session
from sqlalchemy import case, func, or_

from database.db import get_db
from middleware.auth_dependency import get_current_user, get_current_user_optional
from models.models import (
    User, Follower, FollowRequest, Post, Notification, NotificationType, Story, Reel,
    Circle, BusinessPage, BusinessProduct,
)
from models.account import AccountActivity
from schemas.schemas import (
    UserProfile, UserPublic, UserUpdate, PasswordChange, AccountDelete, Message
)
from utils.security import verify_password, hash_password
from utils.files import save_image, delete_image, delete_video
from services.moderation import admin_ids
from services.account_privacy import can_view_profile_details, is_accepted_follower

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
    details = can_view_profile_details(db, user, viewer)
    pending = bool(viewer and db.query(FollowRequest.id).filter(FollowRequest.requester_id == viewer.id, FollowRequest.target_id == user.id, FollowRequest.status == "pending").first())
    return UserProfile(
        id=user.id,
        username=user.username,
        full_name=user.full_name,
        bio=user.bio if details else "",
        avatar_url=user.avatar_url,
        is_verified=user.is_verified,
        verification_expires_at=user.verification_expires_at,
        created_at=user.created_at,
        followers_count=_followers_count(db, user.id),
        following_count=_following_count(db, user.id),
        posts_count=_posts_count(db, user.id),
        is_followed_by_me=_is_followed_by(db, viewer.id if viewer else None, user.id),
        account_visibility=getattr(user, "account_visibility", None) or ("private" if user.is_private else "public"),
        follow_request_pending=pending,
        is_follow_requested=pending,
        follow_request_status="pending" if pending else None,
        follow_status="accepted" if _is_followed_by(db, viewer.id if viewer else None, user.id) else "pending" if pending else "none",
        can_view_content=details,
        can_view_profile_details=details,
    )


@router.get("/search", response_model=list[UserPublic])
def search_users(
    q: str = Query(default="", max_length=60),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=20, ge=1, le=50),
    db: Session = Depends(get_db),
):
    q = unicodedata.normalize("NFKC", q).strip().lower()
    if q.startswith("@"):
        q = q[1:]
    if not q:
        return []
    username = func.lower(User.username)
    full_name = func.lower(User.full_name)
    users = (
        db.query(User)
        .filter(
            or_(username.contains(q, autoescape=True), full_name.contains(q, autoescape=True)),
            User.is_banned == False,  # noqa: E712
            User.is_active == True,  # noqa: E712
        )
        .order_by(
            case(
                (username == q, 0),
                (username.startswith(q, autoescape=True), 1),
                (full_name.startswith(q, autoescape=True), 2),
                else_=3,
            ),
            username.asc(),
        )
        .offset(min(skip, 1_000_000))
        .limit(limit)
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
    changed = False
    if data.full_name is not None and data.full_name != current_user.full_name:
        current_user.full_name = data.full_name
        changed = True
    if data.bio is not None and data.bio != current_user.bio:
        current_user.bio = data.bio
        changed = True
    if changed:
        db.add(AccountActivity(user_id=current_user.id, activity_type="profile_updated"))
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
    db.add(AccountActivity(user_id=current_user.id, activity_type="profile_updated", details="avatar"))
    try:
        db.commit()
    except Exception:
        db.rollback()
        delete_image(new_url)
        raise
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
    db.add(AccountActivity(user_id=current_user.id, activity_type="password_changed"))
    db.commit()
    return Message(message="تم تغيير كلمة المرور بنجاح")


@router.delete("/me", response_model=Message)
def delete_account(
    data: AccountDelete,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.id in admin_ids():
        raise HTTPException(status_code=403, detail="أزل هذا المعرف من قائمة الإدارة بإجراء آمن قبل حذف الحساب")
    if not verify_password(data.password, current_user.hashed_password):
        raise HTTPException(status_code=400, detail="كلمة المرور غير صحيحة")
    image_urls = [row[0] for row in db.query(Post.image_url).filter(
        Post.author_id == current_user.id, Post.image_url.isnot(None)
    ).all()]
    image_urls.extend(row[0] for row in db.query(Story.image_url).filter(
        Story.author_id == current_user.id, Story.image_url.isnot(None)
    ).all())
    for circle_image, circle_cover in db.query(Circle.image_url, Circle.cover_url).filter(
        Circle.creator_id == current_user.id
    ).all():
        if circle_image:
            image_urls.append(circle_image)
        if circle_cover:
            image_urls.append(circle_cover)
    owned_business_pages = db.query(
        BusinessPage.id, BusinessPage.image_url, BusinessPage.cover_url
    ).filter(BusinessPage.owner_id == current_user.id).all()
    owned_business_page_ids = [row[0] for row in owned_business_pages]
    for _page_id, page_image, page_cover in owned_business_pages:
        if page_image:
            image_urls.append(page_image)
        if page_cover:
            image_urls.append(page_cover)
    if owned_business_page_ids:
        image_urls.extend(row[0] for row in db.query(BusinessProduct.image_url).filter(
            BusinessProduct.page_id.in_(owned_business_page_ids),
            BusinessProduct.image_url.isnot(None),
        ).all())
    video_urls = [row[0] for row in db.query(Reel.video_url).filter(Reel.author_id == current_user.id).all()]
    video_urls.extend(row[0] for row in db.query(Post.video_url).filter(
        Post.author_id == current_user.id, Post.video_url.isnot(None)
    ).all())
    video_urls.extend(row[0] for row in db.query(Story.video_url).filter(
        Story.author_id == current_user.id, Story.video_url.isnot(None)
    ).all())
    if current_user.avatar_url:
        image_urls.append(current_user.avatar_url)
    db.delete(current_user)
    db.commit()
    for image_url in image_urls:
        delete_image(image_url)
    for video_url in video_urls:
        delete_video(video_url)
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

    if (getattr(target, "account_visibility", None) or ("private" if target.is_private else "public")) == "private":
        req = db.query(FollowRequest).filter(FollowRequest.requester_id == current_user.id, FollowRequest.target_id == target.id).first()
        if req and req.status == "pending": raise HTTPException(status_code=400, detail="طلب المتابعة قيد الانتظار")
        if req: req.status = "pending"
        else: db.add(FollowRequest(requester_id=current_user.id, target_id=target.id, status="pending"))
        db.add(Notification(recipient_id=target.id, actor_id=current_user.id, type=NotificationType.follow)); db.commit()
        return Message(message="تم إرسال طلب المتابعة")
    pending = db.query(FollowRequest).filter(FollowRequest.requester_id == current_user.id, FollowRequest.target_id == target.id, FollowRequest.status == "pending").first()
    if pending:
        pending.status = "accepted"
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
    if existing:
        db.delete(existing)
        pending = db.query(FollowRequest).filter(FollowRequest.requester_id == current_user.id, FollowRequest.target_id == target.id, FollowRequest.status == "pending").first()
        if pending:
            pending.status = "cancelled"
    else:
        req = db.query(FollowRequest).filter(FollowRequest.requester_id == current_user.id, FollowRequest.target_id == target.id, FollowRequest.status == "pending").first()
        if not req: raise HTTPException(status_code=400, detail="أنت لا تتابع هذا المستخدم")
        req.status = "cancelled"
    db.commit()
    return Message(message="تم إلغاء المتابعة بنجاح")

@router.delete("/{username}/follow-request", response_model=Message)
def cancel_follow_request_for_user(username: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    target = db.query(User).filter(User.username == username.lower()).first()
    if not target:
        raise HTTPException(status_code=404, detail="المستخدم غير موجود")
    req = db.query(FollowRequest).filter(FollowRequest.requester_id == current_user.id, FollowRequest.target_id == target.id, FollowRequest.status == "pending").first()
    if not req:
        raise HTTPException(status_code=404, detail="طلب المتابعة غير موجود")
    req.status = "cancelled"
    db.commit()
    return Message(message="تم إلغاء طلب المتابعة")


@router.get("/{username}/followers", response_model=list[UserPublic])
def get_followers(
    username: str,
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=20, ge=1, le=50),
    db: Session = Depends(get_db),
    viewer: User | None = Depends(get_current_user_optional),
):
    target = db.query(User).filter(User.username == username.lower()).first()
    if not target:
        raise HTTPException(status_code=404, detail="المستخدم غير موجود")
    if (getattr(target, "account_visibility", None) or ("private" if target.is_private else "public")) == "private" and not (viewer and (viewer.id == target.id or is_accepted_follower(db, viewer, target))):
        raise HTTPException(status_code=403, detail="قائمة المتابعين خاصة")
    rows = (
        db.query(Follower)
        .filter(Follower.following_id == target.id)
        .order_by(Follower.id.asc())
        .offset(skip)
        .limit(limit)
        .all()
    )
    return [r.follower for r in rows]


@router.get("/{username}/following", response_model=list[UserPublic])
def get_following(
    username: str,
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=20, ge=1, le=50),
    db: Session = Depends(get_db),
    viewer: User | None = Depends(get_current_user_optional),
):
    target = db.query(User).filter(User.username == username.lower()).first()
    if not target:
        raise HTTPException(status_code=404, detail="المستخدم غير موجود")
    if (getattr(target, "account_visibility", None) or ("private" if target.is_private else "public")) == "private" and not (viewer and (viewer.id == target.id or is_accepted_follower(db, viewer, target))):
        raise HTTPException(status_code=403, detail="قائمة المتابَعين خاصة")
    rows = (
        db.query(Follower)
        .filter(Follower.follower_id == target.id)
        .order_by(Follower.id.asc())
        .offset(skip)
        .limit(limit)
        .all()
    )
    return [r.following for r in rows]


@router.get("/follow/requests")
def incoming_follow_requests(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    rows = db.query(FollowRequest).filter(FollowRequest.target_id == current_user.id, FollowRequest.status == "pending").order_by(FollowRequest.id.asc()).all()
    return [{"id": r.id, "requester": {"id": r.requester.id, "username": r.requester.username, "full_name": r.requester.full_name, "avatar_url": r.requester.avatar_url, "is_verified": r.requester.is_verified}, "status": r.status, "created_at": r.created_at} for r in rows]

@router.post("/follow/requests/{request_id}/approve", response_model=Message)
def approve_follow_request(request_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    req = db.query(FollowRequest).filter(FollowRequest.id == request_id, FollowRequest.target_id == current_user.id, FollowRequest.status == "pending").first()
    if not req: raise HTTPException(status_code=404, detail="طلب المتابعة غير موجود")
    req.status = "accepted"; db.add(Follower(follower_id=req.requester_id, following_id=req.target_id)); db.commit(); return Message(message="تم قبول طلب المتابعة")

@router.post("/follow/requests/{request_id}/reject", response_model=Message)
def reject_follow_request(request_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    req = db.query(FollowRequest).filter(FollowRequest.id == request_id, FollowRequest.target_id == current_user.id, FollowRequest.status == "pending").first()
    if not req: raise HTTPException(status_code=404, detail="طلب المتابعة غير موجود")
    req.status = "rejected"; db.commit(); return Message(message="تم رفض طلب المتابعة")

@router.delete("/follow/requests/{request_id}", response_model=Message)
def cancel_follow_request(request_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    req = db.query(FollowRequest).filter(FollowRequest.id == request_id, FollowRequest.requester_id == current_user.id, FollowRequest.status == "pending").first()
    if not req: raise HTTPException(status_code=404, detail="طلب المتابعة غير موجود")
    req.status = "cancelled"; db.commit(); return Message(message="تم إلغاء طلب المتابعة")
