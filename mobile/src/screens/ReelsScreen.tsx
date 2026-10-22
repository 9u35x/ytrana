import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Dimensions, FlatList, Image, Modal, Pressable, StyleSheet, Text, View, type ViewToken } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useIsFocused, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type * as ImagePicker from 'expo-image-picker';
import { VideoView, useVideoPlayer } from 'expo-video';
import { apiRequest, authenticatedMediaSource, mediaUrl, uploadMediaFile } from '../api';
import { useAuth } from '../auth';
import { Avatar, EmptyState, ErrorText, PrimaryButton, Screen, SecondaryButton, TextField, UploadProgress } from '../components';
import { type RootNavigation, type TabParamList } from '../navigation';
import { MAX_VIDEO_BYTES, pickMedia } from '../media';
import { colors } from '../theme';
import type { MoodKey, Post, Reel } from '../types';
import ReportButton from '../components/ReportButton';

const CARD_HEIGHT = Math.max(390, Dimensions.get('window').height - 220);
const ITEM_HEIGHT = CARD_HEIGHT + 10;
type ReelsFeedRow = { kind: 'post'; key: string; post: Post } | { kind: 'reel'; key: string; reel: Reel };

function formatSize(bytes?: number): string {
  return bytes ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : '';
}

export default function ReelsScreen() {
  const { token } = useAuth();
  const navigation = useNavigation<RootNavigation>();
  const route = useRoute<RouteProp<TabParamList, 'Reels'>>();
  const postId = route.params?.postId;
  const [reels, setReels] = useState<Reel[]>([]);
  const [featuredPost, setFeaturedPost] = useState<Post | null>(null);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [activePostId, setActivePostId] = useState<number | null>(null);
  const [selectedVideo, setSelectedVideo] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [caption, setCaption] = useState('');
  const [mood, setMood] = useState<MoodKey | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const isFocused = useIsFocused();

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const rows = await apiRequest<Reel[]>('/api/reels/feed?skip=0&limit=20', { token });
      setReels(rows);
      setHasMore(rows.length === 20);
      setActiveId(rows[0]?.id ?? null);
      setError(null);
      if (postId) {
        try {
          const post = await apiRequest<Post>(`/api/media/posts/${postId}`, { token });
          const playable = post.video_url ? post : null;
          setFeaturedPost(playable);
          setActivePostId(playable?.id ?? null);
          if (playable) setActiveId(null);
        } catch {
          setFeaturedPost(null);
          setActivePostId(null);
        }
      } else {
        setFeaturedPost(null);
        setActivePostId(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل الريلز.');
    }
  }, [token, postId]);
  useFocusEffect(useCallback(() => { load(); return () => { setActiveId(null); setActivePostId(null); }; }, [load]));

  const loadMore = useCallback(async () => {
    if (!token || loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const rows = await apiRequest<Reel[]>(`/api/reels/feed?skip=${reels.length}&limit=20`, { token });
      setReels((current) => [...current, ...rows]);
      setHasMore(rows.length === 20);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل المزيد من الريلز.');
    } finally { setLoadingMore(false); }
  }, [hasMore, loadingMore, reels.length, token]);

  const openProfile = useCallback((username: string) => navigation.navigate('ProfileDetail', { username }), [navigation]);
  const updateLike = useCallback((id: number, next: boolean) => {
    setReels((old) => old.map((row) => row.id === id ? { ...row, liked_by_me: next, likes_count: Math.max(0, row.likes_count + (next ? 1 : -1)) } : row));
  }, []);
  const renderItem = useCallback(({ item }: { item: ReelsFeedRow }) => item.kind === 'post'
    ? <PostReelItem post={item.post} active={isFocused && item.post.id === activePostId} />
    : <ReelItem reel={item.reel} active={isFocused && item.reel.id === activeId} onOpenProfile={openProfile} onLike={updateLike} />, [activeId, activePostId, isFocused, openProfile, updateLike]);

  const feedRows: ReelsFeedRow[] = [
    ...(featuredPost ? [{ kind: 'post' as const, key: `post-${featuredPost.id}`, post: featuredPost }] : []),
    ...reels.map((reel) => ({ kind: 'reel' as const, key: `reel-${reel.id}`, reel })),
  ];

  const viewed = useRef(new Set<number>());
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const row = viewableItems.find((view) => view.isViewable)?.item as ReelsFeedRow | undefined;
    if (!row) return;
    if (row.kind === 'post') {
      setActivePostId(row.post.id);
      setActiveId(null);
      return;
    }
    const item = row.reel;
    setActivePostId(null);
    setActiveId(item.id);
    if (!item.viewed_by_me && token && !viewed.current.has(item.id)) {
      viewed.current.add(item.id);
      apiRequest<{ views_count: number }>(`/api/reels/${item.id}/view`, { method: 'POST', token }).then((result) => {
        setReels((old) => old.map((current) => current.id === item.id ? { ...current, viewed_by_me: true, views_count: result.views_count } : current));
      }).catch(() => viewed.current.delete(item.id));
    }
  }).current;
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 70 }).current;

  async function chooseVideo() {
    if (!token || busy) return;
    try {
      const video = await pickMedia('videos');
      if (!video) return;
      setSelectedVideo(video);
      setCaption('');
      setError(null);
      setComposerOpen(true);
    } catch (err) {
      Alert.alert('تعذر اختيار الفيديو', err instanceof Error ? err.message : 'حاول اختيار مقطع آخر.');
    }
  }

  async function publish() {
    if (!token || !selectedVideo || busy) return;
    setBusy(true);
    setError(null);
    setProgress(null);
    try {
      await uploadMediaFile<Reel>({
        path: '/api/reels',
        token,
        file: selectedVideo,
        fieldName: 'video',
        maxBytes: MAX_VIDEO_BYTES,
        parameters: { caption: caption.trim(), mood_key: mood || '' },
        onProgress: setProgress,
      });
      setComposerOpen(false);
      setSelectedVideo(null);
      setCaption('');
      setMood(null);
      setProgress(null);
      viewed.current.clear();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر نشر الريل. تحقق من الاتصال وحاول مجددًا.');
    } finally {
      setBusy(false);
    }
  }

  return <Screen>
    <View style={styles.header}>
      <View style={styles.headerText}><Text style={styles.headerTitle}>ريلز</Text><Text style={styles.headerSubtitle}>مقاطع عمودية من مجتمعك</Text></View>
      <Pressable disabled={busy} onPress={chooseVideo} style={styles.addButton}><Ionicons name="add" size={18} color="#FFFFFF" /><Text style={styles.addText}>{busy ? 'جارٍ الرفع…' : 'أضف مقطعًا'}</Text></Pressable>
    </View>
    {error && feedRows.length ? <ErrorText message={error} /> : null}
    {feedRows.length ? <FlatList
      data={feedRows}
      keyExtractor={(item) => item.key}
      renderItem={renderItem}
      pagingEnabled
      snapToInterval={ITEM_HEIGHT}
      decelerationRate="fast"
      disableIntervalMomentum
      onViewableItemsChanged={onViewableItemsChanged}
      viewabilityConfig={viewabilityConfig}
      getItemLayout={(_, index) => ({ length: ITEM_HEIGHT, offset: ITEM_HEIGHT * index, index })}
      showsVerticalScrollIndicator={false}
      initialNumToRender={2}
      maxToRenderPerBatch={2}
      windowSize={3}
      removeClippedSubviews
      onEndReached={loadMore}
      onEndReachedThreshold={0.7}
    /> : <EmptyState title={error ? 'تعذر عرض الريلز' : 'لا توجد مقاطع بعد'} detail={error || 'أضف مقطعًا عموديًا قصيرًا لتبدأ الخلاصة.'} />}

    <Modal visible={composerOpen} transparent animationType="slide" onRequestClose={() => !busy && setComposerOpen(false)} statusBarTranslucent>
      <View style={styles.shade}><Pressable style={StyleSheet.absoluteFill} onPress={() => !busy && setComposerOpen(false)} />
        <View style={styles.modal}>
          <View style={styles.handle} />
          <View style={styles.modalHeader}><View><Text style={styles.modalTitle}>نشر ريل</Text><Text style={styles.helper}>مقطع عمودي قصير لمجتمعك</Text></View><Ionicons name="play-circle" size={30} color={colors.primary} /></View>
          {selectedVideo ? <View style={styles.selectedVideo}><Ionicons name="videocam" size={21} color={colors.primaryDark} /><View style={styles.videoInfo}><Text style={styles.videoName} numberOfLines={1}>{selectedVideo.fileName || 'مقطع محدد'}</Text><Text style={styles.videoMeta}>{formatSize(selectedVideo.fileSize)} · حتى 60 ثانية و20MB</Text></View><Pressable onPress={() => setSelectedVideo(null)} style={styles.remove}><Ionicons name="close" size={17} color={colors.danger} /></Pressable></View> : null}
          <TextField placeholder="اكتب وصفًا…" value={caption} onChangeText={setCaption} maxLength={500} multiline />
          <View style={styles.moodChoices}>{(['happy', 'sad'] as MoodKey[]).map((item) => <Pressable key={item} onPress={() => setMood(mood === item ? null : item)} style={[styles.moodChoice, mood === item && styles.moodActive]}><Text style={styles.moodText}>{item === 'happy' ? '😊 سعيد' : '😔 حزين'}</Text></Pressable>)}</View>
          {busy ? <UploadProgress progress={progress} label="جارٍ رفع الريل" /> : null}
          <ErrorText message={error} />
          <PrimaryButton title={busy ? 'جارٍ الرفع…' : 'نشر الريل'} onPress={publish} disabled={busy || !selectedVideo} />
          <SecondaryButton title="إلغاء" onPress={() => { if (busy) return; setComposerOpen(false); setSelectedVideo(null); }} disabled={busy} />
        </View>
      </View>
    </Modal>
  </Screen>;
}

