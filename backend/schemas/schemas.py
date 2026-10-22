"""
Pydantic Schemas - للتحقق من صحة البيانات (Validation) وتنسيق الاستجابات.
"""
import re
from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator, ConfigDict

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
        if len(v.encode("utf-8")) > 72:
            raise ValueError("كلمة المرور يجب ألا تتجاوز 72 بايتًا")
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
        if len(v.encode("utf-8")) > 72:
            raise ValueError("كلمة المرور الجديدة يجب ألا تتجاوز 72 بايتًا")
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
    is_verified: bool = False
    verification_expires_at: Optional[datetime] = None
    created_at: datetime
    account_visibility: str = "public"

    model_config = ConfigDict(from_attributes=True)

    @model_validator(mode="before")
    @classmethod
    def private_preview(cls, value):
        # Mini-user ORM snapshots have no viewer context. Hide private bios;
        # authorized full profiles supply an explicitly filtered dictionary.
        if not isinstance(value, dict) and getattr(value, "account_visibility", "public") == "private":
            data = {name: getattr(value, name) for name in cls.model_fields if hasattr(value, name)}
            data["bio"] = ""
            return data
        return value


class UserProfile(UserPublic):
    followers_count: int = 0
    following_count: int = 0
    posts_count: int = 0
    is_followed_by_me: bool = False
    follow_request_pending: bool = False
    is_follow_requested: bool = False
    follow_request_status: str | None = None
    follow_status: str = "none"
    can_view_content: bool = True
    can_view_profile_details: bool = True


class UserMe(UserPublic):
    """معلومات الحساب الحالي؛ صفة الإدارة لا تُكشف في الملفات العامة."""
    is_admin: bool = False


class AdminUser(UserPublic):
    """حقول حالة الحساب لا تظهر إلا داخل لوحة الإدارة المحمية."""
    is_admin: bool = False
    is_banned: bool = False
    is_frozen: bool = False
    frozen_until: Optional[datetime] = None
class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserPublic


class LoginResponse(BaseModel):
    """استجابة تسجيل الدخول: جلسة مباشرة أو خطوة تحقق إضافية."""
    access_token: Optional[str] = None
    token_type: Optional[str] = None
    user: Optional[UserPublic] = None
    requires_otp: bool = False
    challenge_id: Optional[str] = None
    available_methods: list[str] = Field(default_factory=list)
    email_hint: Optional[str] = None
    phone_hint: Optional[str] = None


class LoginOtpStart(BaseModel):
    challenge_id: str
    method: Literal["email", "sms", "totp"]


class OtpCode(BaseModel):
    challenge_id: str
    code: str

    @field_validator("code")
    @classmethod
    def validate_code(cls, value: str) -> str:
        value = value.strip().replace(" ", "")
        if len(value) != 6 or not value.isdigit():
            raise ValueError("رمز التحقق يجب أن يتكون من 6 أرقام")
        return value


class TotpConfirm(BaseModel):
    code: str

    @field_validator("code")
    @classmethod
    def validate_code(cls, value: str) -> str:
        value = value.strip().replace(" ", "")
        if len(value) != 6 or not value.isdigit():
            raise ValueError("رمز التحقق يجب أن يتكون من 6 أرقام")
        return value


class PhoneNumber(BaseModel):
    phone_number: str

    @field_validator("phone_number")
    @classmethod
    def validate_phone_number(cls, value: str) -> str:
        value = value.strip().replace(" ", "").replace("-", "").replace("(", "").replace(")", "")
        if not re.fullmatch(r"\+[1-9][0-9]{7,14}", value):
            raise ValueError("أدخل الرقم بصيغة دولية مثل +9647XXXXXXXXX")
        return value


