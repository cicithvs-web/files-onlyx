import { Hono } from 'hono';
import type { Env, Variables, NodeRow } from '../types';
import { generateId, generateToken, hashPassword, verifyPassword } from '../lib/crypto';
import { logActivity, jsonError, ok, now, type AppContext } from '../lib/helpers';
import { getStorage } from '../lib/storage';
import { requireAuth } from '../middleware/auth';
import { assertNodeAccess } from './nodes';
import { assertRepoAccess } from '../middleware/auth';

const shares = new Hono<{ Bindings: Env; Variables: Variables }>();

// ---- Authenticated share management ----
shares.get('/', requireAuth, async (c) => {
  const user = c.get('user');
  const rows = await c.env.DB.prepare(
    `SELECT s.*, 
       CASE s.target_type WHEN 'repo' THEN (SELECT name FROM repositories WHERE id = s.target_id) ELSE (SELECT name FROM nodes WHERE id = s.target_id) END AS target_name
     FROM shares s WHERE s.owner_id = ? ORDER BY s.created_at DESC`
  )
    .bind(user.id)
    .all();
  return ok(c, { shares: rows.results });
});

shares.post('/', requireAuth, async (c) => {
  const user = c.get('user');
  const body = await c.req
    .json<{ target_type?: string; target_id?: string; visibility?: string; password?: string; expires_in_hours?: number }>()
    .catch(() => ({}) as Record<string, never>);
  if (!body.target_type || !body.target_id) return jsonError(c, 400, 'Target share wajib diisi', 'validation');

  // ownership validation
  if (body.target_type === 'repo') {
    const repo = await assertRepoAccess(c as unknown as AppContext, body.target_id);
    if (!repo) return jsonError(c, 404, 'Repository tidak ditemukan', 'not_found');
  } else if (body.target_type === 'node') {
    const access = await assertNodeAccess(c as unknown as AppContext, body.target_id);
    if (!access) return jsonError(c, 404, 'Item tidak ditemukan', 'not_found');
  } else {
    return jsonError(c, 400, 'Tipe target tidak valid', 'validation');
  }

  const id = generateId();
  const token = generateToken(16);
  const passwordHash = body.password ? await hashPassword(body.password) : null;
  const expiresAt = body.expires_in_hours && body.expires_in_hours > 0 ? now() + body.expires_in_hours * 3600 * 1000 : null;

  await c.env.DB.prepare(
    'INSERT INTO shares (id, token, owner_id, target_type, target_id, visibility, password_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(id, token, user.id, body.target_type, body.target_id, body.visibility === 'private' ? 'private' : 'public', passwordHash, expiresAt, now())
    .run();
  await logActivity(c.env, user.id, 'share', body.target_type, body.target_id, 'Membuat link share');
  return ok(c, { id, token, url: `/s/${token}` });
});

shares.delete('/:id', requireAuth, async (c) => {
  const user = c.get('user');
  const share = await c.env.DB.prepare('SELECT id FROM shares WHERE id = ? AND owner_id = ?')
    .bind(c.req.param('id'), user.id)
    .first();
  if (!share) return jsonError(c, 404, 'Share tidak ditemukan', 'not_found');
  await c.env.DB.prepare('DELETE FROM shares WHERE id = ?').bind(c.req.param('id')).run();
  return ok(c);
});

// ---- Public share access (no auth) ----

interface ShareRow {
  id: string;
  token: string;
  owner_id: string;
  target_type: 'repo' | 'node';
  target_id: string;
  visibility: string;
  password_hash: string | null;
  expires_at: number | null;
}

async function resolveShare(c: AppContext, token: string): Promise<ShareRow | Response> {
  const share = await c.env.DB.prepare('SELECT * FROM shares WHERE token = ?').bind(token).first<ShareRow>();
  if (!share) return jsonError(c, 404, 'Link share tidak ditemukan', 'not_found');
  if (share.expires_at && share.expires_at < now())
    return c.json({ success: false, error: { message: 'Link share sudah kedaluwarsa', code: 'expired' } }, 410);
  return share;
}

async function checkSharePassword(c: AppContext, share: ShareRow): Promise<Response | null> {
  if (!share.password_hash) return null;
  const provided = c.req.header('X-Share-Password') || c.req.query('password') || c.req.query('pw') || '';
  if (!provided) return c.json({ success: false, error: { message: 'Password diperlukan', code: 'password_required' } }, 401);
  if (!(await verifyPassword(provided, share.password_hash)))
    return c.json({ success: false, error: { message: 'Password salah', code: 'password_invalid' } }, 401);
  return null;
}

// Share metadata
shares.get('/public/:token', async (c) => {
  const shareOrResp = await resolveShare(c as unknown as AppContext, c.req.param('token'));
  if (shareOrResp instanceof Response) return shareOrResp;
  const share = shareOrResp;
  const needsPassword = !!share.password_hash;

  let target: Record<string, unknown> | null = null;
  if (share.target_type === 'repo') {
    target = await c.env.DB.prepare('SELECT id, name, description, icon, color, size_bytes FROM repositories WHERE id = ? AND deleted_at IS NULL')
      .bind(share.target_id)
      .first();
  } else {
    target = await c.env.DB.prepare('SELECT id, type, name, path, size_bytes, mime_type FROM nodes WHERE id = ? AND deleted_at IS NULL')
      .bind(share.target_id)
      .first();
  }
  if (!target) return jsonError(c, 404, 'Konten share sudah dihapus', 'not_found');
  return ok(c, {
    share: { token: share.token, target_type: share.target_type, needs_password: needsPassword, expires_at: share.expires_at },
    target,
  });
});

// List folder/repo contents in a share
shares.get('/public/:token/list', async (c) => {
  const shareOrResp = await resolveShare(c as unknown as AppContext, c.req.param('token'));
  if (shareOrResp instanceof Response) return shareOrResp;
  const share = shareOrResp;
  const pwErr = await checkSharePassword(c as unknown as AppContext, share);
  if (pwErr) return pwErr;

  const parentId = c.req.query('parent_id') || null;
  let repoId: string;
  let rootParent: string | null = null;

  if (share.target_type === 'repo') {
    repoId = share.target_id;
  } else {
    const node = await c.env.DB.prepare('SELECT * FROM nodes WHERE id = ? AND deleted_at IS NULL').bind(share.target_id).first<NodeRow>();
    if (!node || node.type !== 'folder') return jsonError(c, 400, 'Share ini bukan folder', 'validation');
    repoId = node.repo_id;
    rootParent = node.id;
  }

  const effectiveParent = parentId || rootParent;
  // Security: ensure requested parent is inside the shared subtree
  if (parentId && share.target_type === 'node') {
    const shared = await c.env.DB.prepare('SELECT path, repo_id FROM nodes WHERE id = ?').bind(share.target_id).first<{ path: string; repo_id: string }>();
    const requested = await c.env.DB.prepare('SELECT path, repo_id FROM nodes WHERE id = ?').bind(parentId).first<{ path: string; repo_id: string }>();
    if (!shared || !requested || requested.repo_id !== shared.repo_id ||
        (requested.path !== shared.path && !requested.path.startsWith(`${shared.path}/`)))
      return jsonError(c, 403, 'Akses ditolak', 'forbidden');
  }

  const rows = await c.env.DB.prepare(
    `SELECT id, parent_id, type, name, path, size_bytes, mime_type, updated_at FROM nodes WHERE repo_id = ? AND ${effectiveParent ? 'parent_id = ?' : 'parent_id IS NULL'} AND deleted_at IS NULL ORDER BY type DESC, name COLLATE NOCASE ASC`
  )
    .bind(...(effectiveParent ? [repoId, effectiveParent] : [repoId]))
    .all();

  // Breadcrumbs: ancestors of the current folder relative to the share root
  const breadcrumbs: Array<Record<string, unknown>> = [];
  if (parentId) {
    let cursor: string | null = parentId;
    while (cursor && cursor !== rootParent) {
      const n: { id: string; parent_id: string | null; name: string; type: string } | null = await c.env.DB.prepare(
        'SELECT id, parent_id, name, type FROM nodes WHERE id = ? AND deleted_at IS NULL'
      ).bind(cursor).first();
      if (!n) break;
      breadcrumbs.unshift(n as unknown as Record<string, unknown>);
      cursor = n.parent_id;
    }
  }
  return ok(c, { nodes: rows.results, breadcrumbs });
});

// Download entire shared repo/folder as ZIP
shares.get('/public/:token/download', async (c) => {
  const shareOrResp = await resolveShare(c as unknown as AppContext, c.req.param('token'));
  if (shareOrResp instanceof Response) return shareOrResp;
  const share = shareOrResp;
  const pwErr = await checkSharePassword(c as unknown as AppContext, share);
  if (pwErr) return pwErr;

  let repoId: string;
  let basePath = '';
  let zipName = 'share';
  if (share.target_type === 'repo') {
    const repo = await c.env.DB.prepare('SELECT id, name FROM repositories WHERE id = ? AND deleted_at IS NULL')
      .bind(share.target_id).first<{ id: string; name: string }>();
    if (!repo) return jsonError(c as unknown as AppContext, 404, 'Konten share sudah dihapus', 'not_found');
    repoId = repo.id;
    zipName = repo.name;
  } else {
    const node = await c.env.DB.prepare('SELECT * FROM nodes WHERE id = ? AND deleted_at IS NULL').bind(share.target_id).first<NodeRow>();
    if (!node) return jsonError(c as unknown as AppContext, 404, 'Konten share sudah dihapus', 'not_found');
    repoId = node.repo_id;
    zipName = node.name;
    if (node.type === 'folder') basePath = node.path;
    else {
      // single file: return the file directly
      const obj = await getStorage(c.env).get(node.storage_key!);
      if (!obj) return jsonError(c as unknown as AppContext, 404, 'Konten file tidak ditemukan', 'not_found');
      return new Response(obj.body as ArrayBuffer, {
        headers: {
          'Content-Type': node.mime_type || 'application/octet-stream',
          'Content-Disposition': `attachment; filename="${encodeURIComponent(node.name)}"`,
        },
      });
    }
  }

  const files = await c.env.DB.prepare(
    `SELECT * FROM nodes WHERE repo_id = ? AND type = 'file' AND deleted_at IS NULL${basePath ? ' AND path LIKE ?' : ''}`
  )
    .bind(...(basePath ? [repoId, `${basePath}/%`] : [repoId]))
    .all<NodeRow>();

  const entries: Record<string, Uint8Array> = {};
  const storage = getStorage(c.env);
  for (const f of files.results) {
    if (!f.storage_key) continue;
    const buf = await storage.getBuffer(f.storage_key);
    if (!buf) continue;
    const rel = basePath ? f.path.slice(basePath.length + 1) : f.path.replace(/^\//, '');
    entries[rel] = new Uint8Array(buf);
  }
  const { zipSync } = await import('fflate');
  const zipped = zipSync(entries, { level: 6 });
  return new Response(zipped.slice().buffer as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(zipName)}.zip"`,
    },
  });
});

