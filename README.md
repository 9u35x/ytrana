# Ytrana

منصة تواصل اجتماعي عربية — نسخة MVP قابلة للتشغيل محليًا.

Backend/API: **Python + FastAPI + SQLAlchemy + SQLite**
Web: **HTML5 + CSS3 + Vanilla JavaScript**؛ تطبيق الهاتف: **React Native + Expo** لمشروع واحد يستهدف Android وiOS.

---

## 1. تشغيل الخادم الخلفي (Backend)

```bash
cd Ytrana
python -m venv venv
source venv/bin/activate        # على Windows: venv\Scripts\activate

pip install -r requirements.txt

cp .env.example backend/.env
# افتح backend/.env وغيّر SECRET_KEY إلى قيمة عشوائية طويلة وسرية

cd backend
uvicorn main:app --reload --port 8000
```

- سيتم إنشاء قاعدة بيانات `ytrana.db` (SQLite) تلقائيًا عند أول تشغيل.
- توثيق الـ API التفاعلي متاح على: `http://127.0.0.1:8000/docs`
- فحص الصحة: `http://127.0.0.1:8000/api/health`

### الاختبارات المحلية

من جذر المشروع شغّل `pip install -r requirements-test.txt` ثم
`PYTHONPATH=backend:tests python -m pytest tests -q` لتشغيل اختبارات unittest وpytest معًا؛
تنشئ الاختبارات قاعدة بيانات وملفات رفع مؤقتة، ولا تتصل بقاعدة بيانات أو API منشور.
اختبارات عقود الواجهات: `for f in tests/*.cjs mobile/tests/*.cjs; do node "$f" || exit; done`.
فحص أنواع الهاتف: `cd mobile && npm ci && npm run typecheck`.

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

ثم افتح `http://127.0.0.1:5500` في المتصفح. عند تشغيل الواجهة على `localhost`
أو `127.0.0.1` ستستخدم تلقائيًا API المحلي على المنفذ `8000`. أما الواجهة المنشورة
على نطاق آخر فتبقى متصلة بعنوان API المستضاف الحالي المعرّف في `frontend/js/config.js`.

### تطبيق الهاتف (Android وiOS)

```bash
cd mobile
npm ci
cp .env.example .env
npm start
```

على محاكي Android يستخدم التطبيق `10.0.2.2:8000` افتراضيًا، وعلى محاكي iOS يستخدم
`127.0.0.1:8000`. لاختبار هاتف حقيقي، ضع عنوان LAN الذي يمكن للهاتف الوصول إليه في
`mobile/.env` كقيمة `EXPO_PUBLIC_API_BASE` وشغّل الخادم والهاتف على الشبكة نفسها.
الكود الأساسي مشترك بين المنصتين. إصدار المصدر الحالي **0.1.5**؛ ويحتفظ مجلد
`releases/` بحزم Android السابقة، إضافة إلى AAB الإصدار **0.1.5** الموقّع للمراجعة المحلية.
لم يُرفع هذا الإصدار إلى الاستضافة أو Play Console، ولم تُنشر صفحة الخصوصية. يتطلب نشر iOS
حساب Apple Developer وشهادات التوقيع.

أُضيف `mobile/eas.json` لتجهيز مسارين للبناء عبر EAS: `preview` ينتج APK داخليًا
لأندرويد، و`production` ينتج AAB لأندرويد وIPA لـiOS. قبل البناء عيّن
`EXPO_PUBLIC_API_BASE` إلى عنوان API عام يعمل عبر HTTPS، وسجّل الدخول إلى حساب Expo
الذي يملكه صاحب المشروع؛ بناء iOS وتوزيعه يتطلب اعتماد Apple Developer والتوقيع المناسب.
ملف الإعداد وحده لا ينشئ حسابًا ولا يبني أو يرفع أي نسخة إلى متجر.

ملاحظة قبل الإصدار: تدقيق `npm audit` على سلسلة Expo/Metro الحالية يرصد 22 تنبيهًا
انتقاليًا (7 متوسطة و15 عالية). لم يُستخدم `npm audit fix --force` لأنه يقترح خفض Expo
والحزم الأساسية إلى إصدار قديم؛ أعد التدقيق عند صدور إصلاحات متوافقة قبل النشر بالمتاجر.

---

## 3. النشر على خادمك

يتضمن المستودع نشرًا ذاتيًا عبر Docker Compose: API داخلي، واجهة Nginx، وCaddy لإصدار
HTTPS تلقائيًا. تحتاج خادم Linux عليه Docker Engine وDocker Compose plugin، ونطاقًا
تملكه يشير DNS الخاص به إلى عنوان الخادم، مع السماح بالاتصال على المنفذين 80 و443.

