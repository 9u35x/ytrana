# Ytrana

منصة تواصل اجتماعي — نسخة MVP.

Backend: **Python + FastAPI + SQLAlchemy + SQLite**
Frontend: **HTML5 + CSS3 + Vanilla JavaScript** (بدون أي إطار عمل أو خدمة مدفوعة)

---

## 1. تشغيل الخادم الخلفي (Backend)

```bash
cd Ytrana
python -m venv venv
source venv/bin/activate        # على Windows: venv\Scripts\activate

pip install -r requirements.txt

cp .env.example .env
# افتح .env وغيّر SECRET_KEY إلى قيمة عشوائية طويلة وسرية

cd backend
uvicorn main:app --reload --port 8000
```

- سيتم إنشاء قاعدة بيانات `ytrana.db` (SQLite) تلقائيًا عند أول تشغيل.
- توثيق الـ API التفاعلي متاح على: `http://127.0.0.1:8000/docs`
- فحص الصحة: `http://127.0.0.1:8000/api/health`

### إنشاء أول حساب Admin

لا يوجد مسار API عام لإنشاء admin (لأسباب أمنية). بعد تسجيل حساب عادي من الواجهة:

```bash
cd backend
python create_admin.py <username>
```

---

## 2. تشغيل الواجهة الأمامية (Frontend)

الواجهة عبارة عن ملفات HTML/CSS/JS ثابتة، يمكن تشغيلها بأي خادم ملفات ثابت. الأسهل هو
إضافة (Live Server) في VS Code، أو:

```bash
cd frontend
python -m http.server 5500
```

ثم افتح `http://127.0.0.1:5500` في المتصفح.

> تأكد أن العنوان الذي تفتح منه الواجهة موجود ضمن `CORS_ORIGINS` في ملف `.env`
> (القيمة الافتراضية تدعم `5500` و`8000`).

لوحة الإدارة متاحة على `admin.html` لأي مستخدم لديه `is_admin = true`.

---

## 3. هيكل المشروع

```
Ytrana/
├── backend/
│   ├── main.py              # نقطة الدخول + تسجيل الـ Routers
│   ├── config.py            # الإعدادات (تُقرأ من .env)
│   ├── create_admin.py      # سكربت ترقية مستخدم إلى admin
│   ├── database/db.py       # اتصال SQLAlchemy + Session
│   ├── models/models.py     # نماذج قاعدة البيانات (ORM)
│   ├── schemas/schemas.py   # Pydantic schemas للتحقق والاستجابات
│   ├── routes/              # auth, users, posts, comments, notifications, reports, admin
│   ├── services/            # منطق العمل (auth_service...)
│   ├── middleware/          # auth_dependency (JWT + صلاحيات)
│   └── utils/                # security (تشفير/JWT), files (رفع صور آمن)
│
├── frontend/
│   ├── index.html            # الصفحة الرئيسية (Feed)
│   ├── login.html / register.html
│   ├── profile.html          # الملف الشخصي + المتابعون/يتابع
│   ├── settings.html         # تعديل الحساب، كلمة المرور، حذف الحساب
│   ├── search.html           # البحث عن مستخدمين
│   ├── notifications.html
│   ├── admin.html            # لوحة إدارة بسيطة
│   ├── css/style.css         # Design System الخاص بـ Ytrana
│   └── js/                   # طبقة API، أدوات مساعدة، منطق كل صفحة
│
├── uploads/                  # الصور المرفوعة (avatars/, posts/)
├── .env.example
├── requirements.txt
└── .gitignore
```

## 4. قاعدة البيانات

الجداول: `users`, `posts`, `comments`, `likes`, `followers`, `notifications`, `reports` —
جميعها بعلاقات Foreign Key، وقيود Unique (مثل عدم تكرار الإعجاب أو المتابعة لنفس العنصر)،
وفهارس (Indexes) على الأعمدة الأكثر استخدامًا في البحث والفرز.

## 5. الأمان المطبّق في هذه النسخة

- تشفير كلمات المرور عبر bcrypt (`passlib`).
- مصادقة JWT عديمة الحالة (Stateless)، صلاحية التوكن قابلة للتهيئة.
- تحقق صارم من صحة المدخلات عبر Pydantic (اسم مستخدم، كلمة مرور، طول النصوص...).
- رفع صور آمن: التحقق من نوع الملف الحقيقي، حد أقصى للحجم، وأسماء ملفات عشوائية (uuid)
  لمنع Path Traversal أو تعارض الأسماء.
- CORS مقيّد بعناوين محددة فقط عبر `.env`.
- كل عمليات التعديل/الحذف تتحقق من ملكية العنصر أو صلاحية admin قبل التنفيذ.
- لا يوجد أي Secret مكتوب داخل الكود؛ كل شيء يُقرأ من `.env`.

## 6. خارطة الطريق

هذه نسخة **MVP** فقط. البنية مصممة لتتوسع لاحقًا نحو PostgreSQL، Redis، WebSockets
(رسائل خاصة، حالة الاتصال)، تخزين سحابي للصور، Docker، وتطبيقات الجوال — دون الحاجة
لإعادة كتابة الأساس الحالي.
