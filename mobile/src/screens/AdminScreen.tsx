import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, FlatList, Image, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../auth';
import { API_BASE } from '../api';
import { Avatar, EmptyState, ErrorText, Panel, Screen, SecondaryButton, TextField, VerifiedBadge } from '../components';
import { colors } from '../theme';
import { banUser, checkAdminAccess, freezeUser, getReportTarget, loadAdminReports, loadAdminUsers, reportCategories, resolveReport, unbanUser, unfreezeUser, updateVerification, type AdminReport, type AdminTargetMedia, type AdminUser, type ReportTarget } from '../adminApi';

const LIMIT = 20;
const labels: Record<string, string> = { pending: 'قيد المراجعة', reviewed: 'تمت المراجعة', dismissed: 'مرفوض', user: 'حساب', post: 'منشور', comment: 'تعليق', reel: 'ريل', story: 'قصة', message: 'رسالة', review: 'مراجعة', dismiss: 'رفض', delete_content: 'حذف المحتوى', ban_user: 'حظر المستخدم', freeze_user: 'تجميد المستخدم' };
const reportTypes = ['', 'user', 'post', 'comment', 'reel', 'story', 'message'];
const statuses = ['pending', 'reviewed', 'dismissed'];
function parseDays(raw: string, required = false): number | undefined {
  const value = raw.trim();
  if (!value && !required) return undefined;
  const days = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(days) || days < 1 || days > 3650) throw new Error('أدخل عدد أيام صحيحًا من 1 إلى 3650؛ اتركه فارغًا فقط للتجميد غير المحدد.');
  return days;
}
function date(value?: string | null) { return value ? new Date(value).toLocaleString('ar-IQ') : ''; }
type ConfirmAction = (title: string, action: () => Promise<unknown>) => void;

