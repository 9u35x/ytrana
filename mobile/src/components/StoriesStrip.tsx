import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type * as ImagePicker from 'expo-image-picker';
import { apiFormRequest, apiRequest, uploadMediaFile } from '../api';
import { useAuth } from '../auth';
import { Avatar, ErrorText, PrimaryButton, SectionTitle, TextField, UploadProgress } from '../components';
import { MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, pickMedia } from '../media';
import StoryViewer from './StoryViewer';
import { colors } from '../theme';
import type { MoodKey, Story } from '../types';

const moods: { key: MoodKey; label: string; emoji: string }[] = [
  { key: 'happy', label: 'سعيد', emoji: '😊' },
  { key: 'sad', label: 'حزين', emoji: '😔' },
];

function formatSize(bytes?: number): string {
  return bytes ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : '';
}

export default function StoriesStrip({ onSeeAll }: { onSeeAll?: () => void }) {
  const { token, user } = useAuth();
  const [stories, setStories] = useState<Story[]>([]);
  const [open, setOpen] = useState(false);
  const [viewing, setViewing] = useState<Story | null>(null);
  const [caption, setCaption] = useState('');
  const [media, setMedia] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [mood, setMood] = useState<MoodKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setStories(await apiRequest<Story[]>('/api/stories/feed', { token }));
    } catch {
      // Keep the home feed usable if the story list is temporarily unavailable.
    }
  }, [token]);
  useEffect(() => { load(); }, [load]);

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
    setUploadProgress(null);
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
          onProgress: setUploadProgress,
        });
      } else {
        await apiFormRequest<Story>('/api/stories', fields, token);
      }
      setOpen(false);
      setCaption('');
      setMedia(null);
      setMood(null);
      setUploadProgress(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر نشر القصة. تحقق من الاتصال وأعد المحاولة.');
    } finally {
      setBusy(false);
    }
  }

  async function show(story: Story) {
    setViewing(story);
    if (token && !story.viewed_by_me && story.author.id !== user?.id) {
      try {
        const result = await apiRequest<{ views_count: number }>(`/api/stories/${story.id}/view`, { method: 'POST', token });
        setStories((current) => current.map((item) => item.id === story.id ? { ...item, viewed_by_me: true, views_count: result.views_count } : item));
      } catch {
        // Viewing remains available even if the view counter cannot be updated.
      }
    }
  }

  return <>
    <View style={styles.wrap}>
      <SectionTitle title="القصص" trailing={onSeeAll ? <Pressable onPress={onSeeAll} style={styles.seeAll}><Text style={styles.seeAllText}>عرض الكل</Text><Ionicons name="chevron-back" size={15} color={colors.primaryDark} /></Pressable> : null} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        <Pressable accessibilityRole="button" accessibilityLabel="إضافة قصة" onPress={() => { setError(null); setOpen(true); }} style={styles.bubble}>
          <View style={styles.addRing}><Avatar uri={user?.avatar_url} size={56} /><View style={styles.plusBadge}><Ionicons name="add" size={16} color="#FFFFFF" /></View></View>
          <Text style={styles.name}>قصتي</Text>
        </Pressable>
        {stories.map((story) => <Pressable key={story.id} onPress={() => show(story)} style={styles.bubble}>
          <View style={[styles.ring, story.viewed_by_me && styles.seen]}><Avatar uri={story.author.avatar_url} size={56} /></View>
          <Text style={styles.name} numberOfLines={1}>{story.author.username}</Text>
        </Pressable>)}
      </ScrollView>
    </View>

    <Modal visible={open} transparent animationType="slide" onRequestClose={() => !busy && setOpen(false)} statusBarTranslucent>
      <View style={styles.shade}>
        <Pressable accessibilityLabel="إغلاق محرر القصة" style={StyleSheet.absoluteFill} onPress={() => !busy && setOpen(false)} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.sheetHeader}><View><Text style={styles.modalTitle}>أضف قصة</Text><Text style={styles.modalSubtitle}>شارك لحظة تختفي بعد 24 ساعة</Text></View><Pressable onPress={() => !busy && setOpen(false)} style={styles.closeButton}><Ionicons name="close" size={20} color={colors.muted} /></Pressable></View>
          <TextField placeholder="اكتب شيئًا…" value={caption} onChangeText={setCaption} maxLength={500} multiline style={styles.captionInput} />
          {media ? <View style={styles.selectedMedia}>
            {media.type === 'image' ? <Image source={{ uri: media.uri }} style={styles.previewImage} /> : <View style={styles.previewVideo}><Ionicons name="play" size={22} color="#FFFFFF" /></View>}
            <View style={styles.mediaInfo}><Text style={styles.mediaTitle}>{media.type === 'video' ? 'فيديو للقصة' : 'صورة للقصة'}</Text><Text style={styles.mediaName} numberOfLines={1}>{media.fileName || 'ملف محدد'}</Text><Text style={styles.mediaMeta}>{formatSize(media.fileSize)} · ملف واحد</Text></View>
            <Pressable accessibilityRole="button" accessibilityLabel="إزالة المرفق" onPress={() => setMedia(null)} style={styles.removeButton}><Ionicons name="close" size={17} color={colors.danger} /></Pressable>
          </View> : null}
          <View style={styles.mediaActions}>
            <Pressable onPress={() => choose('images')} disabled={busy} style={styles.actionChip}><Ionicons name="image-outline" size={18} color={colors.primaryDark} /><Text style={styles.actionText}>صورة</Text></Pressable>
            <Pressable onPress={() => choose('videos')} disabled={busy} style={styles.actionChip}><Ionicons name="videocam-outline" size={18} color={colors.primaryDark} /><Text style={styles.actionText}>فيديو</Text></Pressable>
          </View>
          <View style={styles.moods}>{moods.map((item) => <Pressable key={item.key} onPress={() => setMood(mood === item.key ? null : item.key)} disabled={busy} style={[styles.mood, mood === item.key && styles.selectedMood]}><Text style={styles.moodText}>{item.emoji} {item.label}</Text></Pressable>)}</View>
          <Text style={styles.hint}>الصورة حتى 5MB · الفيديو حتى 60 ثانية و20MB</Text>
          {busy ? <UploadProgress progress={uploadProgress} label="جارٍ رفع القصة" /> : null}
          <ErrorText message={error} />
          <PrimaryButton title={busy ? 'جارٍ النشر…' : 'نشر القصة'} onPress={publish} disabled={busy || (!caption.trim() && !media)} />
          <Pressable onPress={() => !busy && setOpen(false)} disabled={busy} style={styles.cancelButton}><Text style={styles.cancel}>إلغاء</Text></Pressable>
        </View>
      </View>
    </Modal>
    <StoryViewer story={viewing} close={() => setViewing(null)} />
  </>;
}

