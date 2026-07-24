import { Hono } from 'hono';
import type { Env, Variables, AuthUser, JwtPayload } from '../types';
import { hashPassword, verifyPassword, signJwt, verifyJwt, sha256Hex, generateId, generateToken } from '../lib/crypto';
import {
  ACCESS_TOKEN_TTL,
  REFRESH_TOKEN_TTL,
  REFRESH_TOKEN_TTL_REMEMBER,
  setAuthCookies,
  clearAuthCookies,
  getCookie,
  logActivity,
  jsonError,
  ok,
  now,
  type AppContext,
} from '../lib/helpers';
import { requireAuth } from '../middleware/auth';

const auth = new Hono<{ Bindings: Env; Variables: Variables }>();

// Idempotent super admin seed
export async function seedAdmin(env: Env): Promise<void> {
  const username = env.ADMIN_USERNAME || 'admin';
  const existing = await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(username).first();
  if (existing) return;
  const password = env.ADMIN_PASSWORD || 'Admin123456';
  const hash = await hashPassword(password);
  await env.DB.prepare(
    'INSERT INTO users (id, username, display_name, password_hash, role, status, quota_bytes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(generateId(), username, 'Super Admin', hash, 'super_admin', 'active', parseInt(env.DEFAULT_QUOTA_BYTES || '104857600', 10), now())
    .run();
}

async function issueTokens(c: AppContext, user: AuthUser, remember: boolean) {
  const iat = Math.floor(Date.now() / 1000);
  const accessToken = await signJwt(
    { user_id: user.id, role: user.role, iat, exp: iat + ACCESS_TOKEN_TTL },
    c.env.JWT_SECRET
  );
  const refreshRaw = generateToken(32);
  const refreshHash = await sha256Hex(refreshRaw);
  const ttl = remember ? REFRESH_TOKEN_TTL_REMEMBER : REFRESH_TOKEN_TTL;
  await c.env.DB.prepare(
    'INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, created_at, remember) VALUES (?, ?, ?, ?, ?, ?)'
  )
    .bind(generateId(), user.id, refreshHash, now() + ttl * 1000, now(), remember ? 1 : 0)
    .run();
  setAuthCookies(c, accessToken, refreshRaw, ttl);
}

// Rate limiting via KV: max 8 attempts / 10 minutes per username+IP
async function checkRateLimit(c: AppContext, username: string): Promise<boolean> {
  const ip = c.req.header('CF-Connecting-IP') || 'unknown';
  const key = `login_rl:${username}:${ip}`;
  const count = parseInt((await c.env.CACHE.get(key)) || '0', 10);
  if (count >= 8) return false;
  await c.env.CACHE.put(key, String(count + 1), { expirationTtl: 600 });
  return true;
}

auth.post('/login', async (c) => {
  await seedAdmin(c.env);
  const body = await c.req.json<{ username?: string; password?: string; remember?: boolean }>().catch(() => ({}) as Record<string, never>);
  const username = (body.username || '').trim();
  const password = body.password || '';
  const remember = !!body.remember;

  if (!username || !password) return jsonError(c, 400, 'Username dan password wajib diisi', 'validation');
  // Rate limit temporarily disabled for debugging
  // if (!(await checkRateLimit(c, username)))
  //   return jsonError(c, 429, 'Terlalu banyak percobaan login. Coba lagi dalam 10 menit.', 'rate_limited');

  const user = await c.env.DB.prepare('SELECT * FROM users WHERE username = ?').bind(username).first<AuthUser & { password_hash: string }>();
  if (!user) {
    console.log('[login] User not found:', username);
    return jsonError(c, 401, 'Username atau password salah', 'invalid_credentials');
  }
  const pwMatch = await verifyPassword(password, user.password_hash);
  if (!pwMatch) {
    console.log('[login] Password mismatch for user:', username);
    return jsonError(c, 401, 'Username atau password salah', 'invalid_credentials');
  }
  if (user.status !== 'active') return jsonError(c, 403, 'Akun Anda telah dinonaktifkan/ditangguhkan', 'disabled');

  await c.env.DB.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').bind(now(), user.id).run();
  await issueTokens(c, user, remember);
  await logActivity(c.env, user.id, 'login');

  const { password_hash: _ph, ...safe } = user;
  return ok(c, { user: safe });
});

auth.post('/refresh', async (c) => {
  const refreshRaw = getCookie(c, 'fo_refresh');
  if (!refreshRaw) return jsonError(c, 401, 'Sesi kedaluwarsa, silakan login kembali', 'no_refresh');
  const refreshHash = await sha256Hex(refreshRaw);
  const record = await c.env.DB.prepare('SELECT * FROM refresh_tokens WHERE token_hash = ?')
    .bind(refreshHash)
    .first<{ id: string; user_id: string; expires_at: number; remember: number }>();
  if (!record || record.expires_at < now()) {
    if (record) await c.env.DB.prepare('DELETE FROM refresh_tokens WHERE id = ?').bind(record.id).run();
    clearAuthCookies(c);
    return jsonError(c, 401, 'Sesi kedaluwarsa, silakan login kembali', 'refresh_expired');
  }
  const user = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(record.user_id).first<AuthUser & { password_hash: string }>();
  if (!user || user.status !== 'active') {
    await c.env.DB.prepare('DELETE FROM refresh_tokens WHERE id = ?').bind(record.id).run();
    clearAuthCookies(c);
    return jsonError(c, 403, 'Akun tidak aktif', 'disabled');
  }
  // Rotate refresh token
  await c.env.DB.prepare('DELETE FROM refresh_tokens WHERE id = ?').bind(record.id).run();
  await issueTokens(c, user, record.remember === 1);
  const { password_hash: _ph, ...safe } = user;
  return ok(c, { user: safe });
});

auth.post('/logout', async (c) => {
  const refreshRaw = getCookie(c, 'fo_refresh');
  if (refreshRaw) {
    const refreshHash = await sha256Hex(refreshRaw);
    await c.env.DB.prepare('DELETE FROM refresh_tokens WHERE token_hash = ?').bind(refreshHash).run();
  }
  clearAuthCookies(c);
  return ok(c);
});

// Public seed endpoint (idempotent) - re-create admin user if needed
auth.post('/seed', async (c) => {
  try {
    await seedAdmin(c.env);
    return ok(c, { message: 'Admin user seeded successfully' });
  } catch (err) {
    console.error('Seed error:', err);
    return jsonError(c, 500, 'Gagal seed admin user', 'internal');
  }
});

auth.get('/me', requireAuth, async (c) => {
  const user = c.get('user');
  const settings = await c.env.DB.prepare('SELECT * FROM settings WHERE user_id = ?').bind(user.id).first();
  return ok(c, { user, settings: settings || { theme: 'dark', accent_color: '#7c6cf0', language: 'id' } });
});

async function updateProfile(c: AppContext & { get: (k: 'user') => AuthUser }) {
  const user = (c as unknown as { get: (k: string) => AuthUser }).get('user');
  const body = await c.req.json<{ display_name?: string; avatar_key?: string }>().catch(() => ({}) as Record<string, never>);
  if (body.display_name !== undefined) {
    await c.env.DB.prepare('UPDATE users SET display_name = ? WHERE id = ?').bind(body.display_name.slice(0, 100), user.id).run();
  }
  if (body.avatar_key !== undefined) {
    await c.env.DB.prepare('UPDATE users SET avatar_key = ? WHERE id = ?').bind(body.avatar_key || null, user.id).run();
  }
  return ok(c, {});
}

auth.patch('/profile', requireAuth, (c) => updateProfile(c as unknown as AppContext & { get: (k: 'user') => AuthUser }));

auth.patch('/me', requireAuth, async (c) => {
  const user = c.get('user');
  const body = await c.req.json<{ display_name?: string; avatar_key?: string }>().catch(() => ({}) as Record<string, never>);
  if (body.display_name !== undefined) {
    await c.env.DB.prepare('UPDATE users SET display_name = ? WHERE id = ?').bind(body.display_name.slice(0, 100), user.id).run();
  }
  if (body.avatar_key !== undefined) {
    await c.env.DB.prepare('UPDATE users SET avatar_key = ? WHERE id = ?').bind(body.avatar_key || null, user.id).run();
  }
  return ok(c);
});

async function changePassword(c: AppContext) {
  const user = (c as unknown as { get: (k: string) => AuthUser }).get('user');
  const body = await c.req
    .json<{ current_password?: string; old_password?: string; new_password?: string }>()
    .catch(() => ({}) as Record<string, never>);
  const currentPw = body.current_password || body.old_password;
  if (!currentPw || !body.new_password) return jsonError(c, 400, 'Password lama dan baru wajib diisi', 'validation');
  if (body.new_password.length < 8) return jsonError(c, 400, 'Password baru minimal 8 karakter', 'validation');
  const row = await c.env.DB.prepare('SELECT password_hash FROM users WHERE id = ?').bind(user.id).first<{ password_hash: string }>();
  if (!row || !(await verifyPassword(currentPw, row.password_hash)))
    return jsonError(c, 401, 'Password lama salah', 'invalid_credentials');
  const hash = await hashPassword(body.new_password);
  await c.env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(hash, user.id).run();
  return ok(c, {});
}

auth.post('/me/password', requireAuth, (c) => changePassword(c as unknown as AppContext));
auth.post('/password', requireAuth, (c) => changePassword(c as unknown as AppContext));

async function saveSettings(c: AppContext) {
  const user = (c as unknown as { get: (k: string) => AuthUser }).get('user');
  const body = await c.req.json<{ theme?: string; accent_color?: string; language?: string }>().catch(() => ({}) as Record<string, never>);
  await c.env.DB.prepare(
    `INSERT INTO settings (user_id, theme, accent_color, language) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET theme = excluded.theme, accent_color = excluded.accent_color, language = excluded.language`
  )
    .bind(user.id, body.theme || 'dark', body.accent_color || '#7c6cf0', body.language || 'id')
    .run();
  return ok(c, {});
}

auth.patch('/me/settings', requireAuth, (c) => saveSettings(c as unknown as AppContext));
auth.put('/settings', requireAuth, (c) => saveSettings(c as unknown as AppContext));

export default auth;
