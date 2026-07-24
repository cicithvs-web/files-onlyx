import { Hono } from 'hono';
import type { Env, Variables, NodeRow } from '../types';
import { generateId } from '../lib/crypto';
import { logActivity, jsonError, ok, now, adjustUserStorage, adjustRepoSize, type AppContext } from '../lib/helpers';
import { getStorage } from '../lib/storage';
import { requireAuth } from '../middleware/auth';

const misc = new Hono<{ Bindings: Env; Variables: Variables }>();
misc.use('*', requireAuth);

// ---- Dashboard stats ----
misc.get('/dashboard', async (c) => {
  const user = c.get('user');
  const ownerFilter = user.role === 'super_admin' ? '' : 'AND r.owner_id = ?';
  const binds = user.role === 'super_admin' ? [] : [user.id];

  const repoStats = await c.env.DB.prepare(
    `SELECT COUNT(*) AS repo_count, COALESCE(SUM(r.size_bytes),0) AS total_size FROM repositories r WHERE r.deleted_at IS NULL ${ownerFilter}`
  )
    .bind(...binds)
    .first<{ repo_count: number; total_size: number }>();

  const nodeStats = await c.env.DB.prepare(
    `SELECT SUM(CASE WHEN n.type='file' THEN 1 ELSE 0 END) AS file_count,
            SUM(CASE WHEN n.type='folder' THEN 1 ELSE 0 END) AS folder_count
     FROM nodes n JOIN repositories r ON r.id = n.repo_id
     WHERE n.deleted_at IS NULL AND r.deleted_at IS NULL ${ownerFilter}`
  )
    .bind(...binds)
    .first<{ file_count: number; folder_count: number }>();

  const recentRepos = await c.env.DB.prepare(
    `SELECT r.id, r.name, r.icon, r.color, r.size_bytes, r.updated_at, r.is_public FROM repositories r WHERE r.deleted_at IS NULL AND r.is_archived = 0 ${ownerFilter} ORDER BY r.updated_at DESC LIMIT 6`
  )
    .bind(...binds)
    .all();

  const recentActivity = await c.env.DB.prepare(
    'SELECT * FROM activities WHERE user_id = ? ORDER BY created_at DESC LIMIT 10'
  )
    .bind(user.id)
    .all();

  return ok(c, {
    repo_count: repoStats?.repo_count || 0,
    file_count: nodeStats?.file_count || 0,
    folder_count: nodeStats?.folder_count || 0,
    storage_used: user.storage_used_bytes,
    storage_quota: user.quota_bytes,
    recent_repos: recentRepos.results,
    recent_activity: recentActivity.results,
  });
});

// ---- Activity log ----
misc.get('/activities', async (c) => {
  const user = c.get('user');
  const page = Math.max(1, parseInt(c.req.query('page') || '1', 10));
  const perPage = 20;
  const rows = await c.env.DB.prepare(
    'SELECT * FROM activities WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
  )
    .bind(user.id, perPage, (page - 1) * perPage)
    .all();
  const total = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM activities WHERE user_id = ?')
    .bind(user.id)
    .first<{ n: number }>();
  return ok(c, { activities: rows.results, total: total?.n || 0, page, per_page: perPage });
});

// ---- Trash ----
misc.get('/trash', async (c) => {
  const user = c.get('user');
  const ownerFilter = user.role === 'super_admin' ? '' : 'AND r.owner_id = ?';
  const binds = user.role === 'super_admin' ? [] : [user.id];

  // Trashed repos
  const repos = await c.env.DB.prepare(
    `SELECT r.id, r.name, r.icon, r.color, r.size_bytes, r.deleted_at, 'repo' AS item_type FROM repositories r WHERE r.deleted_at IS NOT NULL ${ownerFilter} ORDER BY r.deleted_at DESC`
  )
    .bind(...binds)
    .all();

  // Trashed nodes whose repo still alive (exclude descendants of trashed folders shown at top level)
  const nodes = await c.env.DB.prepare(
    `SELECT n.id, n.name, n.type, n.path, n.size_bytes, n.deleted_at, n.repo_id, r.name AS repo_name, 'node' AS item_type
     FROM nodes n JOIN repositories r ON r.id = n.repo_id
     WHERE n.deleted_at IS NOT NULL AND r.deleted_at IS NULL ${ownerFilter}
       AND NOT EXISTS (
         SELECT 1 FROM nodes p WHERE p.repo_id = n.repo_id AND p.type='folder' AND p.deleted_at IS NOT NULL
           AND p.id != n.id AND n.path LIKE p.path || '/%'
       )
     ORDER BY n.deleted_at DESC LIMIT 200`
  )
    .bind(...binds)
    .all();

  return ok(c, { repos: repos.results, nodes: nodes.results, retention_days: parseInt(c.env.TRASH_RETENTION_DAYS, 10) });
});

