import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { hashPassword, generateId } from '../lib/crypto';
import { logActivity, jsonError, ok, now } from '../lib/helpers';
import { getStorage } from '../lib/storage';
import { requireAuth, requireSuperAdmin } from '../middleware/auth';

const users = new Hono<{ Bindings: Env; Variables: Variables }>();

users.use('*', requireAuth, requireSuperAdmin);

users.get('/', async (c) => {
  const rows = await c.env.DB.prepare(
    'SELECT id, username, display_name, avatar_key, role, status, quota_bytes, storage_used_bytes, created_at, last_login_at FROM users ORDER BY created_at DESC'
  ).all();
  return ok(c, { users: rows.results });
});

users.post('/', async (c) => {
  const admin = c.get('user');
  const body = await c.req
    .json<{ username?: string; password?: string; display_name?: string; role?: string; quota_bytes?: number }>()
    .catch(() => ({}) as Record<string, never>);
  const username = (body.username || '').trim().toLowerCase();
  if (!/^[a-z0-9_.-]{3,32}$/.test(username))
    return jsonError(c, 400, 'Username harus 3-32 karakter (huruf kecil, angka, _ . -)', 'validation');
  if (!body.password || body.password.length < 8) return jsonError(c, 400, 'Password minimal 8 karakter', 'validation');

  const existing = await c.env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(username).first();
  if (existing) return jsonError(c, 409, 'Username sudah digunakan', 'duplicate');

  const role = body.role === 'super_admin' ? 'super_admin' : 'user';
  const quota = body.quota_bytes && body.quota_bytes > 0 ? body.quota_bytes : parseInt(c.env.DEFAULT_QUOTA_BYTES, 10);
  const id = generateId();
  const hash = await hashPassword(body.password);
  await c.env.DB.prepare(
    'INSERT INTO users (id, username, display_name, password_hash, role, status, quota_bytes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(id, username, body.display_name || username, hash, role, 'active', quota, now())
    .run();
  await logActivity(c.env, admin.id, 'create', 'user', id, `Membuat user ${username}`);
  const created = await c.env.DB.prepare(
    'SELECT id, username, display_name, avatar_key, role, status, quota_bytes, storage_used_bytes, created_at, last_login_at FROM users WHERE id = ?'
  ).bind(id).first();
  return ok(c, { id, user: created });
});

users.patch('/:id', async (c) => {
  const admin = c.get('user');
  const id = c.req.param('id');
  const target = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<{ id: string; username: string; role: string }>();
  if (!target) return jsonError(c, 404, 'User tidak ditemukan', 'not_found');

  const body = await c.req
    .json<{ username?: string; display_name?: string; role?: string; quota_bytes?: number; status?: string; password?: string }>()
    .catch(() => ({}) as Record<string, never>);

  if (body.username !== undefined) {
    const uname = body.username.trim().toLowerCase();
    if (!/^[a-z0-9_.-]{3,32}$/.test(uname)) return jsonError(c, 400, 'Username tidak valid', 'validation');
    const dup = await c.env.DB.prepare('SELECT id FROM users WHERE username = ? AND id != ?').bind(uname, id).first();
    if (dup) return jsonError(c, 409, 'Username sudah digunakan', 'duplicate');
    await c.env.DB.prepare('UPDATE users SET username = ? WHERE id = ?').bind(uname, id).run();
  }
  if (body.display_name !== undefined)
    await c.env.DB.prepare('UPDATE users SET display_name = ? WHERE id = ?').bind(body.display_name.slice(0, 100), id).run();
  if (body.role !== undefined) {
    if (id === admin.id) return jsonError(c, 400, 'Tidak dapat mengubah role akun sendiri', 'validation');
    const role = body.role === 'super_admin' ? 'super_admin' : 'user';
    await c.env.DB.prepare('UPDATE users SET role = ? WHERE id = ?').bind(role, id).run();
  }
  if (body.quota_bytes !== undefined && body.quota_bytes > 0)
    await c.env.DB.prepare('UPDATE users SET quota_bytes = ? WHERE id = ?').bind(body.quota_bytes, id).run();
  if (body.status !== undefined) {
    if (id === admin.id) return jsonError(c, 400, 'Tidak dapat menonaktifkan akun sendiri', 'validation');
    const status = body.status === 'disabled' ? 'disabled' : body.status === 'suspended' ? 'suspended' : 'active';
    await c.env.DB.prepare('UPDATE users SET status = ? WHERE id = ?').bind(status, id).run();
    if (status !== 'active') {
      // Revoke all refresh tokens => active sessions die immediately
      await c.env.DB.prepare('DELETE FROM refresh_tokens WHERE user_id = ?').bind(id).run();
    }
  }
  if (body.password !== undefined) {
    if (body.password.length < 8) return jsonError(c, 400, 'Password minimal 8 karakter', 'validation');
    const hash = await hashPassword(body.password);
    await c.env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(hash, id).run();
    await c.env.DB.prepare('DELETE FROM refresh_tokens WHERE user_id = ?').bind(id).run();
  }

  await logActivity(c.env, admin.id, 'rename', 'user', id, `Memperbarui user ${target.username}`);
  return ok(c);
});

users.delete('/:id', async (c) => {
  const admin = c.get('user');
  const id = c.req.param('id');
  if (id === admin.id) return jsonError(c, 400, 'Tidak dapat menghapus akun sendiri', 'validation');
  const target = await c.env.DB.prepare('SELECT username FROM users WHERE id = ?').bind(id).first<{ username: string }>();
  if (!target) return jsonError(c, 404, 'User tidak ditemukan', 'not_found');

  // Delete storage objects owned by the user's repositories
  const storage = getStorage(c.env);
  const repos = await c.env.DB.prepare('SELECT id FROM repositories WHERE owner_id = ?').bind(id).all<{ id: string }>();
  for (const r of repos.results) {
    await storage.deletePrefix(`files/${r.id}/`);
  }
  await c.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(id).run();
  await logActivity(c.env, admin.id, 'delete', 'user', id, `Menghapus user ${target.username}`);
  return ok(c);
});

export default users;
