"""
مسارات المزاج (Mood) — حالة مزاجية مؤقتة (24 ساعة) تشبه القصص،
وتُستخدم أيضًا للتأثير على ترتيب/تصفية المحتوى بالخلاصة مستقبلاً.
"""
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from database.db import get_db
from middleware.auth_dependency import get_current_user
from models.models import User, Mood, MoodStatus, Follower
from schemas.schemas import MoodOut, MoodStatusCreate, MoodStatusOut

router = APIRouter(prefix="/api/moods", tags=["Moods"])

MOOD_DURATION_HOURS = 24


@router.get("", response_model=list[MoodOut])
def list_moods(db: Session = Depends(get_db)):
    """قائمة كل الحالات المزاجية المتاحة للاختيار."""
    return db.query(Mood).all()


@router.get("/me", response_model=MoodStatusOut | None)
def get_my_mood(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """مزاجي الحالي إن كان لا يزال ساريًا (لم تنتهِ الـ 24 ساعة)."""
    status_row = (
        db.query(MoodStatus)
        .filter(
            MoodStatus.user_id == current_user.id,
            MoodStatus.expires_at > datetime.utcnow(),
        )
        .order_by(MoodStatus.created_at.desc())
        .first()
    )
    return status_row


@router.post("", response_model=MoodStatusOut, status_code=status.HTTP_201_CREATED)
def set_my_mood(
    payload: MoodStatusCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """تحديد مزاجي الحالي (يستبدل أي مزاج سابق لم تنتهِ صلاحيته بعد)."""
    mood = db.query(Mood).filter(Mood.key == payload.mood_key).first()
    if not mood:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="المزاج غير موجود")

    new_status = MoodStatus(
        user_id=current_user.id,
        mood_id=mood.id,
        note=payload.note,
        expires_at=datetime.utcnow() + timedelta(hours=MOOD_DURATION_HOURS),
    )
    db.add(new_status)
    db.commit()
    db.refresh(new_status)
    return new_status


@router.delete("/me", status_code=status.HTTP_204_NO_CONTENT)
def clear_my_mood(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """إخفاء مزاجي الحالي فورًا (بدون انتظار انتهاء الـ 24 ساعة)."""
    db.query(MoodStatus).filter(
        MoodStatus.user_id == current_user.id,
        MoodStatus.expires_at > datetime.utcnow(),
    ).update({"expires_at": datetime.utcnow()})
    db.commit()
    return None


@router.get("/feed", response_model=list[MoodStatusOut])
def mood_feed(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """حالات المزاج النشطة لكل من يتابعهم المستخدم الحالي (زي شريط القصص)."""
    following_ids = [
        f.following_id
        for f in db.query(Follower).filter(Follower.follower_id == current_user.id).all()
    ]
    following_ids.append(current_user.id)

    statuses = (
        db.query(MoodStatus)
        .filter(
            MoodStatus.user_id.in_(following_ids),
            MoodStatus.expires_at > datetime.utcnow(),
        )
        .order_by(MoodStatus.created_at.desc())
        .all()
    )
    return statuses
