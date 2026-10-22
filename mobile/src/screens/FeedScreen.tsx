import React, { useCallback, useState } from 'react';
import { Alert, FlatList, Image, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type * as ImagePicker from 'expo-image-picker';
import { apiFormRequest, apiRequest, enrichPostMedia, uploadMediaFile } from '../api';
import { useAuth } from '../auth';
import { Avatar, EmptyState, ErrorText, Panel, PrimaryButton, Screen, SectionTitle, TextField, UploadProgress } from '../components';
import { type RootNavigation } from '../navigation';
import { MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, pickMedia } from '../media';
import { colors, pagePadding } from '../theme';
import type { MoodKey, Post } from '../types';
import StoriesStrip from '../components/StoriesStrip';
import PostCard from './PostCard';

const moodOptions: { key: MoodKey; label: string }[] = [
  { key: 'happy', label: '😊 سعيد' },
  { key: 'sad', label: '😔 حزين' },
];

function formatSize(bytes?: number): string {
  if (!bytes) return '';
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function FeedScreen() {
  const { token, user } = useAuth();
  const navigation = useNavigation<RootNavigation>();
  const [posts, setPosts] = useState<Post[]>([]);
  const [text, setText] = useState('');
  const [media, setMedia] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [mood, setMood] = useState<MoodKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const base = await apiRequest<Post[]>('/api/posts/feed?skip=0&limit=30', { token });
      setPosts(await enrichPostMedia(base, token));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر تحميل الخلاصة.');
    }
  }, [token]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function chooseMedia(kind: 'images' | 'videos') {
    try {
      const asset = await pickMedia(kind);
      if (!asset) return;
      setMedia(asset);
      setError(null);
    } catch (e) {
      Alert.alert('تعذر اختيار الملف', e instanceof Error ? e.message : 'حاول اختيار ملف آخر.');
    }
  }

  async function publish() {
    if (!token || busy) return;
    if (!text.trim() && !media) return setError('اكتب شيئًا أو أرفق صورة أو فيديو.');
    setBusy(true);
    setError(null);
    setUploadProgress(null);
    try {
      if (media) {
        const isVideo = media.type === 'video';
        await uploadMediaFile<Post>({
          path: '/api/media/posts',
          token,
          file: media,
          fieldName: isVideo ? 'video' : 'image',
          maxBytes: isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES,
          parameters: { content: text.trim(), mood_key: mood || '' },
          onProgress: setUploadProgress,
        });
      } else {
        await apiFormRequest<Post>('/api/posts', { content: text.trim(), mood_key: mood || '' }, token);
      }
      setText('');
      setMedia(null);
      setMood(null);
      setUploadProgress(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر نشر المحتوى. أعد المحاولة.');
    } finally {
      setBusy(false);
    }
  }

  const greetingName = user?.full_name?.split(' ')[0] || 'بك';
  const listHeader = <>
    <View style={styles.welcome}>
      <View style={styles.welcomeCopy}>
        <Text style={styles.welcomeTitle}>مرحبًا، {greetingName}</Text>
        <Text style={styles.welcomeSubtitle}>لحظات جديدة من مجتمعك اليوم</Text>
      </View>
      <Avatar uri={user?.avatar_url} size={46} />
    </View>
    <StoriesStrip onSeeAll={() => navigation.navigate('Main', { screen: 'Stories' })} />
    <Panel style={styles.composer}>
      <View style={styles.composerHeading}>
        <View style={styles.composerTitleBlock}>
          <Text style={styles.composerTitle}>شارك لحظتك</Text>
          <Text style={styles.composerSub}>منشور جديد لمتابعيك</Text>
        </View>
        <Avatar uri={user?.avatar_url} size={38} />
      </View>
      <TextField placeholder="بماذا تفكر؟" value={text} onChangeText={setText} multiline maxLength={3000} style={styles.composerInput} />
      {media ? <View style={styles.selectedMedia}>
        {media.type === 'image'
          ? <Image source={{ uri: media.uri }} style={styles.previewImage} />
          : <View style={styles.previewVideo}><Ionicons name="play-circle" size={30} color="#FFFFFF" /></View>}
        <View style={styles.mediaInfo}>
          <Text style={styles.mediaTitle}>{media.type === 'video' ? 'فيديو جاهز للنشر' : 'صورة جاهزة للنشر'}</Text>
          <Text numberOfLines={1} style={styles.mediaName}>{media.fileName || 'ملف محدد'}</Text>
          <Text style={styles.mediaMeta}>{formatSize(media.fileSize)} · ملف واحد</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="إزالة الملف" onPress={() => setMedia(null)} style={styles.removeButton}>
          <Ionicons name="close" size={17} color={colors.danger} />
        </Pressable>
      </View> : null}
      <View style={styles.toolbar}>
        <View style={styles.mediaActions}>
          <Pressable onPress={() => chooseMedia('images')} disabled={busy} style={styles.actionChip}>
            <Ionicons name="image-outline" size={17} color={colors.primaryDark} /><Text style={styles.actionText}>صورة</Text>
          </Pressable>
          <Pressable onPress={() => chooseMedia('videos')} disabled={busy} style={styles.actionChip}>
            <Ionicons name="videocam-outline" size={17} color={colors.primaryDark} /><Text style={styles.actionText}>فيديو</Text>
          </Pressable>
        </View>
        <View style={styles.moodActions}>
          {moodOptions.map((item) => <Pressable key={item.key} onPress={() => setMood(mood === item.key ? null : item.key)} disabled={busy} style={[styles.moodChip, mood === item.key && styles.moodActive]}>
            <Text style={[styles.moodText, mood === item.key && styles.moodTextActive]}>{item.label}</Text>
          </Pressable>)}
        </View>
      </View>
      {busy ? <UploadProgress progress={uploadProgress} label={media ? 'جارٍ رفع المنشور' : 'جارٍ نشر المنشور'} /> : null}
      <ErrorText message={error} />
      <View style={styles.publishRow}>
        <Text style={styles.limitNote}>{media?.type === 'video' ? 'فيديو حتى 60 ثانية و20MB' : media?.type === 'image' ? 'صورة حتى 5MB' : 'شارك ما يدور في بالك'}</Text>
        <PrimaryButton title={busy ? 'جارٍ النشر…' : 'نشر'} onPress={publish} disabled={busy || (!text.trim() && !media)} compact />
      </View>
    </Panel>
    <SectionTitle title="أحدث المنشورات" />
  </>;

  return <Screen>
    <FlatList
      data={posts}
      keyExtractor={(item) => String(item.id)}
      renderItem={({ item }) => <PostCard post={item} />}
      ListHeaderComponent={listHeader}
      ListEmptyComponent={<EmptyState title={error ? 'تعذر عرض الخلاصة' : 'لا توجد منشورات بعد'} detail={error || 'تابع أشخاصًا أو شارك أول منشورك.'} />}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={colors.primary} />}
      contentContainerStyle={styles.listContent}
      keyboardShouldPersistTaps="handled"
    />
  </Screen>;
}