class MfaDisable(BaseModel):
    method: Literal["email", "sms", "totp"]
    password: str
    code: Optional[str] = None

    @field_validator("code")
    @classmethod
    def validate_optional_code(cls, value: Optional[str]) -> Optional[str]:
        if value is None or not value.strip():
            return None
        value = value.strip().replace(" ", "")
        if len(value) != 6 or not value.isdigit():
            raise ValueError("رمز التحقق يجب أن يتكون من 6 أرقام")
        return value


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
    video_url: Optional[str] = None
    mood_key: Optional[str] = None
    circle_id: Optional[int] = None
    challenge_id: Optional[int] = None
    business_id: Optional[int] = None
    business: Optional[dict] = None
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
    target_id: int = Field(gt=0)
    reason: str
    category: Literal["spam", "harassment", "hate", "violence", "sexual", "impersonation", "scam", "privacy", "copyright", "other"] = "other"

    @field_validator("target_type")
    @classmethod
    def validate_target_type(cls, v: str) -> str:
        if v not in ("user", "post", "comment", "reel", "story", "message"):
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
    category: str = "other"
    status: str
    reviewer_id: Optional[int] = None
    review_note: Optional[str] = None
    resolution: Optional[str] = None
    reviewed_at: Optional[datetime] = None
    created_at: datetime
    
    reporter: UserPublic

    model_config = ConfigDict(from_attributes=True)


class ModerationNote(BaseModel):
    note: str = Field(default="", max_length=1000)


class FreezeRequest(ModerationNote):
    days: Optional[int] = Field(default=None, ge=1, le=3650)


class VerificationRequest(FreezeRequest):
    mode: Literal["permanent", "temporary", "revoke"]


class ResolveReport(FreezeRequest):
    action: Literal["review", "dismiss", "delete_content", "ban_user", "freeze_user"]


# ---------- Generic ----------

class Message(BaseModel):
    message: str


class DmApprovalCreate(BaseModel):
    requester_id: int = Field(gt=0)
    recipient_id: int = Field(gt=0)
# ==================== V2: الدردشة والمزاج ====================

class MessageCreate(BaseModel):
    content: str
    circle_id: Optional[int] = Field(default=None, gt=0)

    @field_validator("content")
    @classmethod
    def validate_content(cls, v: str) -> str:
        v = v.strip()
        if len(v) < 1:
            raise ValueError("الرسالة لا يمكن أن تكون فارغة")
        if len(v) > 2000:
            raise ValueError("الرسالة طويلة جدًا (الحد الأقصى 2000 حرف)")
        return v


class MessageOut(BaseModel):
    id: int
    conversation_id: int
    content: str
    is_read: bool
    created_at: datetime
    sender: UserPublic

    model_config = ConfigDict(from_attributes=True)


class ConversationOut(BaseModel):
    id: int
    other_user: UserPublic
    last_message: Optional[str] = None
    last_message_at: Optional[datetime] = None
    unread_count: int = 0

    model_config = ConfigDict(from_attributes=True)


class MoodOut(BaseModel):
    id: int
    key: str
    label_ar: str
    emoji: str
    color: str

    model_config = ConfigDict(from_attributes=True)


class MoodStatusCreate(BaseModel):
    mood_key: str
    note: Optional[str] = None

    @field_validator("mood_key")
    @classmethod
    def validate_mood_key(cls, v: str) -> str:
        v = v.strip().lower()
        if len(v) < 1 or len(v) > 30:
            raise ValueError("المزاج غير صالح")
        return v

    @field_validator("note")
    @classmethod
    def validate_note(cls, v):
        if v is None:
            return v
        v = v.strip()
        if len(v) > 120:
            raise ValueError("الملاحظة طويلة جدًا (الحد الأقصى 120 حرف)")
        return v


class MoodStatusOut(BaseModel):
    id: int
    mood: MoodOut
    note: Optional[str] = None
    created_at: datetime
    expires_at: datetime
    user: UserPublic

    model_config = ConfigDict(from_attributes=True)


# ==================== V3: القصص المؤقتة ومقاطع Reels ====================
class StoryOut(BaseModel):
    id: int
    caption: Optional[str] = None
    image_url: Optional[str] = None
    video_url: Optional[str] = None
    mood_key: Optional[str] = None
    created_at: datetime
    expires_at: datetime
    author: UserPublic
    views_count: int = 0
    viewed_by_me: bool = False


