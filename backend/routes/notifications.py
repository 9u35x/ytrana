"""
مسارات الإشعارات: عرض إشعارات المستخدم، تمييزها كمقروءة.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func

from database.db import get_db
from middleware.auth_dependency import get_current_user
from models.models import Notification, User
from schemas.schemas import NotificationOut, Message

router = APIRouter(prefix="/api/notifications", tags=["Notifications"])


@router.get("", response_model=list[NotificationOut])
def list_notifications(
    skip: int = 0,
    limit: int = 30,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    limit = min(limit, 100)
    notifications = (
        db.query(Notification)
        .options(joinedload(Notification.actor))
        .filter(Notification.recipient_id == current_user.id)
        .order_by(Notification.created_at.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )
    return notifications


@router.get("/unread-count")
def unread_count(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    count = db.query(func.count(Notification.id)).filter(
        Notification.recipient_id == current_user.id, Notification.is_read == False  # noqa: E712
    ).scalar() or 0
    return {"unread_count": count}


@router.put("/{notification_id}/read", response_model=Message)
def mark_as_read(
    notification_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    notif = db.query(Notification).filter(
        Notification.id == notification_id, Notification.recipient_id == current_user.id
    ).first()
    if not notif:
        raise HTTPException(status_code=404, detail="الإشعار غير موجود")
    notif.is_read = True
    db.commit()
    return Message(message="تم تحديد الإشعار كمقروء")


@router.put("/read-all", response_model=Message)
def mark_all_as_read(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    db.query(Notification).filter(
        Notification.recipient_id == current_user.id, Notification.is_read == False  # noqa: E712
    ).update({"is_read": True})
    db.commit()
    return Message(message="تم تحديد جميع الإشعارات كمقروءة")
