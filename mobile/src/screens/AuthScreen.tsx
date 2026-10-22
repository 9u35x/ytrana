import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../auth';
import { ErrorText, PrimaryButton, Screen, SecondaryButton, TextField } from '../components';
import { colors } from '../theme';
import type { AuthMethod } from '../types';

const METHOD_LABELS: Record<AuthMethod, string> = {
  email: 'البريد الإلكتروني',
  sms: 'رسالة SMS',
  totp: 'تطبيق المصادقة',
};

export default function AuthScreen() {
  const { signIn, register, startLoginOtp, verifyLoginOtp } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [methods, setMethods] = useState<AuthMethod[]>([]);
  const [selectedMethod, setSelectedMethod] = useState<AuthMethod>('email');
  const [emailHint, setEmailHint] = useState<string | null>(null);
  const [phoneHint, setPhoneHint] = useState<string | null>(null);
  const [otpStarted, setOtpStarted] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [otpHint, setOtpHint] = useState('');

  async function submit() {
    setError(null);
    if (challengeId) {
      setBusy(true);
      try {
        if (!otpStarted) {
          const result = await startLoginOtp(challengeId, selectedMethod);
          setOtpStarted(true);
          setOtpHint(result.target_hint ? `${result.message} إلى ${result.target_hint}` : result.message);
          return;
        }
        if (!/^[0-9]{6}$/.test(otpCode.trim())) return setError('أدخل رمز التحقق المكوّن من 6 أرقام.');
        await verifyLoginOtp(challengeId, otpCode.trim());
      } catch (err) {
        setError(err instanceof Error ? err.message : 'تعذر التحقق من الرمز.');
      } finally {
        setBusy(false);
      }
      return;
    }

    if (!username.trim() || !password) return setError('أدخل اسم المستخدم وكلمة المرور.');
    if (mode === 'register') {
      if (fullName.trim().length < 2) return setError('اكتب اسمًا من حرفين على الأقل.');
      if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError('تحقق من البريد الإلكتروني.');
      if (password.length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) return setError('كلمة المرور يجب أن تضم 8 أحرف على الأقل وحرفًا ورقمًا.');
    }
    setBusy(true);
    try {
      if (mode === 'login') {
        const result = await signIn(username, password);
        if (result.requires_otp && result.challenge_id) {
          const offered = result.available_methods || [];
          setChallengeId(result.challenge_id);
          setMethods(offered);
          setSelectedMethod(offered[0] || 'email');
          setEmailHint(result.email_hint || null);
          setPhoneHint(result.phone_hint || null);
          setOtpStarted(false);
          setOtpCode('');
          setOtpHint('تم التحقق من كلمة المرور. اختر طريقة التحقق لإكمال الدخول.');
        }
      } else {
        await register({ username: username.trim().toLowerCase(), email: email.trim(), full_name: fullName.trim(), password });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إكمال الطلب.');
    } finally {
      setBusy(false);
    }
  }

  function cancelOtp() {
    setChallengeId(null);
    setMethods([]);
    setOtpStarted(false);
    setOtpCode('');
    setOtpHint('');
    setError(null);
  }

  const showingOtp = mode === 'login' && !!challengeId;
  const actionTitle = showingOtp
    ? busy ? 'لحظة…' : otpStarted ? 'تحقق وأكمل الدخول' : selectedMethod === 'totp' ? 'متابعة بتطبيق المصادقة' : `إرسال رمز ${selectedMethod === 'sms' ? 'SMS' : 'البريد'}`
    : busy ? 'لحظة…' : mode === 'login' ? 'تسجيل الدخول' : 'إنشاء الحساب';

  return <Screen><KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <View style={styles.brand}><View style={styles.logo}><Text style={styles.logoText}>Y</Text></View><Text style={styles.title}>Ytrana</Text><Text style={styles.subtitle}>مكان اجتماعي أقرب لمزاجك</Text></View>
      <View style={styles.form}>
        <Text style={styles.formTitle}>{showingOtp ? 'تحقق من هويتك' : mode === 'login' ? 'أهلًا بعودتك' : 'أنشئ حسابك'}</Text>
        {showingOtp ? <>
          <Text style={styles.otpHint}>{otpHint}</Text>
          <View style={styles.methods}>
            {methods.map((method) => <Pressable key={method} onPress={() => { setSelectedMethod(method); setOtpStarted(false); setOtpCode(''); setError(null); }} style={[styles.method, selectedMethod === method && styles.methodSelected]}>
              <Text style={[styles.methodText, selectedMethod === method && styles.methodTextSelected]}>{METHOD_LABELS[method]}{method === 'email' && emailHint ? ` · ${emailHint}` : ''}{method === 'sms' && phoneHint ? ` · ${phoneHint}` : ''}</Text>
            </Pressable>)}
          </View>
          {otpStarted ? <TextField placeholder="رمز التحقق المكوّن من 6 أرقام" value={otpCode} onChangeText={(value) => setOtpCode(value.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" autoComplete="one-time-code" maxLength={6} returnKeyType="done" onSubmitEditing={submit} /> : null}
          <ErrorText message={error} />
          <PrimaryButton title={actionTitle} onPress={submit} disabled={busy || !methods.length} />
          <SecondaryButton title="العودة لتسجيل الدخول" onPress={cancelOtp} />
          {!methods.length ? <Text style={styles.errorText}>لا توجد طريقة تحقق مفعّلة لهذا الحساب؛ تواصل مع الدعم.</Text> : null}
        </> : <>
          {mode === 'register' ? <>
            <TextField placeholder="الاسم الكامل" value={fullName} onChangeText={setFullName} autoCapitalize="words" returnKeyType="next" />
            <TextField placeholder="البريد الإلكتروني" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoCorrect={false} returnKeyType="next" />
          </> : null}
          <TextField placeholder={mode === 'login' ? 'اسم المستخدم أو البريد' : 'اسم المستخدم'} value={username} onChangeText={setUsername} autoCapitalize="none" autoCorrect={false} returnKeyType="next" />
          <TextField placeholder="كلمة المرور" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" returnKeyType="done" onSubmitEditing={submit} />
          <ErrorText message={error} />
          <PrimaryButton title={actionTitle} onPress={submit} disabled={busy} />
          <View style={styles.switchRow}><Text style={styles.switchText}>{mode === 'login' ? 'جديد على Ytrana؟' : 'لديك حساب بالفعل؟'}</Text><SecondaryButton title={mode === 'login' ? 'إنشاء حساب' : 'دخول'} onPress={() => { setError(null); setMode(mode === 'login' ? 'register' : 'login'); }} /></View>
          <Text style={styles.footnote}>استخدم كلمة مرور فريدة ولا تشارك بيانات الدخول.</Text>
        </>}
      </View>
    </ScrollView>
  </KeyboardAvoidingView></Screen>;
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, justifyContent: 'center', padding: 22, paddingTop: 35, paddingBottom: 35 },
  brand: { alignItems: 'center', marginBottom: 28 }, logo: { width: 72, height: 72, borderRadius: 24, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  logoText: { color: '#FFFFFF', fontSize: 42, fontWeight: '900' }, title: { color: colors.ink, fontSize: 32, fontWeight: '900' }, subtitle: { color: colors.muted, fontSize: 15, marginTop: 6, textAlign: 'center', writingDirection: 'rtl' },
  form: { backgroundColor: '#FFFFFF', borderRadius: 22, borderWidth: 1, borderColor: colors.border, padding: 18, gap: 5 }, formTitle: { color: colors.ink, fontSize: 21, fontWeight: '800', textAlign: 'right', writingDirection: 'rtl', marginBottom: 8 },
  switchRow: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 12 }, switchText: { color: colors.muted, fontSize: 13, textAlign: 'right', writingDirection: 'rtl', flex: 1 }, footnote: { color: colors.muted, fontSize: 11, textAlign: 'center', writingDirection: 'rtl', marginTop: 9 },
  otpHint: { color: colors.muted, fontSize: 13, textAlign: 'right', writingDirection: 'rtl', lineHeight: 20 }, methods: { gap: 8, marginVertical: 8 }, method: { padding: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: 'flex-end' }, methodSelected: { borderColor: colors.primary, backgroundColor: '#F5F2FF' }, methodText: { color: colors.ink, fontWeight: '700', writingDirection: 'rtl' }, methodTextSelected: { color: colors.primaryDark }, errorText: { color: colors.danger, textAlign: 'center', writingDirection: 'rtl', marginTop: 8 },
});
