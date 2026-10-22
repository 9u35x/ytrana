from services.moderation import is_platform_admin
"""دوائر Ytrana: إنشاء واكتشاف وعضوية وصلاحيات ومحتوى خاص."""
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import func, or_
from sqlalchemy.orm import Session, joinedload

from database.db import get_db
from middleware.auth_dependency import get_current_user, get_current_user_optional
from models.models import Circle, CircleDMApproval, CircleDMRequest, CircleMembership, Post, User
from schemas.schemas import CircleMemberRole, CircleUpdate, DmApprovalCreate, Message
from services.content_access import can_view_circle, can_view_post, can_view_account_content, get_circle_membership, has_circle_capability, is_circle_moderator, membership_capabilities
from utils.files import delete_image, save_image
from routes.posts import _serialize_post

router = APIRouter(prefix="/api/circles", tags=["Circles"])


def _public_user(user: User) -> dict:
    return {"id": user.id, "username": user.username, "full_name": user.full_name,
            "bio": "" if user.account_visibility == "private" else user.bio,
            "avatar_url": user.avatar_url, "created_at": user.created_at}


def _circle_out(db: Session, circle: Circle, viewer: User | None) -> dict:
    membership = get_circle_membership(db, circle.id, viewer.id) if viewer else None
    can_read_content = can_view_circle(db, circle, viewer)
    members_count = (db.query(func.count(CircleMembership.id)).filter(
        CircleMembership.circle_id == circle.id, CircleMembership.status == "active"
    ).scalar() or 0) if can_read_content else 0
    posts_count = (db.query(func.count(Post.id)).filter(Post.circle_id == circle.id).scalar() or 0) if can_read_content else 0
    image_url = circle.image_url
    cover_url = circle.cover_url
    if circle.is_private:
        image_url = f"/api/private-media/circles/{circle.id}/image" if can_read_content and circle.image_url else None
        cover_url = f"/api/private-media/circles/{circle.id}/cover" if can_read_content and circle.cover_url else None
    return {
        "id": circle.id, "name": circle.name, "description": circle.description,
        "image_url": image_url, "cover_url": cover_url,
        "is_private": circle.is_private, "is_archived": circle.is_archived,
        "creator": _public_user(circle.creator), "created_at": circle.created_at,
        "members_count": members_count, "posts_count": posts_count,
        "my_membership": membership.status if membership else None,
        "my_role": membership.role if membership and membership.status == "active" else None,
        "moderator_capabilities": sorted(membership_capabilities(membership)),
        "can_moderate": bool(viewer and is_circle_moderator(db, circle.id, viewer)),
        "pinned_post_id": circle.pinned_post_id if can_read_content else None,
    }


def _get_circle(db: Session, circle_id: int) -> Circle:
    circle = db.query(Circle).options(joinedload(Circle.creator)).filter(Circle.id == circle_id).first()
    if not circle:
        raise HTTPException(status_code=404, detail="الدائرة غير موجودة")
    return circle


def _require_capability(db: Session, circle: Circle, user: User, capability: str) -> None:
    if not has_circle_capability(db, circle.id, user, capability):
        raise HTTPException(status_code=403, detail=f"تحتاج صلاحية الدائرة: {capability}")


def _require_owner(db: Session, circle: Circle, user: User) -> None:
    membership = get_circle_membership(db, circle.id, user.id)
    if not membership or membership.status != "active" or membership.role != "owner":
        raise HTTPException(status_code=403, detail="هذه العملية متاحة لمالك الدائرة فقط")


@router.get("")
def discover_circles(q: str = "", skip: int = 0, limit: int = 20, db: Session = Depends(get_db), viewer: User | None = Depends(get_current_user_optional)):
    skip, limit = max(0, min(skip, 1_000_000)), max(1, min(limit, 50))
    query = db.query(Circle).options(joinedload(Circle.creator)).filter(Circle.is_archived == False, Circle.is_private == False)  # noqa: E712
    term = q.strip()[:100]
    if term:
        query = query.filter(or_(Circle.name.contains(term, autoescape=True), Circle.description.contains(term, autoescape=True)))
    rows = query.order_by(Circle.created_at.desc()).offset(skip).limit(limit).all()
    return [_circle_out(db, row, viewer) for row in rows]


@router.get("/mine")
def my_circles(db: Session = Depends(get_db), viewer: User = Depends(get_current_user)):
    rows = db.query(Circle).join(CircleMembership, CircleMembership.circle_id == Circle.id).options(joinedload(Circle.creator)).filter(
        CircleMembership.user_id == viewer.id
    ).order_by(Circle.created_at.desc()).all()
    return [_circle_out(db, row, viewer) for row in rows]


