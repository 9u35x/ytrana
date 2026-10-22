"""سياسة إدارة مغلقة افتراضيًا؛ الأسماء الظاهرة ليست مصدر صلاحية."""
import json
from pathlib import Path
from fastapi import HTTPException
from config import settings
from models.models import User, Post, Comment, Reel, Story, Message, Conversation, ReportTargetType, utcnow_naive

ADMIN_IDS_FILE = Path(__file__).resolve().parents[1] / ".moderation-admins.json"
REPORT_CATEGORIES = {
    "spam": "محتوى مزعج أو متكرر", "harassment": "تنمر أو مضايقة",
    "hate": "خطاب كراهية", "violence": "عنف أو تهديد", "sexual": "محتوى جنسي",
    "impersonation": "انتحال شخصية", "scam": "احتيال", "privacy": "انتهاك الخصوصية",
    "copyright": "حقوق ملكية", "other": "سبب آخر",
}
TARGET_MODELS = {"user": User, "post": Post, "comment": Comment, "reel": Reel, "story": Story, "message": Message}


def admin_ids() -> frozenset[int]:
    """لا يُفعّل أي إداري إلا بتهيئة معرفين مختلفين موجبين، مع is_admin."""
    if not settings.admin_user_ids.strip():
        # ملف خاص بالتثبيت، خارج frontend؛ يحافظ على .env الحالي دون تعديل.
        # لا يُستخدم عند وجود قيمة بيئة غير فارغة وغير صالحة؛ تلك تبقى مغلقة.
        try:
            if ADMIN_IDS_FILE.is_symlink() or ADMIN_IDS_FILE.stat().st_size > 256:
                return frozenset()
            values = json.loads(ADMIN_IDS_FILE.read_text(encoding="utf-8"))
            if not isinstance(values, list) or len(values) != 2 or any(type(value) is not int or value <= 0 for value in values):
                return frozenset()
            ids = frozenset(values)
            return ids if len(ids) == 2 else frozenset()
        except (OSError, ValueError, TypeError):
            return frozenset()
    parts = [value.strip() for value in settings.admin_user_ids.split(",")]
    if len(parts) != 2 or any(not part.isascii() or not part.isdecimal() for part in parts):
        return frozenset()
    try:
        ids = frozenset(int(value) for value in parts)
    except (ValueError, OverflowError):
        return frozenset()
    return ids if len(ids) == 2 and all(value > 0 for value in ids) else frozenset()


def is_platform_admin(user: User | None) -> bool:
    return bool(user and user.is_admin and user.id in admin_ids() and user.is_active and not user.is_banned and not user.is_frozen)


def require_mutable_user(user: User) -> None:
    if user.id in admin_ids():
        raise HTTPException(status_code=400, detail="لا يمكن معاقبة أحد حسابي الإدارة المعتمدين")


def target_row(db, target_type, target_id):
    key = target_type.value if isinstance(target_type, ReportTargetType) else target_type
    model = TARGET_MODELS.get(key)
    return db.get(model, target_id) if model else None


def target_owner(target_type, row):
    key = target_type.value if isinstance(target_type, ReportTargetType) else target_type
    if row is None:
        return None
    return row.id if key == "user" else row.sender_id if key == "message" else row.author_id


def target_fingerprint(target_type, row):
    if row is None:
        return None
    return f"{target_owner(target_type, row)}|{row.created_at.replace(tzinfo=None).isoformat()}"


def report_target_row(db, report):
    row = target_row(db, report.target_type, report.target_id)
    if row is not None and report.target_fingerprint and target_fingerprint(report.target_type, row) != report.target_fingerprint:
        return None
    return row


def target_summary(target_type, row):
    key = target_type.value if isinstance(target_type, ReportTargetType) else target_type
    if row is None:
        return "المحتوى غير متاح أو حُذف"
    if key == "user":
        return f"@{row.username} — {row.full_name}\n{row.bio or ''}"[:2000]
    return (getattr(row, "content", None) or getattr(row, "caption", None) or "محتوى وسائط بلا وصف")[:2000]


def require_reportable(db, target_type, row, viewer):
    """منع تخمين IDs لرسائل الغير أو لمحتوى الدوائر الخاصة."""
    from services.content_access import can_view_post
    if row is None:
        raise HTTPException(status_code=404, detail="العنصر المُبلَّغ عنه غير موجود")
    if target_type == "post" and not can_view_post(db, row, viewer):
        raise HTTPException(status_code=404, detail="العنصر المُبلَّغ عنه غير موجود")
    if target_type == "comment":
        post = db.get(Post, row.post_id)
        if not post or not can_view_post(db, post, viewer):
            raise HTTPException(status_code=404, detail="العنصر المُبلَّغ عنه غير موجود")
    if target_type == "message":
        conversation = db.get(Conversation, row.conversation_id)
        if not conversation or viewer.id not in (conversation.user1_id, conversation.user2_id):
            raise HTTPException(status_code=404, detail="العنصر المُبلَّغ عنه غير موجود")
    if target_type == "story" and row.expires_at.replace(tzinfo=None) <= utcnow_naive():
        raise HTTPException(status_code=404, detail="القصة منتهية الصلاحية")