function ActiveVideo({ source, muted = false }: { source: string; muted?: boolean }) {
  const { token } = useAuth();
  const videoSource = useMemo(() => {
    const authenticated = authenticatedMediaSource(source, token);
    if (!authenticated) return null;
    return typeof authenticated === 'string'
      ? { uri: authenticated, useCaching: true }
      : { ...authenticated, useCaching: false };
  }, [source, token]);
  const player = useVideoPlayer(videoSource, (videoPlayer) => {
    videoPlayer.loop = true;
    videoPlayer.muted = muted;
    videoPlayer.play();
  });
  return <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} />;
}

const PostReelItem = React.memo(function PostReelItem({ post, active }: { post: Post; active: boolean }) {
  const { token } = useAuth();
  const source = mediaUrl(post.video_url) || null;
  const [liked, setLiked] = useState(post.liked_by_me);
  const [likes, setLikes] = useState(post.likes_count);
  useEffect(() => { setLiked(post.liked_by_me); setLikes(post.likes_count); }, [post.id, post.liked_by_me, post.likes_count]);
  async function toggleLike() {
    if (!token) return;
    const previous = liked;
    setLiked(!previous);
    setLikes(Math.max(0, likes + (previous ? -1 : 1)));
    try { await apiRequest(`/api/posts/${post.id}/like`, { method: previous ? 'DELETE' : 'POST', token }); }
    catch (err) { setLiked(previous); setLikes(likes); Alert.alert('تعذر الإعجاب', err instanceof Error ? err.message : 'حاول مرة أخرى.'); }
  }
  return <View style={styles.reelCard}>
    {active && source ? <ActiveVideo source={source} muted /> : null}
    <View style={[StyleSheet.absoluteFill, styles.shadeOverlay]} />
    <View style={styles.reelOverlay}>
      <View style={styles.actionRail}><Pressable onPress={toggleLike} style={styles.actionButton}><Ionicons name={liked ? 'heart' : 'heart-outline'} size={28} color={liked ? colors.coral : '#FFFFFF'} /><Text style={styles.actionLabel}>{likes}</Text></Pressable></View>
      <View style={styles.creatorBlock}><Text style={styles.creatorName}>@{post.author.username}</Text><Text style={styles.caption}>{post.content || 'فيديو من المنشورات'}</Text>{post.mood_key ? <Text style={styles.moodBadge}>{post.mood_key === 'happy' ? '😊 سعيد' : '😔 حزين'}</Text> : null}<ReportButton targetType="post" targetId={post.id} /> </View>
    </View>
  </View>;
});

