"""مسارات المصادقة وتسجيل الدخول بخطوة OTP اختيارية."""
from datetime import timedelta
from urllib.parse import quote
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from database.db import get_db
from middleware.auth_dependency import get_current_user
from models.models import OtpChallenge, User, utcnow_naive
from schemas.schemas import (
    LoginOtpStart, LoginResponse, MfaDisable, Message, OtpCode, PhoneNumber,
    Token, TotpConfirm, UserCreate, UserLogin, UserMe, UserPublic,
)
from services.auth_service import authenticate_user, create_user, get_user_by_email, get_user_by_username
from services.moderation import is_platform_admin
from utils.security import create_access_token, verify_password
from services.otp_service import (
    code_digest, decrypt_totp_secret, deliver_otp, email_delivery_ready,
    mask_email, mask_phone, new_otp_code, new_totp_secret, encrypt_totp_secret,
    sms_delivery_ready, verify_code_digest, verify_sms_code, verify_totp,
)

router = APIRouter(prefix="/api/auth", tags=["Auth"])
OTP_TTL = timedelta(minutes=10)
OTP_MAX_ATTEMPTS = 5
OTP_MAX_SENDS = 3
OTP_RESEND_WAIT = timedelta(seconds=60)


def _enabled_methods(user: User) -> list[str]:
    methods = []
    if user.totp_secret:
        methods.append("totp")
    if user.email_otp_enabled:
        methods.append("email")
    if user.sms_otp_enabled and user.phone_verified:
        methods.append("sms")
    return methods


def _new_challenge(db: Session, user: User, purpose: str, method: str = "pending", target: str | None = None) -> OtpChallenge:
    challenge = OtpChallenge(
        id=str(uuid4()), user_id=user.id, purpose=purpose, method=method,
        target=target, created_at=utcnow_naive(), expires_at=utcnow_naive() + OTP_TTL,
    )
    db.add(challenge)
    db.commit()
    db.refresh(challenge)
    return challenge


def _send_challenge_code(db: Session, challenge: OtpChallenge, method: str, target: str) -> None:
    ready = email_delivery_ready() if method == "email" else sms_delivery_ready()
    if not ready:
        raise HTTPException(status_code=503, detail=(
            "إعدادات إرسال البريد غير مكتملة" if method == "email"
            else "إعدادات مزود SMS غير مكتملة"
        ))
    if challenge.sends_count >= OTP_MAX_SENDS:
        raise HTTPException(status_code=429, detail="وصلت إلى الحد الأقصى لإعادة إرسال الرمز؛ ابدأ تسجيل الدخول من جديد")
    now = utcnow_naive()
    if challenge.last_sent_at and now - challenge.last_sent_at < OTP_RESEND_WAIT:
        raise HTTPException(status_code=429, detail="انتظر دقيقة قبل طلب رمز جديد")
    recent = db.query(func.count(OtpChallenge.id)).filter(
        OtpChallenge.user_id == challenge.user_id,
        OtpChallenge.last_sent_at >= now - timedelta(hours=1),
    ).scalar() or 0
    if recent >= 5:
        raise HTTPException(status_code=429, detail="وصلت إلى حد إرسال الرموز خلال الساعة؛ حاول لاحقاً")

    code = new_otp_code() if method == "email" else None
    challenge.method = method
    challenge.target = target
    challenge.code_hash = code_digest(challenge.id, code) if code is not None else None
    challenge.attempts = 0
    challenge.expires_at = now + OTP_TTL
    db.commit()
    try:
        deliver_otp(method, target, code)
    except Exception as exc:
        challenge.code_hash = None
        db.commit()
        # لا نكشف تفاصيل Brevo/Twilio أو بيانات المزود للعميل.
        raise HTTPException(status_code=503, detail="تعذر إرسال رمز التحقق؛ تحقق من إعدادات مزود الخدمة") from exc
    challenge.last_sent_at = now
    challenge.sends_count += 1
    db.commit()


