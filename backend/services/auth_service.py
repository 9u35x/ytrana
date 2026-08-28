"""
منطق المصادقة: إنشاء المستخدمين، التحقق من بيانات الدخول.
"""
from sqlalchemy.orm import Session

from models.models import User
from schemas.schemas import UserCreate
from utils.security import hash_password, verify_password


def get_user_by_username(db: Session, username: str) -> User | None:
    return db.query(User).filter(User.username == username.lower()).first()


def get_user_by_email(db: Session, email: str) -> User | None:
    return db.query(User).filter(User.email == email.lower()).first()


def create_user(db: Session, user_in: UserCreate) -> User:
    user = User(
        username=user_in.username,
        email=user_in.email.lower(),
        full_name=user_in.full_name,
        hashed_password=hash_password(user_in.password),
        bio="",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def authenticate_user(db: Session, username_or_email: str, password: str) -> User | None:
    identifier = username_or_email.strip().lower()
    user = get_user_by_username(db, identifier) or get_user_by_email(db, identifier)
    if not user:
        return None
    if not verify_password(password, user.hashed_password):
        return None
    return user
