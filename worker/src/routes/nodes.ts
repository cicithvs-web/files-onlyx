import { Hono } from 'hono';
import type { Env, Variables, NodeRow } from '../types';
import { generateId } from '../lib/crypto';
import {
  logActivity,
  jsonError,
  ok,
  now,
  sanitizeName,
  joinPath,
  mimeOf,
  adjustUserStorage,
  adjustRepoSize,
  type AppContext,
} from '../lib/helpers';
import { getStorage } from '../lib/storage';
import { requireAuth, assertRepoAccess } from '../middleware/auth';

const nodes = new Hono<{ Bindings: Env; Variables: Variables }>();
nodes.use('*', requireAuth);

async function getNode(c: AppContext, nodeId: string): Promise<NodeRow | null> {
  return c.env.DB.prepare('SELECT * FROM nodes WHERE id = ?').bind(nodeId).first<NodeRow>();
}

export async function assertNodeAccess(
  c: AppContext,
  nodeId: string
): Promise<{ node: NodeRow; repo: Record<string, unknown> } | null> {
  const node = await c.env.DB.prepare('SELECT * FROM nodes WHERE id = ?').bind(nodeId).first<NodeRow>();
  if (!node) return null;
  const repo = await assertRepoAccess(c, node.repo_id);
  if (!repo) return null;
  return { node, repo };
}

async function uniqueName(
  c: AppContext,
  repoId: string,
  parentId: string | null,
  baseName: string,
  type: string
): Promise<string> {
  let name = baseName;
  let i = 1;
  for (;;) {
    const dup = await c.env.DB.prepare(
      `SELECT id FROM nodes WHERE repo_id = ? AND ${parentId ? 'parent_id = ?' : 'parent_id IS NULL'} AND name = ? AND deleted_at IS NULL`
    )
      .bind(...(parentId ? [repoId, parentId, name] : [repoId, name]))
      .first();
    if (!dup) return name;
    const dot = type === 'file' ? baseName.lastIndexOf('.') : -1;
    if (dot > 0) name = `${baseName.slice(0, dot)} (${i})${baseName.slice(dot)}`;
    else name = `${baseName} (${i})`;
    i++;
    if (i > 500) return `${baseName}-${generateId().slice(0, 8)}`;
  }
}

// List children of a folder (or repo root)
nodes.get('/repo/:repoId', async (c) => {
  const repo = await assertRepoAccess(c as unknown as AppContext, c.req.param('repoId'));
  if (!repo) return jsonError(c, 404, 'Repository tidak ditemukan', 'not_found');
  const parentId = c.req.query('parent_id') || null;
  const rows = await c.env.DB.prepare(
    `SELECT id, repo_id, parent_id, type, name, path, size_bytes, mime_type, is_favorite, created_at, updated_at FROM nodes WHERE repo_id = ? AND ${parentId ? 'parent_id = ?' : 'parent_id IS NULL'} AND deleted_at IS NULL ORDER BY type DESC, name COLLATE NOCASE ASC`
  )
    .bind(...(parentId ? [repo.id, parentId] : [repo.id]))
    .all();
  return ok(c, { nodes: rows.results });
});

// Full tree (for explorer sidebar)
nodes.get('/repo/:repoId/tree', async (c) => {
  const repo = await assertRepoAccess(c as unknown as AppContext, c.req.param('repoId'));
  if (!repo) return jsonError(c, 404, 'Repository tidak ditemukan', 'not_found');
  const rows = await c.env.DB.prepare(
    'SELECT id, parent_id, type, name, path, size_bytes, mime_type, is_favorite, updated_at, created_at FROM nodes WHERE repo_id = ? AND deleted_at IS NULL ORDER BY path COLLATE NOCASE ASC'
  )
    .bind(repo.id)
    .all();
  return ok(c, { nodes: rows.results });
});