def _get_challenge(db: Session, challenge_id: str, purpose: str, user_id: int | None = None) -> OtpChallenge:
    challenge = db.query(OtpChallenge).filter(
        OtpChallenge.id == challenge_id, OtpChallenge.purpose == purpose,
    ).first()
    if not challenge or (user_id is not None and challenge.user_id != user_id):
        raise HTTPException(status_code=404, detail="جلسة التحقق غير موجودة أو انتهت")
    if challenge.consumed or challenge.expires_at <= utcnow_naive():
        raise HTTPException(status_code=400, detail="انتهت صلاحية رمز التحقق؛ ابدأ من جديد")
    if challenge.attempts >= OTP_MAX_ATTEMPTS:
        raise HTTPException(status_code=429, detail="تجاوزت عدد المحاولات؛ ابدأ من جديد")
    return challenge


def _wrong_code(db: Session, challenge: OtpChallenge) -> None:
    challenge.attempts += 1
    db.commit()
    if challenge.attempts >= OTP_MAX_ATTEMPTS:
        raise HTTPException(status_code=429, detail="تجاوزت عدد المحاولات؛ ابدأ من جديد")
    raise HTTPException(status_code=400, detail="رمز التحقق غير صحيح")


def _check_challenge_code(db: Session, challenge: OtpChallenge, code: str) -> int | None:
    if challenge.method == "email":
        if not verify_code_digest(challenge.id, code, challenge.code_hash):
            _wrong_code(db, challenge)
        return None
    if challenge.method == "sms":
        try:
            valid = verify_sms_code(challenge.target or "", code)
        except Exception as exc:
            raise HTTPException(status_code=503, detail="تعذر التحقق من الرمز عبر مزود SMS") from exc
        if not valid:
            _wrong_code(db, challenge)
        return None
    if challenge.method == "totp":
        user = db.query(User).filter(User.id == challenge.user_id).first()
        secret = decrypt_totp_secret(user.totp_secret if user else None)
        accepted_step = verify_totp(secret, code, user.totp_last_step if user else None)
        if accepted_step is None:
            _wrong_code(db, challenge)
        return accepted_step
    _wrong_code(db, challenge)


def _session_response(user: User) -> LoginResponse:
    return LoginResponse(
        access_token=create_access_token(data={"sub": str(user.id)}),
        token_type="bearer", user=UserPublic.model_validate(user),
    )


@router.post("/register", response_model=Token, status_code=status.HTTP_201_CREATED)
def register(user_in: UserCreate, db: Session = Depends(get_db)):
    if get_user_by_username(db, user_in.username):
        raise HTTPException(status_code=400, detail="اسم المستخدم مستخدم بالفعل")
    if get_user_by_email(db, user_in.email):
        raise HTTPException(status_code=400, detail="البريد الإلكتروني مستخدم بالفعل")
    user = create_user(db, user_in)
    access_token = create_access_token(data={"sub": str(user.id)})
    return Token(access_token=access_token, user=UserPublic.model_validate(user))


@router.post("/login", response_model=LoginResponse)
def login(credentials: UserLogin, db: Session = Depends(get_db)):
    user = authenticate_user(db, credentials.username_or_email, credentials.password)
    if not user:
        raise HTTPException(status_code=401, detail="اسم المستخدم/البريد أو كلمة المرور غير صحيحة")
    if user.is_frozen:
        raise HTTPException(status_code=403, detail="هذا الحساب مجمّد مؤقتًا من قبل الإدارة")
    if user.is_banned:
        raise HTTPException(status_code=403, detail="تم حظر هذا الحساب من قبل الإدارة")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="هذا الحساب غير مفعّل")

    methods = _enabled_methods(user)
    if not methods:
        return _session_response(user)
    challenge = _new_challenge(db, user, "login")
    return LoginResponse(
        requires_otp=True, challenge_id=challenge.id, available_methods=methods,
        email_hint=mask_email(user.email) if "email" in methods else None,
        phone_hint=mask_phone(user.phone_number) if "sms" in methods else None,
    )