للتجربة بلا تكلفة يمكن إنشاء حساب PythonAnywhere Beginner، الذي يعطي نطاقًا فرعيًا
على شكل `username.pythonanywhere.com` إذا كان اسم المستخدم متاحًا. الخطة المجانية
محدودة جدًا (تذكر صفحة الأسعار الرسمية 512MB تخزينًا ونطاقًا تردديًا منخفضًا)، ولا
تمنح نطاقًا مخصصًا؛ لذلك تصلح لاختبار MVP فقط وليست استضافة إنتاجية لفيديوهات أو جمهور كبير.
لن تُنشر المنصة تلقائيًا قبل إعداد حساب يملكه صاحب المشروع والتحقق من توفر الاسم.

انسخ `.env.deploy.example` إلى `.env.production`، وضع نطاقك في `YTRANA_DOMAIN` و
`YTRANA_PUBLIC_URL`، وأنشئ سرًا عشوائيًا باستخدام `openssl rand -hex 32` وضع ناتجه
في `SECRET_KEY`. ثم شغّل من مجلد المشروع:

```bash
docker compose --env-file .env.production up -d --build
docker compose --env-file .env.production logs -f
```

تُحفظ قاعدة SQLite والصور في volume دائم باسم `ytrana_data`، وتُحفظ شهادات TLS في
`caddy_data`. لا تحذف هذه الـvolumes عند التحديث، وأضف نسخًا احتياطية دورية واختبر
استعادتها قبل الاعتماد الإنتاجي. ملف الأسرار مستثنى من Git وDocker build context.

> تأكد أن العنوان الذي تفتح منه الواجهة موجود ضمن `CORS_ORIGINS` في ملف `.env`
> (القيمة الافتراضية تدعم `5500` و`8000`).

لوحة الإدارة متاحة على `admin.html` لأي مستخدم لديه `is_admin = true`.

---

## 4. هيكل المشروع

```
Ytrana/
├── backend/
│   ├── main.py              # نقطة الدخول + تسجيل الـ Routers
│   ├── config.py            # الإعدادات (تُقرأ من .env)
│   ├── create_admin.py      # سكربت ترقية مستخدم إلى admin
│   ├── database/db.py       # اتصال SQLAlchemy + Session
│   ├── models/models.py     # نماذج قاعدة البيانات (ORM)
│   ├── schemas/schemas.py   # Pydantic schemas للتحقق والاستجابات
│   ├── routes/                # auth, users, posts, messages, OTP, circles, challenges, business...
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
│   ├── community.html        # مركز الدوائر والتحديات والأعمال
│   ├── circles.html          # الدوائر العامة والخاصة
│   ├── challenges.html       # التحديات ولوحة المشاركات
│   ├── business.html         # صفحات الأعمال والمنتجات والخدمات
│   ├── notifications.html
│   ├── admin.html            # لوحة إدارة بسيطة
│   ├── media.html             # القصص وReels
│   ├── css/style.css         # Design System الخاص بـ Ytrana
│   └── js/                   # طبقة API، أدوات مساعدة، منطق كل صفحة
│
├── mobile/                   # Expo / React Native لـ Android وiOS (يشمل تبويب المجتمع)
├── tests/                    # اختبارات API والوسائط
├── deploy/                   # إعدادات Nginx وCaddy وDocker
├── uploads/                  # الوسائط المرفوعة (avatars/, posts/, stories/, reels/)
├── .env.example
├── .env.deploy.example
├── requirements.txt
├── requirements-test.txt
└── .gitignore
```

## 5. قاعدة البيانات

الجداول: `users`, `posts`, `comments`, `likes`, `followers`, `notifications`, `reports`,
`stories`, `story_views`, `reels`, `reel_likes`, `reel_views`, `otp_challenges`,
`circles`, `circle_memberships`, `challenges`, `challenge_achievements`,
`business_pages`, `business_products`, `business_follows`, `business_page_views` —
جميعها بعلاقات Foreign Key، وقيود Unique (مثل عدم تكرار الإعجاب أو المتابعة لنفس العنصر)،
وفهارس (Indexes) على الأعمدة الأكثر استخدامًا في البحث والفرز.

## 6. الأمان المطبّق في هذه النسخة

- تشفير كلمات المرور عبر bcrypt (`passlib`).
- مصادقة JWT عديمة الحالة (Stateless)، صلاحية التوكن قابلة للتهيئة.
- تحقق صارم من صحة المدخلات عبر Pydantic (اسم مستخدم، كلمة مرور، طول النصوص...).
- رفع صور آمن: التحقق من نوع الملف الحقيقي، حد أقصى للحجم، وأسماء ملفات عشوائية (uuid)
  لمنع Path Traversal أو تعارض الأسماء.
