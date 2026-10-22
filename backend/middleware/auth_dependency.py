"""
Dependencies للتحقق من هوية المستخدم وصلاحياته على مستوى الـ Routes.
"""
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from database.db import get_db
from models.models import User
from utils.security import decode_access_token
from services.moderation import is_platform_admin

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)


def get_current_user(
    token: str | None = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="بيانات الدخول غير صالحة أو منتهية الصلاحية",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if not token:
        raise credentials_exception

    payload = decode_access_token(token)
    if payload is None:
        raise credentials_exception

    try:
        user_id = int(payload.get("sub"))
    except (TypeError, ValueError):
        raise credentials_exception
    if user_id < 1:
        raise credentials_exception

    user = db.query(User).filter(User.id == int(user_id)).first()
    if user is None:
        raise credentials_exception

    if user.is_banned:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="تم حظر هذا الحساب من قبل الإدارة",
        )
    if user.is_frozen:
        raise HTTPException(status_code=403, detail="هذا الحساب مجمّد مؤقتًا من قبل الإدارة")
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="هذا الحساب غير مفعّل",
        )

    return user


def get_current_user_optional(
    token: str | None = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User | None:
    """يُستخدم في المسارات التي تعمل بدون تسجيل دخول، لكن تتغير النتيجة إن كان المستخدم مسجلاً."""
    if not token:
        return None
    payload = decode_access_token(token)
    if payload is None:
        return None
    try:
        user_id = int(payload.get("sub"))
    except (TypeError, ValueError):
        return None
    if user_id < 1:
        return None
    user = db.query(User).filter(User.id == int(user_id)).first()
    if user and (user.is_banned or user.is_frozen or not user.is_active):
        return None
    return user


def get_current_admin(current_user: User = Depends(get_current_user)) -> User:
    if not is_platform_admin(current_user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="هذه الصلاحية مخصصة للإدارة فقط",
        )
    return current_user