// Create file or folder
nodes.post('/', async (c) => {
  const user = c.get('user');
  const body = await c.req
    .json<{ repo_id?: string; parent_id?: string | null; type?: string; name?: string; content?: string }>()
    .catch(() => ({}) as Record<string, never>);
  if (!body.repo_id) return jsonError(c, 400, 'repo_id wajib diisi', 'validation');
  const repo = await assertRepoAccess(c as unknown as AppContext, body.repo_id);
  if (!repo) return jsonError(c, 404, 'Repository tidak ditemukan', 'not_found');

  const name = sanitizeName(body.name || '');
  if (!name) return jsonError(c, 400, 'Nama tidak boleh kosong', 'validation');
  const type = body.type === 'folder' ? 'folder' : 'file';

  let parentPath = '/';
  if (body.parent_id) {
    const parent = await getNode(c as unknown as AppContext, body.parent_id);
    if (!parent || parent.repo_id !== repo.id || parent.type !== 'folder')
      return jsonError(c, 400, 'Folder induk tidak valid', 'validation');
    parentPath = parent.path;
  }

  const dup = await c.env.DB.prepare(
    `SELECT id FROM nodes WHERE repo_id = ? AND ${body.parent_id ? 'parent_id = ?' : 'parent_id IS NULL'} AND name = ? AND deleted_at IS NULL`
  )
    .bind(...(body.parent_id ? [repo.id, body.parent_id, name] : [repo.id, name]))
    .first();
  if (dup) return jsonError(c, 409, 'Nama sudah digunakan di folder ini', 'duplicate');

  const id = generateId();
  const ts = now();
  const path = joinPath(parentPath, name);
  let storageKey: string | null = null;
  let size = 0;
  let mime: string | null = null;

  if (type === 'file') {
    const content = body.content || '';
    size = new TextEncoder().encode(content).length;
    if (size > parseInt(c.env.MAX_FILE_BYTES, 10))
      return jsonError(c, 413, 'Ukuran file melebihi batas maksimum', 'too_large');
    const quotaLeft = user.quota_bytes - user.storage_used_bytes;
    if (size > quotaLeft) return jsonError(c, 400, 'Kuota storage tidak mencukupi', 'quota_exceeded');
    mime = mimeOf(name);
    storageKey = `files/${repo.id}/${id}`;
    await getStorage(c.env).put(storageKey, content, mime);
    await adjustUserStorage(c.env, repo.owner_id as string, size);
    await adjustRepoSize(c.env, repo.id as string, size);
  }

  await c.env.DB.prepare(
    'INSERT INTO nodes (id, repo_id, parent_id, type, name, path, size_bytes, mime_type, storage_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(id, repo.id, body.parent_id || null, type, name, path, size, mime, storageKey, ts, ts)
    .run();
  await logActivity(c.env, user.id, 'create', 'node', id, `Membuat ${type === 'folder' ? 'folder' : 'file'} ${name}`);
  const node = await c.env.DB.prepare('SELECT * FROM nodes WHERE id = ?').bind(id).first();
  return ok(c, { id, path, node });
});

// Read file content (editor / preview)
nodes.get('/:id/content', async (c) => {
  const access = await assertNodeAccess(c as unknown as AppContext, c.req.param('id'));
  if (!access) return jsonError(c, 404, 'File tidak ditemukan', 'not_found');
  const { node } = access;
  if (node.type !== 'file' || !node.storage_key) return jsonError(c, 400, 'Bukan file', 'validation');
  const maxBytes = parseInt(c.env.MAX_EDITOR_FILE_BYTES, 10);
  if (node.size_bytes > maxBytes)
    return jsonError(c, 413, 'File terlalu besar untuk dibuka di editor. Silakan download.', 'too_large');
  const obj = await getStorage(c.env).get(node.storage_key);
  if (!obj) return jsonError(c, 404, 'Konten file tidak ditemukan', 'not_found');
  return new Response(obj.body as ArrayBuffer, {
    headers: { 'Content-Type': node.mime_type || 'application/octet-stream', 'Cache-Control': 'no-store' },
  });
});

// Save file content (editor)
nodes.put('/:id/content', async (c) => {
  const access = await assertNodeAccess(c as unknown as AppContext, c.req.param('id'));
  if (!access) return jsonError(c, 404, 'File tidak ditemukan', 'not_found');
  const { node, repo } = access;
  if (node.type !== 'file' || !node.storage_key) return jsonError(c, 400, 'Bukan file', 'validation');

  const content = await c.req.arrayBuffer();
  const newSize = content.byteLength;
  if (newSize > parseInt(c.env.MAX_FILE_BYTES, 10))
    return jsonError(c, 413, 'Ukuran file melebihi batas maksimum', 'too_large');
  const delta = newSize - node.size_bytes;
  const owner = await c.env.DB.prepare('SELECT quota_bytes, storage_used_bytes FROM users WHERE id = ?')
    .bind(repo.owner_id)
    .first<{ quota_bytes: number; storage_used_bytes: number }>();
  if (owner && delta > 0 && delta > owner.quota_bytes - owner.storage_used_bytes)
    return jsonError(c, 400, 'Kuota storage tidak mencukupi', 'quota_exceeded');

  await getStorage(c.env).put(node.storage_key, content, node.mime_type || 'text/plain');
  await c.env.DB.prepare('UPDATE nodes SET size_bytes = ?, updated_at = ? WHERE id = ?').bind(newSize, now(), node.id).run();
  await adjustUserStorage(c.env, repo.owner_id as string, delta);
  await adjustRepoSize(c.env, repo.id as string, delta);
  return ok(c, { size_bytes: newSize });
});

// Download file
nodes.get('/:id/download', async (c) => {
  const user = c.get('user');
  const access = await assertNodeAccess(c as unknown as AppContext, c.req.param('id'));
  if (!access) return jsonError(c, 404, 'File tidak ditemukan', 'not_found');
  const { node } = access;
  if (node.type !== 'file' || !node.storage_key)
    return jsonError(c, 400, 'Gunakan endpoint ZIP untuk mengunduh folder', 'validation');
  const obj = await getStorage(c.env).get(node.storage_key);
  if (!obj) return jsonError(c, 404, 'Konten file tidak ditemukan', 'not_found');
  await logActivity(c.env, user.id, 'download', 'node', node.id, `Mengunduh ${node.name}`);
  const inline = c.req.query('inline') === '1';
  return new Response(obj.body as ArrayBuffer, {
    headers: {
      'Content-Type': node.mime_type || 'application/octet-stream',
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(node.name)}"`,
      'Content-Length': String(node.size_bytes),
    },
  });
});

