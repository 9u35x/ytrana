import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { apiRequest } from '../api';
import { colors, pagePadding } from '../theme';
import type { StarLevel, StarsResponse } from '../types';

type Props = { username: string; token?: string | null; refreshKey?: string | number | null };

const levelColors = ['#9C6BFF', '#E4A7FF', '#F5C542', '#FF9F43', '#F05D8B', '#39C6B4', '#4F8CFF', '#8D6E63', '#B45CFF', '#4A176F'];
const number = (value: number) => Number(value || 0).toLocaleString('ar-EG');

export default function StarsCard({ username, token, refreshKey }: Props) {
  const [data, setData] = useState<StarsResponse | null>(null);
  const [selectedLevel, setSelectedLevel] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);
  const mounted = useRef(false);
  const loadedIdentity = useRef<{ username: string; token: string } | null>(null);

  // Set true in setup as well as false in cleanup: React StrictMode replays effects.
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; requestId.current += 1; };
  }, []);

  // Identity changes must never leave the previous user's private metrics visible.
  useEffect(() => {
    requestId.current += 1;
    setData(null);
    setSelectedLevel(null);
    setError(null);
    setLoading(false);
  }, [username, token]);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    if (!token || !username) {
      if (mounted.current && id === requestId.current) {
        setData(null); setSelectedLevel(null); setError(null); setLoading(false);
      }
      return;
    }
    setLoading(true);
    try {
      const result = await apiRequest<StarsResponse>(`/api/users/${encodeURIComponent(username)}/stars`, { token });
      if (!mounted.current || id !== requestId.current) return;
      loadedIdentity.current = { username, token };
      setData(result);
      setSelectedLevel((previous) => result.levels.some((level) => level.level === previous) ? previous : result.level);
      setError(null);
    } catch (err) {
      if (!mounted.current || id !== requestId.current) return;
      // 404 also means privacy was revoked; never retain cached private details.
      setData(null); setSelectedLevel(null);
      setError(err instanceof Error ? err.message : 'تعذر تحميل النجوم.');
    } finally {
      if (mounted.current && id === requestId.current) setLoading(false);
    }
  }, [token, username]);

  useFocusEffect(useCallback(() => {
    void load();
    return () => { requestId.current += 1; };
  }, [load, refreshKey]));

  if (error) {
    const privateDenied = /خاص|ممنوع|غير موجود|forbidden|403|404/i.test(error);
    return <View style={styles.card} accessibilityRole="summary">
      <Text style={styles.title}>نجوم الحساب</Text>
      <Text style={styles.notice}>{privateDenied ? 'لا يمكن عرض نجوم هذا الحساب حاليًا.' : error}</Text>
      {!privateDenied ? <Pressable accessibilityRole="button" accessibilityLabel="إعادة محاولة تحميل النجوم" onPress={() => { void load(); }} style={styles.retry}><Text style={styles.retryText}>إعادة المحاولة</Text></Pressable> : null}
    </View>;
  }
  if (loading && !data) return <View style={styles.card} accessibilityRole="progressbar"><ActivityIndicator color={colors.primary} /><Text style={styles.notice}>جارٍ تحميل النجوم…</Text></View>;
  if (!data) return null;
  if (!token || loadedIdentity.current?.username !== username || loadedIdentity.current?.token !== token) return null;

  const progress = Math.max(0, Math.min(100, Number(data.progress_percent) || 0));
  const selected = data.levels.find((level) => level.level === (selectedLevel ?? data.level)) || data.levels[0];
  if (!selected) return null;
  const followerProgress = selected.required_followers > 0 ? (data.followers_count / selected.required_followers) * 100 : 100;
  const dayProgress = selected.required_active_days > 0 ? (data.active_days / selected.required_active_days) * 100 : 100;
  const selectedProgress = Math.max(0, Math.min(100, Math.min(followerProgress, dayProgress)));
  const selectedColor = selected.color || levelColors[selected.level - 1] || colors.primary;

  return <View style={styles.card} accessibilityRole="summary">
    <View style={styles.heading}><Text style={styles.title}>نجوم الحساب</Text><Text style={styles.subtitle}>المستوى الفعلي: {data.level} · {data.name}</Text><Text style={styles.subtitle}>التقدم يعتمد على المتابعين وأيام النشر المؤهلة</Text></View>
    <View style={styles.progressLabels}><Text style={styles.metric}>{number(data.followers_count)} متابع</Text><Text style={styles.metric}>{number(data.active_days)} يوم نشر</Text></View>
    <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: progress }} style={styles.track}><View style={[styles.fill, { width: `${progress}%` }]} /></View>
    <Text style={styles.progressText}>{data.next_level == null ? 'وصلت إلى أعلى مستوى' : `${progress}٪ من الطريق إلى المستوى التالي`}</Text>
    <View style={styles.levels}>{data.levels.map((level) => {
      const earned = Boolean(level.earned);
      const isSelected = level.level === selected.level;
      return <Pressable key={level.level} onPress={() => setSelectedLevel(level.level)} accessibilityRole="button" accessibilityLabel={`${level.name}، المستوى ${level.level}${earned ? '، مكتسبة' : '، معاينة'}`} accessibilityState={{ selected: isSelected }} style={[styles.level, earned && styles.earnedLevel, isSelected && styles.selectedLevel, level.level === 10 && styles.crystalLevel]}>
        <Text style={[styles.levelIcon, { color: level.color || levelColors[level.level - 1] || colors.primary }]}>{level.icon || '◆'}</Text>
        <Text style={styles.levelNumber}>{level.level}</Text>
        <Text style={styles.levelName}>{level.name}</Text>
        <Text style={styles.levelState}>{earned ? 'مكتسبة' : 'مقفل — معاينة المتطلبات'}</Text>
      </Pressable>;
    })}</View>
    <View style={[styles.detail, { borderColor: selectedColor }]} accessibilityRole="summary">
      <Text style={styles.detailEyebrow}>تفاصيل المستوى المحدد</Text>
      <Text style={styles.detailIcon}>{selected.icon || '◆'}</Text>
      <Text style={styles.detailName}>{selected.name}</Text>
      <Text style={styles.detailStatus}>{selected.earned ? 'مكتسبة' : 'مقفل — معاينة المتطلبات'}</Text>
      <Text style={styles.detailRequirement}>المطلوب: {number(selected.required_followers)} متابع · {number(selected.required_active_days)} يوم نشر</Text>
      <Text style={styles.detailActual}>الحالي: {number(data.followers_count)} متابع · {number(data.active_days)} يوم نشر</Text>
      <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: selectedProgress }} style={styles.detailTrack}><View style={[styles.fill, { width: `${selectedProgress}%`, backgroundColor: selectedColor }]} /></View>
      <Text style={styles.detailProgress}>{selectedProgress}% من متطلبات هذا المستوى</Text>
    </View>
    <View style={styles.reward}><Text style={styles.rewardTitle}>المكافأة المقترحة</Text><Text style={styles.rewardText}>لا توجد مكافأة وصول مطبقة حاليًا.</Text><Text style={styles.rewardText}>أولوية مقترحة لهذا المستوى: +{selected.proposed_priority_bonus_percent}%</Text><Text style={styles.disclaimer}>هذه قيمة مقترحة من بيانات المستوى وليست ضمانًا للمشاهدات أو الانتشار.</Text></View>
  </View>;
}

