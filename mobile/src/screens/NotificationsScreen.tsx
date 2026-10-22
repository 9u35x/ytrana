import React, { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { apiRequest } from '../api';
import { useAuth } from '../auth';
import { Avatar, EmptyState, Panel, Screen } from '../components';
import { type RootNavigation } from '../navigation';
import { colors, pagePadding } from '../theme';
import type { NotificationItem } from '../types';

const labels: Record<string, string> = { follow: 'بدأ بمتابعتك', like: 'أعجبه منشورك', comment: 'علّق على منشورك' };
export default function NotificationsScreen() {
  const { token } = useAuth();
  const navigation = useNavigation<RootNavigation>();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [rows, unread] = await Promise.all([
        apiRequest<NotificationItem[]>('/api/notifications?skip=0&limit=50', { token }),
        apiRequest<{ unread_count: number }>('/api/notifications/unread-count', { token }),
      ]);
      setItems(rows); setUnreadCount(unread.unread_count); setError(null);
    }
    catch (err) { setError(err instanceof Error ? err.message : 'تعذر تحميل الإشعارات.'); }
  }, [token]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  async function open(item: NotificationItem) {
    if (token && !item.is_read) {
      await apiRequest(`/api/notifications/${item.id}/read`, { method: 'PUT', token }).catch(() => undefined);
      setItems((old) => old.map((row) => row.id === item.id ? { ...row, is_read: true } : row));
      setUnreadCount((count) => Math.max(0, count - 1));
    }
    navigation.navigate('ProfileDetail', { username: item.actor.username });
  }
  async function markAllRead() {
    if (!token || !unreadCount || markingAll) return;
    setMarkingAll(true);
    try {
      await apiRequest('/api/notifications/read-all', { method: 'PUT', token });
      setItems((old) => old.map((item) => ({ ...item, is_read: true })));
      setUnreadCount(0);
    } catch (err) { setError(err instanceof Error ? err.message : 'تعذر تحديث الإشعارات.'); }
    finally { setMarkingAll(false); }
  }
  async function refresh() { setRefreshing(true); await load(); setRefreshing(false); }
  return <Screen><FlatList data={items} keyExtractor={(item) => String(item.id)} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />}
    ListHeaderComponent={<View style={styles.header}><View style={styles.headerText}><Text style={styles.title}>الإشعارات{unreadCount ? ` · ${unreadCount}` : ''}</Text><Text style={styles.sub}>ابقَ على اطلاع بتفاعلات مجتمعك</Text></View>{unreadCount ? <Pressable accessibilityRole="button" onPress={markAllRead} disabled={markingAll} style={styles.markAll}><Text style={styles.markAllText}>{markingAll ? 'جارٍ التحديث…' : 'تحديد الكل كمقروء'}</Text></Pressable> : null}</View>}
    renderItem={({ item }) => <Pressable onPress={() => open(item)}><Panel style={[styles.row, !item.is_read && styles.unread]}><Avatar uri={item.actor.avatar_url} size={43} /><View style={styles.body}><Text style={styles.line}><Text style={styles.bold}>{item.actor.full_name}</Text> {labels[item.type] || 'تفاعل معك'}</Text><Text style={styles.date}>{new Date(item.created_at).toLocaleString('ar-IQ')}</Text></View><View style={[styles.dot, item.is_read && styles.dotHidden]} /></Panel></Pressable>}
    ListEmptyComponent={<EmptyState title={error ? 'تعذر عرض الإشعارات' : 'لا توجد إشعارات بعد'} detail={error || 'ستظهر التفاعلات الجديدة هنا.'} />} contentContainerStyle={{ paddingBottom: 20 }} /></Screen>;
}
const styles = StyleSheet.create({ header: { padding: pagePadding, paddingBottom: 8, flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', gap: 8 }, headerText: { flex: 1, alignItems: 'flex-end' }, markAll: { padding: 8, borderRadius: 10, backgroundColor: '#F2F0FF' }, markAllText: { color: colors.primaryDark, fontSize: 11, fontWeight: '800', textAlign: 'right', writingDirection: 'rtl' }, title: { color: colors.ink, fontSize: 22, fontWeight: '900', textAlign: 'right', writingDirection: 'rtl' }, sub: { color: colors.muted, fontSize: 12, textAlign: 'right', writingDirection: 'rtl', marginTop: 4 }, row: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10 }, unread: { borderColor: '#CFC6FF', backgroundColor: '#FBFAFF' }, body: { flex: 1, alignItems: 'flex-end' }, line: { color: colors.ink, fontSize: 13, textAlign: 'right', writingDirection: 'rtl' }, bold: { fontWeight: '900' }, date: { color: colors.muted, fontSize: 10, marginTop: 4 }, dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary }, dotHidden: { opacity: 0 }, });