@router.post("")
async def create_circle(
    name: str = Form(...), description: str = Form(""), is_private: bool = Form(False),
    image: UploadFile | None = File(None), cover: UploadFile | None = File(None),
    db: Session = Depends(get_db), viewer: User = Depends(get_current_user),
):
    name = name.strip()
    description = description.strip()
    if not 3 <= len(name) <= 100 or len(description) > 1000:
        raise HTTPException(status_code=422, detail="تحقق من اسم الدائرة ووصفها")
    image_url = cover_url = None
    try:
        if image and image.filename:
            image_url = await save_image(image, "circles")
        if cover and cover.filename:
            cover_url = await save_image(cover, "circles")
        circle = Circle(name=name, description=description, is_private=is_private, image_url=image_url, cover_url=cover_url, creator_id=viewer.id)
        db.add(circle)
        db.flush()
        db.add(CircleMembership(circle_id=circle.id, user_id=viewer.id, role="owner", status="active"))
        db.commit()
        db.refresh(circle)
        return _circle_out(db, circle, viewer)
    except Exception:
        db.rollback()
        if image_url:
            delete_image(image_url)
        if cover_url:
            delete_image(cover_url)
        raise


@router.get("/{circle_id}")
def get_circle(circle_id: int, db: Session = Depends(get_db), viewer: User | None = Depends(get_current_user_optional)):
    circle = _get_circle(db, circle_id)
    membership = get_circle_membership(db, circle.id, viewer.id) if viewer else None
    if not can_view_circle(db, circle, viewer) and not (membership and membership.status == "pending"):
        raise HTTPException(status_code=404, detail="الدائرة غير موجودة")
    return _circle_out(db, circle, viewer)


@router.put("/{circle_id}")
def update_circle(circle_id: int, data: CircleUpdate, db: Session = Depends(get_db), viewer: User = Depends(get_current_user)):
    circle = _get_circle(db, circle_id)
    _require_capability(db, circle, viewer, "edit_circle")
    for field in ("name", "description", "is_private"):
        value = getattr(data, field)
        if value is not None:
            setattr(circle, field, value)
    db.commit()
    db.refresh(circle)
    return _circle_out(db, circle, viewer)


@router.put("/{circle_id}/archive", response_model=Message)
def archive_circle(circle_id: int, db: Session = Depends(get_db), viewer: User = Depends(get_current_user)):
    circle = _get_circle(db, circle_id)
    _require_capability(db, circle, viewer, "edit_circle")
    circle.is_archived = True
    db.commit()
    return Message(message="تم أرشفة الدائرة؛ بقيت منشوراتها وبياناتها محفوظة")


@router.post("/{circle_id}/join")
def join_circle(circle_id: int, db: Session = Depends(get_db), viewer: User = Depends(get_current_user)):
    circle = _get_circle(db, circle_id)
    if circle.is_archived:
        raise HTTPException(status_code=400, detail="هذه الدائرة مؤرشفة ولا تقبل أعضاء جددًا")
    existing = get_circle_membership(db, circle.id, viewer.id)
    if existing:
        raise HTTPException(status_code=400, detail="لديك طلب أو عضوية في هذه الدائرة بالفعل")
    status = "pending" if circle.is_private else "active"
    db.add(CircleMembership(circle_id=circle.id, user_id=viewer.id, status=status))
    db.commit()
    return {"message": "أُرسل طلب الانضمام إلى مشرفي الدائرة" if status == "pending" else "انضممت إلى الدائرة", "membership_status": status}


@router.delete("/{circle_id}/leave", response_model=Message)
def leave_circle(circle_id: int, db: Session = Depends(get_db), viewer: User = Depends(get_current_user)):
    membership = get_circle_membership(db, circle_id, viewer.id)
    if not membership:
        raise HTTPException(status_code=404, detail="لا توجد لك عضوية في هذه الدائرة")
    if membership.role == "owner":
        raise HTTPException(status_code=400, detail="مالك الدائرة لا يغادرها؛ أرشفها أو عيّن مالكًا جديدًا")
    db.delete(membership)
    db.commit()
    return Message(message="غادرت الدائرة")


