"""Reusable account privacy policy checks; routes and content enforcement share these."""
from fastapi import HTTPException
from sqlalchemy.orm import Session
from models.models import Follower, User


def is_accepted_follower(db: Session, viewer: User | None, author: User) -> bool:
    return bool(viewer and db.query(Follower.id).filter(
        Follower.follower_id == viewer.id, Follower.following_id == author.id
    ).first())


def can_view_account_content(db: Session, author: User, viewer: User | None) -> bool:
    if viewer and viewer.id == author.id:
        return True
    visibility = getattr(author, "account_visibility", None) or ("private" if getattr(author, "is_private", False) else "public")
    if visibility == "public":
        policy = author.content_visibility or "everyone"
        return policy == "everyone" or (policy == "followers" and is_accepted_follower(db, viewer, author))
    return is_accepted_follower(db, viewer, author)


def can_view_content(db: Session, author: User, viewer: User | None) -> bool:
    """Backward-compatible alias used by existing post/story enforcement."""
    return can_view_account_content(db, author, viewer)


def can_view_profile_details(db: Session, author: User, viewer: User | None) -> bool:
    return can_view_account_content(db, author, viewer)


def can_view_activity_status(db: Session, author: User, viewer: User | None) -> bool:
    if viewer and viewer.id == author.id:
        return True
    if not getattr(author, "show_activity_status", True):
        return False
    return can_view_account_content(db, author, viewer)


def can_comment(db: Session, viewer: User, author: User) -> bool:
    if viewer.id == author.id:
        return True
    if not can_view_account_content(db, author, viewer):
        return False
    policy = author.comment_privacy or "everyone"
    following = is_accepted_follower(db, viewer, author)
    followed_by = bool(db.query(Follower.id).filter(
        Follower.follower_id == author.id, Follower.following_id == viewer.id
    ).first())
    return policy == "everyone" or (policy == "followers" and following) or (policy == "following" and followed_by)


def require_can_comment(db: Session, viewer: User, author: User) -> None:
    if not can_comment(db, viewer, author):
        raise HTTPException(status_code=403, detail="لا يسمح هذا الحساب بالتعليق منك")


def can_send_message(db: Session, sender: User, recipient: User) -> tuple[bool, str]:
    if sender.id == recipient.id:
        return True, ""
    policy = recipient.message_privacy or "everyone"
    if policy == "everyone":
        return True, ""
    following = is_accepted_follower(db, sender, recipient)
    followed_by = bool(db.query(Follower.id).filter(Follower.follower_id == recipient.id, Follower.following_id == sender.id).first())
    if policy == "followers" and following:
        return True, ""
    if policy == "following" and followed_by:
        return True, ""
    return False, "الرسائل الخاصة معطلة لهذا الحساب"


def require_message_access(db: Session, sender: User, recipient: User) -> None:
    allowed, reason = can_send_message(db, sender, recipient)
    if not allowed:
        raise HTTPException(status_code=403, detail=reason)