misc.post('/trash/restore', async (c) => {
  const user = c.get('user');
  const body = await c.req.json<{ item_type?: string; id?: string }>().catch(() => ({}) as Record<string, never>);
  if (!body.id) return jsonError(c, 400, 'ID wajib diisi', 'validation');

  if (body.item_type === 'repo') {
    const repo = await c.env.DB.prepare('SELECT * FROM repositories WHERE id = ? AND deleted_at IS NOT NULL').bind(body.id).first();
    if (!repo) return jsonError(c, 404, 'Repository tidak ditemukan di Trash', 'not_found');
    if (user.role !== 'super_admin' && repo.owner_id !== user.id) return jsonError(c, 403, 'Akses ditolak', 'forbidden');
    const delTs = repo.deleted_at as number;
    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE repositories SET deleted_at = NULL, updated_at = ? WHERE id = ?').bind(now(), body.id),
      c.env.DB.prepare('UPDATE nodes SET deleted_at = NULL WHERE repo_id = ? AND deleted_at = ?').bind(body.id, delTs),
    ]);
    await logActivity(c.env, user.id, 'create', 'repo', body.id, `Memulihkan repository ${repo.name}`);
    return ok(c);
  }

  const node = await c.env.DB.prepare('SELECT * FROM nodes WHERE id = ? AND deleted_at IS NOT NULL').bind(body.id).first<NodeRow>();
  if (!node) return jsonError(c, 404, 'Item tidak ditemukan di Trash', 'not_found');
  const repo = await c.env.DB.prepare('SELECT owner_id FROM repositories WHERE id = ?').bind(node.repo_id).first<{ owner_id: string }>();
  if (!repo || (user.role !== 'super_admin' && repo.owner_id !== user.id)) return jsonError(c, 403, 'Akses ditolak', 'forbidden');

  // Restore node + descendants deleted at same timestamp; restore parents if trashed
  const stmts = [
    c.env.DB.prepare('UPDATE nodes SET deleted_at = NULL WHERE id = ?').bind(node.id),
    c.env.DB.prepare('UPDATE nodes SET deleted_at = NULL WHERE repo_id = ? AND path LIKE ? AND deleted_at = ?').bind(
      node.repo_id,
      `${node.path}/%`,
      node.deleted_at
    ),
  ];
  await c.env.DB.batch(stmts);

  // If parent chain contains trashed folders, reattach node to root
  if (node.parent_id) {
    const parent = await c.env.DB.prepare('SELECT deleted_at FROM nodes WHERE id = ?').bind(node.parent_id).first<{ deleted_at: number | null }>();
    if (!parent || parent.deleted_at !== null) {
      await c.env.DB.prepare('UPDATE nodes SET parent_id = NULL, path = ? WHERE id = ?').bind(`/${node.name}`, node.id).run();
      if (node.type === 'folder') {
        await c.env.DB.prepare('UPDATE nodes SET path = ? || SUBSTR(path, ?) WHERE repo_id = ? AND path LIKE ? AND deleted_at IS NULL').bind(
          `/${node.name}`,
          node.path.length + 1,
          node.repo_id,
          `${node.path}/%`
        ).run();
      }
    }
  }
  await logActivity(c.env, user.id, 'create', 'node', node.id, `Memulihkan ${node.name}`);
  return ok(c);
});

