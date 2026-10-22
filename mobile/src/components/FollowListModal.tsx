import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { apiRequest } from '../api';
import { useAuth } from '../auth';
import { Avatar, EmptyState, ErrorText } from '../components';
import type { RootNavigation } from '../navigation';
import { colors, pagePadding } from '../theme';
import type { UserPublic } from '../types';

type FollowListKind = 'followers' | 'following';

type Props = {
  visible: boolean;
  username: string;
  kind: FollowListKind;
  onClose: () => void;
};

const PAGE_SIZE = 20;
const titles: Record<FollowListKind, string> = { followers: 'المتابعون', following: 'يتابع' };

export default function FollowListModal({ visible, username, kind, onClose }: Props) {
  const { token } = useAuth();
  const navigation = useNavigation<RootNavigation>();
  const [items, setItems] = useState<UserPublic[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (reset: boolean) => {
    if (!token || (!reset && (loadingMore || !hasMore))) return;
    const skip = reset ? 0 : items.length;
    reset ? setLoading(true) : setLoadingMore(true);
    try {
      const page = await apiRequest<UserPublic[]>(
        `/api/users/${encodeURIComponent(username)}/${kind}?skip=${skip}&limit=${PAGE_SIZE}`,
        { token },
      );
      setItems((current) => reset ? page : [...current, ...page]);
      setHasMore(page.length === PAGE_SIZE);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل القائمة.');
    } finally {
      reset ? setLoading(false) : setLoadingMore(false);
    }
  }, [hasMore, items.length, kind, loadingMore, token, username]);

  useEffect(() => {
    if (visible) {
      setItems([]);
      setHasMore(true);
      setError(null);
      void load(true);
    }
  }, [visible, username, kind]); // load is intentionally called once per opened list

  function openProfile(person: UserPublic) {
    onClose();
    navigation.navigate('ProfileDetail', { username: person.username });
  }

  return <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="إغلاق" onPress={onClose} style={styles.close}>
          <Text style={styles.closeText}>إغلاق</Text>
        </Pressable>
        <Text style={styles.title}>{titles[kind]}</Text>
        <View style={styles.closeSpacer} />
      </View>
      {loading ? <View style={styles.center}><ActivityIndicator color={colors.primary} size="large" /><Text style={styles.muted}>جارٍ التحميل…</Text></View> :
        <FlatList
          data={items}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => <Pressable onPress={() => openProfile(item)} style={styles.row}>
            <Avatar uri={item.avatar_url} size={48} />
            <View style={styles.names}><Text style={styles.name}>{item.full_name}</Text><Text style={styles.handle}>@{item.username}</Text></View>
          </Pressable>}
          onEndReached={() => { if (hasMore) void load(false); }}
          onEndReachedThreshold={0.5}
          ListHeaderComponent={<ErrorText message={error} />}
          ListEmptyComponent={error ? null : <EmptyState title="لا توجد حسابات" detail={kind === 'followers' ? 'لم يتابع هذا الحساب أحد بعد.' : 'لا يتابع هذا الحساب أحدًا بعد.'} />}
          ListFooterComponent={loadingMore ? <ActivityIndicator color={colors.primary} style={styles.footer} /> : null}
          contentContainerStyle={items.length ? styles.list : styles.emptyList}
        />}
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, paddingTop: 14 },
  header: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: pagePadding, paddingBottom: 12, borderBottomColor: colors.border, borderBottomWidth: 1 },
  title: { color: colors.ink, fontSize: 19, fontWeight: '900', writingDirection: 'rtl' },
  close: { minWidth: 58, paddingVertical: 8 },
  closeText: { color: colors.primaryDark, fontWeight: '800', textAlign: 'left', writingDirection: 'rtl' },
  closeSpacer: { width: 58 },
  row: { flexDirection: 'row-reverse', alignItems: 'center', gap: 12, paddingHorizontal: pagePadding, paddingVertical: 11, borderBottomColor: colors.border, borderBottomWidth: 1 },
  names: { flex: 1, alignItems: 'flex-end' },
  name: { color: colors.ink, fontSize: 15, fontWeight: '800', writingDirection: 'rtl' },
  handle: { color: colors.muted, fontSize: 12, marginTop: 2 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  muted: { color: colors.muted, writingDirection: 'rtl' },
  list: { paddingBottom: 28 },
  emptyList: { flexGrow: 1, justifyContent: 'center' },
  footer: { padding: 15 },
});
