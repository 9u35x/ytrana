from services.moderation import is_platform_admin
"""صفحات أعمال اجتماعية قابلة للتطوير؛ لا توجد سلة شراء أو مدفوعات."""
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import func, or_
from sqlalchemy.orm import Session, joinedload

from database.db import get_db
from middleware.auth_dependency import get_current_user, get_current_user_optional
from models.models import BusinessFollow, BusinessPage, BusinessPageView, BusinessProduct, Comment, Like, Post, User
from schemas.schemas import BusinessProductInput, Message
from utils.files import delete_image, save_image
from routes.posts import _serialize_post
from services.content_access import can_view_account_content, can_view_post

router = APIRouter(prefix="/api/business", tags=["Business"])


def _public_user(user: User) -> dict:
    return {"id": user.id, "username": user.username, "full_name": user.full_name,
            "bio": "" if user.account_visibility == "private" else user.bio,
            "avatar_url": user.avatar_url, "created_at": user.created_at}


def _product_out(product: BusinessProduct) -> dict:
    return {"id": product.id, "page_id": product.page_id, "name": product.name,
            "description": product.description, "image_url": product.image_url,
            "price": product.price, "created_at": product.created_at, "updated_at": product.updated_at}


def _page_out(db: Session, page: BusinessPage, viewer: User | None) -> dict:
    followers_count = db.query(func.count(BusinessFollow.id)).filter(BusinessFollow.page_id == page.id).scalar() or 0
    views_count = db.query(func.count(BusinessPageView.id)).filter(BusinessPageView.page_id == page.id).scalar() or 0
    posts_count = db.query(func.count(Post.id)).filter(Post.business_id == page.id).scalar() or 0
    products_count = db.query(func.count(BusinessProduct.id)).filter(BusinessProduct.page_id == page.id).scalar() or 0
    likes_count = db.query(func.count(Like.id)).join(Post, Like.post_id == Post.id).filter(Post.business_id == page.id).scalar() or 0
    comments_count = db.query(func.count(Comment.id)).join(Post, Comment.post_id == Post.id).filter(Post.business_id == page.id).scalar() or 0
    is_owner = bool(viewer and viewer.id == page.owner_id)
    is_followed = bool(viewer and db.query(BusinessFollow.id).filter(
        BusinessFollow.page_id == page.id, BusinessFollow.user_id == viewer.id
    ).first())
    return {
        "id": page.id, "name": page.name, "description": page.description,
        "image_url": page.image_url, "cover_url": page.cover_url,
        "contact_email": page.contact_email, "contact_phone": page.contact_phone,
        "website_url": page.website_url, "is_active": page.is_active,
        "created_at": page.created_at, "updated_at": page.updated_at,
        "owner": _public_user(page.owner), "followers_count": followers_count,
        "views_count": views_count, "posts_count": posts_count,
        "likes_count": likes_count, "comments_count": comments_count,
        "products_count": products_count, "is_followed_by_me": is_followed,
        "is_owner": is_owner,
    }


def _get_page(db: Session, page_id: int) -> BusinessPage:
    page = db.query(BusinessPage).options(joinedload(BusinessPage.owner)).filter(BusinessPage.id == page_id).first()
    if not page:
        raise HTTPException(status_code=404, detail="صفحة النشاط غير موجودة")
    if not page.is_active:
        raise HTTPException(status_code=404, detail="صفحة النشاط غير متاحة")
    return page


def _require_owner(page: BusinessPage, user: User) -> None:
    if page.owner_id != user.id and not is_platform_admin(user):
        raise HTTPException(status_code=403, detail="لا يمكنك تعديل صفحة أعمال لا تملكها")


@router.get("/pages")
def discover_business_pages(q: str = "", skip: int = 0, limit: int = 20, db: Session = Depends(get_db), viewer: User | None = Depends(get_current_user_optional)):
    skip, limit = max(0, min(skip, 1_000_000)), max(1, min(limit, 50))
    query = db.query(BusinessPage).options(joinedload(BusinessPage.owner)).filter(BusinessPage.is_active == True)  # noqa: E712
    term = q.strip()[:120]
    if term:
        query = query.filter(or_(BusinessPage.name.contains(term, autoescape=True), BusinessPage.description.contains(term, autoescape=True)))
    rows = query.order_by(BusinessPage.created_at.desc()).offset(skip).limit(limit).all()
    return [_page_out(db, page, viewer) for page in rows]


