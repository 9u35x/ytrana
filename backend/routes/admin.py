"""إدارة الحسابات والبلاغات، محمية بعلامة الإدارة وقائمة معرفين ثابتين معًا."""
import json
from datetime import timedelta
from pathlib import Path, PurePosixPath
from urllib.parse import urlsplit
import mimetypes
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from sqlalchemy import or_
from sqlalchemy.orm import Session, joinedload
from config import settings
from database.db import get_db
from middleware.auth_dependency import get_current_admin
from models.models import User, Post, Comment, Report, ReportStatus, ReportTargetType, ModerationAudit, utcnow_naive
from schemas.schemas import AdminUser, ReportOut, Message, ModerationNote, FreezeRequest, VerificationRequest, ResolveReport
from services.moderation import (
    REPORT_CATEGORIES, TARGET_MODELS, target_row, target_owner, target_summary, require_mutable_user, report_target_row,
)
from utils.files import delete_image, delete_video

router = APIRouter(prefix="/api/admin", tags=["Admin"])


def _media_urls(target):
    return getattr(target, "image_url", None), getattr(target, "video_url", None)


def _cleanup_media(urls):
    image_url, video_url = urls
    if image_url:
        delete_image(image_url)
    if video_url:
        delete_video(video_url)


def _audit(db, admin, action, target_type, target_id, note="", report_id=None, details=None):
    db.add(ModerationAudit(
        actor_id=admin.id, action=action, target_type=target_type, target_id=target_id,
        note=note.strip(), report_id=report_id,
        details=json.dumps(details, ensure_ascii=False) if details is not None else None,
    ))


def _user(db, user_id):
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="المستخدم غير موجود")
    return user


def _reason(note):
    note = note.strip()
    if not note:
        raise HTTPException(status_code=422, detail="أدخل ملاحظة توضح سبب الإجراء")
    return note


def _freeze(user, days):
    require_mutable_user(user)
    user.frozen_at = utcnow_naive()
    user.frozen_until = user.frozen_at + timedelta(days=days) if days is not None else None


@router.get("/access")
def admin_access(_admin: User = Depends(get_current_admin)):
    return {"allowed": True}


@router.get("/users", response_model=list[AdminUser])
def list_all_users(
    skip: int = Query(0, ge=0, le=1_000_000), limit: int = Query(50, ge=1, le=100),
    search: str = Query("", max_length=100), db: Session = Depends(get_db),
    _admin: User = Depends(get_current_admin),
):
    query = db.query(User)
    term = search.strip().lstrip("@")
    if term:
        query = query.filter(or_(User.username.contains(term, autoescape=True), User.full_name.contains(term, autoescape=True)))
    return query.order_by(User.created_at.desc(), User.id.desc()).offset(skip).limit(limit).all()


@router.put("/users/{user_id}/ban", response_model=Message)
def ban_user(user_id: int, data: ModerationNote | None = None, db: Session = Depends(get_db), admin: User = Depends(get_current_admin)):
    user = _user(db, user_id)
    require_mutable_user(user)
    user.is_banned = True
    _audit(db, admin, "ban_user", "user", user.id, data.note if data else "إجراء من مسار الحظر المتوافق")
    db.commit()
    return Message(message=f"تم حظر المستخدم {user.username}")


@router.put("/users/{user_id}/unban", response_model=Message)
def unban_user(user_id: int, data: ModerationNote | None = None, db: Session = Depends(get_db), admin: User = Depends(get_current_admin)):
    user = _user(db, user_id)
    user.is_banned = False
    _audit(db, admin, "unban_user", "user", user.id, data.note if data else "")
    db.commit()
    return Message(message=f"تم إلغاء حظر المستخدم {user.username}")


@router.put("/users/{user_id}/freeze", response_model=Message)
def freeze_user(user_id: int, data: FreezeRequest, db: Session = Depends(get_db), admin: User = Depends(get_current_admin)):
    user = _user(db, user_id)
    note = _reason(data.note)
    _freeze(user, data.days)
    _audit(db, admin, "freeze_user", "user", user.id, note, details={"days": data.days})
    db.commit()
    return Message(message="تم تجميد الحساب؛ ينتهي التجميد المحدد تلقائيًا حسب الوقت")


@router.put("/users/{user_id}/unfreeze", response_model=Message)
def unfreeze_user(user_id: int, data: ModerationNote | None = None, db: Session = Depends(get_db), admin: User = Depends(get_current_admin)):
    user = _user(db, user_id)
    user.frozen_at = None
    user.frozen_until = None
    _audit(db, admin, "unfreeze_user", "user", user.id, data.note if data else "")
    db.commit()
    return Message(message="تم فك التجميد؛ لا يزيل هذا الإجراء أي حظر مستقل")