const ReelItem = React.memo(function ReelItem({ reel, active, onOpenProfile, onLike }: { reel: Reel; active: boolean; onOpenProfile: (username: string) => void; onLike: (id: number, next: boolean) => void }) {
  const { token } = useAuth();
  const source = mediaUrl(reel.video_url) || null;
  const [liked, setLiked] = useState(reel.liked_by_me);
  const [likes, setLikes] = useState(reel.likes_count);
  useEffect(() => { setLiked(reel.liked_by_me); setLikes(reel.likes_count); }, [reel.id, reel.liked_by_me, reel.likes_count]);
  async function toggleLike() {
    if (!token) return;
    const previous = liked;
    const next = !previous;
    setLiked(next);
    setLikes(Math.max(0, likes + (next ? 1 : -1)));
    onLike(reel.id, next);
    try { await apiRequest(`/api/reels/${reel.id}/like`, { method: next ? 'POST' : 'DELETE', token }); }
    catch (err) { setLiked(previous); setLikes(Math.max(0, likes + (previous ? -1 : 1))); onLike(reel.id, previous); Alert.alert('تعذر الإعجاب', err instanceof Error ? err.message : 'حاول مرة أخرى.'); }
  }
  return <View style={styles.reelCard}>
    {active && source ? <ActiveVideo source={source} /> : null}
    <View style={[StyleSheet.absoluteFill, styles.shadeOverlay]} />
    <View style={styles.reelOverlay}>
      <View style={styles.actionRail}>
        <Pressable onPress={toggleLike} style={styles.actionButton}><Ionicons name={liked ? 'heart' : 'heart-outline'} size={28} color={liked ? colors.coral : '#FFFFFF'} /><Text style={styles.actionLabel}>{likes}</Text></Pressable>
        <View style={styles.actionButton}><Ionicons name="eye-outline" size={25} color="#FFFFFF" /><Text style={styles.actionLabel}>{reel.views_count}</Text></View>
      </View>
      <View style={styles.creatorBlock}>
        <Pressable onPress={() => onOpenProfile(reel.author.username)} style={styles.creator}><Avatar uri={reel.author.avatar_url} size={38} /><Text style={styles.creatorName}>@{reel.author.username}</Text></Pressable>
        <Text style={styles.caption}>{reel.caption || 'مقطع جديد على Ytrana'}</Text>
        {reel.mood_key ? <Text style={styles.moodBadge}>{reel.mood_key === 'happy' ? '😊 سعيد' : '😔 حزين'}</Text> : null}<ReportButton targetType="reel" targetId={reel.id} />
      </View>
    </View>
  </View>;
});

