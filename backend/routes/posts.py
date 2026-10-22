from services.moderation import is_platform_admin
"""
مسارات المنشورات: إنشاء، تعديل، حذف، الإعجاب/إلغاء الإعجاب، والـ Feed الرئيسي.
"""
from typing import Optional
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, status
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func, or_

from database.db import get_db
from middleware.auth_dependency import get_current_user, get_current_user_optional
from models.models import (
    Post, User, Like, Comment, Follower, Notification, NotificationType,
    Circle, CircleMembership, Challenge, ChallengeAchievement, BusinessPage, BusinessFollow,
)
from schemas.schemas import PostOut, Message
from services.content_access import can_view_post, get_circle_membership, has_circle_capability
from services.content_access import can_view_account_content, visible_account_author_ids
from utils.files import save_image, save_video, delete_image, delete_video

router = APIRouter(prefix="/api/posts", tags=["Posts"])


def _visible_circle_posts(db: Session, query, viewer: Optional[User]):
    public_circle_ids = db.query(Circle.id).filter(Circle.is_private == False, Circle.is_archived == False)  # noqa: E712
    allowed = [Post.circle_id.is_(None), Post.circle_id.in_(public_circle_ids)]
    if viewer:
        member_circle_ids = db.query(CircleMembership.circle_id).filter(
            CircleMembership.user_id == viewer.id, CircleMembership.status == "active"
        )
        allowed.append(Post.circle_id.in_(member_circle_ids))
    return query.filter(or_(*allowed))


def _serialize_post(db: Session, post: Post, viewer: Optional[User]) -> PostOut:
    likes_count = db.query(func.count(Like.id)).filter(Like.post_id == post.id).scalar() or 0
    comments_count = db.query(func.count(Comment.id)).filter(Comment.post_id == post.id).scalar() or 0
    liked_by_me = False
    if viewer:
        liked_by_me = db.query(Like).filter(
            Like.post_id == post.id, Like.user_id == viewer.id
        ).first() is not None

    image_url, video_url = post.image_url, post.video_url
    # Never expose follower-only media through the static /uploads route.  The
    # authenticated endpoint performs the same post + privacy authorization.
    protected = bool(post.circle_id)
    if post.author and ((post.author.content_visibility or "everyone") != "everyone" or (post.author.account_visibility or "public") == "private"):
        protected = True
    if protected:
        if viewer and can_view_post(db, post, viewer):
            image_url = f"/api/private-media/posts/{post.id}/image" if post.image_url else None
            video_url = f"/api/private-media/posts/{post.id}/video" if post.video_url else None
        else:
            image_url = video_url = None

    business = db.query(BusinessPage).filter(BusinessPage.id == post.business_id, BusinessPage.is_active == True).first() if post.business_id else None  # noqa: E712
    return PostOut(
        id=post.id,
        content=post.content,
        image_url=image_url,
        video_url=video_url,
        mood_key=post.mood_key,
        created_at=post.created_at,
        updated_at=post.updated_at,
        is_edited=post.is_edited,
        author=post.author,
        circle_id=post.circle_id,
        challenge_id=post.challenge_id,
        business_id=post.business_id,
        business={"id": business.id, "name": business.name, "image_url": business.image_url} if business else None,
        likes_count=likes_count,
        comments_count=comments_count,
        liked_by_me=liked_by_me,
    )