export default function AdminScreen() {
  const { token } = useAuth();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [tab, setTab] = useState<'users' | 'reports'>('users');
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [reports, setReports] = useState<AdminReport[]>([]);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [status, setStatus] = useState('pending');
  const [type, setType] = useState('');
  const [note, setNote] = useState('');
  const [days, setDays] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const actionLock = useRef(false);
  const requestId = useRef(0);
  const focused = useRef(false);

  useFocusEffect(useCallback(() => {
    let active = true; focused.current = true; setAllowed(null); setError(null);
    if (!token) { setAllowed(false); return () => { active = false; focused.current = false; }; }
    void checkAdminAccess(token).then(result => {
      if (active) setAllowed(result.allowed === true);
    }).catch(e => { if (active) { setAllowed(false); setError(e instanceof Error ? e.message : 'تعذر التحقق من الصلاحية.'); } });
    return () => { active = false; focused.current = false; requestId.current += 1; };
  }, [token]));

  const load = useCallback(async () => {
    if (!token || allowed !== true || !focused.current) return;
    const id = ++requestId.current; setLoading(true);
    try {
      if (tab === 'users') {
        const rows = await loadAdminUsers(token, search, page * LIMIT, LIMIT);
        if (id === requestId.current) setUsers(rows);
      } else {
        const rows = await loadAdminReports(token, status, type, page * LIMIT, LIMIT);
        if (id === requestId.current) setReports(rows);
      }
      if (id === requestId.current) setError(null);
    } catch (e) { if (id === requestId.current) setError(e instanceof Error ? e.message : 'تعذر تحميل لوحة الإدارة.'); }
    finally { if (id === requestId.current) setLoading(false); }
  }, [token, allowed, tab, search, page, status, type]);
  useEffect(() => { void load(); return () => { requestId.current += 1; }; }, [load]);

  const confirm: ConfirmAction = (title, action) => {
    if (actionLock.current) return;
    if (!note.trim()) { setError('أضف ملاحظة توضح سبب الإجراء أولًا.'); return; }
    if (note.trim().length > 1000) { setError('الملاحظة يجب ألا تتجاوز 1000 حرف.'); return; }
    actionLock.current = true; setActionBusy(true);
    const unlock = () => { actionLock.current = false; setActionBusy(false); };
    Alert.alert('تأكيد الإجراء', title, [
      { text: 'إلغاء', style: 'cancel', onPress: unlock },
      { text: 'تأكيد', style: 'destructive', onPress: () => { void (async () => {
        try { await action(); setNote(''); await load(); }
        catch (e) { setError(e instanceof Error ? e.message : 'تعذر تنفيذ الإجراء.'); }
        finally { unlock(); }
      })(); } },
    ], { cancelable: false });
  };
  const validate = (action: () => void) => { try { action(); } catch (e) { setError(e instanceof Error ? e.message : 'القيمة غير صالحة.'); } };
  const refresh = async () => { await load(); };
  const changeTab = (next: 'users' | 'reports') => { setTab(next); setPage(0); };
  if (allowed === null) return <Screen><EmptyState title="جارٍ التحقق من الصلاحية…" /></Screen>;
  if (!allowed || !token) return <Screen><EmptyState title="غير مصرح" detail={error || 'هذه اللوحة للحسابين المعتمدين فقط.'} /></Screen>;
  return <Screen>
    <View style={styles.tabs}>{(['users', 'reports'] as const).map(value => <Pressable key={value} disabled={actionBusy} onPress={() => changeTab(value)} style={[styles.tab, tab === value && styles.active]}><Text>{value === 'users' ? 'المستخدمون' : 'البلاغات'}</Text></Pressable>)}</View>
    <View style={styles.filters}>
      {tab === 'users' ? <><TextField placeholder="بحث بالاسم أو المستخدم" value={searchInput} onChangeText={setSearchInput} onSubmitEditing={() => { setPage(0); setSearch(searchInput.trim()); }} /><SecondaryButton title="بحث" onPress={() => { setPage(0); setSearch(searchInput.trim()); }} disabled={actionBusy} /></> : <>
        <View style={styles.chips}>{statuses.map(value => <Pressable key={value} disabled={actionBusy} onPress={() => { setStatus(value); setPage(0); }} style={[styles.chip, status === value && styles.active]}><Text>{labels[value]}</Text></Pressable>)}</View>
        <View style={styles.chips}>{reportTypes.map(value => <Pressable key={value} disabled={actionBusy} onPress={() => { setType(value); setPage(0); }} style={[styles.chip, type === value && styles.active]}><Text>{labels[value] || 'كل الأنواع'}</Text></Pressable>)}</View>
      </>}
      <TextField placeholder="ملاحظة مطلوبة للإجراء" accessibilityLabel="ملاحظة مطلوبة للإجراء" value={note} onChangeText={setNote} maxLength={1000} editable={!actionBusy} />
      <Text style={styles.fieldHint}>تُحفظ الملاحظة مع التأكيد وتظهر في سجل القرار.</Text>
      <TextField placeholder="عدد الأيام؛ للتوثيق المؤقت أو التجميد (1–3650)" accessibilityLabel="مدة الإجراء بالأيام" value={days} onChangeText={setDays} keyboardType="number-pad" editable={!actionBusy} />
      <Text style={styles.fieldHint}>اتركها فارغة فقط عند التجميد غير المحدد أو الإجراءات التي لا تحتاج مدة.</Text>
      <ErrorText message={error} />
    </View>
    {tab === 'users' ? <FlatList data={users} keyExtractor={item => String(item.id)} refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} />} ListEmptyComponent={<EmptyState title="لا يوجد مستخدمون" />} renderItem={({ item }) => <UserRow item={item} token={token} note={note.trim()} days={days} confirm={confirm} validate={validate} busy={actionBusy} />} /> :
      <FlatList data={reports} keyExtractor={item => String(item.id)} refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} />} ListEmptyComponent={<EmptyState title="لا توجد بلاغات" />} renderItem={({ item }) => <ReportRow report={item} token={token} note={note.trim()} days={days} confirm={confirm} validate={validate} busy={actionBusy} setError={setError} />} />}
    <View style={styles.pager}><SecondaryButton title="السابق" onPress={() => setPage(value => Math.max(0, value - 1))} disabled={loading || actionBusy || page === 0} /><Text style={styles.page}>صفحة {page + 1}</Text><SecondaryButton title="التالي" onPress={() => setPage(value => value + 1)} disabled={loading || actionBusy || (tab === 'users' ? users.length : reports.length) < LIMIT} /></View>
  </Screen>;
}

