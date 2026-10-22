import React from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { mediaUrl } from './api';
import { colors, pagePadding, radii } from './theme';

export function Screen({ children }: React.PropsWithChildren) {
  return <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>{children}</SafeAreaView>;
}

export function Panel({ children, style }: React.PropsWithChildren<{ style?: object }>) {
  return <View style={[styles.panel, style]}>{children}</View>;
}

export function PrimaryButton({ title, onPress, disabled, compact }: { title: string; onPress: () => void; disabled?: boolean; compact?: boolean }) {
  return <Pressable accessibilityRole="button" onPress={onPress} disabled={disabled} style={({ pressed }) => [styles.primaryButton, compact && styles.compactButton, disabled && styles.disabled, pressed && !disabled && styles.pressed]}>
    <Text style={styles.primaryButtonText}>{title}</Text>
  </Pressable>;
}

export function SecondaryButton({ title, onPress, disabled }: { title: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" onPress={onPress} disabled={disabled} style={({ pressed }) => [styles.secondaryButton, disabled && styles.disabled, pressed && !disabled && styles.pressed]}>
    <Text style={styles.secondaryButtonText}>{title}</Text>
  </Pressable>;
}

export function TextField(props: TextInputProps) {
  return <TextInput
    placeholderTextColor={colors.muted}
    selectionColor={colors.primary}
    {...props}
    style={[styles.input, props.multiline && styles.multiline, props.style]}
    textAlign="right"
  />;
}

export function Avatar({ uri, size = 44 }: { uri?: string | null; size?: number }) {
  const source = mediaUrl(uri);
  if (source) return <Image source={{ uri: source }} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.soft }} />;
  return <View style={[styles.avatarFallback, { width: size, height: size, borderRadius: size / 2 }]}><Text style={[styles.avatarInitial, { fontSize: Math.max(14, size * 0.43) }]}>Y</Text></View>;
}

export function VerifiedBadge({ size = 19 }: { size?: number }) {
  return <View accessibilityRole="image" accessibilityLabel="حساب موثق" style={[styles.verifiedBadge, { width: size, height: size }]}>
    <MaterialCommunityIcons name="decagram" size={size} color="#0095F6" style={styles.verifiedIcon} />
    <MaterialCommunityIcons name="check" size={Math.max(9, size * 0.52)} color="#FFFFFF" style={styles.verifiedCheck} />
  </View>;
}

export function LoadingView({ label = 'جارٍ التحميل…' }: { label?: string }) {
  return <View style={styles.center}><ActivityIndicator color={colors.primary} size="large" /><Text style={styles.muted}>{label}</Text></View>;
}

export function EmptyState({ title, detail }: { title: string; detail?: string }) {
  return <View style={styles.empty}><Text style={styles.emptyTitle}>{title}</Text>{detail ? <Text style={styles.muted}>{detail}</Text> : null}</View>;
}

export function ErrorText({ message }: { message: string | null }) {
  return message ? <Text accessibilityRole="alert" style={styles.error}>{message}</Text> : null;
}

export function UploadProgress({ progress, label = 'جارٍ رفع الملف' }: { progress: number | null; label?: string }) {
  const value = progress === null ? 12 : Math.max(3, Math.min(100, Math.round(progress * 100)));
  return <View accessibilityRole="progressbar" accessibilityValue={progress === null ? undefined : { min: 0, max: 100, now: Math.round(progress * 100) }} style={styles.progressWrap}>
    <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${value}%` }]} /></View>
    <Text style={styles.progressLabel}>{progress === null ? `${label}…` : `${label} · ${Math.round(progress * 100)}٪`}</Text>
  </View>;
}

export function SectionTitle({ title, trailing }: { title: string; trailing?: React.ReactNode }) {
  return <View style={styles.sectionTitle}><Text style={styles.sectionText}>{title}</Text>{trailing}</View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  panel: {
    backgroundColor: colors.surface,
    borderRadius: radii.medium,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 15,
    marginHorizontal: pagePadding,
    marginVertical: 7,
    shadowColor: colors.primaryDeep,
    shadowOpacity: 0.035,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
    elevation: 1,
  },
  primaryButton: {
    backgroundColor: colors.primary,
    minHeight: 50,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    shadowColor: colors.primary,
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  compactButton: { minHeight: 40, borderRadius: 13, paddingHorizontal: 16, shadowOpacity: 0, elevation: 0 },
  primaryButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800', textAlign: 'center', writingDirection: 'rtl' },
  secondaryButton: { minHeight: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, backgroundColor: colors.soft },
  secondaryButtonText: { color: colors.primaryDark, fontSize: 14, fontWeight: '700', textAlign: 'center', writingDirection: 'rtl' },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.82, transform: [{ scale: 0.985 }] },
  input: { minHeight: 48, borderWidth: 1, borderColor: colors.border, backgroundColor: '#FFFFFF', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, color: colors.ink, fontSize: 15, marginVertical: 5, writingDirection: 'rtl' },
  multiline: { minHeight: 90, textAlignVertical: 'top', lineHeight: 22 },
  avatarFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.soft },
  avatarInitial: { color: colors.primary, fontWeight: '900' },
  verifiedBadge: { alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'visible', marginHorizontal: 3 },
  verifiedIcon: { position: 'absolute' },
  verifiedCheck: { position: 'absolute' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  muted: { color: colors.muted, fontSize: 13, textAlign: 'center', writingDirection: 'rtl', marginTop: 5 },
  empty: { padding: 30, alignItems: 'center', justifyContent: 'center', gap: 6 },
  emptyTitle: { color: colors.ink, fontSize: 16, fontWeight: '800', textAlign: 'center', writingDirection: 'rtl' },
  error: { color: colors.danger, textAlign: 'right', writingDirection: 'rtl', marginVertical: 8, fontSize: 13, lineHeight: 20 },
  progressWrap: { gap: 7, marginVertical: 5 },
  progressTrack: { height: 7, overflow: 'hidden', borderRadius: 5, backgroundColor: colors.soft },
  progressFill: { height: '100%', borderRadius: 5, backgroundColor: colors.aqua },
  progressLabel: { color: colors.primaryDark, fontSize: 12, textAlign: 'right', writingDirection: 'rtl', fontWeight: '700' },
  sectionTitle: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', marginHorizontal: pagePadding, marginVertical: 10 },
  sectionText: { color: colors.ink, fontWeight: '900', fontSize: 18, textAlign: 'right', writingDirection: 'rtl' },
});
