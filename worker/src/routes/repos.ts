import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { generateId } from '../lib/crypto';
import { logActivity, jsonError, ok, now, sanitizeName, type AppContext } from '../lib/helpers';
import { requireAuth, assertRepoAccess } from '../middleware/auth';

const repos = new Hono<{ Bindings: Env; Variables: Variables }>();

repos.use('*', requireAuth);

repos.get('/', async (c) => {
  const user = c.get('user');
  const q = c.req.query('q') || '';
  const filter = c.req.query('filter') || 'all'; // all | public | private | archived | favorite
  const sort = c.req.query('sort') || 'date'; // name | date | size
  const order = c.req.query('order') === 'asc' ? 'ASC' : 'DESC';

  let where = 'deleted_at IS NULL';
  const binds: unknown[] = [];
  if (user.role !== 'super_admin') {
    where += ' AND owner_id = ?';
    binds.push(user.id);
  }
  if (q) {
    where += ' AND name LIKE ?';
    binds.push(`%${q}%`);
  }
  if (filter === 'public') where += ' AND is_public = 1 AND is_archived = 0';
  else if (filter === 'private') where += ' AND is_public = 0 AND is_archived = 0';
  else if (filter === 'archived') where += ' AND is_archived = 1';
  else if (filter === 'favorite') where += ' AND is_favorite = 1 AND is_archived = 0';
  else where += " AND is_archived = 0";

  const sortCol = sort === 'name' ? 'name' : sort === 'size' ? 'size_bytes' : 'updated_at';
  const rows = await c.env.DB.prepare(
    `SELECT r.*, u.username AS owner_username FROM repositories r JOIN users u ON u.id = r.owner_id WHERE ${where.replace(/owner_id/g, 'r.owner_id').replace(/deleted_at/g, 'r.deleted_at').replace(/name LIKE/g, 'r.name LIKE').replace(/is_public/g, 'r.is_public').replace(/is_archived/g, 'r.is_archived').replace(/is_favorite/g, 'r.is_favorite')} ORDER BY r.${sortCol} ${order} LIMIT 200`
  )
    .bind(...binds)
    .all();
  return ok(c, { repos: rows.results });
});