@router.get("/pages/mine")
def my_business_page(db: Session = Depends(get_db), viewer: User = Depends(get_current_user)):
    page = db.query(BusinessPage).options(joinedload(BusinessPage.owner)).filter(BusinessPage.owner_id == viewer.id).first()
    return _page_out(db, page, viewer) if page else None


@router.post("/pages")
async def create_business_page(
    name: str = Form(...), description: str = Form(""), contact_email: str | None = Form(None),
    contact_phone: str | None = Form(None), website_url: str | None = Form(None),
    image: UploadFile | None = File(None), cover: UploadFile | None = File(None),
    db: Session = Depends(get_db), viewer: User = Depends(get_current_user),
):
    if db.query(BusinessPage.id).filter(BusinessPage.owner_id == viewer.id).first():
        raise HTTPException(status_code=409, detail="لديك صفحة أعمال بالفعل؛ يمكنك تعديلها")
    name, description = name.strip(), description.strip()
    if not 2 <= len(name) <= 120 or len(description) > 2000:
        raise HTTPException(status_code=422, detail="تحقق من اسم النشاط ووصفه")
    image_url = cover_url = None
    try:
        if image and image.filename:
            image_url = await save_image(image, "business")
        if cover and cover.filename:
            cover_url = await save_image(cover, "business")
        page = BusinessPage(
            owner_id=viewer.id, name=name, description=description,
            contact_email=(contact_email or "").strip() or None,
            contact_phone=(contact_phone or "").strip() or None,
            website_url=(website_url or "").strip() or None,
            image_url=image_url, cover_url=cover_url,
        )
        db.add(page)
        db.commit()
        db.refresh(page)
        return _page_out(db, page, viewer)
    except Exception:
        db.rollback()
        if image_url:
            delete_image(image_url)
        if cover_url:
            delete_image(cover_url)
        raise


@router.get("/pages/{page_id}")
def get_business_page(page_id: int, db: Session = Depends(get_db), viewer: User | None = Depends(get_current_user_optional)):
    page = _get_page(db, page_id)
    if viewer and viewer.id != page.owner_id:
        exists = db.query(BusinessPageView.id).filter(
            BusinessPageView.page_id == page.id, BusinessPageView.viewer_id == viewer.id
        ).first()
        if not exists:
            db.add(BusinessPageView(page_id=page.id, viewer_id=viewer.id))
            db.commit()
    return _page_out(db, page, viewer)


@router.put("/pages/{page_id}")
def update_business_page(
    page_id: int, name: str | None = Form(None), description: str | None = Form(None),
    contact_email: str | None = Form(None), contact_phone: str | None = Form(None), website_url: str | None = Form(None),
    db: Session = Depends(get_db), viewer: User = Depends(get_current_user),
):
    page = _get_page(db, page_id)
    _require_owner(page, viewer)
    if name is not None:
        name = name.strip()
        if not 2 <= len(name) <= 120:
            raise HTTPException(status_code=422, detail="اسم النشاط غير صالح")
        page.name = name
    if description is not None:
        description = description.strip()
        if len(description) > 2000:
            raise HTTPException(status_code=422, detail="وصف النشاط طويل جدًا")
        page.description = description
    for field, value in (("contact_email", contact_email), ("contact_phone", contact_phone), ("website_url", website_url)):
        if value is not None:
            setattr(page, field, value.strip() or None)
    db.commit()
    db.refresh(page)
    return _page_out(db, page, viewer)


@router.put("/pages/{page_id}/archive", response_model=Message)
def archive_business_page(page_id: int, db: Session = Depends(get_db), viewer: User = Depends(get_current_user)):
    page = db.query(BusinessPage).filter(BusinessPage.id == page_id).first()
    if not page:
        raise HTTPException(status_code=404, detail="صفحة النشاط غير موجودة")
    _require_owner(page, viewer)
    page.is_active = False
    db.commit()
    return Message(message="تم إيقاف الصفحة مؤقتًا مع الاحتفاظ ببياناتها")


