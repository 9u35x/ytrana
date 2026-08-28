"""
مسارات المصادقة: تسجيل حساب، تسجيل دخول، تسجيل خروج، بيانات المستخدم الحالي.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from database.db import get_db
from middleware.auth_dependency import get_current_user
from models.models import User
from schemas.schemas import Token, UserCreate, UserLogin, UserPublic, Message
from services.auth_service import authenticate_user, create_user, get_user_by_email, get_user_by_username
from utils.security import create_access_token

router = APIRouter(prefix="/api/auth", tags=["Auth"])


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
    user = authenticate_user(db, credentials.username_or_email, credentials.password)
    if not user:
        raise HTTPException(status_code=401, detail="اسم المستخدم/البريد أو كلمة المرور غير صحيحة")
    if user.is_banned:
        raise HTTPException(status_code=403, detail="تم حظر هذا الحساب من قبل الإدارة")

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
