"""
مسارات لوحة الإدارة: عرض المستخدمين، حظر/إلغاء حظر، حذف منشورات/تعليقات مخالفة،
عرض ومعالجة البلاغات. كل هذه المسارات محمية بصلاحية is_admin فقط.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from database.db import get_db
from middleware.auth_dependency import get_current_admin
from models.models import User, Post, Comment, Report, ReportStatus
from schemas.schemas import UserPublic, ReportOut, Message
from utils.files import delete_image

router = APIRouter(prefix="/api/admin", tags=["Admin"])


@router.get("/users", response_model=list[UserPublic])
def list_all_users(
    skip: int = 0,
    limit: int = 50,
    db: Session = Depends(get_db),
    _admin: User = Depends(get_current_admin),
):
    limit = min(limit, 100)
    return db.query(User).order_by(User.created_at.desc()).offset(skip).limit(limit).all()


@router.put("/users/{user_id}/ban", response_model=Message)
def ban_user(user_id: int, db: Session = Depends(get_db), admin: User = Depends(get_current_admin)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="المستخدم غير موجود")
    if user.is_admin:
        raise HTTPException(status_code=400, detail="لا يمكن حظر مستخدم إداري")
    user.is_banned = True
    db.commit()
    return Message(message=f"تم حظر المستخدم {user.username}")


@router.put("/users/{user_id}/unban", response_model=Message)
def unban_user(user_id: int, db: Session = Depends(get_db), _admin: User = Depends(get_current_admin)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="المستخدم غير موجود")
    user.is_banned = False
    db.commit()
    return Message(message=f"تم إلغاء حظر المستخدم {user.username}")


@router.delete("/posts/{post_id}", response_model=Message)
def admin_delete_post(post_id: int, db: Session = Depends(get_db), _admin: User = Depends(get_current_admin)):
    post = db.query(Post).filter(Post.id == post_id).first()
    if not post:
        raise HTTPException(status_code=404, detail="المنشور غير موجود")
    image_to_delete = post.image_url
    db.delete(post)
    db.commit()
    if image_to_delete:
        delete_image(image_to_delete)
    return Message(message="تم حذف المنشور المخالف")


@router.delete("/comments/{comment_id}", response_model=Message)
def admin_delete_comment(comment_id: int, db: Session = Depends(get_db), _admin: User = Depends(get_current_admin)):
    comment = db.query(Comment).filter(Comment.id == comment_id).first()
    if not comment:
        raise HTTPException(status_code=404, detail="التعليق غير موجود")
    db.delete(comment)
    db.commit()
    return Message(message="تم حذف التعليق المخالف")


@router.get("/reports", response_model=list[ReportOut])
def list_reports(
    status_filter: str | None = None,
    skip: int = 0,
    limit: int = 50,
    db: Session = Depends(get_db),
    _admin: User = Depends(get_current_admin),
):
    limit = min(limit, 100)
    query = db.query(Report).options(joinedload(Report.reporter))
    if status_filter:
        query = query.filter(Report.status == ReportStatus(status_filter))
    reports = query.order_by(Report.created_at.desc()).offset(skip).limit(limit).all()
    return reports


@router.put("/reports/{report_id}/review", response_model=Message)
def review_report(report_id: int, db: Session = Depends(get_db), _admin: User = Depends(get_current_admin)):
    report = db.query(Report).filter(Report.id == report_id).first()
    if not report:
        raise HTTPException(status_code=404, detail="البلاغ غير موجود")
    report.status = ReportStatus.reviewed
    db.commit()
    return Message(message="تم تحديث حالة البلاغ إلى: تمت المراجعة")


@router.put("/reports/{report_id}/dismiss", response_model=Message)
def dismiss_report(report_id: int, db: Session = Depends(get_db), _admin: User = Depends(get_current_admin)):
    report = db.query(Report).filter(Report.id == report_id).first()
    if not report:
        raise HTTPException(status_code=404, detail="البلاغ غير موجود")
    report.status = ReportStatus.dismissed
    db.commit()
    return Message(message="تم رفض البلاغ")