misc.post('/trash/delete-forever', async (c) => {
  const user = c.get('user');
  const body = await c.req.json<{ item_type?: string; id?: string }>().catch(() => ({}) as Record<string, never>);
  if (!body.id) return jsonError(c, 400, 'ID wajib diisi', 'validation');
  const storage = getStorage(c.env);

  if (body.item_type === 'repo') {
    const repo = await c.env.DB.prepare('SELECT * FROM repositories WHERE id = ? AND deleted_at IS NOT NULL').bind(body.id).first();
    if (!repo) return jsonError(c, 404, 'Repository tidak ditemukan di Trash', 'not_found');
    if (user.role !== 'super_admin' && repo.owner_id !== user.id) return jsonError(c, 403, 'Akses ditolak', 'forbidden');
    await storage.deletePrefix(`files/${body.id}/`);
    await adjustUserStorage(c.env, repo.owner_id as string, -(repo.size_bytes as number));
    await c.env.DB.prepare('DELETE FROM nodes WHERE repo_id = ?').bind(body.id).run();
    await c.env.DB.prepare('DELETE FROM repositories WHERE id = ?').bind(body.id).run();
    await logActivity(c.env, user.id, 'delete', 'repo', body.id, `Menghapus permanen repository ${repo.name}`);
    return ok(c);
  }

  const node = await c.env.DB.prepare('SELECT * FROM nodes WHERE id = ? AND deleted_at IS NOT NULL').bind(body.id).first<NodeRow>();
  if (!node) return jsonError(c, 404, 'Item tidak ditemukan di Trash', 'not_found');
  const repo = await c.env.DB.prepare('SELECT owner_id FROM repositories WHERE id = ?').bind(node.repo_id).first<{ owner_id: string }>();
  if (!repo || (user.role !== 'super_admin' && repo.owner_id !== user.id)) return jsonError(c, 403, 'Akses ditolak', 'forbidden');

  // Gather node + descendants
  const descendants = await c.env.DB.prepare(
    "SELECT id, type, size_bytes, storage_key FROM nodes WHERE repo_id = ? AND (id = ? OR path LIKE ?)"
  )
    .bind(node.repo_id, node.id, `${node.path}/%`)
    .all<{ id: string; type: string; size_bytes: number; storage_key: string | null }>();

  let freed = 0;
  for (const d of descendants.results) {
    if (d.storage_key) {
      await storage.delete(d.storage_key);
      freed += d.size_bytes;
    }
  }
  await c.env.DB.prepare('DELETE FROM nodes WHERE repo_id = ? AND (id = ? OR path LIKE ?)')
    .bind(node.repo_id, node.id, `${node.path}/%`)
    .run();
  await adjustUserStorage(c.env, repo.owner_id, -freed);
  await adjustRepoSize(c.env, node.repo_id, -freed);
  await logActivity(c.env, user.id, 'delete', 'node', node.id, `Menghapus permanen ${node.name}`);
  return ok(c);
});

misc.post('/trash/empty', async (c) => {
  const user = c.get('user');
  const storage = getStorage(c.env);
  // Personal trash only
  const repos = await c.env.DB.prepare('SELECT id, owner_id, size_bytes FROM repositories WHERE deleted_at IS NOT NULL AND owner_id = ?')
    .bind(user.id)
    .all<{ id: string; owner_id: string; size_bytes: number }>();
  for (const r of repos.results) {
    await storage.deletePrefix(`files/${r.id}/`);
    await adjustUserStorage(c.env, r.owner_id, -r.size_bytes);
    await c.env.DB.prepare('DELETE FROM nodes WHERE repo_id = ?').bind(r.id).run();
    await c.env.DB.prepare('DELETE FROM repositories WHERE id = ?').bind(r.id).run();
  }
  const nodes = await c.env.DB.prepare(
    `SELECT n.id, n.repo_id, n.size_bytes, n.storage_key, n.type, n.path FROM nodes n JOIN repositories r ON r.id = n.repo_id
     WHERE n.deleted_at IS NOT NULL AND r.deleted_at IS NULL AND r.owner_id = ?`
  )
    .bind(user.id)
    .all<{ id: string; repo_id: string; size_bytes: number; storage_key: string | null; type: string; path: string }>();
  for (const n of nodes.results) {
    if (n.storage_key) {
      await storage.delete(n.storage_key);
      await adjustUserStorage(c.env, user.id, -n.size_bytes);
      await adjustRepoSize(c.env, n.repo_id, -n.size_bytes);
    }
    await c.env.DB.prepare('DELETE FROM nodes WHERE id = ?').bind(n.id).run();
  }
  await logActivity(c.env, user.id, 'delete', undefined, undefined, 'Mengosongkan Trash');
  return ok(c);
});

// ---- Search ----
misc.get('/search', async (c) => {
  const user = c.get('user');
  const q = (c.req.query('q') || '').trim();
  if (!q) return ok(c, { repos: [], nodes: [] });
  const ownerFilter = user.role === 'super_admin' ? '' : 'AND r.owner_id = ?';
  const binds = user.role === 'super_admin' ? [`%${q}%`] : [`%${q}%`, user.id];

  const repos = await c.env.DB.prepare(
    `SELECT r.id, r.name, r.icon, r.color, r.description FROM repositories r WHERE r.deleted_at IS NULL AND r.name LIKE ? ${ownerFilter} LIMIT 10`
  )
    .bind(...binds)
    .all();

  const nodes = await c.env.DB.prepare(
    `SELECT n.id, n.repo_id, n.type, n.name, n.path, n.size_bytes, n.mime_type, r.name AS repo_name
     FROM nodes n JOIN repositories r ON r.id = n.repo_id
     WHERE n.deleted_at IS NULL AND r.deleted_at IS NULL AND (n.name LIKE ? OR n.path LIKE ?) ${user.role === 'super_admin' ? '' : 'AND r.owner_id = ?'}
     LIMIT 30`
  )
    .bind(...(user.role === 'super_admin' ? [`%${q}%`, `%${q}%`] : [`%${q}%`, `%${q}%`, user.id]))
    .all();

  return ok(c, { repos: repos.results, nodes: nodes.results });
});

