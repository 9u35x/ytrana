"""
نقطة الدخول الرئيسية لتطبيق Ytrana API.
"""
import os

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError

from config import settings
from database.db import Base, engine
from models import models  # noqa: F401  (يضمن تسجيل كل النماذج قبل create_all)

from routes import auth, users, posts, comments, notifications, reports, admin, messages, moods

# إنشاء الجداول إن لم تكن موجودة (لبيئة SQLite / MVP الحالية)
Base.metadata.create_all(bind=engine)

# التأكد من وجود مجلدات الرفع
os.makedirs(os.path.join(settings.upload_dir, "avatars"), exist_ok=True)
os.makedirs(os.path.join(settings.upload_dir, "posts"), exist_ok=True)

app = FastAPI(
    title="Ytrana API",
    description="واجهة برمجية لمنصة التواصل الاجتماعي Ytrana",
    version="0.1.0",
)

# CORS آمن: يسمح فقط بالمصادر المحددة في .env
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

# تقديم ملفات الصور المرفوعة بشكل ثابت
app.mount("/uploads", StaticFiles(directory=settings.upload_dir), name="uploads")


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


@app.get("/api/health")
def health_check():
    return {"status": "ok", "app": settings.app_name}