@router.get("/{circle_id}/members")
def list_members(circle_id: int, status_filter: str = "active", db: Session = Depends(get_db), viewer: User = Depends(get_current_user)):
    circle = _get_circle(db, circle_id)
    if status_filter not in {"active", "pending"}:
        raise HTTPException(status_code=400, detail="حالة العضوية غير صالحة")
    if not can_view_circle(db, circle, viewer):
        raise HTTPException(status_code=404, detail="الدائرة غير موجودة")
    if status_filter == "pending":
        _require_capability(db, circle, viewer, "approve_members")
    rows = db.query(CircleMembership).options(joinedload(CircleMembership.user)).filter(
        CircleMembership.circle_id == circle.id, CircleMembership.status == status_filter
    ).order_by(CircleMembership.created_at.asc()).limit(200).all()
    return [{"user": _public_user(row.user), "role": row.role, "status": row.status, "created_at": row.created_at} for row in rows]


@router.post("/{circle_id}/members/{user_id}/approve", response_model=Message)
def approve_member(circle_id: int, user_id: int, db: Session = Depends(get_db), viewer: User = Depends(get_current_user)):
    circle = _get_circle(db, circle_id)
    _require_capability(db, circle, viewer, "approve_members")
    membership = get_circle_membership(db, circle.id, user_id)
    if not membership or membership.status != "pending":
        raise HTTPException(status_code=404, detail="طلب الانضمام غير موجود")
    membership.status = "active"
    db.commit()
    return Message(message="تم قبول طلب الانضمام")


@router.delete("/{circle_id}/members/{user_id}", response_model=Message)
def remove_member(circle_id: int, user_id: int, db: Session = Depends(get_db), viewer: User = Depends(get_current_user)):
    circle = _get_circle(db, circle_id)
    _require_capability(db, circle, viewer, "remove_members")
    membership = get_circle_membership(db, circle.id, user_id)
    if not membership:
        raise HTTPException(status_code=404, detail="العضوية غير موجودة")
    if membership.role == "owner":
        raise HTTPException(status_code=400, detail="لا يمكن إزالة مالك الدائرة")
    db.delete(membership)
    db.commit()
    return Message(message="تمت إزالة العضو")


@router.put("/{circle_id}/members/{user_id}/role", response_model=Message)
def change_member_role(circle_id: int, user_id: int, data: CircleMemberRole, db: Session = Depends(get_db), viewer: User = Depends(get_current_user)):
    circle = _get_circle(db, circle_id)
    owner = get_circle_membership(db, circle.id, viewer.id)
    if not (owner and owner.role == "owner" and owner.status == "active"):
        raise HTTPException(status_code=403, detail="تغيير صلاحية المشرف متاح لمالك الدائرة فقط")
    membership = get_circle_membership(db, circle.id, user_id)
    if not membership or membership.status != "active" or membership.role == "owner":
        raise HTTPException(status_code=404, detail="العضو النشط غير موجود")
    membership.role = data.role
    membership.capabilities = "[]" if data.role == "member" else __import__("json").dumps(sorted(set(data.capabilities)), separators=(",", ":"))
    db.commit()
    return Message(message="تم تحديث دور العضو")


@router.put("/{circle_id}/pin/{post_id}", response_model=Message)
def pin_post(circle_id: int, post_id: int, db: Session = Depends(get_db), viewer: User = Depends(get_current_user)):
    circle = _get_circle(db, circle_id)
    _require_capability(db, circle, viewer, "pin_posts")
    post = db.query(Post).filter(Post.id == post_id, Post.circle_id == circle.id).first()
    if not post:
        raise HTTPException(status_code=404, detail="المنشور غير موجود في هذه الدائرة")
    circle.pinned_post_id = post.id
    db.commit()
    return Message(message="تم تثبيت المنشور")


@router.delete("/{circle_id}/pin", response_model=Message)
def unpin_post(circle_id: int, db: Session = Depends(get_db), viewer: User = Depends(get_current_user)):
    circle = _get_circle(db, circle_id)
    _require_capability(db, circle, viewer, "pin_posts")
    circle.pinned_post_id = None
    db.commit()
    return Message(message="تم إلغاء تثبيت المنشور")


@router.get("/{circle_id}/posts")
def circle_posts(circle_id: int, skip: int = 0, limit: int = 20, db: Session = Depends(get_db), viewer: User = Depends(get_current_user)):
    circle = _get_circle(db, circle_id)
    if not can_view_circle(db, circle, viewer):
        raise HTTPException(status_code=404, detail="الدائرة غير موجودة")
    rows = db.query(Post).options(joinedload(Post.author)).filter(Post.circle_id == circle.id).order_by(Post.created_at.desc()).all()
    # Circle membership never bypasses the author account gate or archived-post rule.
    visible = [post for post in rows if can_view_post(db, post, viewer) and can_view_account_content(db, post.author, viewer)]
    start = max(skip, 0); end = start + max(1, min(limit, 50))
    return [_serialize_post(db, post, viewer) for post in visible[start:end]]