// Rename node (updates descendant paths for folders)
nodes.patch('/:id/rename', async (c) => {
  const user = c.get('user');
  const access = await assertNodeAccess(c as unknown as AppContext, c.req.param('id'));
  if (!access) return jsonError(c, 404, 'Item tidak ditemukan', 'not_found');
  const { node } = access;
  const body = await c.req.json<{ name?: string }>().catch(() => ({}) as Record<string, never>);
  const name = sanitizeName(body.name || '');
  if (!name) return jsonError(c, 400, 'Nama tidak boleh kosong', 'validation');

  const dup = await c.env.DB.prepare(
    `SELECT id FROM nodes WHERE repo_id = ? AND ${node.parent_id ? 'parent_id = ?' : 'parent_id IS NULL'} AND name = ? AND id != ? AND deleted_at IS NULL`
  )
    .bind(...(node.parent_id ? [node.repo_id, node.parent_id, name, node.id] : [node.repo_id, name, node.id]))
    .first();
  if (dup) return jsonError(c, 409, 'Nama sudah digunakan di folder ini', 'duplicate');

  const oldPath = node.path;
  const parentPath = oldPath.slice(0, oldPath.lastIndexOf('/')) || '';
  const newPath = `${parentPath}/${name}`;
  const ts = now();

  const stmts = [
    c.env.DB.prepare('UPDATE nodes SET name = ?, path = ?, mime_type = ?, updated_at = ? WHERE id = ?').bind(
      name,
      newPath,
      node.type === 'file' ? mimeOf(name) : null,
      ts,
      node.id
    ),
  ];
  if (node.type === 'folder') {
    stmts.push(
      c.env.DB.prepare('UPDATE nodes SET path = ? || SUBSTR(path, ?) WHERE repo_id = ? AND path LIKE ? AND id != ?').bind(
        newPath,
        oldPath.length + 1,
        node.repo_id,
        `${oldPath}/%`,
        node.id
      )
    );
  }
  await c.env.DB.batch(stmts);
  await logActivity(c.env, user.id, 'rename', 'node', node.id, `Mengubah nama ${node.name} menjadi ${name}`);
  return ok(c, { path: newPath });
});

