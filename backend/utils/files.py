"""
أدوات آمنة لرفع الصور والفيديوهات وحذفها.
يُتحقق من نوع MIME ومحتوى الصورة الفعلي والحجم والأبعاد قبل حفظها.
"""
import io
import logging
import os
import uuid
import warnings
from pathlib import Path, PurePosixPath
from urllib.parse import urlsplit

from fastapi import HTTPException, UploadFile, status
from PIL import Image, UnidentifiedImageError

from config import settings

logger = logging.getLogger(__name__)

ALLOWED_IMAGE_TYPES = {
    "image/jpeg": (".jpg", "JPEG"),
    "image/png": (".png", "PNG"),
    "image/webp": (".webp", "WEBP"),
    "image/gif": (".gif", "GIF"),
}
MAX_IMAGE_PIXELS = 40_000_000


def _bad_image(detail: str = "محتوى الملف ليس صورة صالحة أو لا يطابق نوعه المعلن"):
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)


async def save_image(upload_file: UploadFile, subfolder: str) -> str:
    """يتحقق من الملف ثم يحفظ نسخة باسم عشوائي داخل مجلد الرفع المسموح."""
    if subfolder not in {"avatars", "posts", "stories", "circles", "business"}:
        raise HTTPException(status_code=400, detail="مسار رفع غير صالح")

    declared_type = upload_file.content_type or ""
    if declared_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="نوع الملف غير مدعوم. الأنواع المسموحة: JPEG, PNG, WEBP, GIF",
        )

    max_bytes = max(1, settings.max_upload_mb) * 1024 * 1024
    contents = bytearray()
    while True:
        # اقرأ على دفعات، ولا تسمح بتحميل ملف غير محدود إلى الذاكرة.
        chunk = await upload_file.read(min(64 * 1024, max_bytes + 1 - len(contents)))
        if not chunk:
            break
        contents.extend(chunk)
        if len(contents) > max_bytes:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"حجم الملف يتجاوز الحد الأقصى المسموح ({settings.max_upload_mb}MB)",
            )

    if not contents:
        raise HTTPException(status_code=400, detail="الملف فارغ")

    extension, expected_format = ALLOWED_IMAGE_TYPES[declared_type]
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(contents)) as image:
                if image.format != expected_format:
                    raise _bad_image()
                if image.width < 1 or image.height < 1 or image.width * image.height > MAX_IMAGE_PIXELS:
                    raise _bad_image("أبعاد الصورة أكبر من الحد المسموح")
                image.verify()
    except HTTPException:
        raise
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise _bad_image() from None

    filename = f"{uuid.uuid4().hex}{extension}"
    target_dir = Path(settings.upload_dir) / subfolder
    target_dir.mkdir(parents=True, exist_ok=True)
    target_path = target_dir / filename
    with target_path.open("xb") as output:
        output.write(contents)

    return f"/uploads/{subfolder}/{filename}"


def delete_image(relative_url: str) -> None:
    """يحذف فقط صورة داخل مجلدي الرفع المعتمدين، ولا يتبع مسارات خارجية."""
    if not isinstance(relative_url, str):
        return
    path = urlsplit(relative_url).path
    parts = PurePosixPath(path).parts
    if len(parts) != 4 or parts[0] != "/" or parts[1] != "uploads" or parts[2] not in {"avatars", "posts", "stories", "circles", "business"}:
        return

    root = Path(settings.upload_dir).resolve()
    folder = (root / parts[2]).resolve()
    if not folder.is_relative_to(root):
        return
    target = (folder / parts[3]).resolve()
    if target.parent != folder or not target.is_relative_to(root):
        return
    try:
        if target.is_file():
            target.unlink()
    except OSError:
        logger.warning("تعذر حذف صورة مرفوعة: %s", target, exc_info=True)


async def save_video(upload_file: UploadFile, subfolder: str = "reels") -> str:
    """يحفظ فيديو MP4/MOV أو WebM محدود الحجم باسم عشوائي؛ يحتاج الإنتاج إلى ترميز/فحص وسائط."""
    if subfolder not in {"posts", "stories", "reels"}:
        raise HTTPException(status_code=400, detail="مسار رفع فيديو غير صالح")
    allowed_types = {"video/mp4", "video/quicktime", "video/webm"}
    declared_type = (upload_file.content_type or "").lower()
    if declared_type not in allowed_types:
        raise HTTPException(status_code=400, detail="الصيغ المدعومة للفيديو هي MP4 أو MOV أو WebM")

    max_bytes = max(1, settings.max_reel_mb) * 1024 * 1024
    contents = bytearray()
    while True:
        chunk = await upload_file.read(min(64 * 1024, max_bytes + 1 - len(contents)))
        if not chunk:
            break
        contents.extend(chunk)
        if len(contents) > max_bytes:
            raise HTTPException(status_code=400, detail=f"الفيديو يتجاوز الحد الأقصى ({settings.max_reel_mb}MB)")

    is_webm = bytes(contents[:4]) == b"\x1a\x45\xdf\xa3"
    is_iso_bmff = len(contents) >= 12 and bytes(contents[4:8]) == b"ftyp"
    if not contents or (declared_type == "video/webm" and not is_webm) or (declared_type != "video/webm" and not is_iso_bmff):
        raise HTTPException(status_code=400, detail="محتوى الفيديو تالف أو لا يطابق نوع الملف المعلن")

    extension = ".webm" if is_webm else ".mp4"
    filename = f"{uuid.uuid4().hex}{extension}"
    target_dir = Path(settings.upload_dir) / subfolder
    target_dir.mkdir(parents=True, exist_ok=True)
    target_path = target_dir / filename
    with target_path.open("xb") as output:
        output.write(contents)
    return f"/uploads/{subfolder}/{filename}"


def delete_video(relative_url: str) -> None:
    """يحذف فقط فيديو داخل مجلدات الوسائط المعتمدة، ولا يتبع مسارات خارجية أو traversal."""
    if not isinstance(relative_url, str):
        return
    parts = PurePosixPath(urlsplit(relative_url).path).parts
    if len(parts) != 4 or parts[0] != "/" or parts[1] != "uploads" or parts[2] not in {"posts", "stories", "reels"}:
        return
    root = Path(settings.upload_dir).resolve()
    folder = (root / parts[2]).resolve()
    target = (folder / parts[3]).resolve()
    if not folder.is_relative_to(root) or target.parent != folder or not target.is_relative_to(root):
        return
    try:
        if target.is_file():
            target.unlink()
    except OSError:
        logger.warning("تعذر حذف فيديو مرفوع: %s", target, exc_info=True)