def _pair_members(db: Session, circle_id: int, requester_id: int, recipient_id: int, owner_id: int | None = None):
    if requester_id == recipient_id:
        raise HTTPException(status_code=422, detail="يجب أن يكون العضوان مختلفين")
    # The owner may also be one party. Approval is still owner-only, so a
    # member's request to contact the owner must not become impossible to approve.
    ids = {requester_id, recipient_id}
    rows = db.query(CircleMembership).filter(CircleMembership.circle_id == circle_id, CircleMembership.user_id.in_(ids), CircleMembership.status == "active").all()
    if len(rows) != 2:
        raise HTTPException(status_code=404, detail="يجب أن يكون العضوان نشطين في الدائرة")
    return rows


def _approval_out(row):
    return {"id": row.id, "requester_id": row.requester_id, "recipient_id": row.recipient_id,
            "requester": _public_user(row.requester), "recipient": _public_user(row.recipient),
            "status": row.status, "created_at": row.created_at, "updated_at": row.updated_at}


@router.get("/{circle_id}/dm-approvals")
def list_dm_approvals(circle_id: int, db: Session = Depends(get_db), viewer: User = Depends(get_current_user)):
    circle = _get_circle(db, circle_id)
    _require_owner(db, circle, viewer)
    rows = db.query(CircleDMApproval).filter(CircleDMApproval.circle_id == circle_id).order_by(CircleDMApproval.created_at.desc()).all()
    return [_approval_out(row) for row in rows]


@router.post("/{circle_id}/dm-approvals", response_model=Message)
def approve_dm_pair(circle_id: int, data: DmApprovalCreate, db: Session = Depends(get_db), viewer: User = Depends(get_current_user)):
    circle = _get_circle(db, circle_id)
    _require_owner(db, circle, viewer)
    _pair_members(db, circle_id, data.requester_id, data.recipient_id, viewer.id)
    first, second = sorted((data.requester_id, data.recipient_id))
    approval = db.query(CircleDMApproval).filter_by(circle_id=circle_id, requester_id=first, recipient_id=second).first()
    if approval:
        approval.status, approval.approved_by = "active", viewer.id
    else:
        approval = CircleDMApproval(circle_id=circle_id, requester_id=first, recipient_id=second, approved_by=viewer.id)
        db.add(approval)
    db.commit()
    return Message(message="تمت الموافقة على المراسلة")


@router.post("/{circle_id}/dm-approvals/{user_id}", response_model=Message)
def approve_dm(circle_id: int, user_id: int, db: Session = Depends(get_db), viewer: User = Depends(get_current_user)):
    circle = _get_circle(db, circle_id)
    _require_owner(db, circle, viewer)
    target = get_circle_membership(db, circle_id, user_id)
    if not target or target.status != "active" or user_id == viewer.id:
        raise HTTPException(status_code=404, detail="العضو النشط غير موجود")
    first, second = sorted((viewer.id, user_id))
    approval = db.query(CircleDMApproval).filter_by(circle_id=circle_id, requester_id=first, recipient_id=second).first()
    if approval:
        approval.status, approval.approved_by = "active", viewer.id
    else:
        db.add(CircleDMApproval(circle_id=circle_id, requester_id=first, recipient_id=second, approved_by=viewer.id))
    db.commit()
    return Message(message="تمت الموافقة على المراسلة")


@router.delete("/{circle_id}/dm-approvals/{requester_id}/{recipient_id}", response_model=Message)
def revoke_dm_pair(circle_id: int, requester_id: int, recipient_id: int, db: Session = Depends(get_db), viewer: User = Depends(get_current_user)):
    circle = _get_circle(db, circle_id)
    _require_owner(db, circle, viewer)
    first, second = sorted((requester_id, recipient_id))
    approval = db.query(CircleDMApproval).filter_by(circle_id=circle_id, requester_id=first, recipient_id=second).first()
    if not approval:
        raise HTTPException(status_code=404, detail="الموافقة غير موجودة")
    approval.status = "revoked"
    db.commit()
    return Message(message="تم إلغاء الموافقة على المراسلة")


