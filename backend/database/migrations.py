"""ترحيلات إضافية متوافقة إلى الخلف لقاعدة SQLite الحالية."""
from sqlalchemy import inspect, text


ADDITIVE_COLUMNS = {
    "posts": {
        "video_url": "VARCHAR(255)", "mood_key": "VARCHAR(20)",
        "circle_id": "INTEGER",
        "challenge_id": "INTEGER",
        "business_id": "INTEGER",
        "is_archived": "BOOLEAN NOT NULL DEFAULT 0",
    },
    "stories": {"video_url": "VARCHAR(255)", "mood_key": "VARCHAR(20)", "is_archived": "BOOLEAN NOT NULL DEFAULT 0"},
    "reels": {"mood_key": "VARCHAR(20)"},
    "challenges": {"period": "VARCHAR(10) NOT NULL DEFAULT 'weekly'"},
    "reports": {
        "category": "VARCHAR(30) NOT NULL DEFAULT 'other'",
        "reviewer_id": "INTEGER", "review_note": "VARCHAR(1000)",
        "resolution": "VARCHAR(30)", "reviewed_at": "DATETIME", "target_snapshot": "TEXT",
        "target_fingerprint": "VARCHAR(120)",
    },
    "conversations": {"circle_id": "INTEGER"},
    "circle_memberships": {"capabilities": "TEXT NOT NULL DEFAULT '[]'"},
    "users": {
        "verified_at": "DATETIME", "verification_expires_at": "DATETIME",
        "frozen_at": "DATETIME", "frozen_until": "DATETIME",
        "phone_number": "VARCHAR(20)",
        "phone_verified": "BOOLEAN NOT NULL DEFAULT 0",
        "email_otp_enabled": "BOOLEAN NOT NULL DEFAULT 0",
        "sms_otp_enabled": "BOOLEAN NOT NULL DEFAULT 0",
        "totp_secret": "VARCHAR(512)",
        "pending_totp_secret": "VARCHAR(512)",
        "totp_last_step": "INTEGER",
        "is_private": "BOOLEAN NOT NULL DEFAULT 0",
        "account_visibility": "VARCHAR(20) NOT NULL DEFAULT 'public'",
        "message_privacy": "VARCHAR(20) NOT NULL DEFAULT 'everyone'",
        "comment_privacy": "VARCHAR(20) NOT NULL DEFAULT 'everyone'",
        "show_activity_status": "BOOLEAN NOT NULL DEFAULT 1",
        "activity_visibility": "VARCHAR(20) NOT NULL DEFAULT 'everyone'",
        "content_visibility": "VARCHAR(20) NOT NULL DEFAULT 'everyone'",
    },
}


def migrate_additive_media_columns(engine) -> None:
    """أضف أعمدة OTP والوسائط المفقودة بقيم آمنة، دون إسقاط أو إعادة إنشاء الجداول."""
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())
    for table, additions in ADDITIVE_COLUMNS.items():
        if table not in existing_tables:
            continue
        existing_columns = {column["name"] for column in inspect(engine).get_columns(table)}
        for column, sql_type in additions.items():
            if column in existing_columns:
                continue
            # الأسماء وأنواع SQL تأتي من قائمة ثوابت أعلاه لا من إدخال المستخدم.
            statement = text(f'ALTER TABLE "{table}" ADD COLUMN "{column}" {sql_type}')
            with engine.begin() as connection:
                connection.execute(statement)
            existing_columns.add(column)

    if engine.dialect.name == "sqlite" and "posts" in existing_tables:
        post_columns = {column["name"] for column in inspect(engine).get_columns("posts")}
        with engine.begin() as connection:
            for column in ("circle_id", "challenge_id", "business_id"):
                if column in post_columns:
                    connection.execute(text(f'CREATE INDEX IF NOT EXISTS "ix_posts_{column}" ON "posts" ("{column}")'))
