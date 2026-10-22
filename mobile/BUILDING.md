# بناء تطبيق Ytrana

- المشروع مبني على Expo SDK 57 وReact Native، وعنوان API الإنتاج مضبوط في `eas.json` على `https://270zw.pythonanywhere.com`.
- حد الصورة الذي يقبله الخادم 5MB؛ حد الفيديو 20MB ولمدة قصوى 60 ثانية. يضغط التطبيق صور HEIC إلى JPEG، ويطلب من iOS تمثيلًا متوافقًا للفيديو.
- فحص الأنواع: `npm run typecheck`.

## Android

ملف `preview` ينتج APK لاختبار التثبيت المباشر:

```bash
npx expo prebuild --platform android
cd android && ./gradlew assembleRelease
```

نسخة الاختبار الحالية تستخدم مفتاح توقيع Android الاختباري الافتراضي، وليست ملف نشر Play Store. إعداد `release` يستخدم مفتاح الإصدار الخاص فقط، ولا يعود إلى مفتاح `debug`.

### بناء إصدار Android موقّع

وفّر القيم `YTRANA_RELEASE_STORE_FILE` و`YTRANA_RELEASE_STORE_PASSWORD` و`YTRANA_RELEASE_KEY_ALIAS` و`YTRANA_RELEASE_KEY_PASSWORD` عبر بيئة بناء آمنة/مدير أسرار؛ لا تضع كلمات المرور في ملفات المشروع أو Git. ثم شغّل:

```bash
cd mobile/android && ./gradlew :app:bundleRelease
```

ينتج الملف `mobile/android/app/build/outputs/bundle/release/app-release.aab`. احتفظ بنسخة محمية من ملف المفتاح نفسه؛ يلزم المفتاح نفسه لتوقيع التحديثات المستقبلية، ويجب زيادة `android.versionCode` قبل كل رفع جديد إلى Play Console.

## iPhone / iOS

تم توليد مشروع Xcode في `ios/` وإعداد ملفي EAS `preview` و`production`، كما نجح تصدير حزمة JavaScript الخاصة بـiOS وربطها بعنوان API الإنتاج. لم يُنشأ IPA: جلسة EAS غير مسجلة في بيئة البناء و`xcodebuild` غير متاح على Linux. لإصدار IPA يلزم تسجيل EAS وعضوية Apple Developer فعالة لإعداد الشهادات وملفات التوزيع.

```bash
eas build --profile preview --platform ios
```

لا يرفع هذا الأمر التطبيق تلقائيًا إلى App Store؛ يلزم إعداد التوزيع ومراجعة Apple بشكل منفصل.

## استخدام مؤقت على iPhone عبر Safari

إلى أن يتوفر IPA موقّع، يمكن فتح [Ytrana](https://270zw.pythonanywhere.com) في Safari ثم اختيار زر المشاركة → «إضافة إلى الشاشة الرئيسية». أضيفت بيانات التطبيق وأيقونته ليُفتح من الشاشة الرئيسية بواجهة مستقلة. هذه نسخة ويب تحتاج اتصالًا بالإنترنت وليست تطبيق iOS أصليًا ولا تُثبت من App Store.