// ---- Favorites ----
misc.get('/favorites', async (c) => {
  const user = c.get('user');
  const ownerFilter = user.role === 'super_admin' ? '' : 'AND r.owner_id = ?';
  const binds = user.role === 'super_admin' ? [] : [user.id];
  const repos = await c.env.DB.prepare(
    `SELECT r.* FROM repositories r WHERE r.deleted_at IS NULL AND r.is_favorite = 1 ${ownerFilter} ORDER BY r.updated_at DESC`
  )
    .bind(...binds)
    .all();
  const nodes = await c.env.DB.prepare(
    `SELECT n.*, r.name AS repo_name FROM nodes n JOIN repositories r ON r.id = n.repo_id
     WHERE n.deleted_at IS NULL AND r.deleted_at IS NULL AND n.is_favorite = 1 ${ownerFilter} ORDER BY n.updated_at DESC LIMIT 100`
  )
    .bind(...binds)
    .all();
  return ok(c, { repos: repos.results, nodes: nodes.results });
});

// ---- Tags ----
misc.get('/tags', async (c) => {
  const user = c.get('user');
  const rows = await c.env.DB.prepare('SELECT * FROM tags WHERE owner_id = ? ORDER BY name').bind(user.id).all();
  return ok(c, { tags: rows.results });
});

misc.post('/tags', async (c) => {
  const user = c.get('user');
  const body = await c.req.json<{ name?: string; color?: string }>().catch(() => ({}) as Record<string, never>);
  const name = (body.name || '').trim().slice(0, 40);
  if (!name) return jsonError(c, 400, 'Nama tag tidak boleh kosong', 'validation');
  const dup = await c.env.DB.prepare('SELECT id FROM tags WHERE owner_id = ? AND name = ?').bind(user.id, name).first();
  if (dup) return jsonError(c, 409, 'Tag sudah ada', 'duplicate');
  const id = generateId();
  await c.env.DB.prepare('INSERT INTO tags (id, owner_id, name, color, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(id, user.id, name, body.color || '#7c6cf0', now())
    .run();
  return ok(c, { id });
});

misc.delete('/tags/:id', async (c) => {
  const user = c.get('user');
  await c.env.DB.prepare('DELETE FROM tags WHERE id = ? AND owner_id = ?').bind(c.req.param('id'), user.id).run();
  return ok(c);
});

misc.post('/tags/:id/link', async (c) => {
  const user = c.get('user');
  const tag = await c.env.DB.prepare('SELECT id FROM tags WHERE id = ? AND owner_id = ?').bind(c.req.param('id'), user.id).first();
  if (!tag) return jsonError(c, 404, 'Tag tidak ditemukan', 'not_found');
  const body = await c.req.json<{ target_type?: string; target_id?: string; unlink?: boolean }>().catch(() => ({}) as Record<string, never>);
  if (!body.target_type || !body.target_id) return jsonError(c, 400, 'Target wajib diisi', 'validation');
  if (body.unlink) {
    await c.env.DB.prepare('DELETE FROM tag_links WHERE tag_id = ? AND target_type = ? AND target_id = ?')
      .bind(c.req.param('id'), body.target_type, body.target_id)
      .run();
  } else {
    await c.env.DB.prepare('INSERT OR IGNORE INTO tag_links (tag_id, target_type, target_id) VALUES (?, ?, ?)')
      .bind(c.req.param('id'), body.target_type, body.target_id)
      .run();
  }
  return ok(c);
});

misc.get('/tags/links', async (c) => {
  const user = c.get('user');
  const rows = await c.env.DB.prepare(
    'SELECT tl.* FROM tag_links tl JOIN tags t ON t.id = tl.tag_id WHERE t.owner_id = ?'
  )
    .bind(user.id)
    .all();
  return ok(c, { links: rows.results });
});

// ---- Jobs (background job status) ----
misc.get('/jobs/:id', async (c) => {
  const user = c.get('user');
  const job = await c.env.DB.prepare('SELECT * FROM jobs WHERE id = ? AND user_id = ?').bind(c.req.param('id'), user.id).first();
  if (!job) return jsonError(c, 404, 'Job tidak ditemukan', 'not_found');
  return ok(c, { job });
});

export default misc;