// Move node
nodes.patch('/:id/move', async (c) => {
  const user = c.get('user');
  const access = await assertNodeAccess(c as unknown as AppContext, c.req.param('id'));
  if (!access) return jsonError(c, 404, 'Item tidak ditemukan', 'not_found');
  const { node } = access;
  const body = await c.req.json<{ target_parent_id?: string | null }>().catch(() => ({}) as Record<string, never>);
  const targetParentId = body.target_parent_id || null;

  let targetPath = '/';
  if (targetParentId) {
    const target = await getNode(c as unknown as AppContext, targetParentId);
    if (!target || target.repo_id !== node.repo_id || target.type !== 'folder')
      return jsonError(c, 400, 'Folder tujuan tidak valid', 'validation');
    if (node.type === 'folder' && (target.path === node.path || target.path.startsWith(`${node.path}/`)))
      return jsonError(c, 400, 'Tidak dapat memindahkan folder ke dalam dirinya sendiri', 'validation');
    targetPath = target.path;
  }

  const dup = await c.env.DB.prepare(
    `SELECT id FROM nodes WHERE repo_id = ? AND ${targetParentId ? 'parent_id = ?' : 'parent_id IS NULL'} AND name = ? AND id != ? AND deleted_at IS NULL`
  )
    .bind(...(targetParentId ? [node.repo_id, targetParentId, node.name, node.id] : [node.repo_id, node.name, node.id]))
    .first();
  if (dup) return jsonError(c, 409, 'Nama sudah digunakan di folder tujuan', 'duplicate');

  const oldPath = node.path;
  const newPath = joinPath(targetPath, node.name);
  const ts = now();
  const stmts = [
    c.env.DB.prepare('UPDATE nodes SET parent_id = ?, path = ?, updated_at = ? WHERE id = ?').bind(
      targetParentId,
      newPath,
      ts,
      node.id
    ),
  ];
  if (node.type === 'folder') {
    stmts.push(
      c.env.DB.prepare('UPDATE nodes SET path = ? || SUBSTR(path, ?) WHERE repo_id = ? AND path LIKE ? AND id != ?').bind(
        newPath,
        oldPath.length + 1,
        node.repo_id,
        `${oldPath}/%`,
        node.id
      )
    );
  }
  await c.env.DB.batch(stmts);
  await logActivity(c.env, user.id, 'move', 'node', node.id, `Memindahkan ${node.name}`);
  return ok(c, { path: newPath });
});

