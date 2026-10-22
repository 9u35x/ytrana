import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';

const localDefault = Platform.OS === 'android' ? 'http://10.0.2.2:8000' : 'http://127.0.0.1:8000';
const productionDefault = 'https://270zw.pythonanywhere.com';
const defaultBase = __DEV__ ? localDefault : productionDefault;
export const API_BASE = (process.env.EXPO_PUBLIC_API_BASE || defaultBase).replace(/\/$/, '');

type ApiOptions = {
  method?: string;
  token?: string | null;
  body?: unknown;
  formData?: boolean;
};

type FormFields = Record<string, string>;

type UploadFile = {
  uri: string;
  fileName?: string | null;
  mimeType?: string | null;
};

type UploadOptions = {
  path: string;
  token: string;
  file: UploadFile;
  fieldName: 'image' | 'video';
  parameters?: FormFields;
  onProgress?: (progress: number) => void;
  maxBytes?: number;
};

export function mediaUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  try {
    return new URL(path, `${API_BASE}/`).toString();
  } catch {
    return null;
  }
}

export function authenticatedMediaSource(path: string | null | undefined, token: string | null | undefined): string | { uri: string; headers: Record<string, string> } | null {
  const url = mediaUrl(path);
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.origin !== new URL(API_BASE).origin) return null;
    if (parsed.pathname.startsWith('/api/private-media/') || parsed.pathname.startsWith('/api/account/archive/')) {
      return token ? { uri: url, headers: { Authorization: `Bearer ${token}` } } : null;
    }
    return parsed.pathname.startsWith('/uploads/') ? url : null;
  } catch { return null; }
}

function parseResponse(raw: string): any {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function responseMessage(data: any, status: number): string {
  const detail = data?.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    const parts = detail.map((item: { msg?: string }) => item.msg).filter(Boolean);
    if (parts.length) return parts.join('، ');
  }
  if (status === 413) return 'حجم الملف أكبر من الحد الذي تقبله الاستضافة. اختر مقطعًا أصغر.';
  if (status === 401) return 'انتهت جلسة الدخول. سجّل دخولك ثم أعد المحاولة.';
  return `تعذر إكمال الطلب (HTTP ${status})`;
}

export async function apiRequest<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;

  let body: BodyInit | undefined;
  if (options.body !== undefined && options.body !== null) {
    if (options.formData) {
      body = options.body as FormData;
    } else {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.body);
    }
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: options.method || 'GET',
      headers,
      body,
    });
  } catch {
    throw new Error(`تعذر الاتصال بالخادم (${API_BASE}). تحقق من الإنترنت وحاول مرة أخرى.`);
  }

  const raw = await response.text();
  const data = parseResponse(raw);
  if (!response.ok) throw new Error(responseMessage(data, response.status));
  return data as T;
}

export async function apiFormRequest<T>(path: string, fields: FormFields, token?: string | null): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const body = Object.entries(fields)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, { method: 'POST', headers, body });
  } catch {
    throw new Error(`تعذر الاتصال بالخادم (${API_BASE}). تحقق من الإنترنت وحاول مرة أخرى.`);
  }
  const raw = await response.text();
  const data = parseResponse(raw);
  if (!response.ok) throw new Error(responseMessage(data, response.status));
  return data as T;
}

function safeExtension(file: UploadFile, fieldName: UploadOptions['fieldName']): string {
  const mime = (file.mimeType || '').toLowerCase().split(';')[0];
  const fromMime = mime.includes('/') ? mime.split('/')[1] : '';
  const ext = fromMime === 'quicktime' ? 'mov' : fromMime === 'jpeg' ? 'jpg' : fromMime;
  if (/^[a-z0-9]{2,8}$/.test(ext)) return ext;
  const fromName = file.fileName?.split('.').pop()?.toLowerCase() || '';
  if (/^[a-z0-9]{2,8}$/.test(fromName)) return fromName;
  return fieldName === 'video' ? 'mp4' : 'jpg';
}

function safeFileName(file: UploadFile, fieldName: UploadOptions['fieldName']): string {
  const ext = safeExtension(file, fieldName);
  const base = (file.fileName || `ytrana-${fieldName}`)
    .replace(/\\/g, '/')
    .split('/')
    .pop()
    ?.replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .slice(0, 48) || `ytrana-${fieldName}`;
  return `${base}-${Date.now()}.${ext}`;
}

export async function uploadMediaFile<T>({
  path,
  token,
  file,
  fieldName,
  parameters = {},
  onProgress,
  maxBytes,
}: UploadOptions): Promise<T> {
  if (!token) throw new Error('سجّل الدخول قبل رفع الملف.');
  if (!FileSystem.cacheDirectory) throw new Error('مساحة التخزين المؤقت غير متاحة على هذا الجهاز.');

  const tempUri = `${FileSystem.cacheDirectory}${safeFileName(file, fieldName)}`;
  try {
    const info = await FileSystem.getInfoAsync(file.uri);
    if (!info.exists || info.isDirectory) throw new Error('الملف المحدد لم يعد متاحًا. اختره مرة أخرى.');
    if (maxBytes !== undefined && info.exists && info.size > maxBytes) {
      throw new Error(fieldName === 'image' ? 'حجم الصورة أكبر من 5MB. اختر صورة أصغر.' : 'حجم الفيديو أكبر من 20MB. اختر مقطعًا أصغر.');
    }
    await FileSystem.copyAsync({ from: file.uri, to: tempUri });

    const mimeType = file.mimeType || (fieldName === 'video' ? 'video/mp4' : 'image/jpeg');
    const task = FileSystem.createUploadTask(
      `${API_BASE}${path}`,
      tempUri,
      {
        uploadType: FileSystem.FileSystemUploadType.MULTIPART,
        fieldName,
        mimeType,
        httpMethod: 'POST',
        headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
        parameters,
      },
      (event) => {
        if (event.totalBytesExpectedToSend > 0) {
          onProgress?.(Math.min(1, event.totalBytesSent / event.totalBytesExpectedToSend));
        }
      },
    );
    const response = await task.uploadAsync();
    if (!response) throw new Error('أُلغي رفع الملف.');
    const data = parseResponse(response.body);
    if (response.status < 200 || response.status >= 300) {
      throw new Error(responseMessage(data, response.status));
    }
    onProgress?.(1);
    return data as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message.includes('لم يعد متاحًا') || message.includes('أُلغي')) throw error;
    if (/network request failed|timed? ?out|connection|socket|econn/i.test(message)) {
      throw new Error('تعذر إرسال الملف إلى الخادم. تحقق من الإنترنت، واختر ملفًا أصغر ثم أعد المحاولة.');
    }
    throw error instanceof Error ? error : new Error('تعذر رفع الملف. اختره مرة أخرى وحاول مجددًا.');
  } finally {
    await FileSystem.deleteAsync(tempUri, { idempotent: true }).catch(() => undefined);
  }
}

export async function enrichPostMedia<T extends { id: number }>(posts: T[], token?: string | null): Promise<T[]> {
  if (!posts.length) return posts;
  try {
    const ids = posts.map((post) => post.id).join(',');
    const media = await apiRequest<Array<Partial<T> & { id: number }>>(
      `/api/media/posts?ids=${encodeURIComponent(ids)}`,
      { token },
    );
    const byId = new Map(media.map((post) => [post.id, post]));
    return posts.map((post) => ({ ...post, ...(byId.get(post.id) || {}) }));
  } catch {
    // Keep the legacy feed usable if an older server does not expose media metadata yet.
    return posts;
  }
}
