import React from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { API_BASE } from '../api';
import { Panel } from '../components';
import { colors } from '../theme';
import type { TabParamList } from '../navigation';

type Props = BottomTabScreenProps<TabParamList, 'PrivacyPolicy'>;

export default function PrivacyPolicyScreen({ navigation }: Props) {
  async function openPublicPolicy() {
    try { await Linking.openURL(`${API_BASE}/privacy.html`); } catch { /* يظل النص الكامل متاحًا داخل التطبيق. */ }
  }

  async function openPublicDeletionInfo() {
    try { await Linking.openURL(`${API_BASE}/account-deletion.html`); } catch { /* تبقى خطوات الحذف داخل التطبيق متاحة. */ }
  }

  async function openSupportEmail() {
    try { await Linking.openURL('mailto:300asq@gmail.com'); } catch { /* يظل عنوان الدعم ظاهرًا للمستخدم. */ }
  }

  return <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
    <Panel>
      <Text style={styles.title}>سياسة الخصوصية — Ytrana</Text>
      <Text style={styles.meta}>آخر تحديث: 11 أكتوبر 2026</Text>
      <Text style={styles.paragraph}>توضح هذه السياسة البيانات التي تعالجها Ytrana عند استخدام التطبيق أو الموقع، وأغراض المعالجة وخياراتك. تنطبق على الخدمات والميزات المتاحة في النسخة الحالية.</Text>
    </Panel>

    <PolicySection title="البيانات التي نعالجها">
      <Text>• بيانات الحساب: اسم المستخدم، البريد الإلكتروني، الاسم، كلمة المرور (تُحفظ بصيغة تجزئة لا كنص مقروء)، وتاريخ إنشاء الحساب.</Text>
      <Text>• بيانات اختيارية للملف والحماية: النبذة، الصورة الشخصية، رقم الهاتف عند تفعيل SMS، إعدادات التحقق بخطوتين، وأسرار تطبيق المصادقة المشفّرة.</Text>
      <Text>• ما تضيفه أو تتفاعل معه: المنشورات والتعليقات والرسائل المباشرة والصور والفيديوهات والقصص ومقاطع Reels والحالة المزاجية وملاحظتها، المتابعات والإعجابات والإشعارات ومشاهدات المحتوى.</Text>
      <Text>• بحسب الميزة المستخدمة: أسماء الدوائر ووصفها وعضويتها، بيانات صفحات الأعمال والمنتجات ووسائل اتصالها الاختيارية، إنجازات التحديات، والبلاغات وأسبابها.</Text>
      <Text>• معلومات تشغيلية: سجلات رموز التحقق ومحاولاتها وبيانات الطلب اللازمة لتقديم الخدمة. قد تعالج الاستضافة بيانات اتصال تقنية مثل عنوان IP ضمن سجلاتها.</Text>
    </PolicySection>

    <PolicySection title="كيف نستخدم البيانات">
      <Text>نستخدمها لإنشاء الحساب وتشغيل الملف الشخصي وميزات المجتمع والمراسلة والمحتوى، والتحقق من الهوية وتأمين الحساب، وإرسال رمز تحقق عند اختيار البريد أو SMS، ومعالجة البلاغات وإدارة إساءة الاستخدام وتشخيص أعطال الخدمة.</Text>
    </PolicySection>

    <PolicySection title="الظهور والمشاركة مع أطراف أخرى">
      <Text>قد يكون اسم المستخدم والاسم والصورة والنبذة والمحتوى الذي تنشره ظاهرًا لمستخدمي Ytrana الآخرين بحسب الميزة. تُقيّد وسائط الدوائر الخاصة بالعضوية وفق إعدادات الدائرة؛ تجنب نشر ما لا تريد مشاركته، وقد يحتفظ الآخرون بنسخ خارج الخدمة مثل لقطات الشاشة.</Text>
      <Text>تُستضاف النسخة الحالية على PythonAnywhere. عند تفعيل التحقق بالبريد قد يُرسل عنوان البريد ورمز التحقق إلى Brevo، وعند تفعيل SMS قد يُرسل رقم الهاتف ورمز التحقق إلى Twilio Verify. لا تستخدم هذه الخدمات إلا للوظيفة التي تطلبها وعندما تكون إعداداتها مفعّلة. تخضع معالجة مزودي الخدمة لسياساتهم.</Text>
      <Text>لا تتضمن حزمة التطبيق الحالية SDK للإعلانات أو التحليلات، ولا تجمع موقعك الجغرافي عبر أذونات التطبيق. لا تبيع Ytrana بيانات الحساب.</Text>
    </PolicySection>

    <PolicySection title="الصور والصلاحيات وأمن الحساب">
      <Text>يطلب التطبيق إذن مكتبة الصور عند اختيار صورة أو فيديو للمشاركة؛ لا يرفع ملفات المكتبة تلقائيًا. ينسخ الملف المختار مؤقتًا إلى مساحة التخزين المؤقت لإرساله ثم يحذف النسخة المؤقتة بعد اكتمال الطلب. لا يستخدم الإصدار الحالي مسارًا للتصوير بالكاميرا أو تسجيل الصوت، ولا يطلب إذن الموقع الجغرافي.</Text>
      <Text>في الموقع، تُخزّن جلسة الدخول وبعض بيانات الملف المعروضة واختيار المظهر محليًا في تخزين المتصفح (localStorage). في تطبيق الهاتف تُخزّن جلسة الدخول باستخدام التخزين الآمن للنظام. تُحفظ كلمات المرور مجزّأة، وتُشفّر أسرار تطبيق المصادقة في الخادم. يستخدم عنوان الخدمة الإنتاجي HTTPS.</Text>
    </PolicySection>

    <PolicySection title="الاحتفاظ والحذف">
      <Text>نحتفظ ببيانات الحساب ما دام الحساب قائمًا أو بالقدر اللازم لتقديم الوظائف. يمكنك بدء الحذف من «حسابي ← الإعدادات والخصوصية ← حذف الحساب» في التطبيق، أو من صفحة حذف الحساب خارج التطبيق على موقع Ytrana. يتطلب التأكيد إدخال كلمة المرور الحالية. عند نجاح الطلب يُحذف ملف الحساب والسجلات والمحتوى والوسائط المرتبطة به التي يملكها الحساب، بما فيها وسائط الدوائر وصفحات الأعمال والمنتجات؛ ولا يمكن استعادة الحساب بعد ذلك.</Text>
      <Text>قد تبقى تحديات عامة أُنشئت إداريًا وسجلات بلاغات قدمها مستخدمون آخرون لأغراض السلامة بعد حذف الحساب. وقد تبقى نسخ المحتوى التي حفظها مستخدمون خارج Ytrana.</Text>
      <Text>لا يحدد التطبيق مدة الاحتفاظ بسجلات الاستضافة أو النسخ الاحتياطية التقنية؛ وقد تخضع هذه المدد لإعدادات وسياسة مزود الاستضافة.</Text>
    </PolicySection>

    <PolicySection title="اختياراتك والتواصل">
      <Text>يمكنك تحديث بعض بيانات الملف الشخصي من الإعدادات أو حذف الحساب من التطبيق. للاستفسارات أو طلبات الخصوصية، تواصل عبر البريد الإلكتروني:</Text>
      <Pressable accessibilityRole="link" accessibilityLabel="راسل دعم Ytrana على 300asq@gmail.com" onPress={() => { void openSupportEmail(); }}>
        <Text style={styles.supportEmail}>300asq@gmail.com</Text>
      </Pressable>
    </PolicySection>

    <View style={styles.footerActions}>
      <Pressable accessibilityRole="button" onPress={() => { void openPublicPolicy(); }} style={styles.linkButton}><Text style={styles.linkText}>فتح نسخة الويب العامة</Text></Pressable>
      <Pressable accessibilityRole="link" onPress={() => { void openPublicDeletionInfo(); }} style={styles.linkButton}><Text style={styles.linkText}>إرشادات حذف الحساب خارج التطبيق</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={() => navigation.navigate('Settings')} style={styles.backButton}><Text style={styles.backText}>العودة إلى الإعدادات</Text></Pressable>
    </View>
  </ScrollView>;
}