const styles = StyleSheet.create({
  wrap: { paddingTop: 3 },
  seeAll: { flexDirection: 'row-reverse', alignItems: 'center', gap: 2, paddingVertical: 4 },
  seeAllText: { color: colors.primaryDark, fontSize: 11, fontWeight: '800', writingDirection: 'rtl' },
  row: { flexDirection: 'row-reverse', paddingHorizontal: 16, paddingVertical: 3, gap: 13 },
  bubble: { width: 68, alignItems: 'center' },
  addRing: { width: 66, height: 66, borderRadius: 33, padding: 3, borderWidth: 2, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  plusBadge: { position: 'absolute', right: -1, bottom: -1, width: 23, height: 23, borderRadius: 12, backgroundColor: colors.aqua, borderWidth: 2, borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  ring: { width: 66, height: 66, borderRadius: 33, padding: 3, borderWidth: 2, borderColor: colors.coral, alignItems: 'center', justifyContent: 'center' },
  seen: { borderColor: colors.border },
  name: { maxWidth: 68, color: colors.ink, fontSize: 11, fontWeight: '700', marginTop: 5, textAlign: 'center', writingDirection: 'rtl' },
  shade: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#17132288' },
  sheet: { backgroundColor: colors.background, paddingHorizontal: 18, paddingTop: 9, paddingBottom: 26, borderTopLeftRadius: 27, borderTopRightRadius: 27, gap: 9 },
  handle: { width: 38, height: 4, alignSelf: 'center', borderRadius: 3, backgroundColor: '#D9D5E3', marginBottom: 3 },
  sheetHeader: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between' },
  modalTitle: { color: colors.ink, fontWeight: '900', fontSize: 20, textAlign: 'right', writingDirection: 'rtl' },
  modalSubtitle: { color: colors.muted, fontSize: 11, textAlign: 'right', writingDirection: 'rtl', marginTop: 2 },
  closeButton: { width: 35, height: 35, borderRadius: 18, backgroundColor: '#ECEAF1', alignItems: 'center', justifyContent: 'center' },
  captionInput: { minHeight: 68, maxHeight: 110, backgroundColor: '#FFFFFF', borderColor: colors.border, marginVertical: 0 },
  selectedMedia: { flexDirection: 'row-reverse', alignItems: 'center', gap: 9, padding: 8, borderRadius: 14, backgroundColor: '#FFFFFF' },
  previewImage: { width: 50, height: 50, borderRadius: 10, backgroundColor: colors.soft },
  previewVideo: { width: 50, height: 50, borderRadius: 10, backgroundColor: colors.primaryDark, alignItems: 'center', justifyContent: 'center' },
  mediaInfo: { flex: 1, alignItems: 'flex-end' },
  mediaTitle: { color: colors.ink, fontSize: 12, fontWeight: '800', textAlign: 'right', writingDirection: 'rtl' },
  mediaName: { color: colors.muted, fontSize: 10, maxWidth: '100%' },
  mediaMeta: { color: colors.primaryDark, fontSize: 10 },
  removeButton: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#FFECEF', alignItems: 'center', justifyContent: 'center' },
  mediaActions: { flexDirection: 'row-reverse', gap: 8 },
  actionChip: { flexDirection: 'row-reverse', alignItems: 'center', gap: 7, paddingHorizontal: 14, minHeight: 40, borderRadius: 13, backgroundColor: colors.soft },
  actionText: { color: colors.primaryDark, fontSize: 12, fontWeight: '800', writingDirection: 'rtl' },
  moods: { flexDirection: 'row-reverse', gap: 8 },
  mood: { paddingHorizontal: 12, minHeight: 37, justifyContent: 'center', borderRadius: 12, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: colors.border },
  selectedMood: { borderColor: colors.primary, backgroundColor: colors.soft },
  moodText: { color: colors.ink, fontSize: 12, fontWeight: '700', writingDirection: 'rtl' },
  hint: { color: colors.muted, fontSize: 10, textAlign: 'right', writingDirection: 'rtl' },
  cancelButton: { alignItems: 'center', paddingVertical: 5 },
  cancel: { color: colors.muted, fontWeight: '700' },
  viewer: { flex: 1, backgroundColor: colors.overlay, paddingHorizontal: 16, paddingTop: 54, paddingBottom: 28, justifyContent: 'space-between' },
  viewerTop: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between' },
  viewerUser: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8 },
  viewerName: { color: '#FFFFFF', fontWeight: '900', textAlign: 'right' },
  viewerMeta: { color: '#FFFFFFB0', fontSize: 10, textAlign: 'right' },
  viewerClose: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#FFFFFF22', alignItems: 'center', justifyContent: 'center' },
  viewerMedia: { flex: 1, width: '100%', marginVertical: 12 },
  textStory: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  textCaption: { color: '#FFFFFF', fontSize: 27, fontWeight: '800', textAlign: 'center', writingDirection: 'rtl' },
  viewerBottom: { alignItems: 'center', gap: 8, minHeight: 36 },
  viewerCaption: { color: '#FFFFFF', fontSize: 15, textAlign: 'center', writingDirection: 'rtl' },
  viewerMood: { color: '#FFFFFF', fontWeight: '800' },
});
