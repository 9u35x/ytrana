import React, { useCallback, useState } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { apiRequest } from '../api';
import { useAuth } from '../auth';
import {
  Avatar,
  EmptyState,
  Panel,
  PrimaryButton,
  Screen,
  TextField,
} from '../components';
import { type RootNavigation } from '../navigation';
import { colors, pagePadding } from '../theme';
import type { Conversation, Mood, MoodStatus } from '../types';

export default function MessagesScreen() {
  const { token, user } = useAuth();
  const nav = useNavigation<RootNavigation>();
  const [items, setItems] = useState<Conversation[]>([]);
  const [moods, setMoods] = useState<Mood[]>([]);
  const [me, setMe] = useState<MoodStatus | null>(null);
  const [feed, setFeed] = useState<MoodStatus[]>([]);
  const [note, setNote] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const followerNotes = feed.filter((status) => !user || status.user.id !== user.id);

  const load = useCallback(async () => {
    if (!token) return;
    setRefreshing(true);
    try {
      const [conversations, availableMoods, myMood, followedStatuses] = await Promise.all([
        apiRequest<Conversation[]>('/api/messages', { token }),
        apiRequest<Mood[]>('/api/moods', { token }),
        apiRequest<MoodStatus | null>('/api/moods/me', { token }),
        apiRequest<MoodStatus[]>('/api/moods/feed', { token }),
      ]);
      setItems(conversations);
      setMoods(availableMoods);
      setMe(myMood);
      setFeed(followedStatuses);
      setSelected(myMood?.mood.key ?? null);
      setNote(myMood?.note ?? '');
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر تحميل المحادثات والملاحظات.');
    } finally {
      setRefreshing(false);
    }
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function saveMood() {
    if (!token) return;
    if (!selected) {
      Alert.alert('اختر مزاجًا', 'حدد سعيدًا أو حزينًا أولًا.');
      return;
    }
    try {
      await apiRequest('/api/moods', {
        method: 'POST',
        token,
        body: { mood_key: selected, note: note.trim() },
      });
      await load();
      setEditorOpen(false);
      Alert.alert('تم الحفظ', 'ستظهر ملاحظتك لمتابعيك في قسم المحادثات لمدة 24 ساعة.');
    } catch (e) {
      Alert.alert('تعذر تحديث الحالة', e instanceof Error ? e.message : 'حاول مرة أخرى.');
    }
  }

  async function clearMood() {
    if (!token) return;
    try {
      await apiRequest('/api/moods/me', { method: 'DELETE', token });
      setNote('');
      setSelected(null);
      await load();
    } catch (e) {
      Alert.alert('تعذر إخفاء الملاحظة', e instanceof Error ? e.message : 'حاول مرة أخرى.');
    }
  }

  const listHeader = (
    <View>
      <View style={styles.header}>
        <Text style={styles.title}>الرسائل</Text>
        <Text style={styles.subtitle}>محادثاتك الخاصة وملاحظات المتابعين</Text>
      </View>

      <Panel style={styles.moodPanel}>
        <View style={styles.panelHeading}>
          <View style={styles.moodHeadingText}>
            <Text style={styles.moodTitle}>ملاحظات الحالة</Text>
            <Text style={styles.currentMood} numberOfLines={1}>
              {me ? `${me.mood.emoji} ${me.mood.label_ar}${me.note ? ` · ${me.note}` : ''}` : 'شارك مزاجك وملاحظة قصيرة لمدة 24 ساعة'}
            </Text>
          </View>
          <Pressable accessibilityRole="button" onPress={() => setEditorOpen((open) => !open)} style={styles.editButton}>
            <Text style={styles.editButtonText}>{editorOpen ? 'إغلاق' : me ? 'تعديل' : 'إضافة'}</Text>
          </Pressable>
        </View>
        {editorOpen ? <View style={styles.editor}>
          <Text style={styles.hint}>اختر مزاجك واكتب شيئًا بسيطًا لمتابعيك.</Text>
          <View style={styles.choices}>
            {moods.map((mood) => {
              const active = selected === mood.key;
              return <Pressable key={mood.key} accessibilityRole="button" accessibilityState={{ selected: active }} onPress={() => setSelected(mood.key)} style={[styles.choice, active && styles.activeChoice]}>
                <Text style={styles.choiceText}>{mood.emoji} {mood.label_ar}</Text>
              </Pressable>;
            })}
          </View>
          <TextField placeholder="ملاحظة قصيرة (120 حرفًا)" value={note} onChangeText={setNote} maxLength={120} accessibilityLabel="ملاحظتي للمتابعين" />
          <View style={styles.actionRow}>
            <View style={styles.saveButton}><PrimaryButton title="حفظ" onPress={saveMood} compact disabled={!selected} /></View>
            {me ? <Pressable accessibilityRole="button" onPress={clearMood} style={styles.clearButton}><Text style={styles.clearText}>إخفاء</Text></Pressable> : null}
            <Text style={styles.counter}>{note.length}/120</Text>
          </View>
        </View> : null}

        <View style={styles.notesSection}>
          <View style={styles.notesHeader}>
            <View style={styles.notesHeading}>
              <Text style={styles.notesTitle}>ملاحظات من تتابعهم</Text>
              <Text style={styles.notesCount}>{followerNotes.length}</Text>
            </View>
          </View>
          {followerNotes.length ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.notesRail}>
            {followerNotes.map((status) => (
              <View key={status.id} style={styles.noteCard}>
                <View style={[styles.noteMood, { borderColor: status.mood.color }]}>
                  <Text style={styles.noteMoodEmoji}>{status.mood.emoji}</Text>
                </View>
                <View style={styles.noteBody}>
                  <View style={styles.noteByline}>
                    <Text style={styles.noteName} numberOfLines={1}>
                      {status.user.full_name}
                    </Text>
                    <Text style={styles.noteHandle} numberOfLines={1}>
                      @{status.user.username}
                    </Text>
                  </View>
                  <Text style={styles.noteMoodLabel}>{status.mood.label_ar}</Text>
                  <Text style={styles.noteText}>
                    {status.note?.trim() || 'شارك مزاجه بدون ملاحظة نصية.'}
                  </Text>
                </View>
              </View>
            ))}
            </ScrollView>
          ) : (
            <Text style={styles.emptyNotes}>ماكو ملاحظات منشورة من متابعيك حاليًا.</Text>
          )}
        </View>
      </Panel>
    </View>
  );

  return (
    <Screen>
      <FlatList
        data={items}
        keyExtractor={(item) => String(item.id)}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={load} tintColor={colors.primary} />
        }
        ListHeaderComponent={listHeader}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              nav.navigate('Chat', {
                username: item.other_user.username,
                fullName: item.other_user.full_name,
              })
            }
          >
            <Panel style={styles.conversationRow}>
              <Avatar uri={item.other_user.avatar_url} size={48} />
              <View style={styles.conversationInfo}>
                <Text style={styles.conversationName}>{item.other_user.full_name}</Text>
                <Text style={styles.lastMessage} numberOfLines={1}>
                  {item.last_message || 'ابدأ المحادثة'}
                </Text>
              </View>
              {item.unread_count > 0 ? (
                <Text style={styles.badge}>{item.unread_count}</Text>
              ) : null}
            </Panel>
          </Pressable>
        )}
        ListEmptyComponent={
          <EmptyState
            title={error ? 'تعذر تحميل الرسائل' : 'لا توجد محادثات بعد'}
            detail={error || 'افتح ملف شخص وابدأ محادثة.'}
          />
        }
        contentContainerStyle={styles.listContent}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { padding: pagePadding, paddingBottom: 6 },
  title: {
    color: colors.ink,
    fontSize: 24,
    fontWeight: '900',
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  subtitle: {
    color: colors.muted,
    fontSize: 12,
    textAlign: 'right',
    writingDirection: 'rtl',
    marginTop: 3,
  },
  moodPanel: { padding: 13, borderRadius: 21 },
  panelHeading: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  moodHeadingText: { flex: 1, alignItems: 'flex-end' },
  currentMood: { color: colors.muted, fontSize: 11, maxWidth: '100%', textAlign: 'right', writingDirection: 'rtl', marginTop: 3 },
  editButton: { minHeight: 34, paddingHorizontal: 12, borderRadius: 12, backgroundColor: colors.soft, alignItems: 'center', justifyContent: 'center' },
  editButtonText: { color: colors.primaryDark, fontSize: 12, fontWeight: '800', writingDirection: 'rtl' },
  editor: { marginTop: 8, paddingTop: 7, borderTopWidth: 1, borderTopColor: colors.border },
  moodTitle: {
    color: colors.ink,
    fontWeight: '900',
    fontSize: 17,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  headingEmoji: {
    width: 27,
    height: 27,
    borderRadius: 14,
    color: colors.primary,
    backgroundColor: colors.soft,
    textAlign: 'center',
    textAlignVertical: 'center',
    fontWeight: '900',
  },
  hint: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 19,
    textAlign: 'right',
    writingDirection: 'rtl',
    marginTop: 5,
  },
  choices: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 7, marginTop: 7 },
  choice: {
    paddingVertical: 7,
    paddingHorizontal: 11,
    borderRadius: 12,
    backgroundColor: colors.soft,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  activeChoice: { borderColor: colors.primary, backgroundColor: colors.aquaSoft },
  choiceText: { color: colors.ink, fontSize: 13, fontWeight: '700', writingDirection: 'rtl' },
  counter: { color: colors.muted, fontSize: 10, textAlign: 'left', marginTop: -1 },
  actionRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8, marginTop: 3 },
  saveButton: { flex: 1 },
  clearButton: {
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: 13,
    backgroundColor: '#FFF0F1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearText: { color: colors.danger, fontSize: 13, fontWeight: '800' },
  notesSection: { marginTop: 11, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border },
  notesHeader: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  notesTitle: { color: colors.ink, fontSize: 15, fontWeight: '900', textAlign: 'right', writingDirection: 'rtl' },
  notesHeading: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8 },
  notesRail: { flexDirection: 'row-reverse', gap: 8, paddingVertical: 2, paddingEnd: 1 },
  notesCount: {
    minWidth: 24,
    height: 24,
    paddingHorizontal: 6,
    borderRadius: 12,
    overflow: 'hidden',
    color: colors.primaryDark,
    backgroundColor: colors.soft,
    textAlign: 'center',
    textAlignVertical: 'center',
    fontSize: 11,
    fontWeight: '900',
  },
  noteCard: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
    width: 238,
    minHeight: 90,
    padding: 9,
    marginTop: 0,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
  },
  noteMood: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  noteMoodEmoji: { fontSize: 17 },
  noteBody: { flex: 1, alignItems: 'flex-end', gap: 1 },
  noteByline: { width: '100%', flexDirection: 'row-reverse', alignItems: 'center', gap: 5 },
  noteName: { color: colors.ink, fontSize: 12, fontWeight: '800', maxWidth: '60%', textAlign: 'right', writingDirection: 'rtl' },
  noteHandle: { color: colors.muted, fontSize: 9, textAlign: 'right', writingDirection: 'rtl' },
  noteMoodLabel: { color: colors.primaryDark, fontSize: 10, fontWeight: '700', textAlign: 'right', writingDirection: 'rtl' },
  noteText: { color: colors.ink, fontSize: 12, lineHeight: 17, textAlign: 'right', writingDirection: 'rtl', alignSelf: 'stretch' },
  emptyNotes: { color: colors.muted, fontSize: 12, lineHeight: 19, textAlign: 'right', writingDirection: 'rtl', paddingVertical: 8 },
  conversationRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10 },
  conversationInfo: { flex: 1, alignItems: 'flex-end' },
  conversationName: { color: colors.ink, fontWeight: '800', textAlign: 'right', writingDirection: 'rtl' },
  lastMessage: { color: colors.muted, fontSize: 12, textAlign: 'right', writingDirection: 'rtl', marginTop: 2 },
  badge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    overflow: 'hidden',
    color: '#FFFFFF',
    backgroundColor: colors.primary,
    textAlign: 'center',
    textAlignVertical: 'center',
    paddingHorizontal: 5,
    fontWeight: '800',
  },
  listContent: { paddingBottom: 20 },
});