type RowProps = { token: string; note: string; days: string; confirm: ConfirmAction; validate: (action: () => void) => void; busy: boolean };
function UserRow({ item, token, note, days, confirm, validate, busy }: RowProps & { item: AdminUser }) {
  return <Panel><View style={styles.user}><Avatar uri={item.avatar_url} size={40} /><View style={styles.info}><View style={styles.nameLine}><Text style={styles.name}>{item.full_name || item.username}</Text>{item.is_verified ? <VerifiedBadge /> : null}</View><Text style={styles.meta}>@{item.username} · ID {item.id}</Text><Text style={styles.meta}>{item.is_banned ? 'محظور · ' : ''}{item.is_frozen ? `مجمّد ${item.frozen_until ? `حتى ${date(item.frozen_until)}` : 'حتى فك التجميد'}` : ''}{item.is_verified ? ` · ${item.verification_expires_at ? `موثق حتى ${date(item.verification_expires_at)}` : 'توثيق دائم'}` : ''}</Text></View></View>
    <Text style={styles.toolHeading}>أدوات الحساب</Text><View style={styles.actions}>
      <SecondaryButton title={item.is_banned ? 'إلغاء الحظر' : 'حظر'} disabled={busy} onPress={() => confirm(item.is_banned ? 'إلغاء حظر هذا الحساب؟' : 'حظر هذا الحساب ومنعه من الدخول؟', () => item.is_banned ? unbanUser(token, item.id, note) : banUser(token, item.id, note))} />
      <SecondaryButton title={item.is_frozen ? 'إلغاء التجميد' : 'تجميد'} disabled={busy} onPress={() => validate(() => { const duration = parseDays(days); confirm(item.is_frozen ? 'إلغاء التجميد؟ لا يزيل الحظر المستقل.' : 'تجميد هذا الحساب ومنعه من الدخول؟', () => item.is_frozen ? unfreezeUser(token, item.id, note) : freezeUser(token, item.id, duration ?? null, note)); })} />
      <Text style={styles.toolHeading}>التوثيق</Text><SecondaryButton title="توثيق دائم" disabled={busy} onPress={() => confirm('منح هذا الحساب توثيقًا دائمًا؟', () => updateVerification(token, item.id, 'permanent', undefined, note))} />
      <SecondaryButton title="توثيق مؤقت" disabled={busy} onPress={() => validate(() => { const duration = parseDays(days, true); confirm(`منح توثيق لمدة ${duration} يومًا؟`, () => updateVerification(token, item.id, 'temporary', duration, note)); })} />
      {item.is_verified ? <SecondaryButton title="سحب التوثيق" disabled={busy} onPress={() => confirm('سحب توثيق هذا الحساب؟', () => updateVerification(token, item.id, 'revoke', undefined, note))} /> : null}
    </View>
  </Panel>;
}
function ReportRow({ report, token, note, days, confirm, validate, busy, setError }: RowProps & { report: AdminReport; setError: (value: string | null) => void }) {
  const [target, setTarget] = useState<ReportTarget | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  async function preview() {
    if (previewBusy) return; setPreviewBusy(true);
    try { setTarget(await getReportTarget(token, report.id)); }
    catch (e) { setError(e instanceof Error ? e.message : 'تعذر تحميل المعاينة.'); }
    finally { setPreviewBusy(false); }
  }
  const canDelete = report.target_type !== 'user' && target?.exists !== false;
  const actions = ['review', 'dismiss', ...(canDelete ? ['delete_content'] : []), ...(target?.exists !== false ? ['ban_user', 'freeze_user'] : [])];
  return <Panel>
    <Text style={styles.name}>بلاغ #{report.id} · {labels[report.target_type]} #{report.target_id}</Text>
    <Text style={styles.meta}>{reportCategories.find(value => value.key === report.category)?.label || report.category} · {labels[report.status]} · {date(report.created_at)}</Text>
    <Text style={styles.body}>{report.reason}</Text>
    {report.review_note ? <Text style={styles.meta}>ملاحظة المراجعة: {report.review_note}</Text> : null}
    {report.reviewer_id ? <Text style={styles.meta}>المراجع #{report.reviewer_id} · {date(report.reviewed_at)} · {labels[report.resolution || ''] || report.resolution}</Text> : null}
    <SecondaryButton title={previewBusy ? 'جارٍ تحميل المعاينة…' : 'معاينة الهدف'} onPress={() => void preview()} disabled={previewBusy} />
    {target ? <><Text style={styles.body}>{target.exists ? target.summary : `الهدف غير موجود؛ الملخص المحفوظ:\n${target.summary || 'لا يتوفر ملخص'}`}</Text><ReportMedia media={target.media || []} token={token} /></> : null}
    {report.status === 'pending' ? <View style={styles.actions}>{actions.map(action => <SecondaryButton key={action} title={labels[action]} disabled={busy} onPress={() => validate(() => { const duration = action === 'freeze_user' ? parseDays(days) : undefined; confirm(`${labels[action]}؟ سيُسجل القرار ولن يُعاد حسم هذا البلاغ.`, () => resolveReport(token, report.id, action, note, duration)); })} />)}</View> : null}
  </Panel>;
}
function ReportMedia({ media, token }: { media: AdminTargetMedia[]; token: string }) {
  return <>{media.filter(item => /^\/api\/admin\/reports\/\d+\/media\/(image|video)$/.test(item.url)).map(item => item.kind === 'image' ? <Image key={item.url} source={{ uri: `${API_BASE}${item.url}`, headers: { Authorization: `Bearer ${token}` } }} style={styles.preview} resizeMode="contain" /> : <SecureVideo key={item.url} url={`${API_BASE}${item.url}`} token={token} />)}</>;
}
function SecureVideo({ url, token }: { url: string; token: string }) {
  const player = useVideoPlayer({ uri: url, headers: { Authorization: `Bearer ${token}` } }, video => { video.loop = false; });
  return <VideoView player={player} style={styles.preview} contentFit="contain" nativeControls />;
}
const styles = StyleSheet.create({ tabs: { flexDirection: 'row-reverse', padding: 10, gap: 8 }, tab: { flex: 1, minHeight: 46, padding: 12, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#fff' }, active: { backgroundColor: colors.soft, borderColor: colors.primary, borderWidth: 1 }, filters: { paddingHorizontal: 12 }, fieldHint: { color: colors.muted, fontSize: 11, lineHeight: 17, textAlign: 'right', writingDirection: 'rtl', marginBottom: 2 }, chips: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 5, marginVertical: 3 }, chip: { minHeight: 40, paddingHorizontal: 10, justifyContent: 'center', borderRadius: 10, backgroundColor: '#fff' }, actions: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 6, marginTop: 8 }, toolHeading: { width: '100%', color: colors.primaryDark, fontWeight: '900', textAlign: 'right', writingDirection: 'rtl', marginTop: 5 }, user: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10 }, info: { flex: 1, alignItems: 'flex-end' }, nameLine: { flexDirection: 'row-reverse', alignItems: 'center' }, name: { fontWeight: '900', color: colors.ink, textAlign: 'right', writingDirection: 'rtl' }, meta: { color: colors.muted, fontSize: 12, textAlign: 'right', writingDirection: 'rtl', marginTop: 3 }, body: { color: colors.ink, textAlign: 'right', writingDirection: 'rtl', marginTop: 7 }, pager: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', padding: 12 }, page: { color: colors.muted, fontWeight: '800' }, preview: { width: '100%', height: 210, marginTop: 8, backgroundColor: '#111' } });
