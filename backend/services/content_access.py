import json

from services.moderation import is_platform_admin
from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from models.models import Circle, CircleDMApproval, CircleMembership, Follower, Post, User


def can_view_account_content(db, author, viewer):
    """Canonical account gate, with compatibility for the core helper rollout."""
    from services import account_privacy
    helper = getattr(account_privacy, "can_view_account_content", None)
    if helper is not None:
        return helper(db, author, viewer)
    return account_privacy.can_view_content(db, author, viewer)

def visible_account_author_ids(db: Session, viewer: User | None):
    """Apply privacy before pagination without loading every author's rows."""
    public = and_(User.account_visibility == "public", User.content_visibility == "everyone")
    if viewer is None:
        return db.query(User.id).filter(public)
    accepted = db.query(Follower.following_id).filter(Follower.follower_id == viewer.id)
    return db.query(User.id).filter(or_(public, User.id == viewer.id, User.id.in_(accepted)))

CAPABILITIES = frozenset({"approve_members", "remove_members", "manage_posts", "edit_circle", "pin_posts"})


def get_circle_membership(db: Session, circle_id: int, user_id: int) -> CircleMembership | None:
    return db.query(CircleMembership).filter(
        CircleMembership.circle_id == circle_id,
        CircleMembership.user_id == user_id,
    ).first()


def membership_capabilities(membership: CircleMembership | None) -> set[str]:
    if not membership or membership.status != "active":
        return set()
    if membership.role == "owner":
        return set(CAPABILITIES)
    # Capabilities are meaningful only for an active moderator. Never trust a
    # stale capabilities JSON blob on an ordinary member row.
    if membership.role != "moderator":
        return set()
    try:
        values = json.loads(membership.capabilities or "[]")
    except (TypeError, ValueError):
        values = []
    return set(values).intersection(CAPABILITIES) if isinstance(values, list) else set()


def can_view_circle(db: Session, circle: Circle, viewer: User | None) -> bool:
    if not circle.is_private:
        return True
    if viewer is None:
        return False
    if is_platform_admin(viewer):
        return True
    membership = get_circle_membership(db, circle.id, viewer.id)
    return bool(membership and membership.status == "active")


def has_circle_capability(db: Session, circle_id: int, user: User, capability: str) -> bool:
    if is_platform_admin(user):
        return True
    return capability in membership_capabilities(get_circle_membership(db, circle_id, user.id))


def is_circle_moderator(db: Session, circle_id: int, user: User) -> bool:
    if is_platform_admin(user):
        return True
    membership = get_circle_membership(db, circle_id, user.id)
    return bool(membership and membership.status == "active" and membership.role in {"owner", "moderator"})


def shared_active_circles(db: Session, user_a_id: int, user_b_id: int) -> list[Circle]:
    return (db.query(Circle)
            .join(CircleMembership, CircleMembership.circle_id == Circle.id)
            .filter(CircleMembership.user_id == user_a_id, CircleMembership.status == "active")
            .filter(Circle.is_archived == False)  # noqa: E712
            .filter(Circle.id.in_(db.query(CircleMembership.circle_id).filter(
                CircleMembership.user_id == user_b_id, CircleMembership.status == "active"
            )))
            .all())


def dm_approval_active(db: Session, circle_id: int, user_a_id: int, user_b_id: int) -> bool:
    return db.query(CircleDMApproval.id).filter(
        CircleDMApproval.circle_id == circle_id,
        CircleDMApproval.requester_id == user_a_id,
        CircleDMApproval.recipient_id == user_b_id,
        CircleDMApproval.status == "active",
    ).first() is not None or db.query(CircleDMApproval.id).filter(
        CircleDMApproval.circle_id == circle_id,
        CircleDMApproval.requester_id == user_b_id,
        CircleDMApproval.recipient_id == user_a_id,
        CircleDMApproval.status == "active",
    ).first() is not None


def can_send_member_dm(db: Session, user_a_id: int, user_b_id: int, circle_id: int | None = None) -> bool:
    circles = shared_active_circles(db, user_a_id, user_b_id)
    # Explicit community context must itself be shared, even when there are no
    # shared circles (prevents arbitrary context injection).
    if circle_id is not None and not any(c.id == circle_id for c in circles):
        return False
    if not circles:
        return circle_id is None
    # Approval is required in every shared active circle; context never bypasses one.
    return all(dm_approval_active(db, c.id, user_a_id, user_b_id) for c in circles)


def can_view_post(db: Session, post: Post, viewer: User | None) -> bool:
    # Archived posts are hidden from normal feeds; only their author may inspect.
    if post.is_archived and not (viewer and viewer.id == post.author_id):
        return False
    if not can_view_account_content(db, post.author, viewer):
        return False
    if post.circle_id is None:
        return True
    circle = db.query(Circle).filter(Circle.id == post.circle_id).first()
    return bool(circle and can_view_circle(db, circle, viewer))


def require_post_access(db: Session, post: Post, viewer: User) -> None:
    if not can_view_post(db, post, viewer):
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="المنشور غير موجود")
