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

    upload_dir: str = "uploads"
    max_upload_mb: int = 5

    cors_origins: str = "http://localhost:5500,http://127.0.0.1:5500"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