class ReelOut(BaseModel):
    id: int
    caption: Optional[str] = None
    video_url: str
    mood_key: Optional[str] = None
    created_at: datetime
    author: UserPublic
    likes_count: int = 0
    liked_by_me: bool = False
    views_count: int = 0
    viewed_by_me: bool = False


# ---------- دوائر Ytrana ----------
class CircleUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    is_private: Optional[bool] = None

    @field_validator("name")
    @classmethod
    def validate_circle_name(cls, value):
        if value is None:
            return value
        value = value.strip()
        if len(value) < 3 or len(value) > 100:
            raise ValueError("اسم الدائرة يجب أن يكون بين 3 و100 حرف")
        return value

    @field_validator("description")
    @classmethod
    def validate_circle_description(cls, value):
        if value is not None and len(value.strip()) > 1000:
            raise ValueError("وصف الدائرة يجب ألا يتجاوز 1000 حرف")
        return value.strip() if value is not None else value


# ---------- تحديات Ytrana ----------
class ChallengeCreate(BaseModel):
    title: str
    description: str = ""
    image_url: Optional[str] = None
    period: Literal["daily", "weekly"] = "weekly"
    starts_at: datetime
    ends_at: datetime
    is_active: bool = True

    @field_validator("title")
    @classmethod
    def validate_challenge_title(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 3 or len(value) > 120:
            raise ValueError("عنوان التحدي يجب أن يكون بين 3 و120 حرفًا")
        return value

    @field_validator("description")
    @classmethod
    def validate_challenge_description(cls, value: str) -> str:
        value = value.strip()
        if len(value) > 2000:
            raise ValueError("وصف التحدي طويل جدًا")
        return value


class ChallengeUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    image_url: Optional[str] = None
    period: Optional[Literal["daily", "weekly"]] = None
    starts_at: Optional[datetime] = None
    ends_at: Optional[datetime] = None
    is_active: Optional[bool] = None

    @field_validator("title")
    @classmethod
    def validate_updated_challenge_title(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        value = value.strip()
        if len(value) < 3 or len(value) > 120:
            raise ValueError("عنوان التحدي يجب أن يكون بين 3 و120 حرفًا")
        return value

    @field_validator("description")
    @classmethod
    def validate_updated_challenge_description(cls, value: Optional[str]) -> Optional[str]:
        if value is not None and len(value.strip()) > 2000:
            raise ValueError("وصف التحدي طويل جدًا")
        return value.strip() if value is not None else value


class CircleMemberRole(BaseModel):
    role: Literal["member", "moderator"]
    capabilities: list[Literal["approve_members", "remove_members", "manage_posts", "edit_circle", "pin_posts"]] = Field(default_factory=list)


class CircleDMApprovalCreate(BaseModel):
    pass


class ChallengeSubmissionOut(BaseModel):
    post: PostOut
    rank: int
    engagement_count: int


# ---------- صفحات الأعمال ----------
class BusinessProductInput(BaseModel):
    name: str
    description: str = ""
    image_url: Optional[str] = None
    price: Optional[str] = None

    @field_validator("name")
    @classmethod
    def validate_product_name(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 2 or len(value) > 120:
            raise ValueError("اسم المنتج أو الخدمة يجب أن يكون بين حرفين و120 حرفًا")
        return value

    @field_validator("description")
    @classmethod
    def validate_product_description(cls, value: str) -> str:
        value = value.strip()
        if len(value) > 2000:
            raise ValueError("وصف المنتج طويل جدًا")
        return value

    @field_validator("price")
    @classmethod
    def validate_product_price(cls, value: Optional[str]) -> Optional[str]:
        if value is None or not value.strip():
            return None
        value = value.strip()
        if len(value) > 32:
            raise ValueError("السعر طويل جدًا")
        return value
