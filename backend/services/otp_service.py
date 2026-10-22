"""خدمات OTP: تسليم البريد عبر Brevo وSMS عبر Twilio Verify والتحقق من TOTP."""
import base64
import hashlib
import hmac
import json
import secrets
import struct
import time
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from cryptography.fernet import Fernet, InvalidToken

from config import settings


def email_delivery_ready() -> bool:
    return bool(settings.brevo_api_key and settings.brevo_sender_email)


def sms_delivery_ready() -> bool:
    return bool(
        settings.twilio_account_sid and settings.twilio_auth_token
        and settings.twilio_verify_service_sid
    )


def new_otp_code() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def code_digest(challenge_id: str, code: str) -> str:
    message = f"ytrana-otp:{challenge_id}:{code}".encode("utf-8")
    return hmac.new(settings.secret_key.encode("utf-8"), message, hashlib.sha256).hexdigest()


def verify_code_digest(challenge_id: str, code: str, expected: str | None) -> bool:
    if not expected or len(code) != 6 or not code.isdigit():
        return False
    return hmac.compare_digest(code_digest(challenge_id, code), expected)


def _fernet() -> Fernet:
    # اشتقاق مفتاح منفصل باسم نطاق حتى لا يعاد استخدام SECRET_KEY مباشرةً.
    key = base64.urlsafe_b64encode(hashlib.sha256(
        ("ytrana-totp-encryption-v1:" + settings.secret_key).encode("utf-8")
    ).digest())
    return Fernet(key)


def encrypt_totp_secret(secret: str) -> str:
    return _fernet().encrypt(secret.encode("ascii")).decode("ascii")


def decrypt_totp_secret(token: str | None) -> str | None:
    if not token:
        return None
    try:
        return _fernet().decrypt(token.encode("ascii")).decode("ascii")
    except (InvalidToken, ValueError, UnicodeDecodeError):
        return None


def new_totp_secret() -> str:
    return base64.b32encode(secrets.token_bytes(20)).decode("ascii").rstrip("=")


def totp_code(secret: str, step: int | None = None) -> str:
    """RFC 6238 (SHA-1, six digits, 30-second interval)."""
    if step is None:
        step = int(time.time()) // 30
    normalized = secret.strip().upper()
    padded = normalized + ("=" * ((8 - len(normalized) % 8) % 8))
    key = base64.b32decode(padded, casefold=True)
    digest = hmac.new(key, struct.pack(">Q", step), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    value = struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7FFFFFFF
    return f"{value % 1_000_000:06d}"


def verify_totp(secret: str | None, code: str, last_accepted_step: int | None = None) -> int | None:
    if not secret or len(code) != 6 or not code.isdigit():
        return None
    current = int(time.time()) // 30
    for step in (current - 1, current, current + 1):
        if step <= (last_accepted_step if last_accepted_step is not None else -1):
            continue
        if hmac.compare_digest(totp_code(secret, step), code):
            return step
    return None


def mask_email(email: str) -> str:
    local, _, domain = email.partition("@")
    if not domain:
        return "***"
    visible = local[:1]
    return f"{visible}{'*' * max(2, min(8, len(local) - 1))}@{domain}"


def mask_phone(phone: str | None) -> str | None:
    if not phone:
        return None
    return f"{phone[:3]}{'*' * max(3, len(phone) - 5)}{phone[-2:]}"


def send_email_code(target: str, code: str) -> None:
    if not email_delivery_ready():
        raise RuntimeError("إعدادات البريد الإلكتروني غير مكتملة")
    payload = {
        "sender": {
            "email": settings.brevo_sender_email,
            "name": settings.brevo_sender_name or "Ytrana",
        },
        "to": [{"email": target}],
        "subject": "رمز التحقق من Ytrana",
        "textContent": (
            f"رمز التحقق الخاص بك هو: {code}\n\n"
            "ينتهي الرمز خلال 10 دقائق. إذا لم تطلبه، تجاهل هذه الرسالة."
        ),
    }
    request = Request(
        "https://api.brevo.com/v3/smtp/email",
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "api-key": settings.brevo_api_key,
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        method="POST",
    )
    with urlopen(request, timeout=15) as response:
        if response.status < 200 or response.status >= 300:
            raise RuntimeError("تعذر تسليم البريد الإلكتروني")


def _twilio_verify_request(endpoint: str, fields: dict[str, str]) -> dict:
    if not sms_delivery_ready():
        raise RuntimeError("إعدادات مزود SMS غير مكتملة")
    service_sid = settings.twilio_verify_service_sid
    url = f"https://verify.twilio.com/v2/Services/{service_sid}/{endpoint}"
    credentials = base64.b64encode(
        f"{settings.twilio_account_sid}:{settings.twilio_auth_token}".encode("utf-8")
    ).decode("ascii")
    request = Request(url, data=urlencode(fields).encode("utf-8"), headers={
        "Authorization": f"Basic {credentials}",
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
    }, method="POST")
    with urlopen(request, timeout=15) as response:
        if response.status < 200 or response.status >= 300:
            raise RuntimeError("تعذر إكمال طلب Twilio Verify")
        return json.loads(response.read().decode("utf-8"))


def start_sms_verification(target: str) -> None:
    """اطلب من Verify إنشاء رمز SMS وإرساله؛ لا تُرسل أي رسالة إلا عند استدعاء هذا المسار."""
    result = _twilio_verify_request("Verifications", {"To": target, "Channel": "sms"})
    if result.get("status") != "pending":
        raise RuntimeError("تعذر بدء تحقق SMS")


def verify_sms_code(target: str, code: str) -> bool:
    """تحقق من الرمز عبر Verify، بدل حفظ رمز SMS أو مقارنته محلياً."""
    if len(code) != 6 or not code.isdigit():
        return False
    result = _twilio_verify_request("VerificationCheck", {"To": target, "Code": code})
    return result.get("status") == "approved" and result.get("valid") is True


def deliver_otp(method: str, target: str, code: str | None) -> None:
    if method == "email":
        if code is None:
            raise ValueError("رمز البريد غير موجود")
        send_email_code(target, code)
        return
    if method == "sms":
        start_sms_verification(target)
        return
    raise ValueError("طريقة تسليم OTP غير مدعومة")
