import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import { apiRequest } from './api';
import type { AuthMethod, AuthResponse, UserPublic } from './types';

const TOKEN_KEY = 'ytrana.access-token';
type RegisterInput = { username: string; email: string; full_name: string; password: string };
type AuthContextValue = {
  token: string | null; user: UserPublic | null; loading: boolean;
  signIn: (usernameOrEmail: string, password: string) => Promise<AuthResponse>;
  startLoginOtp: (challengeId: string, method: AuthMethod) => Promise<{ message: string; target_hint?: string }>;
  verifyLoginOtp: (challengeId: string, code: string) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  signOut: () => Promise<void>; deleteAccount: (password: string) => Promise<void>;
  refreshUser: () => Promise<void>; setUser: (user: UserPublic) => void;
};
const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: React.PropsWithChildren) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<UserPublic | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const saved = await SecureStore.getItemAsync(TOKEN_KEY);
        if (saved) {
          const current = await apiRequest<UserPublic>('/api/auth/me', { token: saved });
          if (active) { setToken(saved); setUser(current); }
        }
      } catch {
        await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => undefined);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  const saveSession = useCallback(async (result: AuthResponse) => {
    if (!result.access_token || !result.user) throw new Error('لم تكتمل استجابة تسجيل الدخول.');
    await SecureStore.setItemAsync(TOKEN_KEY, result.access_token);
    setToken(result.access_token);
    setUser(result.user);
  }, []);
  const signIn = useCallback(async (usernameOrEmail: string, password: string) => {
    const result = await apiRequest<AuthResponse>('/api/auth/login', { method: 'POST', body: { username_or_email: usernameOrEmail.trim(), password } });
    if (!result.requires_otp) await saveSession(result);
    return result;
  }, [saveSession]);
  const startLoginOtp = useCallback(async (challengeId: string, method: AuthMethod) => {
    return apiRequest<{ message: string; target_hint?: string }>('/api/auth/login/otp/start', { method: 'POST', body: { challenge_id: challengeId, method } });
  }, []);
  const verifyLoginOtp = useCallback(async (challengeId: string, code: string) => {
    const result = await apiRequest<AuthResponse>('/api/auth/login/otp/verify', { method: 'POST', body: { challenge_id: challengeId, code } });
    await saveSession(result);
  }, [saveSession]);
  const register = useCallback(async (input: RegisterInput) => {
    const result = await apiRequest<AuthResponse>('/api/auth/register', { method: 'POST', body: input });
    await saveSession(result);
  }, [saveSession]);
  const signOut = useCallback(async () => {
    const oldToken = token;
    setToken(null); setUser(null);
    await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => undefined);
    if (oldToken) await apiRequest('/api/auth/logout', { method: 'POST', token: oldToken }).catch(() => undefined);
  }, [token]);
  const deleteAccount = useCallback(async (password: string) => {
    if (!token) throw new Error('انتهت جلسة الدخول. سجّل الدخول ثم أعد المحاولة.');
    await apiRequest('/api/users/me', { method: 'DELETE', token, body: { password } });
    setToken(null); setUser(null);
    await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => undefined);
  }, [token]);
  const refreshUser = useCallback(async () => {
    if (token) setUser(await apiRequest<UserPublic>('/api/auth/me', { token }));
  }, [token]);
  const value = useMemo(() => ({ token, user, loading, signIn, startLoginOtp, verifyLoginOtp, register, signOut, deleteAccount, refreshUser, setUser }), [token, user, loading, signIn, startLoginOtp, verifyLoginOtp, register, signOut, deleteAccount, refreshUser]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth يجب أن يُستخدم داخل AuthProvider');
  return context;
}
