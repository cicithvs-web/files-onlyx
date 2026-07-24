import type { Context } from 'hono';
import type { Env, Variables } from '../types';
import { generateId } from './crypto';

export type AppContext = Context<{ Bindings: Env; Variables: Variables }>;

export const ACCESS_TOKEN_TTL = 15 * 60; // 15 minutes
export const REFRESH_TOKEN_TTL = 7 * 24 * 3600; // 7 days
export const REFRESH_TOKEN_TTL_REMEMBER = 30 * 24 * 3600; // 30 days

export function now(): number {
  return Date.now();
}

export function cookieAttrs(env: Env, maxAge: number): string {
  // In local dev COOKIE_DOMAIN may not resolve; keep host-only cookie if domain is 'localhost'
  const domain = env.COOKIE_DOMAIN && env.COOKIE_DOMAIN !== 'localhost' ? `; Domain=${env.COOKIE_DOMAIN}` : '';
  return `HttpOnly; Secure; SameSite=None; Path=/${domain}; Max-Age=${maxAge}`;
}

export function setAuthCookies(
  c: AppContext,
  accessToken: string,
  refreshToken: string | null,
  refreshMaxAge: number
): void {
  c.header('Set-Cookie', `fo_access=${accessToken}; ${cookieAttrs(c.env, ACCESS_TOKEN_TTL)}`, { append: true });
  if (refreshToken !== null) {
    c.header('Set-Cookie', `fo_refresh=${refreshToken}; ${cookieAttrs(c.env, refreshMaxAge)}`, { append: true });
  }
}

export function clearAuthCookies(c: AppContext): void {
  c.header('Set-Cookie', `fo_access=; ${cookieAttrs(c.env, 0)}`, { append: true });
  c.header('Set-Cookie', `fo_refresh=; ${cookieAttrs(c.env, 0)}`, { append: true });
}

export function getCookie(c: AppContext, name: string): string | null {
  const header = c.req.header('Cookie') || '';
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? match[1] : null;
}

export async function logActivity(
  env: Env,
  userId: string,
  action: string,
  targetType?: string,
  targetId?: string,
  detail?: string
): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO activities (id, user_id, action, target_type, target_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(generateId(), userId, action, targetType ?? null, targetId ?? null, detail ?? null, now())
    .run();
}

export async function adjustUserStorage(env: Env, userId: string, deltaBytes: number): Promise<void> {
  await env.DB.prepare(
    'UPDATE users SET storage_used_bytes = MAX(0, storage_used_bytes + ?) WHERE id = ?'
  )
    .bind(deltaBytes, userId)
    .run();
}

export async function adjustRepoSize(env: Env, repoId: string, deltaBytes: number): Promise<void> {
  await env.DB.prepare(
    'UPDATE repositories SET size_bytes = MAX(0, size_bytes + ?), updated_at = ? WHERE id = ?'
  )
    .bind(deltaBytes, now(), repoId)
    .run();
}

export function sanitizeName(name: string): string {
  return name.trim().replace(/[\/\\<>:"|?*\x00-\x1f]/g, '').slice(0, 255);
}

export function joinPath(parentPath: string, name: string): string {
  return parentPath === '/' ? `/${name}` : `${parentPath}/${name}`;
}

export function extOf(name: string): string {
  const idx = name.lastIndexOf('.');
  return idx > 0 ? name.slice(idx + 1).toLowerCase() : '';
}

const MIME_MAP: Record<string, string> = {
  html: 'text/html', htm: 'text/html', css: 'text/css', js: 'text/javascript', mjs: 'text/javascript',
  ts: 'text/typescript', tsx: 'text/typescript', jsx: 'text/javascript', json: 'application/json',
  txt: 'text/plain', md: 'text/markdown', xml: 'application/xml', yaml: 'text/yaml', yml: 'text/yaml',
  svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', ico: 'image/x-icon', pdf: 'application/pdf', mp4: 'video/mp4', webm: 'video/webm',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', zip: 'application/zip', csv: 'text/csv',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf',
};

export function mimeOf(name: string): string {
  return MIME_MAP[extOf(name)] || 'application/octet-stream';
}

export function jsonError(c: AppContext, status: number, message: string, code?: string) {
  return c.json({ success: false, error: { message, code: code ?? 'error' } }, status as 400);
}

export function ok(c: AppContext, data: unknown = null) {
  return c.json({ success: true, data });
}
