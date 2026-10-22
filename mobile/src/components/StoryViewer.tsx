import React, { useEffect, useRef, useState } from 'react';
import { Alert, Image, Keyboard, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { VideoView, useVideoPlayer } from 'expo-video';
import { apiRequest, authenticatedMediaSource } from '../api';
import { useAuth } from '../auth';
import { Avatar } from '../components';
import { colors } from '../theme';
import type { Story } from '../types';
import ReportButton from './ReportButton';

type Props = { story: Story | null; close: () => void };

export default function StoryViewer({ story, close }: Props) {
  const { token, user } = useAuth();
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [paused, setPaused] = useState(false);
  const [showCue, setShowCue] = useState(false);
  const cueTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const player = useVideoPlayer(authenticatedMediaSource(story?.video_url, token) || null, (videoPlayer) => { videoPlayer.loop = false; });

  useEffect(() => {
    setReply('');
    setPaused(!story?.video_url);
    setShowCue(false);
    if (story?.video_url) player.play();
    else player.pause();
  }, [story?.id, story?.video_url, player]);
  useEffect(() => () => { if (cueTimer.current) clearTimeout(cueTimer.current); }, []);

  function togglePlayback() {
    const next = !paused;
    setPaused(next);
    if (next) player.pause(); else player.play();
    setShowCue(true);
    if (cueTimer.current) clearTimeout(cueTimer.current);
    cueTimer.current = setTimeout(() => setShowCue(false), 650);
  }

  async function sendReply() {
    const text = reply.trim();
    if (!token || !story || !text || sending) return;
    setSending(true);
    try {
      const quote = story.caption?.trim().slice(0, 120);
      const content = `رد على قصتك${quote ? `: «${quote}${story.caption && story.caption.length > 120 ? '…' : ''}»` : ''}\n${text}`;
      await apiRequest(`/api/messages/${encodeURIComponent(story.author.username)}`, {
        method: 'POST', token, body: { content },
      });
      setReply('');
      Keyboard.dismiss();
      Alert.alert('تم إرسال الرد', `وصل ردك إلى ${story.author.full_name}.`);
    } catch (error) {
      Alert.alert('تعذر إرسال الرد', error instanceof Error ? error.message : 'حاول مرة أخرى.');
    } finally {
      setSending(false);
    }
  }

  const isMine = !!story && story.author.id === user?.id;
  const rawImageSource = authenticatedMediaSource(story?.image_url, token);
  const imageSource = typeof rawImageSource === 'string' ? { uri: rawImageSource } : rawImageSource || undefined;
  return <Modal visible={!!story} onRequestClose={close} statusBarTranslucent animationType="fade">
    <View style={styles.viewer}>
      <View style={styles.top}>
        <View style={styles.user}>
          <Avatar uri={story?.author.avatar_url} size={38} />
          <View style={styles.userInfo}>
            <Text style={styles.name}>@{story?.author.username}</Text>
            <Text style={styles.meta}>{story?.views_count || 0} مشاهدة</Text>
          </View>
        </View>
        {!isMine && story ? <ReportButton targetType="story" targetId={story.id} label="إبلاغ" /> : null}<Pressable accessibilityRole="button" accessibilityLabel="إغلاق القصة" onPress={close} style={styles.close}>
          <Ionicons name="close" size={23} color="#FFFFFF" />
        </Pressable>
      </View>

      {story?.video_url ? (
        <View style={styles.mediaStage}>
          <VideoView player={player} style={styles.media} contentFit="contain" nativeControls={false} />
          <Pressable accessibilityRole="button" accessibilityLabel={paused ? 'تشغيل القصة' : 'إيقاف القصة مؤقتًا'} onPress={togglePlayback} style={StyleSheet.absoluteFill} />
          {showCue ? <View pointerEvents="none" style={styles.playCue}><Ionicons name={paused ? 'play' : 'pause'} size={27} color="#FFFFFF" /></View> : null}
        </View>
      ) : story?.image_url ? (
        <Image source={imageSource} style={styles.media} resizeMode="contain" />
      ) : (
        <View style={styles.textStage}><Text style={styles.textStory}>{story?.caption}</Text></View>
      )}

      <View style={styles.bottom}>
        {story?.caption && story.image_url ? <Text style={styles.caption}>{story.caption}</Text> : null}
        {story?.mood_key ? <Text style={styles.mood}>{story.mood_key === 'happy' ? '😊 سعيد' : '😔 حزين'}</Text> : null}
        {!isMine && story ? (
          <View style={styles.replyRow}>
            <TextInput
              accessibilityLabel="اكتب ردًا على القصة"
              placeholder="أرسل ردًا على القصة…"
              placeholderTextColor="#B8B4C3"
              value={reply}
              onChangeText={setReply}
              maxLength={500}
              multiline
              editable={!sending}
              style={styles.replyInput}
              textAlign="right"
            />
            <Pressable accessibilityRole="button" accessibilityLabel="إرسال الرد" onPress={sendReply} disabled={!reply.trim() || sending} style={[styles.sendButton, (!reply.trim() || sending) && styles.sendDisabled]}>
              <Ionicons name="send" size={18} color="#FFFFFF" />
            </Pressable>
          </View>
        ) : null}
      </View>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  viewer: { flex: 1, backgroundColor: colors.overlay, paddingHorizontal: 16, paddingTop: 54, paddingBottom: 22, justifyContent: 'space-between' },
  top: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between' },
  user: { flexDirection: 'row-reverse', alignItems: 'center', gap: 9 },
  userInfo: { alignItems: 'flex-end', gap: 2 },
  name: { color: '#FFFFFF', fontWeight: '900', textAlign: 'right' },
  meta: { color: '#FFFFFFB0', fontSize: 10, textAlign: 'right' },
  close: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#FFFFFF22', alignItems: 'center', justifyContent: 'center' },
  mediaStage: { flex: 1, width: '100%', marginVertical: 12, justifyContent: 'center', alignItems: 'center' },
  media: { flex: 1, width: '100%', marginVertical: 12 },
  playCue: { position: 'absolute', width: 56, height: 56, borderRadius: 28, backgroundColor: '#17132288', alignItems: 'center', justifyContent: 'center' },
  textStage: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  textStory: { color: '#FFFFFF', fontSize: 27, fontWeight: '800', textAlign: 'center', writingDirection: 'rtl' },
  bottom: { gap: 9, paddingBottom: 2 },
  caption: { color: '#FFFFFF', fontSize: 14, textAlign: 'center', writingDirection: 'rtl' },
  mood: { color: '#FFFFFF', fontWeight: '800', textAlign: 'center' },
  replyRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 9, minHeight: 48, marginTop: 4, paddingHorizontal: 12, borderRadius: 18, borderWidth: 1, borderColor: '#FFFFFF30', backgroundColor: '#FFFFFF14' },
  replyInput: { flex: 1, minHeight: 42, maxHeight: 86, paddingVertical: 10, color: '#FFFFFF', fontSize: 14, writingDirection: 'rtl' },
  sendButton: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  sendDisabled: { opacity: 0.5 },
});
