"""
Pydantic Schemas - للتحقق من صحة البيانات (Validation) وتنسيق الاستجابات.
"""
import re
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, EmailStr, field_validator, ConfigDict

USERNAME_REGEX = re.compile(r"^[a-zA-Z0-9_.]{3,30}$")


# ---------- Users ----------

class UserBase(BaseModel):
    username: str
    full_name: str


class UserCreate(BaseModel):
    username: str
    email: EmailStr
    full_name: str
    password: str

    @field_validator("username")
    @classmethod
    def validate_username(cls, v: str) -> str:
        v = v.strip().lower()
        if not USERNAME_REGEX.match(v):
            raise ValueError(
                "اسم المستخدم يجب أن يكون بين 3 و30 حرفًا، ويحتوي فقط على أحرف/أرقام/._"
            )
        return v

    @field_validator("full_name")
    @classmethod
    def validate_full_name(cls, v: str) -> str:
        v = v.strip()
        if len(v) < 2 or len(v) > 100:
            raise ValueError("الاسم يجب أن يكون بين 2 و100 حرف")
        return v

    @field_validator("password")
    @classmethod
    def validate_password(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("كلمة المرور يجب أن تكون 8 أحرف على الأقل")
        if not re.search(r"[A-Za-z]", v) or not re.search(r"[0-9]", v):
            raise ValueError("كلمة المرور يجب أن تحتوي على حروف وأرقام")
        return v


class UserLogin(BaseModel):
    username_or_email: str
    password: str


class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    bio: Optional[str] = None

    @field_validator("full_name")
    @classmethod
    def validate_full_name(cls, v):
        if v is None:
            return v
        v = v.strip()
        if len(v) < 2 or len(v) > 100:
            raise ValueError("الاسم يجب أن يكون بين 2 و100 حرف")
        return v

    @field_validator("bio")
    @classmethod
    def validate_bio(cls, v):
        if v is None:
            return v
        if len(v) > 160:
            raise ValueError("السيرة الذاتية يجب ألا تتجاوز 160 حرفًا")
        return v


class PasswordChange(BaseModel):
    current_password: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def validate_new_password(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("كلمة المرور الجديدة يجب أن تكون 8 أحرف على الأقل")
        if not re.search(r"[A-Za-z]", v) or not re.search(r"[0-9]", v):
            raise ValueError("كلمة المرور يجب أن تحتوي على حروف وأرقام")
        return v


class AccountDelete(BaseModel):
    password: str


class UserPublic(BaseModel):
    id: int
    username: str
    full_name: str
    bio: str
    avatar_url: Optional[str] = None
    is_banned: bool = False
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class UserProfile(UserPublic):
    followers_count: int = 0
    following_count: int = 0
    posts_count: int = 0
    is_followed_by_me: bool = False


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserPublic


# ---------- Posts ----------

class PostCreate(BaseModel):
    content: Optional[str] = None

    @field_validator("content")
    @classmethod
    def validate_content(cls, v):
        if v is not None:
            v = v.strip()
            if len(v) > 3000:
                raise ValueError("المنشور طويل جدًا (الحد الأقصى 3000 حرف)")
        return v


class PostUpdate(BaseModel):
    content: Optional[str] = None

    @field_validator("content")
    @classmethod
    def validate_content(cls, v):
        if v is not None:
            v = v.strip()
            if len(v) > 3000:
                raise ValueError("المنشور طويل جدًا (الحد الأقصى 3000 حرف)")
        return v


class PostOut(BaseModel):
    id: int
    content: Optional[str]
    image_url: Optional[str]
    created_at: datetime
    updated_at: datetime
    is_edited: bool
    author: UserPublic
    likes_count: int = 0
    comments_count: int = 0
    liked_by_me: bool = False

    model_config = ConfigDict(from_attributes=True)


# ---------- Comments ----------

class CommentCreate(BaseModel):
    content: str

    @field_validator("content")
    @classmethod
    def validate_content(cls, v: str) -> str:
        v = v.strip()
        if len(v) < 1:
            raise ValueError("التعليق لا يمكن أن يكون فارغًا")
        if len(v) > 500:
            raise ValueError("التعليق طويل جدًا (الحد الأقصى 500 حرف)")
        return v


class CommentOut(BaseModel):
    id: int
    post_id: int
    content: str
    created_at: datetime
    author: UserPublic

    model_config = ConfigDict(from_attributes=True)


# ---------- Notifications ----------

class NotificationOut(BaseModel):
    id: int
    type: str
    actor: UserPublic
    post_id: Optional[int] = None
    comment_id: Optional[int] = None
    is_read: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ---------- Reports ----------

class ReportCreate(BaseModel):
    target_type: str
    target_id: int
    reason: str

    @field_validator("target_type")
    @classmethod
    def validate_target_type(cls, v: str) -> str:
        if v not in ("user", "post", "comment"):
            raise ValueError("نوع البلاغ غير صالح")
        return v

    @field_validator("reason")
    @classmethod
    def validate_reason(cls, v: str) -> str:
        v = v.strip()
        if len(v) < 3 or len(v) > 500:
            raise ValueError("سبب البلاغ يجب أن يكون بين 3 و500 حرف")
        return v


class ReportOut(BaseModel):
    id: int
    target_type: str
    target_id: int
    reason: str
    status: str
    created_at: datetime
    reporter: UserPublic

    model_config = ConfigDict(from_attributes=True)


# ---------- Generic ----------

class Message(BaseModel):
    message: str
