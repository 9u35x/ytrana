import React, { useCallback, useState } from 'react';
import { Alert, FlatList, Image, Modal, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type * as ImagePicker from 'expo-image-picker';
import { useFocusEffect } from '@react-navigation/native';
import { apiFormRequest, apiRequest, uploadMediaFile } from '../api';
import { useAuth } from '../auth';
import { Avatar, EmptyState, ErrorText, Panel, PrimaryButton, Screen, TextField, UploadProgress } from '../components';
import { MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, pickMedia } from '../media';
import StoryViewer from '../components/StoryViewer';
import { colors, pagePadding } from '../theme';
import type { MoodKey, Story } from '../types';

const moods: { key: MoodKey; label: string }[] = [
  { key: 'happy', label: '😊 سعيد' },
  { key: 'sad', label: '😔 حزين' },
];

function formatSize(bytes?: number): string {
  return bytes ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : '';
}

export default function StoriesScreen() {
  const { token, user } = useAuth();
  const [stories, setStories] = useState<Story[]>([]);
  const [caption, setCaption] = useState('');
  const [media, setMedia] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [mood, setMood] = useState<MoodKey | null>(null);
  const [viewing, setViewing] = useState<Story | null>(null);
  const [composer, setComposer] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setStories(await apiRequest<Story[]>('/api/stories/feed', { token }));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر تحميل القصص.');
    }
  }, [token]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function choose(kind: 'images' | 'videos') {
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
    if (!caption.trim() && !media) {
      setError('أضف نصًا أو صورة أو فيديو للقصة.');
      return;
    }
    setBusy(true);
    setError(null);
    setProgress(null);
    try {
      const fields = { caption: caption.trim(), mood_key: mood || '' };
      if (media) {
        const isVideo = media.type === 'video';
        await uploadMediaFile<Story>({
          path: '/api/stories',
          token,
          file: media,
          fieldName: isVideo ? 'video' : 'image',
          maxBytes: isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES,
          parameters: fields,
          onProgress: setProgress,
        });
      } else {
        await apiFormRequest<Story>('/api/stories', fields, token);
      }
      setComposer(false);
      setCaption('');
      setMedia(null);
      setMood(null);
      setProgress(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر نشر القصة. تحقق من الاتصال ثم أعد المحاولة.');
    } finally {
      setBusy(false);
    }
  }

  async function openStory(story: Story) {
    setViewing(story);
    if (!token || story.viewed_by_me || story.author.id === user?.id) return;
    try {
      const result = await apiRequest<{ views_count: number }>(`/api/stories/${story.id}/view`, { method: 'POST', token });
      setStories((current) => current.map((item) => item.id === story.id ? { ...item, viewed_by_me: true, views_count: result.views_count } : item));
    } catch {
      // The story remains watchable if the view counter cannot be updated.
    }
  }

  const header = <>
    <View style={styles.heading}>
      <View><Text style={styles.title}>القصص</Text><Text style={styles.subtitle}>لحظات تختفي تلقائيًا بعد 24 ساعة</Text></View>
      <Pressable accessibilityRole="button" onPress={() => { setError(null); setComposer(true); }} style={styles.addButton}><Ionicons name="add" size={18} color="#FFFFFF" /><Text style={styles.addText}>أضف قصتك</Text></Pressable>
    </View>
    {error ? <ErrorText message={error} /> : null}
  </>;

  return <Screen>
    <FlatList
      data={stories}
      keyExtractor={(item) => String(item.id)}
      ListHeaderComponent={header}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={colors.primary} />}
      renderItem={({ item }) => <Pressable onPress={() => openStory(item)}>
        <Panel style={styles.row}>
          <View style={styles.avatarRing}><Avatar uri={item.author.avatar_url} size={48} /></View>
          <View style={styles.info}>
            <Text style={styles.name}>{item.author.full_name}</Text>
            <Text style={styles.userHandle}>@{item.author.username}</Text>
            <Text style={styles.caption} numberOfLines={2}>{item.caption || 'قصة جديدة من المجتمع'}</Text>
            <Text style={styles.meta}>{item.video_url ? 'فيديو' : item.image_url ? 'صورة' : 'نص'}{item.mood_key ? ` · ${item.mood_key === 'happy' ? '😊 سعيد' : '😔 حزين'}` : ''} · {item.views_count} مشاهدة</Text>
          </View>
          <Ionicons name="chevron-back" size={18} color={colors.muted} />
        </Panel>
      </Pressable>}
      ListEmptyComponent={<EmptyState title={error ? 'تعذر تحميل القصص' : 'لا توجد قصص بعد'} detail={error || 'أضف قصة أو تابع أصدقاءك لتظهر لحظاتهم هنا.'} />}
      contentContainerStyle={styles.listContent}
      keyboardShouldPersistTaps="handled"
    />

    <Modal visible={composer} transparent animationType="slide" onRequestClose={() => !busy && setComposer(false)} statusBarTranslucent>
      <View style={styles.shade}><Pressable style={StyleSheet.absoluteFill} onPress={() => !busy && setComposer(false)} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.sheetHeader}><View><Text style={styles.modalTitle}>أضف قصة</Text><Text style={styles.modalSubtitle}>شارك لحظة مع متابعيك</Text></View><Avatar uri={user?.avatar_url} size={36} /></View>
          <TextField placeholder="اكتب شيئًا…" value={caption} onChangeText={setCaption} multiline maxLength={500} style={styles.captionInput} />
          {media ? <View style={styles.selectedMedia}><Ionicons name={media.type === 'video' ? 'videocam' : 'image'} size={21} color={colors.primaryDark} /><View style={styles.mediaInfo}><Text style={styles.mediaTitle}>{media.type === 'video' ? 'فيديو محدد' : 'صورة محددة'}</Text><Text style={styles.mediaName} numberOfLines={1}>{media.fileName || 'ملف محلي'}</Text><Text style={styles.mediaMeta}>{formatSize(media.fileSize)}</Text></View><Pressable onPress={() => setMedia(null)} style={styles.remove}><Ionicons name="close" size={17} color={colors.danger} /></Pressable></View> : null}
          <View style={styles.choices}>
            <Pressable onPress={() => choose('images')} disabled={busy} style={styles.choice}><Ionicons name="image-outline" size={18} color={colors.primaryDark} /><Text style={styles.choiceText}>صورة</Text></Pressable>
            <Pressable onPress={() => choose('videos')} disabled={busy} style={styles.choice}><Ionicons name="videocam-outline" size={18} color={colors.primaryDark} /><Text style={styles.choiceText}>فيديو</Text></Pressable>
            {moods.map((item) => <Pressable key={item.key} onPress={() => setMood(mood === item.key ? null : item.key)} disabled={busy} style={[styles.choice, mood === item.key && styles.active]}><Text style={styles.choiceText}>{item.label}</Text></Pressable>)}
          </View>
          <Text style={styles.note}>الصورة حتى 5MB · الفيديو حتى 60 ثانية و20MB · تنتهي بعد 24 ساعة</Text>
          {busy ? <UploadProgress progress={progress} label="جارٍ رفع القصة" /> : null}
          <ErrorText message={error} />
          <PrimaryButton title={busy ? 'جارٍ النشر…' : 'نشر القصة'} onPress={publish} disabled={busy || (!caption.trim() && !media)} />
          <Pressable onPress={() => !busy && setComposer(false)} disabled={busy} style={styles.cancel}><Text style={styles.cancelText}>إلغاء</Text></Pressable>
        </View>
      </View>
    </Modal>
    <StoryViewer story={viewing} close={() => setViewing(null)} />
  </Screen>;
}

