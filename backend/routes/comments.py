from services.moderation import is_platform_admin
"""
مسارات التعليقات: إضافة تعليق، عرض تعليقات منشور، حذف تعليق.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload

from database.db import get_db
from middleware.auth_dependency import get_current_user, get_current_user_optional
from models.models import Comment, Post, User, Notification, NotificationType
from schemas.schemas import CommentCreate, CommentOut, Message
from services.content_access import can_view_post, has_circle_capability
from services import account_privacy

router = APIRouter(prefix="/api/posts", tags=["Comments"])


@router.post("/{post_id}/comments", response_model=CommentOut, status_code=status.HTTP_201_CREATED)
def create_comment(
    post_id: int,
    data: CommentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    post = db.query(Post).filter(Post.id == post_id).first()
    if not post:
        raise HTTPException(status_code=404, detail="المنشور غير موجود")
    if not can_view_post(db, post, current_user):
        raise HTTPException(status_code=404, detail="المنشور غير موجود")

    can_comment = getattr(account_privacy, "can_comment", None)
    if can_comment is not None and not can_comment(db, current_user, post.author):
        raise HTTPException(status_code=403, detail="لا يسمح هذا الحساب بالتعليق")

    comment = Comment(post_id=post_id, author_id=current_user.id, content=data.content)
    db.add(comment)
    db.commit()
    db.refresh(comment)

    if post.author_id != current_user.id:
        db.add(Notification(
            recipient_id=post.author_id, actor_id=current_user.id,
            type=NotificationType.comment, post_id=post.id, comment_id=comment.id,
        ))
        db.commit()

    return comment


@router.get("/{post_id}/comments", response_model=list[CommentOut])
def list_comments(post_id: int, skip: int = 0, limit: int = 50, db: Session = Depends(get_db), viewer: User | None = Depends(get_current_user_optional)):
    post = db.query(Post).filter(Post.id == post_id).first()
    if not post:
        raise HTTPException(status_code=404, detail="المنشور غير موجود")
    if not can_view_post(db, post, viewer):
        raise HTTPException(status_code=404, detail="المنشور غير موجود")

    skip = max(0, min(skip, 1_000_000))
    limit = max(1, min(limit, 100))
    comments = (
        db.query(Comment)
        .options(joinedload(Comment.author))
        .filter(Comment.post_id == post_id)
        .order_by(Comment.created_at.asc())
        .offset(skip)
        .limit(limit)
        .all()
    )
    return comments


@router.delete("/comments/{comment_id}", response_model=Message)
def delete_comment(
    comment_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    comment = db.query(Comment).filter(Comment.id == comment_id).first()
    if not comment:
        raise HTTPException(status_code=404, detail="التعليق غير موجود")

    post = db.query(Post).filter(Post.id == comment.post_id).first()
    if post and not can_view_post(db, post, current_user):
        raise HTTPException(status_code=404, detail="التعليق غير موجود")
    is_post_owner = post is not None and post.author_id == current_user.id
    is_circle_moderator_user = bool(post and post.circle_id and has_circle_capability(db, post.circle_id, current_user, "manage_posts"))

    if comment.author_id != current_user.id and not is_post_owner and not is_circle_moderator_user and not is_platform_admin(current_user):
        raise HTTPException(status_code=403, detail="لا يمكنك حذف هذا التعليق")

    db.delete(comment)
    db.commit()
    return Message(message="تم حذف التعليق بنجاح")