repos.post('/', async (c) => {
  const user = c.get('user');
  const body = await c.req
    .json<{ name?: string; description?: string; icon?: string; color?: string; is_public?: boolean }>()
    .catch(() => ({}) as Record<string, never>);
  const name = sanitizeName(body.name || '');
  if (!name) return jsonError(c, 400, 'Nama repository tidak boleh kosong', 'validation');

  const dup = await c.env.DB.prepare('SELECT id FROM repositories WHERE owner_id = ? AND name = ? AND deleted_at IS NULL')
    .bind(user.id, name)
    .first();
  if (dup) return jsonError(c, 409, 'Repository dengan nama tersebut sudah ada', 'duplicate');

  const id = generateId();
  const ts = now();
  await c.env.DB.prepare(
    'INSERT INTO repositories (id, owner_id, name, description, icon, color, is_public, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(id, user.id, name, body.description || '', body.icon || 'folder', body.color || '#7c6cf0', body.is_public ? 1 : 0, ts, ts)
    .run();
  await logActivity(c.env, user.id, 'create', 'repo', id, `Membuat repository ${name}`);
  const repo = await c.env.DB.prepare('SELECT * FROM repositories WHERE id = ?').bind(id).first();
  return ok(c, { id, repo });
});

repos.get('/:id', async (c) => {
  const repo = await assertRepoAccess(c as unknown as AppContext, c.req.param('id'));
  if (!repo) return jsonError(c, 404, 'Repository tidak ditemukan', 'not_found');
  return ok(c, { repo });
});

repos.patch('/:id', async (c) => {
  const user = c.get('user');
  const repo = await assertRepoAccess(c as unknown as AppContext, c.req.param('id'));
  if (!repo) return jsonError(c, 404, 'Repository tidak ditemukan', 'not_found');

  const body = await c.req
    .json<{
      name?: string;
      description?: string;
      icon?: string;
      color?: string;
      is_public?: boolean;
      is_archived?: boolean;
      is_favorite?: boolean;
    }>()
    .catch(() => ({}) as Record<string, never>);

  if (body.name !== undefined) {
    const name = sanitizeName(body.name);
    if (!name) return jsonError(c, 400, 'Nama repository tidak boleh kosong', 'validation');
    const dup = await c.env.DB.prepare(
      'SELECT id FROM repositories WHERE owner_id = ? AND name = ? AND id != ? AND deleted_at IS NULL'
    )
      .bind(repo.owner_id, name, repo.id)
      .first();
    if (dup) return jsonError(c, 409, 'Repository dengan nama tersebut sudah ada', 'duplicate');
    await c.env.DB.prepare('UPDATE repositories SET name = ?, updated_at = ? WHERE id = ?').bind(name, now(), repo.id).run();
    await logActivity(c.env, user.id, 'rename', 'repo', repo.id as string, `Mengubah nama menjadi ${name}`);
  }
  const fields: Array<[string, unknown]> = [];
  if (body.description !== undefined) fields.push(['description', body.description]);
  if (body.icon !== undefined) fields.push(['icon', body.icon]);
  if (body.color !== undefined) fields.push(['color', body.color]);
  if (body.is_public !== undefined) fields.push(['is_public', body.is_public ? 1 : 0]);
  if (body.is_archived !== undefined) fields.push(['is_archived', body.is_archived ? 1 : 0]);
  if (body.is_favorite !== undefined) fields.push(['is_favorite', body.is_favorite ? 1 : 0]);
  for (const [col, val] of fields) {
    await c.env.DB.prepare(`UPDATE repositories SET ${col} = ?, updated_at = ? WHERE id = ?`).bind(val, now(), repo.id).run();
  }
  return ok(c);
});

repos.delete('/:id', async (c) => {
  const user = c.get('user');
  const repo = await assertRepoAccess(c as unknown as AppContext, c.req.param('id'));
  if (!repo) return jsonError(c, 404, 'Repository tidak ditemukan', 'not_found');

  // Soft delete repo + all nodes into trash
  const ts = now();
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE repositories SET deleted_at = ?, updated_at = ? WHERE id = ?').bind(ts, ts, repo.id),
    c.env.DB.prepare('UPDATE nodes SET deleted_at = ? WHERE repo_id = ? AND deleted_at IS NULL').bind(ts, repo.id),
  ]);
  await logActivity(c.env, user.id, 'delete', 'repo', repo.id as string, `Menghapus repository ${repo.name}`);
  return ok(c);
});

// Duplicate repository (deep copy). Small repos synchronously; large via Durable Object job.
repos.post('/:id/duplicate', async (c) => {
  const user = c.get('user');
  const repo = await assertRepoAccess(c as unknown as AppContext, c.req.param('id'));
  if (!repo) return jsonError(c, 404, 'Repository tidak ditemukan', 'not_found');

  const size = (repo.size_bytes as number) || 0;
  const quotaLeft = user.quota_bytes - user.storage_used_bytes;
  if (size > quotaLeft) return jsonError(c, 400, 'Kuota storage tidak mencukupi untuk duplikasi', 'quota_exceeded');

  const jobId = generateId();
  const ts = now();
  await c.env.DB.prepare(
    'INSERT INTO jobs (id, user_id, type, status, payload, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(jobId, user.id, 'repo_duplicate', 'queued', JSON.stringify({ repo_id: repo.id, user_id: user.id }), ts, ts)
    .run();

  // Dispatch to Durable Object
  const doId = c.env.JOBS.idFromName(jobId);
  const stub = c.env.JOBS.get(doId);
  c.executionCtx.waitUntil(
    stub.fetch('https://jobs.internal/run', {
      method: 'POST',
      body: JSON.stringify({ job_id: jobId }),
      headers: { 'Content-Type': 'application/json' },
    })
  );
  await logActivity(c.env, user.id, 'create', 'repo', repo.id as string, `Menduplikasi repository ${repo.name}`);
  return ok(c, { job_id: jobId });
});

export default repos;