const styles = StyleSheet.create({
  listContent: { paddingBottom: 22, flexGrow: 1 },
  heading: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: pagePadding, paddingVertical: 18 },
  title: { color: colors.ink, fontSize: 22, fontWeight: '900', textAlign: 'right', writingDirection: 'rtl' },
  subtitle: { color: colors.muted, fontSize: 11, marginTop: 3, textAlign: 'right', writingDirection: 'rtl' },
  addButton: { flexDirection: 'row-reverse', alignItems: 'center', gap: 4, minHeight: 39, paddingHorizontal: 12, borderRadius: 13, backgroundColor: colors.primary },
  addText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800', writingDirection: 'rtl' },
  row: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10, marginVertical: 5, padding: 13 },
  avatarRing: { padding: 2, borderRadius: 28, borderWidth: 2, borderColor: colors.coral },
  info: { flex: 1, alignItems: 'flex-end', gap: 2 },
  name: { color: colors.ink, fontWeight: '900', textAlign: 'right', writingDirection: 'rtl' },
  userHandle: { color: colors.muted, fontSize: 10, textAlign: 'right' },
  caption: { color: colors.ink, fontSize: 12, textAlign: 'right', writingDirection: 'rtl', marginTop: 2 },
  meta: { color: colors.primaryDark, fontSize: 10, textAlign: 'right', writingDirection: 'rtl', marginTop: 2 },
  shade: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#17132288' },
  sheet: { backgroundColor: colors.background, paddingHorizontal: 18, paddingTop: 9, paddingBottom: 25, borderTopLeftRadius: 26, borderTopRightRadius: 26, gap: 9 },
  handle: { width: 38, height: 4, alignSelf: 'center', borderRadius: 3, backgroundColor: '#D9D5E3', marginBottom: 3 },
  sheetHeader: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between' },
  modalTitle: { color: colors.ink, fontWeight: '900', fontSize: 20, textAlign: 'right', writingDirection: 'rtl' },
  modalSubtitle: { color: colors.muted, fontSize: 11, textAlign: 'right', writingDirection: 'rtl' },
  captionInput: { minHeight: 68, maxHeight: 110, marginVertical: 0 },
  selectedMedia: { flexDirection: 'row-reverse', alignItems: 'center', gap: 9, backgroundColor: '#FFFFFF', padding: 9, borderRadius: 14 },
  mediaInfo: { flex: 1, alignItems: 'flex-end' },
  mediaTitle: { color: colors.ink, fontSize: 12, fontWeight: '800', textAlign: 'right', writingDirection: 'rtl' },
  mediaName: { color: colors.muted, fontSize: 10, maxWidth: '100%' },
  mediaMeta: { color: colors.primaryDark, fontSize: 10 },
  remove: { width: 29, height: 29, borderRadius: 15, backgroundColor: '#FFECEF', alignItems: 'center', justifyContent: 'center' },
  choices: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 7 },
  choice: { flexDirection: 'row-reverse', alignItems: 'center', gap: 5, minHeight: 36, paddingHorizontal: 10, borderRadius: 12, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: colors.border },
  choiceText: { color: colors.ink, fontSize: 11, fontWeight: '700', writingDirection: 'rtl' },
  active: { borderColor: colors.primary, backgroundColor: colors.soft },
  note: { color: colors.muted, fontSize: 10, textAlign: 'right', writingDirection: 'rtl' },
  cancel: { alignItems: 'center', paddingVertical: 4 },
  cancelText: { color: colors.muted, fontWeight: '700' },
  viewer: { flex: 1, backgroundColor: colors.overlay, paddingHorizontal: 16, paddingTop: 54, paddingBottom: 26, justifyContent: 'space-between' },
  viewerHead: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between' },
  viewerUser: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8 },
  viewerName: { color: '#FFFFFF', fontWeight: '800' },
  viewerClose: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#FFFFFF22', alignItems: 'center', justifyContent: 'center' },
  viewerMedia: { flex: 1, width: '100%', marginVertical: 12 },
  textStory: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  storyText: { color: '#FFFFFF', fontSize: 26, fontWeight: '800', textAlign: 'center', writingDirection: 'rtl' },
  viewerBottom: { alignItems: 'center', gap: 7, minHeight: 34 },
  viewerCaption: { color: '#FFFFFF', textAlign: 'center', writingDirection: 'rtl' },
  viewerMood: { color: '#FFFFFF', fontWeight: '800' },
});
