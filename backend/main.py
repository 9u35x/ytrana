"""
نقطة الدخول الرئيسية لتطبيق Ytrana API.
"""
import os

from fastapi import FastAPI, HTTPException, Request, Depends
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from pathlib import Path
import mimetypes
from sqlalchemy import or_

from config import settings
from database.db import Base, engine, SessionLocal, get_db
from database.migrations import migrate_additive_media_columns
from models import models  # noqa: F401  (يضمن تسجيل كل النماذج قبل create_all)
from models import account as account_models  # noqa: F401
from models.models import Mood, Post, Story, Circle, Reel, User

from routes import auth, users, posts, comments, notifications, reports, admin, messages, moods, stories, reels, circles, challenges, business, private_media, account, stars

# إنشاء الجداول إن لم تكن موجودة (لبيئة SQLite / MVP الحالية)
Base.metadata.create_all(bind=engine)
migrate_additive_media_columns(engine)

# بيانات الأنماط الافتراضية تُضاف فقط عند غيابها، دون استبدال اختيارات محفوظة.
DEFAULT_MOODS = (
    {"key": "happy", "label_ar": "سعيد", "emoji": "😊", "color": "#F2B544"},
    {"key": "sad", "label_ar": "حزين", "emoji": "😢", "color": "#6286C7"},
    {"key": "calm", "label_ar": "هادئ", "emoji": "🌿", "color": "#58A68A"},
    {"key": "energetic", "label_ar": "حيوي", "emoji": "⚡", "color": "#E69B28"},
    {"key": "focused", "label_ar": "مركّز", "emoji": "🎯", "color": "#6C63D9"},
)

with SessionLocal() as db:
    mood_keys = {row[0] for row in db.query(Mood.key).all()}
    for mood_data in DEFAULT_MOODS:
        if mood_data["key"] not in mood_keys:
            db.add(Mood(**mood_data))
    db.commit()

# التأكد من وجود مجلدات الرفع
os.makedirs(os.path.join(settings.upload_dir, "avatars"), exist_ok=True)
os.makedirs(os.path.join(settings.upload_dir, "posts"), exist_ok=True)
os.makedirs(os.path.join(settings.upload_dir, "stories"), exist_ok=True)
os.makedirs(os.path.join(settings.upload_dir, "reels"), exist_ok=True)
os.makedirs(os.path.join(settings.upload_dir, "circles"), exist_ok=True)
os.makedirs(os.path.join(settings.upload_dir, "business"), exist_ok=True)

app = FastAPI(
    title="Ytrana API",
    description="واجهة برمجية لمنصة التواصل الاجتماعي Ytrana",
    version="0.1.7",
)

# CORS آمن: يسمح فقط بالمصادر المحددة في .env
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

@app.get("/uploads/{folder}/{filename}")
def serve_upload(folder: str, filename: str, db=Depends(get_db)):
    """الملفات الخاصة لا تُقدَّم عبر رابط ثابت؛ تمر عبر API يتطلب جلسة وعضوية."""
    if folder not in {"avatars", "posts", "stories", "reels", "circles", "business"} or filename in {".", ".."} or "/" in filename:
        raise HTTPException(status_code=404, detail="الملف غير موجود")
    relative_url = f"/uploads/{folder}/{filename}"
    private_post = db.query(Post.id).join(Circle, Post.circle_id == Circle.id).filter(
        Circle.is_private == True, or_(Post.image_url == relative_url, Post.video_url == relative_url)
    ).first()  # noqa: E712
    blocked_post = db.query(Post.id).join(User, Post.author_id == User.id).filter(
        or_(Post.image_url == relative_url, Post.video_url == relative_url),
        (Post.is_archived == True) | (User.content_visibility != "everyone") | (User.account_visibility == "private"),
    ).first()  # noqa: E712
    blocked_story = db.query(Story.id).join(User, Story.author_id == User.id).filter(
        or_(Story.image_url == relative_url, Story.video_url == relative_url),
        (Story.is_archived == True) | (Story.expires_at <= __import__("datetime").datetime.utcnow()) | (User.content_visibility != "everyone") | (User.account_visibility == "private"),
    ).first()  # noqa: E712
    blocked_reel = db.query(Reel.id).join(User, Reel.author_id == User.id).filter(
        Reel.video_url == relative_url, (User.account_visibility == "private") | (User.content_visibility != "everyone")
    ).first()
    if blocked_reel:
        raise HTTPException(status_code=404, detail="الملف غير موجود")
    private_circle = db.query(Circle.id).filter(
        Circle.is_private == True, or_(Circle.image_url == relative_url, Circle.cover_url == relative_url)
    ).first()  # noqa: E712
    if private_post or private_circle or blocked_post or blocked_story:
        raise HTTPException(status_code=404, detail="الملف غير موجود")
    root = Path(settings.upload_dir).resolve()
    target = (root / folder / filename).resolve()
    if target.parent != (root / folder).resolve() or not target.is_relative_to(root) or not target.is_file():
        raise HTTPException(status_code=404, detail="الملف غير موجود")
    return FileResponse(target, media_type=mimetypes.guess_type(str(target))[0] or "application/octet-stream")


# الملفات العامة فقط؛ المسار أعلاه يمنع تقديم ملفات الدوائر الخاصة عبر URL ثابت.


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """تحويل أخطاء التحقق (Pydantic) إلى رسالة عربية واضحة وموحدة الشكل."""
    first_error = exc.errors()[0] if exc.errors() else {}
    message = first_error.get("msg", "بيانات غير صالحة")
    return JSONResponse(status_code=422, content={"detail": message})


app.include_router(auth.router)
app.include_router(users.router)
app.include_router(posts.router)
app.include_router(comments.router)
app.include_router(notifications.router)
app.include_router(reports.router)
app.include_router(admin.router)
app.include_router(messages.router)
app.include_router(moods.router)
app.include_router(stories.router)
app.include_router(reels.router)
app.include_router(circles.router)
app.include_router(challenges.router)
app.include_router(business.router)
app.include_router(private_media.router)
app.include_router(account.router)
app.include_router(stars.router)


@app.get("/api/health")
def health_check():
    return {"status": "ok", "app": settings.app_name}


# عند الاستضافة دون Nginx منفصل، قدّم صفحات الموقع من نفس النطاق بعد مسارات API.
FRONTEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend"))
if os.path.isdir(FRONTEND_DIR):
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