const styles = StyleSheet.create({
  header: { minHeight: 48, paddingHorizontal: 16, flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.background },
  headerText: { alignItems: 'flex-end' },
  headerTitle: { color: colors.ink, fontSize: 17, fontWeight: '900', writingDirection: 'rtl' },
  headerSubtitle: { color: colors.muted, fontSize: 10, writingDirection: 'rtl' },
  addButton: { flexDirection: 'row-reverse', alignItems: 'center', gap: 3, backgroundColor: colors.primary, borderRadius: 13, minHeight: 36, paddingHorizontal: 11 },
  addText: { color: '#FFFFFF', fontSize: 11, fontWeight: '800', writingDirection: 'rtl' },
  reelCard: { height: CARD_HEIGHT, marginHorizontal: 9, marginVertical: 5, borderRadius: 21, overflow: 'hidden', backgroundColor: '#0D0C11' },
  shadeOverlay: { backgroundColor: '#0003' },
  reelOverlay: { flex: 1, flexDirection: 'row-reverse', alignItems: 'flex-end', justifyContent: 'space-between', padding: 16 },
  actionRail: { alignItems: 'center', gap: 18 },
  actionButton: { alignItems: 'center', minWidth: 42, gap: 3 },
  actionLabel: { color: '#FFFFFF', fontSize: 12, fontWeight: '800', textShadowColor: '#0009', textShadowRadius: 4 },
  creatorBlock: { flex: 1, alignItems: 'flex-end', marginRight: 18, gap: 8 },
  creator: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8 },
  creatorName: { color: '#FFFFFF', fontSize: 14, fontWeight: '900', textShadowColor: '#0009', textShadowRadius: 4 },
  caption: { color: '#FFFFFF', fontSize: 14, lineHeight: 20, textAlign: 'right', writingDirection: 'rtl', textShadowColor: '#0009', textShadowRadius: 4 },
  moodBadge: { color: '#FFFFFF', fontSize: 12, fontWeight: '800', backgroundColor: '#0005', paddingHorizontal: 9, paddingVertical: 4, borderRadius: 10 },
  shade: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#17132288' },
  modal: { backgroundColor: colors.background, paddingHorizontal: 18, paddingTop: 9, paddingBottom: 25, gap: 9, borderTopLeftRadius: 25, borderTopRightRadius: 25 },
  handle: { width: 38, height: 4, alignSelf: 'center', borderRadius: 3, backgroundColor: '#D9D5E3', marginBottom: 3 },
  modalHeader: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between' },
  modalTitle: { color: colors.ink, fontSize: 20, fontWeight: '900', textAlign: 'right', writingDirection: 'rtl' },
  helper: { color: colors.muted, fontSize: 11, textAlign: 'right', writingDirection: 'rtl' },
  selectedVideo: { flexDirection: 'row-reverse', alignItems: 'center', gap: 9, backgroundColor: '#FFFFFF', padding: 9, borderRadius: 14 },
  videoInfo: { flex: 1, alignItems: 'flex-end' },
  videoName: { color: colors.ink, fontWeight: '800', fontSize: 12, maxWidth: '100%' },
  videoMeta: { color: colors.primaryDark, fontSize: 10 },
  remove: { width: 29, height: 29, borderRadius: 15, backgroundColor: '#FFECEF', alignItems: 'center', justifyContent: 'center' },
  moodChoices: { flexDirection: 'row-reverse', gap: 8 },
  moodChoice: { paddingHorizontal: 12, minHeight: 37, justifyContent: 'center', borderRadius: 12, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: colors.border },
  moodActive: { borderColor: colors.primary, backgroundColor: colors.soft },
  moodText: { color: colors.ink, fontSize: 12, fontWeight: '700', writingDirection: 'rtl' },
});
