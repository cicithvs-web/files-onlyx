import type { MiddlewareHandler } from 'hono';
import type { Env, Variables, JwtPayload, AuthUser } from '../types';
import { verifyJwt } from '../lib/crypto';
import { getCookie, jsonError, type AppContext } from '../lib/helpers';

export const requireAuth: MiddlewareHandler<{ Bindings: Env; Variables: Variables }> = async (c, next) => {
  const token = getCookie(c as AppContext, 'fo_access');
  if (!token) return jsonError(c as AppContext, 401, 'Sesi tidak ditemukan, silakan login', 'unauthorized');

  const payload = await verifyJwt<JwtPayload>(token, c.env.JWT_SECRET);
  if (!payload) return jsonError(c as AppContext, 401, 'Sesi kedaluwarsa, silakan login kembali', 'token_expired');

  const user = await c.env.DB.prepare(
    'SELECT id, username, display_name, avatar_key, role, status, quota_bytes, storage_used_bytes, created_at, last_login_at FROM users WHERE id = ?'
  )
    .bind(payload.user_id)
    .first<AuthUser>();

  if (!user) return jsonError(c as AppContext, 401, 'Akun tidak ditemukan', 'unauthorized');
  if (user.status !== 'active') return jsonError(c as AppContext, 403, 'Akun Anda telah dinonaktifkan/ditangguhkan', 'disabled');

  c.set('user', user);
  await next();
};

export const requireSuperAdmin: MiddlewareHandler<{ Bindings: Env; Variables: Variables }> = async (c, next) => {
  const user = c.get('user');
  if (!user || user.role !== 'super_admin') {
    return jsonError(c as AppContext, 403, 'Hanya Super Admin yang dapat mengakses fitur ini', 'forbidden');
  }
  await next();
};

// Ensure repo ownership (or super admin). Returns repo row or null (response already sent).
export async function assertRepoAccess(c: AppContext, repoId: string): Promise<Record<string, unknown> | null> {
  const user = c.get('user');
  const repo = await c.env.DB.prepare('SELECT * FROM repositories WHERE id = ? AND deleted_at IS NULL')
    .bind(repoId)
    .first<Record<string, unknown>>();
  if (!repo) return null;
  if (user.role !== 'super_admin' && repo.owner_id !== user.id) return null;
  return repo;
}