@router.delete("/{circle_id}/dm-approvals/{user_id}", response_model=Message)
def revoke_dm(circle_id: int, user_id: int, db: Session = Depends(get_db), viewer: User = Depends(get_current_user)):
    circle = _get_circle(db, circle_id)
    _require_owner(db, circle, viewer)
    first, second = sorted((viewer.id, user_id))
    approval = db.query(CircleDMApproval).filter_by(circle_id=circle_id, requester_id=first, recipient_id=second).first()
    if not approval:
        raise HTTPException(status_code=404, detail="الموافقة غير موجودة")
    approval.status = "revoked"
    db.commit()
    return Message(message="تم إلغاء الموافقة على المراسلة")


@router.post("/{circle_id}/dm-requests/{recipient_id}")
def request_dm(circle_id: int, recipient_id: int, db: Session = Depends(get_db), viewer: User = Depends(get_current_user)):
    circle = _get_circle(db, circle_id)
    requester = get_circle_membership(db, circle_id, viewer.id)
    _pair_members(db, circle_id, viewer.id, recipient_id)
    if not requester or requester.role == "owner":
        raise HTTPException(status_code=400, detail="طلبات DM مخصصة للأعضاء غير المالك")
    first, second = sorted((viewer.id, recipient_id))
    row = db.query(CircleDMRequest).filter_by(circle_id=circle_id, requester_id=first, recipient_id=second).first()
    if row:
        if row.status == "pending":
            raise HTTPException(status_code=409, detail="الطلب موجود بالفعل")
        row.status = "pending"
    else:
        row = CircleDMRequest(circle_id=circle_id, requester_id=first, recipient_id=second)
        db.add(row)
    db.commit(); db.refresh(row)
    return {"id": row.id, "status": row.status, "requester_id": row.requester_id, "recipient_id": row.recipient_id}


def _request_out(row):
    return {"id": row.id, "circle_id": row.circle_id, "requester_id": row.requester_id, "recipient_id": row.recipient_id,
            "requester": _public_user(row.requester), "recipient": _public_user(row.recipient), "status": row.status,
            "created_at": row.created_at, "updated_at": row.updated_at}


@router.get("/{circle_id}/dm-requests")
def list_dm_requests(circle_id: int, status_filter: str = "pending", db: Session = Depends(get_db), viewer: User = Depends(get_current_user)):
    circle = _get_circle(db, circle_id); _require_owner(db, circle, viewer)
    if status_filter not in {"pending", "approved", "revoked", "all"}:
        raise HTTPException(status_code=400, detail="حالة الطلب غير صالحة")
    q = db.query(CircleDMRequest).filter(CircleDMRequest.circle_id == circle_id)
    if status_filter != "all": q = q.filter(CircleDMRequest.status == status_filter)
    return [_request_out(row) for row in q.order_by(CircleDMRequest.created_at.desc()).all()]


@router.post("/{circle_id}/dm-requests/{request_id}/approve", response_model=Message)
def approve_dm_request(circle_id: int, request_id: int, db: Session = Depends(get_db), viewer: User = Depends(get_current_user)):
    circle = _get_circle(db, circle_id); _require_owner(db, circle, viewer)
    row = db.query(CircleDMRequest).filter_by(id=request_id, circle_id=circle_id, status="pending").first()
    if not row: raise HTTPException(status_code=404, detail="طلب المراسلة غير موجود")
    _pair_members(db, circle_id, row.requester_id, row.recipient_id, viewer.id)
    first, second = sorted((row.requester_id, row.recipient_id))
    approval = db.query(CircleDMApproval).filter_by(circle_id=circle_id, requester_id=first, recipient_id=second).first()
    if approval: approval.status, approval.approved_by = "active", viewer.id
    else: db.add(CircleDMApproval(circle_id=circle_id, requester_id=first, recipient_id=second, approved_by=viewer.id))
    row.status = "approved"; db.commit()
    return Message(message="تم قبول طلب المراسلة")


@router.delete("/{circle_id}/dm-requests/{request_id}", response_model=Message)
def revoke_dm_request(circle_id: int, request_id: int, db: Session = Depends(get_db), viewer: User = Depends(get_current_user)):
    circle = _get_circle(db, circle_id); _require_owner(db, circle, viewer)
    row = db.query(CircleDMRequest).filter_by(id=request_id, circle_id=circle_id).first()
    if not row: raise HTTPException(status_code=404, detail="طلب المراسلة غير موجود")
    row.status = "revoked"; db.commit()
    return Message(message="تم إلغاء طلب المراسلة")