@router.post("", response_model=PostOut, status_code=status.HTTP_201_CREATED)
async def create_post(
    content: Optional[str] = Form(None),
    image: Optional[UploadFile] = File(None),
    video: Optional[UploadFile] = File(None),
    mood_key: Optional[str] = Form(None),
    circle_id: Optional[int] = Form(None),
    challenge_id: Optional[int] = Form(None),
    business_id: Optional[int] = Form(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    text = (content or "").strip()
    if len(text) > 3000:
        raise HTTPException(status_code=400, detail="المنشور طويل جدًا")
    if image and image.filename and video and video.filename:
        raise HTTPException(status_code=400, detail="اختر صورة أو فيديو واحدًا فقط")
    mood_key = (mood_key or "").strip().lower() or None
    if mood_key not in {None, "happy", "sad"}:
        raise HTTPException(status_code=400, detail="اختر مزاجًا صالحًا: سعيد أو حزين")
    if sum(value is not None for value in (circle_id, challenge_id, business_id)) > 1:
        raise HTTPException(status_code=400, detail="اختر وجهة واحدة فقط للمنشور")

    challenge = None
    if circle_id is not None:
        circle = db.query(Circle).filter(Circle.id == circle_id, Circle.is_archived == False).first()  # noqa: E712
        membership = get_circle_membership(db, circle_id, current_user.id)
        if not circle or not membership or membership.status != "active":
            raise HTTPException(status_code=403, detail="يجب أن تكون عضوًا نشطًا في الدائرة لنشر محتوى فيها")
    if challenge_id is not None:
        challenge = db.query(Challenge).filter(Challenge.id == challenge_id).first()
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        if not challenge or not challenge.is_active or not (challenge.starts_at <= now <= challenge.ends_at):
            raise HTTPException(status_code=400, detail="التحدي غير نشط أو خارج فترة المشاركة")
        if db.query(Post.id).filter(Post.challenge_id == challenge_id, Post.author_id == current_user.id).first():
            raise HTTPException(status_code=409, detail="شاركت بالفعل في هذا التحدي")
    if business_id is not None:
        page = db.query(BusinessPage).filter(BusinessPage.id == business_id, BusinessPage.is_active == True).first()  # noqa: E712
        if not page or page.owner_id != current_user.id:
            raise HTTPException(status_code=403, detail="يمكن لمالك صفحة الأعمال فقط النشر باسمها")

    image_url = None
    if image is not None and image.filename:
        image_url = await save_image(image, "posts")
    video_url = None
    if video is not None and video.filename:
        video_url = await save_video(video, "posts")

    if not text and not image_url and not video_url:
        raise HTTPException(status_code=400, detail="لا يمكن نشر منشور فارغ")

    post = Post(author_id=current_user.id, content=text or None, image_url=image_url,
                video_url=video_url, mood_key=mood_key, circle_id=circle_id,
                challenge_id=challenge_id, business_id=business_id)
    try:
        db.add(post)
        db.flush()
        if challenge:
            db.add(ChallengeAchievement(challenge_id=challenge.id, user_id=current_user.id))
        db.commit()
        db.refresh(post)
    except Exception:
        db.rollback()
        if image_url:
            delete_image(image_url)
        if video_url:
            delete_video(video_url)
        raise
    return _serialize_post(db, post, current_user)


@router.get("/feed", response_model=list[PostOut])
def get_feed(
    skip: int = 0,
    limit: int = 20,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    skip = max(0, min(skip, 1_000_000))
    limit = max(1, min(limit, 50))
    following_ids = [
        r.following_id for r in
        db.query(Follower).filter(Follower.follower_id == current_user.id).all()
    ]
    author_ids = following_ids + [current_user.id]

    followed_business_ids = db.query(BusinessFollow.page_id).filter(BusinessFollow.user_id == current_user.id)
    query = _visible_circle_posts(db, db.query(Post).options(joinedload(Post.author)).filter(
        or_(Post.author_id.in_(author_ids), Post.business_id.in_(followed_business_ids))
    ).filter(Post.is_archived == False, Post.author_id.in_(visible_account_author_ids(db, current_user))), current_user)
    posts = (
        query
        .order_by(Post.created_at.desc())
        .offset(skip).limit(limit).all()
    )
    visible = [p for p in posts if can_view_account_content(db, p.author, current_user)]
    return [_serialize_post(db, p, current_user) for p in visible]


@router.get("/explore", response_model=list[PostOut])
def get_explore(
    skip: int = 0,
    limit: int = 20,
    db: Session = Depends(get_db),
    viewer: Optional[User] = Depends(get_current_user_optional),
):
    skip = max(0, min(skip, 1_000_000))
    limit = max(1, min(limit, 50))
    posts = (
        _visible_circle_posts(db, db.query(Post)
        .options(joinedload(Post.author))
        .filter(Post.is_archived == False, Post.author_id.in_(visible_account_author_ids(db, viewer)))
        , viewer)
        .order_by(Post.created_at.desc())
        .offset(skip).limit(limit).all()
    )
    visible = [p for p in posts if can_view_post(db, p, viewer)]
    return [_serialize_post(db, p, viewer) for p in visible]


@router.get("/user/{username}", response_model=list[PostOut])
def get_user_posts(
    username: str,
    skip: int = 0,
    limit: int = 20,
    db: Session = Depends(get_db),
    viewer: Optional[User] = Depends(get_current_user_optional),
):
    skip = max(0, min(skip, 1_000_000))
    limit = max(1, min(limit, 50))
    author = db.query(User).filter(User.username == username.lower()).first()
    if not author:
        raise HTTPException(status_code=404, detail="المستخدم غير موجود")
    posts = (
        _visible_circle_posts(db, db.query(Post)
        .options(joinedload(Post.author))
        .filter(Post.author_id == author.id, Post.is_archived == False, Post.author_id.in_(visible_account_author_ids(db, viewer)))
        , viewer)
        .order_by(Post.created_at.desc())
        .offset(skip).limit(limit).all()
    )
    visible = [p for p in posts if can_view_account_content(db, p.author, viewer)]
    return [_serialize_post(db, p, viewer) for p in visible]


@router.get("/{post_id}", response_model=PostOut)
def get_post(
    post_id: int,
    db: Session = Depends(get_db),
    viewer: Optional[User] = Depends(get_current_user_optional),
):
    post = db.query(Post).options(joinedload(Post.author)).filter(Post.id == post_id, Post.is_archived == False).first()
    if not post:
        raise HTTPException(status_code=404, detail="المنشور غير موجود")
    if not can_view_post(db, post, viewer) or not can_view_account_content(db, post.author, viewer):
        raise HTTPException(status_code=404, detail="المنشور غير موجود")
    return _serialize_post(db, post, viewer)


@router.put("/{post_id}", response_model=PostOut)
def update_post(
    post_id: int,
    content: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    post = db.query(Post).filter(Post.id == post_id).first()
    if not post:
        raise HTTPException(status_code=404, detail="المنشور غير موجود")
    if not can_view_post(db, post, current_user):
        raise HTTPException(status_code=404, detail="المنشور غير موجود")
    if post.author_id != current_user.id:
        raise HTTPException(status_code=403, detail="لا يمكنك تعديل منشور لا يخصك")

    text = (content or "").strip()
    if not text and not post.image_url and not post.video_url:
        raise HTTPException(status_code=400, detail="لا يمكن أن يكون المنشور فارغًا")
    if len(text) > 3000:
        raise HTTPException(status_code=400, detail="المنشور طويل جدًا")

    post.content = text or None
    post.is_edited = True
    db.commit()
    db.refresh(post)
    return _serialize_post(db, post, current_user)


@router.delete("/{post_id}", response_model=Message)
def delete_post(
    post_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    post = db.query(Post).filter(Post.id == post_id).first()
    if not post:
        raise HTTPException(status_code=404, detail="المنشور غير موجود")
    if post.author_id != current_user.id and not is_platform_admin(current_user) and not (post.circle_id and has_circle_capability(db, post.circle_id, current_user, "manage_posts")):
        raise HTTPException(status_code=403, detail="لا يمكنك حذف منشور لا يخصك")

    image_to_delete = post.image_url
    video_to_delete = post.video_url
    db.delete(post)
    db.commit()
    if image_to_delete:
        delete_image(image_to_delete)
    if video_to_delete:
        delete_video(video_to_delete)
    return Message(message="تم حذف المنشور بنجاح")


@router.post("/{post_id}/like", response_model=Message)
def like_post(
    post_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    post = db.query(Post).filter(Post.id == post_id).first()
    if not post:
        raise HTTPException(status_code=404, detail="المنشور غير موجود")
    if not can_view_post(db, post, current_user):
        raise HTTPException(status_code=404, detail="المنشور غير موجود")

    existing = db.query(Like).filter(Like.post_id == post_id, Like.user_id == current_user.id).first()
    if existing:
        raise HTTPException(status_code=400, detail="أنت معجب بهذا المنشور بالفعل")

    db.add(Like(user_id=current_user.id, post_id=post_id))
    if post.author_id != current_user.id:
        db.add(Notification(
            recipient_id=post.author_id, actor_id=current_user.id,
            type=NotificationType.like, post_id=post.id,
        ))
    db.commit()
    return Message(message="تم الإعجاب بالمنشور")


@router.delete("/{post_id}/like", response_model=Message)
def unlike_post(
    post_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    like = db.query(Like).filter(Like.post_id == post_id, Like.user_id == current_user.id).first()
    if not like:
        raise HTTPException(status_code=400, detail="أنت لست معجبًا بهذا المنشور")
    db.delete(like)
    db.commit()
    return Message(message="تم إلغاء الإعجاب")
