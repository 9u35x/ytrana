"""
أدوات التعامل الآمن مع رفع الملفات (الصور).
"""
import os
import uuid

from fastapi import HTTPException, UploadFile, status

from config import settings

ALLOWED_IMAGE_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
}

MAX_UPLOAD_BYTES = settings.max_upload_mb * 1024 * 1024


async def save_image(upload_file: UploadFile, subfolder: str) -> str:
    """
    يتحقق من نوع وحجم الملف، ثم يحفظه باسم عشوائي آمن (uuid) لمنع
    تعارض الأسماء أو الوصول المباشر لمسارات يمكن التنبؤ بها أو path traversal.
    يُرجع المسار النسبي القابل للاستخدام في عنوان URL.
    """
    if upload_file.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="نوع الملف غير مدعوم. الأنواع المسموحة: JPEG, PNG, WEBP, GIF",
        )

    contents = await upload_file.read()
    if len(contents) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"حجم الملف يتجاوز الحد الأقصى المسموح ({settings.max_upload_mb}MB)",
        )
    if len(contents) == 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="الملف فارغ")

    ext = ALLOWED_IMAGE_TYPES[upload_file.content_type]
    filename = f"{uuid.uuid4().hex}{ext}"

    target_dir = os.path.join(settings.upload_dir, subfolder)
    os.makedirs(target_dir, exist_ok=True)
    target_path = os.path.join(target_dir, filename)

    with open(target_path, "wb") as f:
        f.write(contents)

    return f"/uploads/{subfolder}/{filename}"


def delete_image(relative_url: str) -> None:
    """يحذف ملف صورة سابق من القرص إن وُجد (يُستخدم عند تحديث/حذف الصورة الشخصية أو المنشور)."""
    if not relative_url or not relative_url.startswith("/uploads/"):
        return
    file_path = relative_url.lstrip("/")
    if os.path.isfile(file_path):
        try:
            os.remove(file_path)
        except OSError:
            pass