@router.put("/pages/{page_id}/restore", response_model=Message)
def restore_business_page(page_id: int, db: Session = Depends(get_db), viewer: User = Depends(get_current_user)):
    page = db.query(BusinessPage).filter(BusinessPage.id == page_id).first()
    if not page:
        raise HTTPException(status_code=404, detail="صفحة النشاط غير موجودة")
    _require_owner(page, viewer)
    page.is_active = True
    db.commit()
    return Message(message="تمت إعادة تفعيل الصفحة")


@router.post("/pages/{page_id}/follow", response_model=Message)
def follow_business(page_id: int, db: Session = Depends(get_db), viewer: User = Depends(get_current_user)):
    page = _get_page(db, page_id)
    if page.owner_id == viewer.id:
        raise HTTPException(status_code=400, detail="لا يمكنك متابعة صفحة نشاطك")
    if db.query(BusinessFollow.id).filter(BusinessFollow.page_id == page.id, BusinessFollow.user_id == viewer.id).first():
        raise HTTPException(status_code=400, detail="أنت تتابع هذه الصفحة بالفعل")
    db.add(BusinessFollow(page_id=page.id, user_id=viewer.id))
    db.commit()
    return Message(message="أصبحت تتابع صفحة النشاط")


@router.delete("/pages/{page_id}/follow", response_model=Message)
def unfollow_business(page_id: int, db: Session = Depends(get_db), viewer: User = Depends(get_current_user)):
    follow = db.query(BusinessFollow).filter(BusinessFollow.page_id == page_id, BusinessFollow.user_id == viewer.id).first()
    if not follow:
        raise HTTPException(status_code=404, detail="لا تتابع هذه الصفحة")
    db.delete(follow)
    db.commit()
    return Message(message="تم إلغاء متابعة الصفحة")


@router.get("/pages/{page_id}/products")
def list_products(page_id: int, db: Session = Depends(get_db)):
    _get_page(db, page_id)
    products = db.query(BusinessProduct).filter(BusinessProduct.page_id == page_id).order_by(BusinessProduct.created_at.desc()).limit(100).all()
    return [_product_out(product) for product in products]


@router.post("/pages/{page_id}/products")
def create_product(page_id: int, data: BusinessProductInput, db: Session = Depends(get_db), viewer: User = Depends(get_current_user)):
    page = _get_page(db, page_id)
    _require_owner(page, viewer)
    product = BusinessProduct(page_id=page.id, **data.model_dump())
    db.add(product)
    db.commit()
    db.refresh(product)
    return _product_out(product)


@router.get("/products/{product_id}")
def get_product(product_id: int, db: Session = Depends(get_db)):
    product = db.query(BusinessProduct).options(joinedload(BusinessProduct.page)).filter(BusinessProduct.id == product_id).first()
    if not product or not product.page.is_active:
        raise HTTPException(status_code=404, detail="المنتج أو الخدمة غير موجودة")
    return _product_out(product)


@router.put("/products/{product_id}")
def update_product(product_id: int, data: BusinessProductInput, db: Session = Depends(get_db), viewer: User = Depends(get_current_user)):
    product = db.query(BusinessProduct).options(joinedload(BusinessProduct.page)).filter(BusinessProduct.id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="المنتج أو الخدمة غير موجودة")
    _require_owner(product.page, viewer)
    for field, value in data.model_dump().items():
        setattr(product, field, value)
    db.commit()
    db.refresh(product)
    return _product_out(product)


@router.delete("/products/{product_id}", response_model=Message)
def delete_product(product_id: int, db: Session = Depends(get_db), viewer: User = Depends(get_current_user)):
    product = db.query(BusinessProduct).options(joinedload(BusinessProduct.page)).filter(BusinessProduct.id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="المنتج أو الخدمة غير موجودة")
    _require_owner(product.page, viewer)
    db.delete(product)
    db.commit()
    return Message(message="تم حذف البطاقة")


@router.get("/pages/{page_id}/posts")
def business_posts(page_id: int, skip: int = 0, limit: int = 20, db: Session = Depends(get_db), viewer: User | None = Depends(get_current_user_optional)):
    _get_page(db, page_id)
    posts = [p for p in db.query(Post).options(joinedload(Post.author)).filter(Post.business_id == page_id, Post.is_archived.is_(False)).order_by(Post.created_at.desc()).all() if can_view_post(db, p, viewer)]
    start = max(skip, 0); return [_serialize_post(db, post, viewer) for post in posts[start:start + max(1, min(limit, 50))]]
