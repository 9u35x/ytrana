import React, { useEffect, useState } from 'react';
import { Alert, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { apiRequest, authenticatedMediaSource } from '../api';
import { useAuth } from '../auth';
import { Avatar, Panel, VerifiedBadge } from '../components';
import { type RootNavigation } from '../navigation';
import { colors } from '../theme';
import type { Post } from '../types';
import ReportButton from '../components/ReportButton';

const moodLabel = (key: Post['mood_key']) => key === 'happy' ? '😊 سعيد' : key === 'sad' ? '😔 حزين' : null;

export default function PostCard({ post }: { post: Post }) {
  const navigation = useNavigation<RootNavigation>();
  const { token } = useAuth();
  const [liked, setLiked] = useState(post.liked_by_me);
  const [likes, setLikes] = useState(post.likes_count);
  const [busy, setBusy] = useState(false);
  const picture = authenticatedMediaSource(post.image_url, token);
  const video = authenticatedMediaSource(post.video_url, token);

  useEffect(() => {
    setLiked(post.liked_by_me);
    setLikes(post.likes_count);
  }, [post.id, post.liked_by_me, post.likes_count]);

  async function toggleLike() {
    if (!token || busy) return;
    const previous = liked;
    setBusy(true);
    setLiked(!previous);
    setLikes(Math.max(0, likes + (previous ? -1 : 1)));
    try {
      await apiRequest(`/api/posts/${post.id}/like`, { method: previous ? 'DELETE' : 'POST', token });
    } catch (error) {
      setLiked(previous);
      setLikes(likes);
      Alert.alert('تعذر التفاعل', error instanceof Error ? error.message : 'حاول مرة أخرى.');
    } finally {
      setBusy(false);
    }
  }

  const date = new Date(post.created_at).toLocaleDateString('ar-IQ', { day: 'numeric', month: 'short' });
  return <Panel style={styles.card}>
    <View style={styles.author}>
      <Pressable onPress={() => navigation.navigate('ProfileDetail', { username: post.author.username })} style={styles.authorInfo}>
        <Avatar uri={post.author.avatar_url} size={43} />
        <View><View style={styles.nameLine}><Text style={styles.name}>{post.author.full_name}</Text>{post.author.is_verified ? <VerifiedBadge /> : null}</View><Text style={styles.handle}>@{post.author.username} · {date}{post.is_edited ? ' · معدّل' : ''}</Text></View>
      </Pressable>
      {moodLabel(post.mood_key) ? <Text style={styles.mood}>{moodLabel(post.mood_key)}</Text> : null}
    </View>
    {post.content ? <Text style={styles.content}>{post.content}</Text> : null}
    {picture ? <Image source={typeof picture === 'string' ? { uri: picture } : picture || undefined} style={styles.photo} /> : null}
    {video ? <Pressable onPress={() => navigation.navigate('Main', { screen: 'Reels', params: { postId: post.id } })} style={styles.videoThumb} accessibilityRole="button" accessibilityLabel="فتح الفيديو في واجهة الريلز"><Text style={styles.play}>▶</Text><Text style={styles.videoLabel}>افتح في الريلز</Text></Pressable> : null}
    <View style={styles.actions}>
      <Pressable onPress={toggleLike} disabled={busy}><Text style={[styles.action, liked && styles.liked]}>{liked ? '♥' : '♡'} {likes}</Text></Pressable>
      <Pressable onPress={() => navigation.navigate('Comments', { post })}><Text style={styles.action}>تعليق · {post.comments_count}</Text></Pressable>
      <ReportButton targetType="post" targetId={post.id} />
    </View>
  </Panel>;
}

const styles = StyleSheet.create({
  card: { padding: 0, overflow: 'hidden' },
  author: { padding: 14, paddingBottom: 5, flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center' },
  authorInfo: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10 },
  name: { color: colors.ink, fontWeight: '800', textAlign: 'right', writingDirection: 'rtl' },
  nameLine: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'flex-start' },
  handle: { color: colors.muted, fontSize: 11, textAlign: 'right', writingDirection: 'rtl' },
  mood: { color: colors.primaryDark, fontSize: 12 },
  content: { color: colors.ink, fontSize: 15, lineHeight: 23, textAlign: 'right', writingDirection: 'rtl', padding: 15 },
  photo: { width: '100%', height: 260 },
  videoThumb: { height: 220, backgroundColor: '#211d2a', alignItems: 'center', justifyContent: 'center' },
  play: { color: '#fff', fontSize: 42 },
  videoLabel: { color: '#fff', marginTop: 6 },
  actions: { flexDirection: 'row-reverse', padding: 13, gap: 20, borderTopWidth: 1, borderTopColor: colors.border },
  action: { color: colors.muted, fontSize: 14, fontWeight: '700' },
  liked: { color: colors.coral },
});