@router.post("/login/otp/start")
def start_login_otp(payload: LoginOtpStart, db: Session = Depends(get_db)):
    challenge = _get_challenge(db, payload.challenge_id, "login")
    user = db.query(User).filter(User.id == challenge.user_id).first()
    if not user or not user.is_active or user.is_banned or user.is_frozen:
        raise HTTPException(status_code=403, detail="هذا الحساب غير متاح لتسجيل الدخول")
    if payload.method not in _enabled_methods(user):
        raise HTTPException(status_code=400, detail="طريقة التحقق غير مفعّلة لهذا الحساب")

    if payload.method == "totp":
        challenge.method = "totp"
        challenge.target = None
        challenge.code_hash = None
        challenge.expires_at = utcnow_naive() + timedelta(minutes=5)
        challenge.attempts = 0
        db.commit()
        return {"message": "افتح تطبيق المصادقة وأدخل الرمز الحالي"}

    target = user.email if payload.method == "email" else user.phone_number
    if not target:
        raise HTTPException(status_code=400, detail="لا توجد وسيلة اتصال موثقة لهذه الطريقة")
    _send_challenge_code(db, challenge, payload.method, target)
    hint = mask_email(target) if payload.method == "email" else mask_phone(target)
    return {"message": "أرسلنا رمز التحقق", "target_hint": hint}


@router.post("/login/otp/verify", response_model=LoginResponse)
def verify_login_otp(payload: OtpCode, db: Session = Depends(get_db)):
    challenge = _get_challenge(db, payload.challenge_id, "login")
    user = db.query(User).filter(User.id == challenge.user_id).first()
    if not user or not user.is_active or user.is_banned or user.is_frozen:
        raise HTTPException(status_code=403, detail="هذا الحساب غير متاح لتسجيل الدخول")
    accepted_step = _check_challenge_code(db, challenge, payload.code)
    challenge.consumed = True
    if accepted_step is not None:
        user.totp_last_step = accepted_step
    db.commit()
    return _session_response(user)


@router.get("/mfa")
def mfa_status(current_user: User = Depends(get_current_user)):
    return {
        "email_enabled": bool(current_user.email_otp_enabled),
        "sms_enabled": bool(current_user.sms_otp_enabled and current_user.phone_verified),
        "totp_enabled": bool(current_user.totp_secret),
        "email_delivery_ready": email_delivery_ready(),
        "sms_delivery_ready": sms_delivery_ready(),
        "email_hint": mask_email(current_user.email),
        "phone_hint": mask_phone(current_user.phone_number),
        "phone_verified": bool(current_user.phone_verified),
    }


