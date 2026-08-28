"""
مسارات المنشورات: إنشاء، تعديل، حذف، الإعجاب/إلغاء الإعجاب، والـ Feed الرئيسي.
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, status
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func

from database.db import get_db
from middleware.auth_dependency import get_current_user, get_current_user_optional
from models.models import Post, User, Like, Comment, Follower, Notification, NotificationType
from schemas.schemas import PostOut, Message
from utils.files import save_image, delete_image

router = APIRouter(prefix="/api/posts", tags=["Posts"])


def _serialize_post(db: Session, post: Post, viewer: Optional[User]) -> PostOut:
    likes_count = db.query(func.count(Like.id)).filter(Like.post_id == post.id).scalar() or 0
    comments_count = db.query(func.count(Comment.id)).filter(Comment.post_id == post.id).scalar() or 0
    liked_by_me = False
    if viewer:
        liked_by_me = db.query(Like).filter(
            Like.post_id == post.id, Like.user_id == viewer.id
        ).first() is not None

    return PostOut(
        id=post.id,
        content=post.content,
        image_url=post.image_url,
        created_at=post.created_at,
        updated_at=post.updated_at,
        is_edited=post.is_edited,
        author=post.author,
        likes_count=likes_count,
        comments_count=comments_count,
        liked_by_me=liked_by_me,
    )


@router.post("", response_model=PostOut, status_code=status.HTTP_201_CREATED)
async def create_post(
    content: Optional[str] = Form(None),
    image: Optional[UploadFile] = File(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    text = (content or "").strip()
    if len(text) > 3000:
        raise HTTPException(status_code=400, detail="المنشور طويل جدًا")

    image_url = None
    if image is not None and image.filename:
        image_url = await save_image(image, "posts")

    if not text and not image_url:
        raise HTTPException(status_code=400, detail="لا يمكن نشر منشور فارغ")

    post = Post(author_id=current_user.id, content=text or None, image_url=image_url)
    db.add(post)
    db.commit()
    db.refresh(post)
    return _serialize_post(db, post, current_user)


@router.get("/feed", response_model=list[PostOut])
def get_feed(
    skip: int = 0,
    limit: int = 20,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    limit = min(limit, 50)
    following_ids = [
        r.following_id for r in
        db.query(Follower).filter(Follower.follower_id == current_user.id).all()
    ]
    author_ids = following_ids + [current_user.id]

    posts = (
        db.query(Post)
        .options(joinedload(Post.author))
        .filter(Post.author_id.in_(author_ids))
        .order_by(Post.created_at.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )
    return [_serialize_post(db, p, current_user) for p in posts]


@router.get("/explore", response_model=list[PostOut])
def get_explore(
    skip: int = 0,
    limit: int = 20,
    db: Session = Depends(get_db),
    viewer: Optional[User] = Depends(get_current_user_optional),
):
    limit = min(limit, 50)
    posts = (
        db.query(Post)
        .options(joinedload(Post.author))
        .order_by(Post.created_at.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )
    return [_serialize_post(db, p, viewer) for p in posts]


@router.get("/user/{username}", response_model=list[PostOut])
def get_user_posts(
    username: str,
    skip: int = 0,
    limit: int = 20,
    db: Session = Depends(get_db),
    viewer: Optional[User] = Depends(get_current_user_optional),
):
    limit = min(limit, 50)
    author = db.query(User).filter(User.username == username.lower()).first()
    if not author:
        raise HTTPException(status_code=404, detail="المستخدم غير موجود")
    posts = (
        db.query(Post)
        .options(joinedload(Post.author))
        .filter(Post.author_id == author.id)
        .order_by(Post.created_at.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )
    return [_serialize_post(db, p, viewer) for p in posts]


@router.get("/{post_id}", response_model=PostOut)
def get_post(
    post_id: int,
    db: Session = Depends(get_db),
    viewer: Optional[User] = Depends(get_current_user_optional),
):
    post = db.query(Post).options(joinedload(Post.author)).filter(Post.id == post_id).first()
    if not post:
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
    if post.author_id != current_user.id:
        raise HTTPException(status_code=403, detail="لا يمكنك تعديل منشور لا يخصك")

    text = (content or "").strip()
    if not text and not post.image_url:
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
    if post.author_id != current_user.id and not current_user.is_admin:
        raise HTTPException(status_code=403, detail="لا يمكنك حذف منشور لا يخصك")

    image_to_delete = post.image_url
    db.delete(post)
    db.commit()
    if image_to_delete:
        delete_image(image_to_delete)
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