@router.put("/users/{user_id}/verification", response_model=Message)
def verify_user(user_id: int, data: VerificationRequest, db: Session = Depends(get_db), admin: User = Depends(get_current_admin)):
    user = _user(db, user_id)
    note = _reason(data.note)
    if data.mode == "temporary" and data.days is None:
        raise HTTPException(status_code=422, detail="حدد عدد أيام التوثيق المؤقت")
    if data.mode != "temporary" and data.days is not None:
        raise HTTPException(status_code=422, detail="المدة مخصصة للتوثيق المؤقت فقط")
    before = {"is_verified": user.is_verified, "expires_at": str(user.verification_expires_at) if user.verification_expires_at else None}
    user.verified_at = None if data.mode == "revoke" else utcnow_naive()
    user.verification_expires_at = user.verified_at + timedelta(days=data.days) if data.mode == "temporary" else None
    _audit(db, admin, "verification_" + data.mode, "user", user.id, note, details={"before": before, "days": data.days})
    db.commit()
    return Message(message="تم تحديث توثيق الحساب")


def _legacy_delete(db, admin, target_type, target_id):
    target = target_row(db, target_type, target_id)
    if target is None:
        raise HTTPException(status_code=404, detail="المحتوى غير موجود")
    _audit(db, admin, "delete_content", target_type, target_id, details={"summary": target_summary(target_type, target)})
    media_urls = _media_urls(target)
    db.delete(target)
    db.commit()
    _cleanup_media(media_urls)
    return Message(message="تم حذف المحتوى المخالف")


@router.delete("/posts/{post_id}", response_model=Message)
def admin_delete_post(post_id: int, db: Session = Depends(get_db), admin: User = Depends(get_current_admin)):
    return _legacy_delete(db, admin, "post", post_id)


@router.delete("/comments/{comment_id}", response_model=Message)
def admin_delete_comment(comment_id: int, db: Session = Depends(get_db), admin: User = Depends(get_current_admin)):
    return _legacy_delete(db, admin, "comment", comment_id)


@router.get("/reports", response_model=list[ReportOut])
def list_reports(
    status_filter: str | None = None, target_type: str | None = None, category: str | None = None,
    skip: int = Query(0, ge=0, le=1_000_000), limit: int = Query(50, ge=1, le=100),
    db: Session = Depends(get_db), _admin: User = Depends(get_current_admin),
):
    query = db.query(Report).options(joinedload(Report.reporter))
    if status_filter:
        try:
            status_value = ReportStatus(status_filter)
        except ValueError:
            raise HTTPException(status_code=400, detail="حالة البلاغ غير صالحة") from None
        query = query.filter(Report.status == status_value)
    if target_type:
        if target_type not in TARGET_MODELS:
            raise HTTPException(status_code=400, detail="نوع البلاغ غير صالح")
        query = query.filter(Report.target_type == ReportTargetType(target_type))
    if category:
        if category not in REPORT_CATEGORIES:
            raise HTTPException(status_code=400, detail="فئة البلاغ غير صالحة")
        query = query.filter(Report.category == category)
    return query.order_by(Report.created_at.desc(), Report.id.desc()).offset(skip).limit(limit).all()


def _report(db, report_id):
    report = db.get(Report, report_id)
    if report is None:
        raise HTTPException(status_code=404, detail="البلاغ غير موجود")
    return report


@router.get("/reports/{report_id}/target")
def report_target(report_id: int, db: Session = Depends(get_db), _admin: User = Depends(get_current_admin)):
    report = _report(db, report_id)
    row = report_target_row(db, report)
    media = []
    if row is not None:
        for kind in ("image", "video"):
            url = getattr(row, kind + "_url", None)
            if report.target_type == ReportTargetType.user and kind == "image":
                url = row.avatar_url
            if url:
                media.append({"kind": kind, "url": f"/api/admin/reports/{report.id}/media/{kind}"})
    return {
        "target_type": report.target_type.value, "target_id": report.target_id,
        "exists": row is not None, "owner_id": target_owner(report.target_type, row),
        "summary": target_summary(report.target_type, row) if row is not None else report.target_snapshot or "المحتوى غير متاح أو حُذف",
        "snapshot": row is None and bool(report.target_snapshot),
        "media": media,
    }


