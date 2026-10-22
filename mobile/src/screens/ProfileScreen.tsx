import React, { useCallback, useState } from 'react';
import { Alert, FlatList, Modal, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { useFocusEffect } from '@react-navigation/native';
import { apiRequest, enrichPostMedia } from '../api';
import { useAuth } from '../auth';
import { Avatar, EmptyState, ErrorText, Panel, PrimaryButton, Screen, SecondaryButton, TextField, VerifiedBadge } from '../components';
import { colors, pagePadding } from '../theme';
import type { Post, UserProfile } from '../types';
import type { TabParamList } from '../navigation';
import PostCard from './PostCard';
import FollowListModal from '../components/FollowListModal';
import StarsCard from '../components/StarsCard';

type Props = BottomTabScreenProps<TabParamList, 'Profile'>;

export default function ProfileScreen({ navigation }: Props) {
  const { token, user, setUser, signOut } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [fullName, setFullName] = useState('');
  const [bio, setBio] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [followList, setFollowList] = useState<'followers' | 'following' | null>(null);
  const load = useCallback(async () => {
    if (!token || !user) return;
    try {
      const [p, items] = await Promise.all([
        apiRequest<UserProfile>(`/api/users/${encodeURIComponent(user.username)}`, { token }),
        apiRequest<Post[]>(`/api/posts/user/${encodeURIComponent(user.username)}?skip=0&limit=30`, { token }),
      ]);
      setProfile(p); setPosts(await enrichPostMedia(items, token)); setFullName(p.full_name); setBio(p.bio || ''); setError(null);
    } catch (err) { setError(err instanceof Error ? err.message : 'تعذر تحميل الحساب.'); }
  }, [token, user]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function saveProfile() {
    if (!token) return;
    try {
      const updated = await apiRequest<UserProfile>('/api/users/me', { method: 'PUT', token, body: { full_name: fullName.trim(), bio: bio.trim() } });
      setProfile(updated); setUser(updated); setEditing(false); setError(null);
    } catch (err) { setError(err instanceof Error ? err.message : 'تعذر حفظ التعديلات.'); }
  }
  async function refresh() { setRefreshing(true); await load(); setRefreshing(false); }
  async function confirmLogout() {
    Alert.alert('تسجيل الخروج', 'هل تريد إنهاء الجلسة على هذا الجهاز؟', [
      { text: 'إلغاء', style: 'cancel' }, { text: 'خروج', style: 'destructive', onPress: () => { void signOut(); } },
    ]);
  }
  return <Screen><FlatList data={posts} keyExtractor={(item) => String(item.id)} renderItem={({ item }) => <PostCard post={item} />}
    ListHeaderComponent={<><View style={styles.top}><Avatar uri={profile?.avatar_url || user?.avatar_url} size={76} /><View style={styles.nameBlock}><View style={styles.nameLine}><Text style={styles.name}>{profile?.full_name || user?.full_name}</Text>{profile?.is_verified ? <VerifiedBadge size={22} /> : null}</View><Text style={styles.handle}>@{user?.username}</Text></View></View>
      <Text style={styles.bio}>{profile?.bio || 'أضف نبذة قصيرة عنك.'}</Text><View style={styles.stats}><Stat label="منشور" value={profile?.posts_count ?? posts.length} /><Pressable accessibilityRole="button" accessibilityLabel="عرض المتابعين" onPress={() => setFollowList('followers')}><Stat label="متابع" value={profile?.followers_count ?? 0} /></Pressable><Pressable accessibilityRole="button" accessibilityLabel="عرض الحسابات التي أتابعها" onPress={() => setFollowList('following')}><Stat label="يتابع" value={profile?.following_count ?? 0} /></Pressable></View><StarsCard username={user?.username || ''} token={token} refreshKey={profile?.followers_count} />
      <View style={styles.settingsRow}><SecondaryButton title="الإعدادات والخصوصية" onPress={() => navigation.navigate('Settings')} /></View><View style={styles.buttons}><SecondaryButton title="تعديل الملف" onPress={() => setEditing(true)} /><SecondaryButton title="تسجيل الخروج" onPress={confirmLogout} /></View><ErrorText message={error} /><Text style={styles.section}>منشوراتي</Text></>}
    ListEmptyComponent={<EmptyState title={error ? 'تعذر تحميل الحساب' : 'لم تنشر شيئًا بعد'} detail={error || 'ستظهر منشوراتك هنا.'} />}
    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />} contentContainerStyle={{ paddingBottom: 20 }} />
    <Modal visible={editing} transparent animationType="slide" onRequestClose={() => setEditing(false)}><View style={styles.shade}><View style={styles.modal}><Text style={styles.modalTitle}>تعديل الملف الشخصي</Text><TextField placeholder="الاسم الكامل" value={fullName} onChangeText={setFullName} maxLength={100} /><TextField placeholder="نبذة (حتى 160 حرفًا)" value={bio} onChangeText={setBio} maxLength={160} multiline /><PrimaryButton title="حفظ" onPress={saveProfile} /><SecondaryButton title="إلغاء" onPress={() => setEditing(false)} /></View></View></Modal>
    {followList ? <FollowListModal visible username={user?.username || ''} kind={followList} onClose={() => { setFollowList(null); void load(); }} /> : null}
  </Screen>;
}

function Stat({ label, value }: { label: string; value: number }) { return <View style={styles.stat}><Text style={styles.statValue}>{value}</Text><Text style={styles.statLabel}>{label}</Text></View>; }
const styles = StyleSheet.create({
  top: { flexDirection: 'row-reverse', alignItems: 'center', gap: 15, paddingHorizontal: pagePadding, paddingTop: 18 }, nameBlock: { flex: 1, alignItems: 'flex-end' }, nameLine: { flexDirection: 'row-reverse', alignItems: 'center' }, name: { color: colors.ink, fontSize: 20, fontWeight: '900', textAlign: 'right', writingDirection: 'rtl' }, handle: { color: colors.muted, fontSize: 13, marginTop: 3 }, bio: { color: colors.ink, fontSize: 14, textAlign: 'right', writingDirection: 'rtl', marginHorizontal: pagePadding, marginVertical: 13 }, stats: { flexDirection: 'row-reverse', justifyContent: 'space-around', paddingVertical: 13, marginHorizontal: pagePadding, backgroundColor: '#FFFFFF', borderRadius: 15, borderColor: colors.border, borderWidth: 1 }, stat: { alignItems: 'center' }, statValue: { color: colors.ink, fontSize: 17, fontWeight: '900' }, statLabel: { color: colors.muted, fontSize: 11, writingDirection: 'rtl' }, settingsRow: { marginHorizontal: pagePadding, marginTop: 10 }, buttons: { flexDirection: 'row-reverse', gap: 8, marginHorizontal: pagePadding, marginVertical: 11 }, section: { color: colors.ink, fontSize: 17, fontWeight: '800', textAlign: 'right', writingDirection: 'rtl', marginHorizontal: pagePadding, marginTop: 9, marginBottom: 5 }, shade: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#0007' }, modal: { backgroundColor: colors.background, padding: 18, gap: 8, borderTopLeftRadius: 22, borderTopRightRadius: 22 }, modalTitle: { color: colors.ink, fontSize: 20, fontWeight: '800', textAlign: 'right', writingDirection: 'rtl' },
});
