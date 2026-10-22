import React, { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRoute, type RouteProp } from '@react-navigation/native';
import { apiRequest } from '../api';
import { useAuth } from '../auth';
import { Avatar, EmptyState, Panel, Screen, TextField } from '../components';
import { type RootStackParamList } from '../navigation';
import { colors, pagePadding } from '../theme';
import type { Comment } from '../types';
import ReportButton from '../components/ReportButton';

export default function CommentsScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'Comments'>>();
  const { post } = route.params;
  const { token } = useAuth();
  const [comments, setComments] = useState<Comment[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { setComments(await apiRequest<Comment[]>(`/api/posts/${post.id}/comments?skip=0&limit=100`, { token })); setError(null); }
    catch (err) { setError(err instanceof Error ? err.message : 'تعذر تحميل التعليقات.'); }
  }, [post.id, token]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  async function refresh() { setRefreshing(true); await load(); setRefreshing(false); }
  async function send() {
    if (!token || sending || !text.trim()) return;
    setSending(true); setError(null);
    try { await apiRequest<Comment>(`/api/posts/${post.id}/comments`, { method: 'POST', token, body: { content: text.trim() } }); setText(''); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : 'تعذر إضافة التعليق.'); }
    finally { setSending(false); }
  }
  return <Screen><FlatList data={comments} keyExtractor={(item) => String(item.id)} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />}
    ListHeaderComponent={<><Panel><Text style={styles.postAuthor}>@{post.author.username}</Text><Text style={styles.postContent}>{post.content || 'منشور بصورة'}</Text></Panel>{error ? <Text style={styles.error}>{error}</Text> : null}</>}
    renderItem={({ item }) => <Panel style={styles.comment}><Avatar uri={item.author.avatar_url} size={36} /><View style={styles.body}><Text style={styles.author}>{item.author.full_name} <Text style={styles.handle}>@{item.author.username}</Text></Text><Text style={styles.text}>{item.content}</Text><Text style={styles.date}>{new Date(item.created_at).toLocaleString('ar-IQ')}</Text><ReportButton targetType="comment" targetId={item.id} /></View></Panel>}
    ListEmptyComponent={<EmptyState title="لا توجد تعليقات بعد" detail="كن أول من يعلّق." />} contentContainerStyle={{ paddingBottom: 10 }} />
    <View style={styles.composer}><TextField placeholder="اكتب تعليقًا…" value={text} onChangeText={setText} maxLength={500} /><Pressable onPress={send} disabled={sending || !text.trim()} style={[styles.send, (!text.trim() || sending) && styles.disabled]}><Text style={styles.sendText}>{sending ? '…' : 'إرسال'}</Text></Pressable></View>
  </Screen>;
}
const styles = StyleSheet.create({ postAuthor: { color: colors.primaryDark, fontWeight: '800', textAlign: 'right' }, postContent: { color: colors.ink, fontSize: 15, textAlign: 'right', writingDirection: 'rtl', marginTop: 5 }, comment: { flexDirection: 'row-reverse', gap: 10, alignItems: 'flex-start' }, body: { flex: 1, alignItems: 'flex-end' }, author: { color: colors.ink, fontSize: 13, fontWeight: '800', textAlign: 'right', writingDirection: 'rtl' }, handle: { color: colors.muted, fontWeight: '400' }, text: { color: colors.ink, fontSize: 14, marginTop: 4, textAlign: 'right', writingDirection: 'rtl' }, date: { color: colors.muted, fontSize: 10, marginTop: 4 }, composer: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8, padding: 10, borderTopWidth: 1, borderColor: colors.border, backgroundColor: '#FFFFFF' }, send: { backgroundColor: colors.primary, paddingHorizontal: 13, paddingVertical: 12, borderRadius: 12 }, sendText: { color: '#FFFFFF', fontWeight: '800', writingDirection: 'rtl' }, disabled: { opacity: 0.5 }, error: { color: colors.danger, textAlign: 'center', writingDirection: 'rtl' },
});
