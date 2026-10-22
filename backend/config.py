"""
إعدادات التطبيق العامة - تُقرأ من ملف .env
"""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Ytrana"
    env: str = "development"

    secret_key: str
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 10080  # 7 أيام

    database_url: str = "sqlite:///./ytrana.db"

    # اتركها فارغة حتى التحقق من هويتي الحسابين وIDs من قاعدة البيانات.
    # معرفان ثابتان فقط، مفصولان بفاصلة. لا تُقبل usernames كمصدر صلاحية.
    admin_user_ids: str = ""

    upload_dir: str = "uploads"
    max_upload_mb: int = 5
    max_reel_mb: int = 20

    cors_origins: str = "http://localhost:5500,http://127.0.0.1:5500"

    # تسليم OTP اختياري؛ لا يُفعّل البريد أو SMS دون إعدادات مزوّد صريحة.
    brevo_api_key: str = ""
    brevo_sender_email: str = ""
    brevo_sender_name: str = "Ytrana"
    twilio_account_sid: str = ""
    twilio_auth_token: str = ""
    twilio_verify_service_sid: str = ""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
