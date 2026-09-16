"""
مسارات المصادقة: تسجيل حساب، تسجيل دخول، تسجيل خروج، بيانات المستخدم الحالي.
"""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from database.db import get_db
from middleware.auth_dependency import get_current_user
from models.models import User
from schemas.schemas import Token, UserCreate, UserLogin, UserPublic, Message
from services.auth_service import authenticate_user, create_user, get_user_by_email, get_user_by_username
from utils.security import create_access_token

router = APIRouter(prefix="/api/auth", tags=["Auth"])

MAX_FAILED_ATTEMPTS = 5
LOCKOUT_MINUTES = 15


@router.post("/register", response_model=Token, status_code=status.HTTP_201_CREATED)
def register(user_in: UserCreate, db: Session = Depends(get_db)):
    if get_user_by_username(db, user_in.username):
        raise HTTPException(status_code=400, detail="اسم المستخدم مستخدم بالفعل")
    if get_user_by_email(db, user_in.email):
        raise HTTPException(status_code=400, detail="البريد الإلكتروني مستخدم بالفعل")

    user = create_user(db, user_in)
    access_token = create_access_token(data={"sub": str(user.id)})
    return Token(access_token=access_token, user=UserPublic.model_validate(user))


@router.post("/login", response_model=Token)
def login(credentials: UserLogin, db: Session = Depends(get_db)):
    identifier = credentials.username_or_email
    existing_user = get_user_by_username(db, identifier) or get_user_by_email(db, identifier)

    now = datetime.now(timezone.utc)

    if existing_user and existing_user.locked_until and existing_user.locked_until > now:
        remaining = int((existing_user.locked_until - now).total_seconds() / 60) + 1
        raise HTTPException(
            status_code=status.HTTP_423_LOCKED,
            detail=f"تم قفل الحساب مؤقتًا بسبب محاولات دخول فاشلة متكررة. حاول بعد {remaining} دقيقة",
        )

    user = authenticate_user(db, identifier, credentials.password)

    if not user:
        if existing_user:
            existing_user.failed_login_attempts = (existing_user.failed_login_attempts or 0) + 1
            if existing_user.failed_login_attempts >= MAX_FAILED_ATTEMPTS:
                existing_user.locked_until = now + timedelta(minutes=LOCKOUT_MINUTES)
            db.commit()
        raise HTTPException(status_code=401, detail="اسم المستخدم/البريد أو كلمة المرور غير صحيحة")

    if user.is_banned:
        raise HTTPException(status_code=403, detail="تم حظر هذا الحساب من قبل الإدارة")

    user.failed_login_attempts = 0
    user.locked_until = None
    db.commit()

    access_token = create_access_token(data={"sub": str(user.id)})
    return Token(access_token=access_token, user=UserPublic.model_validate(user))


@router.post("/logout", response_model=Message)
def logout(current_user: User = Depends(get_current_user)):
    # الـ JWT عديم الحالة (stateless)؛ تسجيل الخروج الفعلي يتم بحذف التوكن من طرف العميل.
    # هذا المسار موجود للتوافق مع الواجهة الأمامية ولإمكانية إضافة قائمة إبطال (blacklist) لاحقًا.
    return Message(message="تم تسجيل الخروج بنجاح")


@router.get("/me", response_model=UserPublic)
def get_me(current_user: User = Depends(get_current_user)):
    return current_user