@router.post("/mfa/email/start")
def start_email_mfa(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if current_user.email_otp_enabled:
        raise HTTPException(status_code=400, detail="التحقق بالبريد مفعّل بالفعل")
    challenge = _new_challenge(db, current_user, "enable_email", "email", current_user.email)
    _send_challenge_code(db, challenge, "email", current_user.email)
    return {"challenge_id": challenge.id, "target_hint": mask_email(current_user.email), "message": "أرسلنا رمز التفعيل إلى بريدك"}


@router.post("/mfa/email/confirm", response_model=Message)
def confirm_email_mfa(payload: OtpCode, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    challenge = _get_challenge(db, payload.challenge_id, "enable_email", current_user.id)
    _check_challenge_code(db, challenge, payload.code)
    challenge.consumed = True
    current_user.email_otp_enabled = True
    db.commit()
    return Message(message="تم تفعيل التحقق بخطوتين عبر البريد الإلكتروني")


@router.post("/mfa/sms/start")
def start_sms_mfa(payload: PhoneNumber, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not sms_delivery_ready():
        raise HTTPException(status_code=503, detail="إعدادات مزود SMS غير مكتملة؛ أضف إعدادات Twilio أولاً")
    challenge = _new_challenge(db, current_user, "enable_sms", "sms", payload.phone_number)
    _send_challenge_code(db, challenge, "sms", payload.phone_number)
    return {"challenge_id": challenge.id, "target_hint": mask_phone(payload.phone_number), "message": "أرسلنا رمز التحقق إلى الهاتف"}


@router.post("/mfa/sms/confirm", response_model=Message)
def confirm_sms_mfa(payload: OtpCode, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    challenge = _get_challenge(db, payload.challenge_id, "enable_sms", current_user.id)
    _check_challenge_code(db, challenge, payload.code)
    challenge.consumed = True
    current_user.phone_number = challenge.target
    current_user.phone_verified = True
    current_user.sms_otp_enabled = True
    db.commit()
    return Message(message="تم التحقق من الهاتف وتفعيل SMS لتسجيل الدخول")


@router.post("/mfa/totp/setup")
def setup_totp(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    secret = new_totp_secret()
    current_user.pending_totp_secret = encrypt_totp_secret(secret)
    db.commit()
    label = quote(f"Ytrana:{current_user.email}", safe="")
    uri = f"otpauth://totp/{label}?secret={secret}&issuer={quote('Ytrana')}&algorithm=SHA1&digits=6&period=30"
    return {
        "secret": secret,
        "otpauth_uri": uri,
        "instructions": "أضف المفتاح يدوياً في Google Authenticator أو Microsoft Authenticator أو أي تطبيق TOTP، ثم أدخل الرمز لإكمال التفعيل.",
    }


@router.post("/mfa/totp/confirm", response_model=Message)
def confirm_totp(payload: TotpConfirm, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    secret = decrypt_totp_secret(current_user.pending_totp_secret)
    accepted_step = verify_totp(secret, payload.code)
    if accepted_step is None:
        raise HTTPException(status_code=400, detail="رمز التطبيق غير صحيح؛ تحقق من الوقت والمفتاح")
    current_user.totp_secret = current_user.pending_totp_secret
    current_user.pending_totp_secret = None
    current_user.totp_last_step = accepted_step
    db.commit()
    return Message(message="تم تفعيل تطبيق المصادقة")


@router.post("/mfa/disable", response_model=Message)
def disable_mfa(payload: MfaDisable, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not verify_password(payload.password, current_user.hashed_password):
        raise HTTPException(status_code=400, detail="كلمة المرور الحالية غير صحيحة")
    if payload.method == "email":
        current_user.email_otp_enabled = False
    elif payload.method == "sms":
        current_user.sms_otp_enabled = False
    else:
        if not payload.code:
            raise HTTPException(status_code=400, detail="أدخل رمز تطبيق المصادقة لتأكيد الإيقاف")
        secret = decrypt_totp_secret(current_user.totp_secret)
        accepted_step = verify_totp(secret, payload.code, current_user.totp_last_step)
        if accepted_step is None:
            raise HTTPException(status_code=400, detail="رمز تطبيق المصادقة غير صحيح")
        current_user.totp_secret = None
        current_user.pending_totp_secret = None
        current_user.totp_last_step = accepted_step
    db.commit()
    return Message(message="تم إيقاف وسيلة التحقق المحددة")


@router.post("/logout", response_model=Message)
def logout(current_user: User = Depends(get_current_user)):
    # JWT عديم الحالة؛ إتمام الخروج يتم بحذف التوكن من جهاز المستخدم.
    return Message(message="تم تسجيل الخروج بنجاح")


@router.get("/me", response_model=UserMe)
def get_me(current_user: User = Depends(get_current_user)):
    return UserMe.model_validate(current_user).model_copy(update={"is_admin": is_platform_admin(current_user)})