@router.get("/reports/{report_id}/media/{kind}")
def report_media(report_id: int, kind: str, db: Session = Depends(get_db), _admin: User = Depends(get_current_admin)):
    report = _report(db, report_id)
    row = report_target_row(db, report)
    if row is None or kind not in {"image", "video"}:
        raise HTTPException(status_code=404, detail="الوسيط غير موجود")
    url = getattr(row, kind + "_url", None)
    if report.target_type == ReportTargetType.user and kind == "image":
        url = row.avatar_url
    parts = PurePosixPath(urlsplit(url or "").path).parts
    if len(parts) != 4 or parts[:2] != ("/", "uploads") or parts[2] not in {"avatars", "posts", "stories", "reels"}:
        raise HTTPException(status_code=404, detail="الوسيط غير موجود")
    root = Path(settings.upload_dir).resolve()
    folder = (root / parts[2]).resolve()
    path = (folder / parts[3]).resolve()
    if not folder.is_relative_to(root) or path.parent != folder or not path.is_relative_to(root) or not path.is_file():
        raise HTTPException(status_code=404, detail="الوسيط غير موجود")
    return FileResponse(path, media_type=mimetypes.guess_type(str(path))[0] or "application/octet-stream", headers={"Cache-Control": "private, no-store"})


def _resolve(db, admin, report_id, data):
    report = _report(db, report_id)
    if report.status != ReportStatus.pending:
        raise HTTPException(status_code=409, detail="هذا البلاغ عولج سابقًا؛ حدّث القائمة")
    note = data.note.strip()
    if data.action not in {"review", "dismiss"}:
        note = _reason(note)
    # حجز قرار نهائي بشرط pending في نفس المعاملة، لمنع عقوبتين عند مراجعة متزامنة.
    new_status = ReportStatus.dismissed if data.action == "dismiss" else ReportStatus.reviewed
    changed = db.query(Report).filter(Report.id == report_id, Report.status == ReportStatus.pending).update({
        Report.status: new_status, Report.reviewer_id: admin.id, Report.review_note: note,
        Report.resolution: data.action, Report.reviewed_at: utcnow_naive(),
    }, synchronize_session=False)
    if changed != 1:
        db.rollback()
        raise HTTPException(status_code=409, detail="سبق أن عالج إداري آخر هذا البلاغ")
    target = report_target_row(db, report)
    if data.action in {"delete_content", "ban_user", "freeze_user"} and target is None:
        db.rollback()
        raise HTTPException(status_code=404, detail="المحتوى الأصلي لم يعد موجودًا؛ يمكن مراجعة أو رفض البلاغ فقط")
    owner_id = target_owner(report.target_type, target)
    media_urls = _media_urls(target) if data.action == "delete_content" else (None, None)
    try:
        if data.action == "delete_content":
            if report.target_type == ReportTargetType.user:
                raise HTTPException(status_code=400, detail="بلاغ الحساب يعالج بالحظر أو التجميد وليس حذف الحساب")
            db.delete(target)
        elif data.action in {"ban_user", "freeze_user"}:
            user = _user(db, owner_id)
            require_mutable_user(user)
            if data.action == "ban_user":
                user.is_banned = True
            else:
                _freeze(user, data.days)
        _audit(db, admin, data.action, report.target_type.value, report.target_id, note, report_id,
               {"owner_id": owner_id, "days": data.days, "summary": target_summary(report.target_type, target)})
        db.commit()
    except Exception:
        db.rollback()
        raise
    _cleanup_media(media_urls)
    return Message(message="تم حفظ قرار المراجعة والإجراء في سجل الإدارة")


@router.put("/reports/{report_id}/resolve", response_model=Message)
def resolve_report(report_id: int, data: ResolveReport, db: Session = Depends(get_db), admin: User = Depends(get_current_admin)):
    return _resolve(db, admin, report_id, data)


@router.put("/reports/{report_id}/review", response_model=Message)
def review_report(report_id: int, db: Session = Depends(get_db), admin: User = Depends(get_current_admin)):
    return _resolve(db, admin, report_id, ResolveReport(action="review"))


@router.put("/reports/{report_id}/dismiss", response_model=Message)
def dismiss_report(report_id: int, db: Session = Depends(get_db), admin: User = Depends(get_current_admin)):
    return _resolve(db, admin, report_id, ResolveReport(action="dismiss"))


@router.get("/audit")
def list_audit(
    skip: int = Query(0, ge=0, le=1_000_000), limit: int = Query(50, ge=1, le=100),
    db: Session = Depends(get_db), _admin: User = Depends(get_current_admin),
):
    rows = db.query(ModerationAudit).order_by(ModerationAudit.created_at.desc(), ModerationAudit.id.desc()).offset(skip).limit(limit).all()
    return [{"id": row.id, "actor_id": row.actor_id, "action": row.action, "target_type": row.target_type,
             "target_id": row.target_id, "report_id": row.report_id, "note": row.note,
             "details": json.loads(row.details) if row.details else None, "created_at": row.created_at} for row in rows]