const styles = StyleSheet.create({
  card: { marginHorizontal: pagePadding, marginVertical: 10, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: '#FFFFFF' },
  heading: { alignItems: 'flex-end' }, title: { color: colors.ink, fontSize: 18, fontWeight: '900', textAlign: 'right', writingDirection: 'rtl' }, subtitle: { color: colors.muted, fontSize: 11, marginTop: 3, textAlign: 'right', writingDirection: 'rtl' },
  notice: { color: colors.muted, textAlign: 'center', writingDirection: 'rtl', marginVertical: 8 }, retry: { alignSelf: 'center', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 12, backgroundColor: colors.soft }, retryText: { color: colors.primaryDark, fontWeight: '800', writingDirection: 'rtl' },
  progressLabels: { flexDirection: 'row-reverse', justifyContent: 'space-between', marginTop: 13 }, metric: { color: colors.ink, fontSize: 12, fontWeight: '800', writingDirection: 'rtl' }, track: { height: 8, borderRadius: 5, overflow: 'hidden', backgroundColor: colors.soft, marginTop: 7 }, fill: { height: '100%', borderRadius: 5, backgroundColor: colors.primary }, progressText: { color: colors.muted, fontSize: 11, textAlign: 'right', writingDirection: 'rtl', marginTop: 4 },
  levels: { flexDirection: 'row-reverse', flexWrap: 'wrap', justifyContent: 'space-between', marginTop: 11, gap: 7 }, level: { width: '18%', minWidth: 58, alignItems: 'center', paddingVertical: 7, borderRadius: 12, opacity: 0.58 }, earnedLevel: { opacity: 1, backgroundColor: '#F7F2FF' }, selectedLevel: { borderWidth: 2, borderColor: colors.primary }, crystalLevel: { backgroundColor: '#F0E4FF' }, levelIcon: { fontSize: 20 }, levelNumber: { color: colors.ink, fontSize: 11, fontWeight: '900' }, levelName: { color: colors.ink, fontSize: 9, fontWeight: '800', textAlign: 'center', writingDirection: 'rtl' }, levelState: { color: colors.muted, fontSize: 8, textAlign: 'center', writingDirection: 'rtl' },
  detail: { marginTop: 12, padding: 12, borderRadius: 14, borderWidth: 1, backgroundColor: '#FAF7FF', alignItems: 'flex-end' }, detailEyebrow: { color: colors.muted, fontSize: 10, writingDirection: 'rtl' }, detailIcon: { fontSize: 27, alignSelf: 'center' }, detailName: { color: colors.ink, fontSize: 18, fontWeight: '900', textAlign: 'right', writingDirection: 'rtl' }, detailStatus: { color: colors.primaryDark, fontWeight: '800', textAlign: 'right', writingDirection: 'rtl', marginTop: 3 }, detailRequirement: { color: colors.ink, fontSize: 12, textAlign: 'right', writingDirection: 'rtl', marginTop: 6 }, detailActual: { color: colors.muted, fontSize: 12, textAlign: 'right', writingDirection: 'rtl', marginTop: 3 }, detailTrack: { width: '100%', height: 7, borderRadius: 5, overflow: 'hidden', backgroundColor: colors.soft, marginTop: 9 }, detailProgress: { color: colors.muted, fontSize: 10, writingDirection: 'rtl', marginTop: 3 }, reward: { marginTop: 12, padding: 10, borderRadius: 12, backgroundColor: '#FFF8E8' }, rewardTitle: { color: '#7A4C00', fontWeight: '900', textAlign: 'right', writingDirection: 'rtl' }, rewardText: { color: colors.ink, fontSize: 12, lineHeight: 19, textAlign: 'right', writingDirection: 'rtl', marginTop: 3 }, disclaimer: { color: colors.muted, fontSize: 10, textAlign: 'right', writingDirection: 'rtl', marginTop: 3 },
});