// Download / view a file within a share
shares.get('/public/:token/file/:nodeId', async (c) => {
  const shareOrResp = await resolveShare(c as unknown as AppContext, c.req.param('token'));
  if (shareOrResp instanceof Response) return shareOrResp;
  const share = shareOrResp;
  const pwErr = await checkSharePassword(c as unknown as AppContext, share);
  if (pwErr) return pwErr;

  const nodeId = c.req.param('nodeId');
  const node = await c.env.DB.prepare('SELECT * FROM nodes WHERE id = ? AND deleted_at IS NULL').bind(nodeId).first<NodeRow>();
  if (!node || node.type !== 'file' || !node.storage_key) return jsonError(c, 404, 'File tidak ditemukan', 'not_found');

  // Validate node is within share target
  if (share.target_type === 'repo') {
    if (node.repo_id !== share.target_id) return jsonError(c, 403, 'Akses ditolak', 'forbidden');
  } else {
    const shared = await c.env.DB.prepare('SELECT * FROM nodes WHERE id = ?').bind(share.target_id).first<NodeRow>();
    if (!shared) return jsonError(c, 404, 'Share tidak valid', 'not_found');
    const inside = shared.type === 'file' ? node.id === shared.id : node.repo_id === shared.repo_id && node.path.startsWith(`${shared.path}/`);
    if (!inside) return jsonError(c, 403, 'Akses ditolak', 'forbidden');
  }

  const obj = await getStorage(c.env).get(node.storage_key);
  if (!obj) return jsonError(c, 404, 'Konten file tidak ditemukan', 'not_found');
  const inline = c.req.query('inline') === '1';
  return new Response(obj.body as ArrayBuffer, {
    headers: {
      'Content-Type': node.mime_type || 'application/octet-stream',
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(node.name)}"`,
    },
  });
});

// Verify share password (for UI gate)
shares.post('/public/:token/verify', async (c) => {
  const shareOrResp = await resolveShare(c as unknown as AppContext, c.req.param('token'));
  if (shareOrResp instanceof Response) return shareOrResp;
  const share = shareOrResp;
  const body = await c.req.json<{ password?: string }>().catch(() => ({}) as Record<string, never>);
  if (!share.password_hash) return ok(c, { valid: true });
  const valid = !!body.password && (await verifyPassword(body.password, share.password_hash));
  if (!valid) return jsonError(c, 401, 'Password salah', 'password_invalid');
  return ok(c, { valid: true });
});

export default shares;