const styles = StyleSheet.create({
  listContent: { paddingBottom: 16 },
  welcome: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: pagePadding, paddingTop: 14, paddingBottom: 4 },
  welcomeCopy: { alignItems: 'flex-end', gap: 3 },
  welcomeTitle: { color: colors.ink, fontSize: 18, fontWeight: '900', textAlign: 'right', writingDirection: 'rtl' },
  welcomeSubtitle: { color: colors.muted, fontSize: 12, textAlign: 'right', writingDirection: 'rtl' },
  composer: { padding: 13, gap: 5 },
  composerHeading: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 },
  composerTitleBlock: { flex: 1, alignItems: 'flex-end', marginRight: 10 },
  composerTitle: { color: colors.ink, fontSize: 15, fontWeight: '900', textAlign: 'right', writingDirection: 'rtl' },
  composerSub: { color: colors.muted, fontSize: 11, textAlign: 'right', writingDirection: 'rtl', marginTop: 2 },
  composerInput: { minHeight: 76, marginVertical: 4, backgroundColor: colors.background, borderColor: 'transparent' },
  selectedMedia: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10, marginTop: 4, padding: 8, borderRadius: 15, backgroundColor: colors.background },
  previewImage: { width: 54, height: 54, borderRadius: 11, backgroundColor: colors.soft },
  previewVideo: { width: 54, height: 54, borderRadius: 11, backgroundColor: colors.primaryDark, alignItems: 'center', justifyContent: 'center' },
  mediaInfo: { flex: 1, alignItems: 'flex-end' },
  mediaTitle: { color: colors.ink, fontSize: 12, fontWeight: '800', textAlign: 'right', writingDirection: 'rtl' },
  mediaName: { color: colors.muted, fontSize: 10, maxWidth: '100%' },
  mediaMeta: { color: colors.primaryDark, fontSize: 10 },
  removeButton: { width: 31, height: 31, borderRadius: 16, backgroundColor: '#FFECEF', alignItems: 'center', justifyContent: 'center' },
  toolbar: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 9, marginTop: 5 },
  mediaActions: { flexDirection: 'row-reverse', gap: 7 },
  actionChip: { flexDirection: 'row-reverse', alignItems: 'center', gap: 5, minHeight: 36, paddingHorizontal: 11, borderRadius: 12, backgroundColor: colors.soft },
  actionText: { color: colors.primaryDark, fontSize: 12, fontWeight: '800', writingDirection: 'rtl' },
  moodActions: { flexDirection: 'row-reverse', gap: 6 },
  moodChip: { paddingHorizontal: 9, minHeight: 34, justifyContent: 'center', borderRadius: 12, backgroundColor: colors.background, borderWidth: 1, borderColor: 'transparent' },
  moodActive: { borderColor: colors.primary, backgroundColor: colors.soft },
  moodText: { color: colors.muted, fontSize: 11, fontWeight: '700' },
  moodTextActive: { color: colors.primaryDark },
  publishRow: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  limitNote: { color: colors.muted, fontSize: 10, textAlign: 'right', writingDirection: 'rtl' },
});