function PolicySection({ title, children }: React.PropsWithChildren<{ title: string }>) {
  return <Panel style={styles.section}><Text style={styles.sectionTitle}>{title}</Text><View style={styles.sectionContent}>{children}</View></Panel>;
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { paddingTop: 10, paddingBottom: 30 },
  title: { color: colors.ink, fontSize: 21, fontWeight: '900', textAlign: 'right', writingDirection: 'rtl' },
  meta: { color: colors.muted, fontSize: 12, textAlign: 'right', writingDirection: 'rtl', marginTop: 6 },
  paragraph: { color: colors.ink, fontSize: 14, lineHeight: 24, textAlign: 'right', writingDirection: 'rtl', marginTop: 10 },
  section: { gap: 7 },
  sectionTitle: { color: colors.primaryDark, fontSize: 16, fontWeight: '900', textAlign: 'right', writingDirection: 'rtl', marginBottom: 4 },
  sectionContent: { gap: 8 },
  sectionContentText: { color: colors.ink, fontSize: 13, lineHeight: 23, textAlign: 'right', writingDirection: 'rtl' },
  footerActions: { marginHorizontal: 18, gap: 9, marginTop: 5 },
  linkButton: { minHeight: 46, justifyContent: 'center', borderRadius: 14, backgroundColor: colors.soft, paddingHorizontal: 14 },
  linkText: { color: colors.primaryDark, fontSize: 14, fontWeight: '800', textAlign: 'center', writingDirection: 'rtl' },
  backButton: { minHeight: 46, justifyContent: 'center', borderRadius: 14, backgroundColor: colors.primary, paddingHorizontal: 14 },
  backText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800', textAlign: 'center', writingDirection: 'rtl' },
  supportEmail: { color: colors.primaryDark, fontSize: 14, lineHeight: 23, fontWeight: '800', textAlign: 'right', writingDirection: 'ltr', textDecorationLine: 'underline' },
});
