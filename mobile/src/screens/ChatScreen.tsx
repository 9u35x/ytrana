import React, { useCallback, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRoute, type RouteProp } from '@react-navigation/native';
import { apiRequest } from '../api';
import { useAuth } from '../auth';
import { Avatar, EmptyState, Screen, TextField } from '../components';
import { type RootStackParamList } from '../navigation';
import { colors, pagePadding } from '../theme';
import type { DirectMessage } from '../types';
import ReportButton from '../components/ReportButton';

export default function ChatScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'Chat'>>();
  const { username } = route.params;
  const { token, user } = useAuth();
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<FlatList<DirectMessage>>(null);
  const load = useCallback(async (active = true) => {
    if (!token) return;
    try { const rows = await apiRequest<DirectMessage[]>(`/api/messages/${encodeURIComponent(username)}`, { token }); if (active) { setMessages(rows); setError(null); } }
    catch (err) { if (active) setError(err instanceof Error ? err.message : 'تعذر تحميل المحادثة.'); }
  }, [token, username]);
  useFocusEffect(useCallback(() => {
    let active = true;
    void load(active);
    const timer = setInterval(() => { void load(active); }, 5000);
    return () => { active = false; clearInterval(timer); };
  }, [load]));
  async function refresh() { setRefreshing(true); await load(); setRefreshing(false); }
  async function send() {
    if (!token || sending || !text.trim()) return;
    setSending(true); setError(null);
    try { await apiRequest<DirectMessage>(`/api/messages/${encodeURIComponent(username)}`, { method: 'POST', token, body: { content: text.trim() } }); setText(''); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : 'تعذر إرسال الرسالة.'); }
    finally { setSending(false); }
  }
  return <Screen><KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={88}>
    <FlatList data={messages} keyExtractor={(item) => String(item.id)} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />}
      ListHeaderComponent={error ? <Text style={styles.error}>{error}</Text> : null}
      ListEmptyComponent={<EmptyState title="ابدأ الحديث" detail="اكتب أول رسالة في هذه المحادثة." />}
      ref={listRef} onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
      renderItem={({ item }) => { const own = item.sender.id === user?.id; return <View style={[styles.messageRow, own ? styles.ownRow : styles.otherRow]}>{!own ? <Avatar uri={item.sender.avatar_url} size={30} /> : null}<View style={[styles.bubble, own ? styles.ownBubble : styles.otherBubble]}><Text style={[styles.messageText, own && styles.ownText]}>{item.content}</Text><Text style={[styles.time, own && styles.ownTime]}>{new Date(item.created_at).toLocaleTimeString('ar-IQ', { hour: '2-digit', minute: '2-digit' })}{own ? ` · ${item.is_read ? 'مقروءة' : 'تم الإرسال'}` : ''}</Text>{!own ? <ReportButton targetType="message" targetId={item.id} /> : null}</View></View>; }}
      contentContainerStyle={{ paddingVertical: 14, flexGrow: 1, justifyContent: messages.length ? 'flex-end' : 'center' }} />
    <View style={styles.composer}><TextField placeholder="اكتب رسالة…" value={text} onChangeText={setText} maxLength={2000} multiline style={styles.input} /><Pressable accessibilityRole="button" onPress={send} disabled={sending || !text.trim()} style={[styles.send, (sending || !text.trim()) && styles.disabled]}><Text style={styles.sendText}>{sending ? '…' : 'إرسال'}</Text></Pressable></View>
  </KeyboardAvoidingView></Screen>;
}

const styles = StyleSheet.create({
  messageRow: { flexDirection: 'row-reverse', alignItems: 'flex-end', gap: 7, marginHorizontal: pagePadding, marginVertical: 4 }, ownRow: { justifyContent: 'flex-start' }, otherRow: { justifyContent: 'flex-end' }, bubble: { maxWidth: '80%', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 9 }, ownBubble: { backgroundColor: colors.primary }, otherBubble: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: colors.border }, messageText: { color: colors.ink, fontSize: 14, lineHeight: 20, textAlign: 'right', writingDirection: 'rtl' }, ownText: { color: '#FFFFFF' }, time: { color: colors.muted, fontSize: 9, marginTop: 4, textAlign: 'left' }, ownTime: { color: '#EAE5FF' }, composer: { flexDirection: 'row-reverse', alignItems: 'flex-end', gap: 8, padding: 10, borderTopWidth: 1, borderColor: colors.border, backgroundColor: '#FFFFFF' }, input: { flex: 1, minHeight: 44, maxHeight: 100, marginVertical: 0 }, send: { backgroundColor: colors.primary, paddingHorizontal: 15, paddingVertical: 13, borderRadius: 13 }, sendText: { color: '#FFFFFF', fontWeight: '800', writingDirection: 'rtl' }, disabled: { opacity: 0.5 }, error: { color: colors.danger, textAlign: 'center', writingDirection: 'rtl', padding: 10 },
});
