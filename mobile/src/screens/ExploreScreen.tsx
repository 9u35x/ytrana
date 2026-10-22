import React, { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { apiRequest, enrichPostMedia } from '../api';
import { useAuth } from '../auth';
import { Avatar, EmptyState, Panel, Screen, TextField } from '../components';
import { type RootNavigation } from '../navigation';
import { colors, pagePadding } from '../theme';
import type { Post, UserPublic } from '../types';
import PostCard from './PostCard';

export default function ExploreScreen() {
  const { token } = useAuth();
  const navigation = useNavigation<RootNavigation>();
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState<UserPublic[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadPosts = useCallback(async () => {
    try { const base = await apiRequest<Post[]>('/api/posts/explore?skip=0&limit=20', { token }); setPosts(await enrichPostMedia(base, token)); setError(null); }
    catch (err) { setError(err instanceof Error ? err.message : 'تعذر تحميل الاستكشاف.'); }
  }, [token]);
  useFocusEffect(useCallback(() => { loadPosts(); }, [loadPosts]));

  React.useEffect(() => {
    let active = true;
    const needle = query.trim();
    if (!needle) { setUsers([]); setSearching(false); return; }
    setSearching(true);
    setError(null);
    const timer = setTimeout(() => {
      apiRequest<UserPublic[]>(`/api/users/search?q=${encodeURIComponent(needle)}`)
        .then((rows) => { if (active) { setUsers(rows); setSearching(false); } })
        .catch((err) => { if (active) { setError(err instanceof Error ? err.message : 'تعذر البحث.'); setSearching(false); } });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [query]);

  async function refresh() { setRefreshing(true); await loadPosts(); setRefreshing(false); }
  return <Screen><FlatList data={posts} keyExtractor={(item) => String(item.id)} renderItem={({ item }) => <PostCard post={item} />}
    ListHeaderComponent={<><View style={styles.header}><Text style={styles.title}>استكشف Ytrana</Text><Text style={styles.sub}>اكتشف أشخاصًا ومنشورات جديدة</Text></View>
      <View style={styles.search}><TextField value={query} onChangeText={setQuery} placeholder="ابحث عن اسم أو @مستخدم" autoCapitalize="none" autoCorrect={false} maxLength={60} /></View>
      {query.trim() ? <View style={styles.results}>{users.map((person) => <Pressable key={person.id} onPress={() => navigation.navigate('ProfileDetail', { username: person.username })}><Panel style={styles.userRow}><Avatar uri={person.avatar_url} size={40} /><View style={styles.userNames}><Text style={styles.userName}>{person.full_name}</Text><Text style={styles.handle}>@{person.username}</Text></View></Panel></Pressable>)}{searching ? <Text style={styles.noUsers}>جارٍ البحث…</Text> : null}{!searching && !users.length && !error ? <Text style={styles.noUsers}>لا توجد نتائج مطابقة بعد.</Text> : null}</View> : null}
      <Text style={styles.section}>منشورات تستحق الاكتشاف</Text>{error ? <Text style={styles.error}>{error}</Text> : null}
    </>}
    ListEmptyComponent={<EmptyState title="لا توجد منشورات عامة بعد" detail="ستظهر المنشورات الجديدة هنا." />}
    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />}
    contentContainerStyle={{ paddingBottom: 20 }} /></Screen>;
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: pagePadding, paddingTop: 16 }, title: { color: colors.ink, fontSize: 22, fontWeight: '900', textAlign: 'right', writingDirection: 'rtl' }, sub: { color: colors.muted, fontSize: 12, textAlign: 'right', writingDirection: 'rtl', marginTop: 4 }, search: { marginHorizontal: pagePadding, marginTop: 8 }, results: { marginBottom: 8 }, userRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 11, marginVertical: 4 }, userNames: { flex: 1, alignItems: 'flex-end' }, userName: { color: colors.ink, fontWeight: '800', textAlign: 'right', writingDirection: 'rtl' }, handle: { color: colors.muted, fontSize: 12, textAlign: 'right' }, noUsers: { color: colors.muted, textAlign: 'center', padding: 12, writingDirection: 'rtl' }, section: { color: colors.ink, fontSize: 17, fontWeight: '800', textAlign: 'right', writingDirection: 'rtl', marginHorizontal: pagePadding, marginVertical: 12 }, error: { color: colors.danger, textAlign: 'center', writingDirection: 'rtl' },
});
