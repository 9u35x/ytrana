"""
مسارات البلاغات: يمكن للمستخدم الإبلاغ عن مستخدم/منشور/تعليق.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database.db import get_db
from middleware.auth_dependency import get_current_user
from models.models import Report, ReportTargetType, User, Post, Comment
from schemas.schemas import ReportCreate, ReportOut, Message

router = APIRouter(prefix="/api/reports", tags=["Reports"])


@router.post("", response_model=Message, status_code=201)
def create_report(
    data: ReportCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if data.target_type == "user":
        exists = db.query(User).filter(User.id == data.target_id).first()
    elif data.target_type == "post":
        exists = db.query(Post).filter(Post.id == data.target_id).first()
    else:
        exists = db.query(Comment).filter(Comment.id == data.target_id).first()

    if not exists:
        raise HTTPException(status_code=404, detail="العنصر المُبلَّغ عنه غير موجود")

    report = Report(
        reporter_id=current_user.id,
        target_type=ReportTargetType(data.target_type),
        target_id=data.target_id,
        reason=data.reason,
    )
    db.add(report)
    db.commit()
    return Message(message="تم إرسال البلاغ، سيتم مراجعته من قبل الإدارة")