// Deep copy helper
async function deepCopyNode(
  c: AppContext,
  node: NodeRow,
  targetParentId: string | null,
  targetParentPath: string,
  newName: string
): Promise<{ id: string; bytes: number }> {
  const id = generateId();
  const ts = now();
  const path = joinPath(targetParentPath, newName);
  let bytes = 0;
  let storageKey: string | null = null;

  if (node.type === 'file' && node.storage_key) {
    storageKey = `files/${node.repo_id}/${id}`;
    const copied = await getStorage(c.env).copy(node.storage_key, storageKey);
    if (copied) bytes = node.size_bytes;
  }

  await c.env.DB.prepare(
    'INSERT INTO nodes (id, repo_id, parent_id, type, name, path, size_bytes, mime_type, storage_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(id, node.repo_id, targetParentId, node.type, newName, path, node.type === 'file' ? node.size_bytes : 0, node.mime_type, storageKey, ts, ts)
    .run();

  if (node.type === 'folder') {
    const children = await c.env.DB.prepare('SELECT * FROM nodes WHERE parent_id = ? AND deleted_at IS NULL')
      .bind(node.id)
      .all<NodeRow>();
    for (const child of children.results) {
      const res = await deepCopyNode(c, child, id, path, child.name);
      bytes += res.bytes;
    }
  }
  return { id, bytes };
}

nodes.post('/:id/copy', async (c) => {
  const user = c.get('user');
  const access = await assertNodeAccess(c as unknown as AppContext, c.req.param('id'));
  if (!access) return jsonError(c, 404, 'Item tidak ditemukan', 'not_found');
  const { node, repo } = access;
  const body = await c.req
    .json<{ target_parent_id?: string | null; duplicate?: boolean }>()
    .catch(() => ({}) as Record<string, never>);

  const targetParentId = body.duplicate ? node.parent_id : body.target_parent_id || null;
  let targetPath = '/';
  if (targetParentId) {
    const target = await getNode(c as unknown as AppContext, targetParentId);
    if (!target || target.repo_id !== node.repo_id || target.type !== 'folder')
      return jsonError(c, 400, 'Folder tujuan tidak valid', 'validation');
    if (node.type === 'folder' && (target.path === node.path || target.path.startsWith(`${node.path}/`)))
      return jsonError(c, 400, 'Tidak dapat menyalin folder ke dalam dirinya sendiri', 'validation');
    targetPath = target.path;
  }

  let subtreeSize = node.size_bytes;
  if (node.type === 'folder') {
    const sum = await c.env.DB.prepare(
      "SELECT COALESCE(SUM(size_bytes),0) AS total FROM nodes WHERE repo_id = ? AND type = 'file' AND deleted_at IS NULL AND path LIKE ?"
    )
      .bind(node.repo_id, `${node.path}/%`)
      .first<{ total: number }>();
    subtreeSize = sum?.total || 0;
  }
  const quotaLeft = user.quota_bytes - user.storage_used_bytes;
  if (subtreeSize > quotaLeft) return jsonError(c, 400, 'Kuota storage tidak mencukupi', 'quota_exceeded');

  const newName = await uniqueName(c as unknown as AppContext, node.repo_id, targetParentId, node.name, node.type);
  const result = await deepCopyNode(c as unknown as AppContext, node, targetParentId, targetPath, newName);
  await adjustUserStorage(c.env, repo.owner_id as string, result.bytes);
  await adjustRepoSize(c.env, node.repo_id, result.bytes);
  await logActivity(c.env, user.id, 'create', 'node', result.id, `Menyalin ${node.name}`);
  return ok(c, { id: result.id });
});

// Soft delete (Trash)
nodes.delete('/:id', async (c) => {
  const user = c.get('user');
  const access = await assertNodeAccess(c as unknown as AppContext, c.req.param('id'));
  if (!access) return jsonError(c, 404, 'Item tidak ditemukan', 'not_found');
  const { node } = access;
  const ts = now();
  const stmts = [c.env.DB.prepare('UPDATE nodes SET deleted_at = ? WHERE id = ?').bind(ts, node.id)];
  if (node.type === 'folder') {
    stmts.push(
      c.env.DB.prepare('UPDATE nodes SET deleted_at = ? WHERE repo_id = ? AND path LIKE ? AND deleted_at IS NULL').bind(
        ts,
        node.repo_id,
        `${node.path}/%`
      )
    );
  }
  await c.env.DB.batch(stmts);
  await logActivity(c.env, user.id, 'delete', 'node', node.id, `Menghapus ${node.name} ke Trash`);
  return ok(c);
});

// Toggle favorite
nodes.patch('/:id/favorite', async (c) => {
  const access = await assertNodeAccess(c as unknown as AppContext, c.req.param('id'));
  if (!access) return jsonError(c, 404, 'Item tidak ditemukan', 'not_found');
  const { node } = access;
  const body = await c.req.json<{ favorite?: boolean }>().catch(() => ({}) as Record<string, never>);
  await c.env.DB.prepare('UPDATE nodes SET is_favorite = ? WHERE id = ?').bind(body.favorite ? 1 : 0, node.id).run();
  return ok(c);
});

// Properties
nodes.get('/:id/properties', async (c) => {
  const access = await assertNodeAccess(c as unknown as AppContext, c.req.param('id'));
  if (!access) return jsonError(c, 404, 'Item tidak ditemukan', 'not_found');
  const { node, repo } = access;
  let size = node.size_bytes;
  let fileCount = 0;
  let folderCount = 0;
  if (node.type === 'folder') {
    const stats = await c.env.DB.prepare(
      `SELECT COALESCE(SUM(CASE WHEN type='file' THEN size_bytes ELSE 0 END),0) AS total,
              SUM(CASE WHEN type='file' THEN 1 ELSE 0 END) AS files,
              SUM(CASE WHEN type='folder' THEN 1 ELSE 0 END) AS folders
       FROM nodes WHERE repo_id = ? AND deleted_at IS NULL AND path LIKE ?`
    )
      .bind(node.repo_id, `${node.path}/%`)
      .first<{ total: number; files: number; folders: number }>();
    size = stats?.total || 0;
    fileCount = stats?.files || 0;
    folderCount = stats?.folders || 0;
  }
  return ok(c, {
    name: node.name,
    type: node.type,
    mime_type: node.mime_type,
    size_bytes: size,
    file_count: fileCount,
    folder_count: folderCount,
    location: `${repo.name}${node.path}`,
    created_at: node.created_at,
    updated_at: node.updated_at,
  });
});

export default nodes;
