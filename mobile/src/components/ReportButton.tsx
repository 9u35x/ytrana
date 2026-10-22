import React, { useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { reportCategories, submitReport, type ReportCategory } from '../adminApi';
import { useAuth } from '../auth';
import { PrimaryButton, SecondaryButton, TextField } from '../components';
import { colors } from '../theme';

const targetLabels: Record<string, string> = { user: 'المستخدم', profile: 'الملف الشخصي', post: 'المنشور', comment: 'التعليق', reel: 'الريل', story: 'القصة', message: 'الرسالة' };
export default function ReportButton({ targetType, targetId, label = 'إبلاغ' }: { targetType: string; targetId: number; label?: string }) {
  const { token } = useAuth();
  const [open, setOpen] = useState(false); const [category, setCategory] = useState<ReportCategory>('spam'); const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false);
  async function send() {
    if (!token || busy) return;
    const trimmed = reason.trim();
    if (trimmed.length > 0 && trimmed.length < 3) { Alert.alert('سبب غير مكتمل', 'اكتب سببًا من 3 أحرف على الأقل أو اتركه فارغًا.'); return; }
    setBusy(true);
    try { await submitReport(token, targetType, targetId, category, trimmed); setOpen(false); setReason(''); Alert.alert('تم إرسال البلاغ', 'سنراجعه وفقًا للسياسات.'); }
    catch (e) { Alert.alert('تعذر إرسال البلاغ', e instanceof Error ? e.message : 'حاول مرة أخرى.'); }
    finally { setBusy(false); }
  }
  const title = targetLabels[targetType] || targetType;
  return <><Pressable accessibilityRole="button" accessibilityLabel={`${label} عن ${title}`} onPress={() => setOpen(true)} style={styles.trigger}><Text style={styles.link}>{label}</Text></Pressable><Modal visible={open} transparent animationType="slide" onRequestClose={() => !busy && setOpen(false)}><KeyboardAvoidingView style={styles.shade} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><View style={styles.sheet}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheetContent} showsVerticalScrollIndicator={false}><Text style={styles.title}>إبلاغ عن {title}</Text><Text style={styles.description}>ساعدنا على إبقاء يترانا آمنًا. اختر الفئة الأقرب للسبب ويمكنك إضافة تفاصيل تساعد فريق المراجعة.</Text><Text style={styles.hint}>الفئة المطلوبة</Text><View style={styles.chips}>{reportCategories.map(c => <Pressable key={c.key} accessibilityRole="radio" accessibilityState={{ selected: category === c.key }} accessibilityLabel={`فئة البلاغ: ${c.label}`} onPress={() => setCategory(c.key)} style={({ pressed }) => [styles.chip, category === c.key && styles.selected, pressed && styles.pressed]}><Text style={[styles.chipText, category === c.key && styles.selectedText]}>{category === c.key ? '✓ ' : ''}{c.label}</Text></Pressable>)}</View><TextField placeholder="تفاصيل إضافية (اختياري)" accessibilityLabel="تفاصيل إضافية للبلاغ" value={reason} onChangeText={setReason} multiline maxLength={500}/><Text style={styles.counter}>{reason.length}/500</Text><PrimaryButton title={busy ? 'جارٍ الإرسال…' : 'إرسال البلاغ'} onPress={() => void send()} disabled={busy}/><SecondaryButton title="إلغاء" onPress={() => !busy && setOpen(false)} disabled={busy}/></ScrollView></View></KeyboardAvoidingView></Modal></>;
}
const styles = StyleSheet.create({ link: { color: colors.muted, fontSize: 13, fontWeight: '700' }, trigger: { minHeight: 40, minWidth: 64, justifyContent: 'center', alignItems: 'center' }, shade: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#17132288' }, sheet: { maxHeight: '92%', backgroundColor: colors.background, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 18, paddingTop: 18 }, sheetContent: { gap: 8, paddingBottom: 14 }, title: { fontSize: 19, fontWeight: '900', color: colors.ink, textAlign: 'right', writingDirection: 'rtl' }, description: { color: colors.muted, fontSize: 13, lineHeight: 20, textAlign: 'right', writingDirection: 'rtl' }, hint: { color: colors.ink, fontWeight: '800', textAlign: 'right', writingDirection: 'rtl', marginTop: 4 }, chips: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8 }, chip: { minHeight: 44, paddingHorizontal: 12, paddingVertical: 10, justifyContent: 'center', borderRadius: 13, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border }, chipText: { color: colors.ink, textAlign: 'right', writingDirection: 'rtl' }, selected: { borderColor: colors.primary, backgroundColor: colors.soft, borderWidth: 2 }, selectedText: { color: colors.primaryDark, fontWeight: '800' }, pressed: { opacity: 0.78 }, counter: { color: colors.muted, fontSize: 11, textAlign: 'left' } });
