export const API_URL = (import.meta.env.VITE_API_URL as string) || 'https://api.files.onlyx.top';
export const APP_NAME = (import.meta.env.VITE_APP_NAME as string) || 'Files Onlyx';

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(message: string, code: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

let refreshPromise: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = fetch(`${API_URL}/api/auth/refresh`, { method: 'POST', credentials: 'include' })
      .then((r) => r.ok)
      .catch(() => false)
      .finally(() => setTimeout(() => (refreshPromise = null), 100));
  }
  return refreshPromise;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  rawBody?: BodyInit;
  headers?: Record<string, string>;
  skipRefresh?: boolean;
}

export async function api<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const doFetch = () =>
    fetch(`${API_URL}${path}`, {
      method: opts.method || 'GET',
      credentials: 'include',
      headers: {
        ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(opts.headers || {}),
      },
      body: opts.rawBody !== undefined ? opts.rawBody : opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });

  let res = await doFetch();
  if (res.status === 401 && !opts.skipRefresh && !path.startsWith('/api/auth/')) {
    const refreshed = await tryRefresh();
    if (refreshed) res = await doFetch();
  }

  const isJson = res.headers.get('Content-Type')?.includes('application/json');
  if (!isJson) {
    if (!res.ok) throw new ApiError('Terjadi kesalahan', 'unknown', res.status);
    return res as unknown as T;
  }
  const json = (await res.json()) as { success: boolean; data?: T; error?: { message: string; code: string } };
  if (!json.success) {
    throw new ApiError(json.error?.message || 'Terjadi kesalahan', json.error?.code || 'unknown', res.status);
  }
  return json.data as T;
}

// Raw fetch for binary content (file preview/download via blob)
export async function apiRaw(path: string, opts: RequestOptions = {}): Promise<Response> {
  const doFetch = () =>
    fetch(`${API_URL}${path}`, {
      method: opts.method || 'GET',
      credentials: 'include',
      headers: opts.headers,
      body: opts.rawBody,
    });
  let res = await doFetch();
  if (res.status === 401 && !opts.skipRefresh) {
    const refreshed = await tryRefresh();
    if (refreshed) res = await doFetch();
  }
  if (!res.ok) {
    let message = 'Terjadi kesalahan';
    let code = 'unknown';
    try {
      const j = (await res.clone().json()) as { error?: { message: string; code: string } };
      message = j.error?.message || message;
      code = j.error?.code || code;
    } catch { /* ignore */ }
    throw new ApiError(message, code, res.status);
  }
  return res;
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatDate(ts: number | null | undefined): string {
  if (!ts) return '-';
  return new Date(ts).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatDateTime(ts: number | null | undefined): string {
  if (!ts) return '-';
  return new Date(ts).toLocaleString('id-ID', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'baru saja';
  if (mins < 60) return `${mins} menit lalu`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} jam lalu`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} hari lalu`;
  return formatDate(ts);
}
