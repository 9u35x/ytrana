"""بلاغات مصنفة، مع إبقاء صيغة العملاء القديمة مقبولة."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from database.db import get_db
from middleware.auth_dependency import get_current_user
from models.models import Report, ReportTargetType, ReportStatus, User
from schemas.schemas import ReportCreate, Message
from services.moderation import REPORT_CATEGORIES, TARGET_MODELS, target_row, target_summary, target_fingerprint, require_reportable

router = APIRouter(prefix="/api/reports", tags=["Reports"])


@router.get("/options")
def report_options():
    return {"target_types": list(TARGET_MODELS), "categories": REPORT_CATEGORIES}


@router.post("", response_model=Message, status_code=201)
def create_report(data: ReportCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    target = target_row(db, data.target_type, data.target_id)
    require_reportable(db, data.target_type, target, current_user)
    duplicate = db.query(Report.id).filter(
        Report.reporter_id == current_user.id, Report.target_type == ReportTargetType(data.target_type),
        Report.target_id == data.target_id, Report.status == ReportStatus.pending,
    ).first()
    if duplicate:
        raise HTTPException(status_code=409, detail="لديك بلاغ قيد المراجعة عن هذا العنصر بالفعل")
    db.add(Report(
        reporter_id=current_user.id, target_type=ReportTargetType(data.target_type),
        target_id=data.target_id, reason=data.reason, category=data.category,
        target_snapshot=target_summary(data.target_type, target),
        target_fingerprint=target_fingerprint(data.target_type, target),
    ))
    db.commit()
    return Message(message="تم إرسال البلاغ، سيتم مراجعته من قبل الإدارة")
