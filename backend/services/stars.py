"""حساب نجوم المستخدمين من بيانات اجتماعية حقيقية فقط.

لا توجد هنا نقاط دفع أو ادعاء بمكافحة الروبوتات؛ النجمة وصف إنجاز مبني
على المتابعين المقبولين وأيام النشر الفعلية.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import and_, func, or_, select, union
from sqlalchemy.orm import Session

from models.models import Follower, Post, Reel, User

FOLLOWER_THRESHOLDS = (0, 100_000, 500_000, 1_000_000, 2_500_000, 5_000_000, 10_000_000, 20_000_000, 35_000_000, 50_000_000)
ACTIVE_DAY_THRESHOLDS = (0, 1, 3, 7, 14, 30, 60, 90, 180, 365)
LEVELS = (
    ("نجمة البداية", "#FFD700", "★", 5),
    ("النجمة الصفراء", "#FFD700", "★", 10),
    ("النجمة الفضية", "#C0C0C0", "★", 15),
    ("النجمة الذهبية", "#D4AF37", "★", 20),
    ("نجمة الياقوت", "#E0115F", "★", 25),
    ("نجمة الزمرد", "#50C878", "★", 30),
    ("النجمة الماسية الزرقاء", "#00BCD4", "★", 35),
    ("النجمة الأرجوانية", "#9B59B6", "★", 40),
    ("النجمة الكريستالية", "#E15AA9", "★", 45),
    ("نجمة الكريستال السوداء (Black Crystal Star)", "#D8B4FE", "◆", 50),
)


def _active_days(db: Session, user_id: int) -> int:
    """عدد أيام UTC المميزة التي نشر فيها صاحب الحساب Post أو Reel غير مؤرشف."""
    # Keep the union/grouping in the database: this avoids loading every timestamp
    # and makes a Post + Reel on one UTC day count once.  Content in circles or
    # business pages is deliberately not evidence of independent public activity.
    now = datetime.utcnow()
    post_days = select(func.date(Post.created_at).label("activity_day")).where(
        Post.author_id == user_id,
        Post.is_archived.is_(False),
        Post.created_at <= now,
        Post.circle_id.is_(None),
        Post.business_id.is_(None),
    )
    reel_days = select(func.date(Reel.created_at).label("activity_day")).where(
        Reel.author_id == user_id,
        Reel.created_at <= now,
    )
    days = union(post_days, reel_days).subquery("activity_days")
    return int(db.query(func.count()).select_from(days).scalar() or 0)


def _followers_count(db: Session, user_id: int) -> int:
    """Accepted Follower rows only; self, inactive and banned accounts are excluded."""
    return int(db.query(func.count(Follower.id)).join(
        User, User.id == Follower.follower_id
    ).filter(
        Follower.following_id == user_id,
        Follower.follower_id != user_id,
        User.is_active.is_(True),
        User.is_banned.is_(False),
        or_(User.frozen_at.is_(None), and_(User.frozen_until.is_not(None), User.frozen_until <= datetime.utcnow())),
    ).scalar() or 0)


def _level_for(followers_count: int, active_days: int) -> int:
    level = 1
    for index, (followers_required, days_required) in enumerate(zip(FOLLOWER_THRESHOLDS, ACTIVE_DAY_THRESHOLDS), start=1):
        if followers_count >= followers_required and active_days >= days_required:
            level = index
    return level


def _progress(followers_count: int, active_days: int, level: int) -> float:
    if level >= len(LEVELS):
        return 100.0
    next_index = level  # zero-based index of the next level
    follower_target = FOLLOWER_THRESHOLDS[next_index]
    days_target = ACTIVE_DAY_THRESHOLDS[next_index]
    follower_ratio = followers_count / follower_target if follower_target else 1.0
    days_ratio = active_days / days_target if days_target else 1.0
    return round(min(100.0, max(0.0, min(follower_ratio, days_ratio) * 100.0)), 2)


def build_stars(db: Session, user: User) -> dict:
    followers_count = _followers_count(db, user.id)
    active_days = _active_days(db, user.id)
    level = _level_for(followers_count, active_days)
    next_level = level + 1 if level < len(LEVELS) else None
    levels = []
    for index, ((name, color, icon, bonus), followers_required, days_required) in enumerate(
        zip(LEVELS, FOLLOWER_THRESHOLDS, ACTIVE_DAY_THRESHOLDS), start=1
    ):
        levels.append({
            "level": index,
            "name": name,
            "required_followers": followers_required,
            "required_active_days": days_required,
            "color": color,
            "icon": icon,
            "earned": index <= level,
            "proposed_priority_bonus_percent": bonus,
        })
    return {
        "level": level,
        "name": LEVELS[level - 1][0],
        "followers_count": followers_count,
        "active_days": active_days,
        "progress_percent": _progress(followers_count, active_days, level),
        "next_level": next_level,
        "reward": {
            "applied": False,
            "proposed_priority_bonus_percent": LEVELS[level - 1][3],
            "description": "المكافأة المقترحة غير مفعّلة؛ الخلاصة مرتبة زمنيًا ولا توجد زيادة مضمونة أو تغيير في ترتيبها.",
        },
        "levels": levels,
    }
