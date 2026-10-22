"""واجهة نجوم الحساب، مع احترام صلاحيات الملف والمحتوى."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database.db import get_db
from middleware.auth_dependency import get_current_user_optional
from models.models import User
from services.account_privacy import can_view_profile_details
from services.stars import build_stars

router = APIRouter(prefix="/api/users", tags=["Stars"])


@router.get("/{username}/stars")
def get_user_stars(
    username: str,
    db: Session = Depends(get_db),
    viewer: User | None = Depends(get_current_user_optional),
):
    user = db.query(User).filter(User.username == username.lower()).first()
    # Do not reveal whether a disabled account has stars.
    if not user or not user.is_active or user.is_banned or user.is_frozen:
        raise HTTPException(status_code=404, detail="المستخدم غير موجود")
    # Activity and follower totals are profile details, so the same privacy gate
    # applies rather than leaking a separate side channel.
    if not can_view_profile_details(db, user, viewer):
        raise HTTPException(status_code=404, detail="المستخدم غير موجود")
    return build_stars(db, user)
