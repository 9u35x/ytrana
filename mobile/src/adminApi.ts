import { apiRequest } from './api';

export type AdminAccess = { allowed: boolean };
export type AdminUser = { id: number; username: string; full_name?: string; avatar_url?: string | null; is_verified?: boolean; verification_expires_at?: string | null; is_frozen?: boolean; frozen_until?: string | null; is_banned?: boolean };
export type AdminReport = { id: number; target_type: string; target_id: number; category: string; reason?: string | null; status: string; review_note?: string | null; reviewer_id?: number | null; resolution?: string | null; reviewed_at?: string | null; created_at?: string };
export type AdminTargetMedia = { kind: 'image' | 'video'; url: string };
export type ReportTarget = { target_type: string; target_id: number; exists: boolean; owner_id?: number | null; summary?: string | null; snapshot?: boolean; media?: AdminTargetMedia[] };
export type ReportCategory = 'spam' | 'harassment' | 'hate' | 'violence' | 'sexual' | 'impersonation' | 'scam' | 'privacy' | 'copyright' | 'other';
export const reportCategories: { key: ReportCategory; label: string }[] = [
  { key: 'spam', label: 'محتوى مزعج' }, { key: 'harassment', label: 'مضايقة' },
  { key: 'hate', label: 'كراهية' }, { key: 'violence', label: 'عنف' },
  { key: 'sexual', label: 'محتوى جنسي' }, { key: 'impersonation', label: 'انتحال شخصية' },
  { key: 'scam', label: 'احتيال' }, { key: 'privacy', label: 'انتهاك الخصوصية' },
  { key: 'copyright', label: 'حقوق نشر' }, { key: 'other', label: 'سبب آخر' },
];
export const checkAdminAccess = (token: string) => apiRequest<AdminAccess>('/api/admin/access', { token });
export const submitReport = (token: string, target_type: string, target_id: number, category: ReportCategory, reason: string) => apiRequest('/api/reports', {
  method: 'POST', token,
  body: { target_type, target_id, category, reason: reason.trim() || reportCategories.find(item => item.key === category)?.label || 'سبب آخر' },
});
export const loadAdminUsers = (token: string, search: string, skip: number, limit = 20) => apiRequest<AdminUser[]>(`/api/admin/users?search=${encodeURIComponent(search)}&skip=${skip}&limit=${limit}`, { token });
export const loadAdminReports = (token: string, status: string, type: string, skip: number, limit = 20) => apiRequest<AdminReport[]>(`/api/admin/reports?status_filter=${encodeURIComponent(status)}&target_type=${encodeURIComponent(type)}&skip=${skip}&limit=${limit}`, { token });
export const resolveReport = (token: string, id: number, action: string, note: string, days?: number) => apiRequest(`/api/admin/reports/${id}/resolve`, { method: 'PUT', token, body: { action, note, ...(days === undefined ? {} : { days }) } });
export const updateVerification = (token: string, id: number, mode: 'permanent' | 'temporary' | 'revoke', days: number | undefined, note: string) => apiRequest(`/api/admin/users/${id}/verification`, { method: 'PUT', token, body: { mode, ...(days === undefined ? {} : { days }), note } });
export const freezeUser = (token: string, id: number, days: number | null, note: string) => apiRequest(`/api/admin/users/${id}/freeze`, { method: 'PUT', token, body: { days, note } });
export const unfreezeUser = (token: string, id: number, note = '') => apiRequest(`/api/admin/users/${id}/unfreeze`, { method: 'PUT', token, body: { note } });
export const banUser = (token: string, id: number, note: string) => apiRequest(`/api/admin/users/${id}/ban`, { method: 'PUT', token, body: { note } });
export const unbanUser = (token: string, id: number, note = '') => apiRequest(`/api/admin/users/${id}/unban`, { method: 'PUT', token, body: { note } });
export const getReportTarget = (token: string, id: number) => apiRequest<ReportTarget>(`/api/admin/reports/${id}/target`, { token });
