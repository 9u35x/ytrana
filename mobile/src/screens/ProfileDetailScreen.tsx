import React, { useCallback, useState } from 'react';
import { Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { apiRequest } from '../api';
import { useAuth } from '../auth';
import { Avatar, EmptyState, Panel, PrimaryButton, Screen, SecondaryButton, VerifiedBadge } from '../components';
import { type RootNavigation, type RootStackParamList } from '../navigation';
import { colors, pagePadding } from '../theme';
import type { Post, UserProfile } from '../types';
import PostCard from './PostCard';
import ReportButton from '../components/ReportButton';
import FollowListModal from '../components/FollowListModal';
import StarsCard from '../components/StarsCard';

export default function ProfileDetailScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'ProfileDetail'>>();
  const navigation = useNavigation<RootNavigation>();
  const { token, user } = useAuth();
  const { username } = route.params;
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [followListKind, setFollowListKind] = useState<'followers'|'following'|null>(null);
  const load = useCallback(async () => {
    try {
      const p = await apiRequest<UserProfile>(`/api/users/${encodeURIComponent(username)}`, { token });
      const canView = p.can_view_content !== false || p.account_visibility !== 'private';
      const items = canView ? await apiRequest<Post[]>(`/api/posts/user/${encodeURIComponent(username)}?skip=0&limit=30`, { token }) : [];
      setProfile(p); setPosts(items); setError(null);
    } catch (err) { setError(err instanceof Error ? err.message : 'تعذر تحميل الملف.'); }
  }, [token, username]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function toggleFollow() {
    if (!token || !profile || busy) return;
    setBusy(true);
    try {
      if (profile.follow_request_status === 'pending') {
        await apiRequest(`/api/users/${encodeURIComponent(username)}/follow-request`, { method: 'DELETE', token });
      } else {
        await apiRequest(`/api/users/${encodeURIComponent(username)}/follow`, { method: profile.is_followed_by_me ? 'DELETE' : 'POST', token });
      }
      await load();
    } catch (err) { Alert.alert('تعذر تحديث المتابعة', err instanceof Error ? err.message : 'حاول مرة أخرى.'); }
    finally { setBusy(false); }
  }
  async function refresh() { setRefreshing(true); await load(); setRefreshing(false); }
  const isMe = user?.username === username;
  return <Screen><FlatList data={posts} keyExtractor={(item) => String(item.id)} renderItem={({ item }) => <PostCard post={item} />}
    ListHeaderComponent={<><View style={styles.top}><Avatar uri={profile?.avatar_url} size={76} /><View style={styles.nameBlock}><View style={styles.nameLine}><Text style={styles.name}>{profile?.full_name || username}</Text>{profile?.is_verified ? <VerifiedBadge size={22} /> : null}</View><Text style={styles.handle}>@{username}</Text></View></View>
      {profile?.can_view_profile_details === false ? <Text style={styles.privateNotice}>هذا حساب خاص. تظهر هنا معاينة عامة فقط حتى يوافق صاحب الحساب على طلب المتابعة.</Text> : <Text style={styles.bio}>{profile?.bio || 'لا توجد نبذة.'}</Text>}{!isMe && profile ? <View style={styles.report}><ReportButton targetType="user" targetId={profile.id} /></View> : null}<View style={styles.stats}><Stat label="منشور" value={profile?.posts_count || 0} /><Stat label="متابع" value={profile?.followers_count || 0} onPress={()=>setFollowListKind('followers')} /><Stat label="يتابع" value={profile?.following_count || 0} onPress={()=>setFollowListKind('following')} /></View><StarsCard username={username} token={token} refreshKey={`${profile?.followers_count || 0}:${profile?.follow_request_status || ''}`} />
      {!isMe ? <View style={styles.actions}><PrimaryButton title={busy ? 'لحظة…' : profile?.follow_request_status === 'pending' ? 'إلغاء طلب المتابعة' : profile?.is_followed_by_me ? 'إلغاء المتابعة' : 'متابعة'} onPress={toggleFollow} disabled={busy || !profile} compact /><SecondaryButton title="رسالة" onPress={() => navigation.navigate('Chat', { username, fullName: profile?.full_name })} /></View> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}<Text style={styles.section}>{profile?.can_view_content === false ? 'المحتوى خاص' : 'المنشورات'}</Text></>}
    ListEmptyComponent={<EmptyState title={error ? 'تعذر تحميل الملف' : 'لا توجد منشورات'} detail={error || 'سيظهر المحتوى العام هنا.'} />}
    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />} contentContainerStyle={{ paddingBottom: 20 }} /><FollowListModal visible={followListKind !== null} username={username} kind={followListKind || 'followers'} onClose={()=>{setFollowListKind(null); void load();}} /></Screen>;
}
function Stat({ label, value, onPress }: { label: string; value: number; onPress?: () => void }) { const content = <><Text style={styles.statValue}>{value}</Text><Text style={styles.statLabel}>{label}</Text></>; return onPress ? <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${value}`} style={styles.stat} onPress={onPress}>{content}</Pressable> : <View style={styles.stat}>{content}</View>; }
const styles = StyleSheet.create({
  top: { flexDirection: 'row-reverse', alignItems: 'center', gap: 15, paddingHorizontal: pagePadding, paddingTop: 18 }, nameBlock: { flex: 1, alignItems: 'flex-end' }, nameLine: { flexDirection: 'row-reverse', alignItems: 'center' }, name: { color: colors.ink, fontSize: 20, fontWeight: '900', textAlign: 'right', writingDirection: 'rtl' }, handle: { color: colors.muted, fontSize: 13, marginTop: 3 }, bio: { color: colors.ink, fontSize: 14, textAlign: 'right', writingDirection: 'rtl', marginHorizontal: pagePadding, marginVertical: 13 }, report: { alignItems: 'flex-end', marginHorizontal: pagePadding, marginBottom: 8 }, stats: { flexDirection: 'row-reverse', justifyContent: 'space-around', paddingVertical: 13, marginHorizontal: pagePadding, backgroundColor: '#FFFFFF', borderRadius: 15, borderColor: colors.border, borderWidth: 1 }, stat: { alignItems: 'center' }, statValue: { color: colors.ink, fontSize: 17, fontWeight: '900' }, statLabel: { color: colors.muted, fontSize: 11, writingDirection: 'rtl' }, actions: { flexDirection: 'row-reverse', gap: 9, marginHorizontal: pagePadding, marginVertical: 12 }, section: { color: colors.ink, fontSize: 17, fontWeight: '800', textAlign: 'right', writingDirection: 'rtl', marginHorizontal: pagePadding, marginTop: 12, marginBottom: 5 }, privateNotice: { color: colors.muted, fontSize: 14, textAlign: 'right', writingDirection: 'rtl', marginHorizontal: pagePadding, marginVertical: 13, lineHeight: 22 }, error: { color: colors.danger, textAlign: 'center', marginTop: 8, writingDirection: 'rtl' },
});
