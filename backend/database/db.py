"""
إعداد الاتصال بقاعدة البيانات باستخدام SQLAlchemy.
مصمم بحيث يمكن استبدال SQLite بـ PostgreSQL لاحقًا بدون تغيير باقي الكود
(فقط تغيير DATABASE_URL في ملف .env).
"""
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, declarative_base

from config import settings

connect_args = {}
if settings.database_url.startswith("sqlite"):
    connect_args = {"check_same_thread": False}

engine = create_engine(settings.database_url, connect_args=connect_args)

if settings.database_url.startswith("sqlite"):
    @event.listens_for(engine, "connect")
    def _enable_sqlite_foreign_keys(connection, _record):
        cursor = connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db():
    """Dependency لتوفير جلسة قاعدة بيانات لكل طلب، مع إغلاقها تلقائيًا بعد الانتهاء."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