- القصص تنتهي بعد 24 ساعة وتُزال ملفاتها عند تنظيفها في مسار الخلاصة؛ Reels تتطلب
  تسجيل دخول، وحجم ملفها محدود افتراضيًا إلى 20MB مع فحص ترويسة الحاوية واسم عشوائي.
- CORS مقيّد بعناوين محددة فقط عبر `.env`.
- وسائط الدوائر الخاصة لا تُقدَّم من رابط `/uploads` العام؛ تُعاد عبر API مصادق يعيد
  التحقق من العضوية عند كل طلب، ويُحجب رابط الملف الثابت.
- OTP اختياري للبريد عبر Brevo، أو SMS عبر Twilio Verify، أو تطبيق TOTP، مع رموز أحادية الاستخدام وحد محاولات؛
  لا يبدأ إرسال البريد/SMS قبل ضبط بيانات المزوّد في بيئة النشر، وقد يترتب على SMS رسم من المزوّد.
- كل عمليات التعديل/الحذف تتحقق من ملكية العنصر أو صلاحية admin قبل التنفيذ.
- لا يوجد أي Secret مكتوب داخل الكود؛ كل شيء يُقرأ من `.env`.

## 7. ما تتضمنه هذه النسخة وما لا تتضمنه

الموجود في المستودع: موقع عربي وتطبيق Expo موحد المصدر لـAndroid وiOS، حسابات وملفات
شخصية ومتابعة وبحث محسّن، منشورات وصور وتعليقات وإعجابات، إشعارات ورسائل (Polling)،
حالات مزاجية، إدارة وبلاغات، OTP اختياري (بريد/SMS/TOTP)، قصص/Reels، وميزات المجتمع:
دوائر عامة وخاصة بطلبات موافقة ومحتوى خاص، تحديات يومية/أسبوعية بمشاركة ولوحة ترتيب
وشارات، وصفحات أعمال اجتماعية بمتابعة ومنتجات/خدمات وإحصاءات زيارات. صفحات الأعمال
لا تتضمن سلة شراء أو دفع. **هذه MVP وليست بديلًا مكافئًا لـInstagram**.

حدود Stories/Reels: القصص الحالية نص/صورة (لا يوجد فيديو Story أو دوائر أصدقاء مقربين)،
أما مقطع Reels فحد واجهته 60 ثانية ورفع الخادم 20MB؛ يتم التحقق من ترويسة الملف، لكن
لا يوجد تحرير/ترميز/فحص وسائط/تخزين CDN، كما أن الخادم لا يفرض مدة 60 ثانية على من
يتجاوز التطبيق. قبل الإطلاق العام استخدم تخزين كائنات خاصًا، ترميزًا وفحصًا في الخلفية،
حدود معدل/حصص، نسخًا احتياطية، ومراقبة وإشرافًا. لا تُعامل تخزين الملفات المحلي على خادم
مجاني على أنه تخزين إنتاجي.

إعداد PythonAnywhere الحالي وعنوان API المنشور حُفظا دون تغيير أثناء هذه التعديلات؛
هذه النسخة المحلية **لم تُرفع إلى الاستضافة**، لذلك يلزم اختبارها ونشرها هناك بقرار المالك.
ملفات Docker للنشر الذاتي اختيار إضافي وليست بديلاً عن الاستضافة الحالية.
إعداد مصدر الهاتف الحالي **0.1.7** و`android.versionCode` هو **8**.
حزم APK/AAB السابقة ومفاتيح توقيعها تبقى محليًا خارج Git؛ تعديل المصدر هنا لا يحدّثها تلقائيًا.
لم يُبنَ أو يُنشر APK/AAB/IPA جديد ضمن تطوير النجوم.
مقترحات مستقبلية لـYtrana (ليست منجزة هنا): اقتراح منشورات بحسب تقارب المزاج مع زر إيقاف،
ترجمة عربية اختيارية تحافظ على اللهجة، دوائر أصدقاء مؤقتة، حفظ المسودات، ومشاركة القصص
مع جمهور مخصص. **تسليم OTP عبر البريد/SMS يتطلب ضبط Brevo أو Twilio Verify وبياناتهما**؛ أما TOTP فيُعدّ داخل التطبيق. تبقى الإشعارات الفورية والبث المباشر والقصص
المصورة بالفيديو والصوت/المؤثرات خارج MVP.
