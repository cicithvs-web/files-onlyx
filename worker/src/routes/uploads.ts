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

const uploads = new Hono<{ Bindings: Env; Variables: Variables }>();
uploads.use('*', requireAuth);

// Ensure nested folder path exists; returns leaf folder id (or null for root)
export async function ensureFolderPath(
  c: AppContext,
  repoId: string,
  baseParentId: string | null,
  relativeDir: string
): Promise<string | null> {
  if (!relativeDir) return baseParentId;
  const parts = relativeDir.split('/').filter(Boolean);
  let parentId = baseParentId;
  let parentPath = '/';
  if (parentId) {
    const parent = await c.env.DB.prepare('SELECT path FROM nodes WHERE id = ?').bind(parentId).first<{ path: string }>();
    parentPath = parent?.path || '/';
  }
  for (const rawPart of parts) {
    const part = sanitizeName(rawPart);
    if (!part) continue;
    const existing = await c.env.DB.prepare(
      `SELECT id, path FROM nodes WHERE repo_id = ? AND ${parentId ? 'parent_id = ?' : 'parent_id IS NULL'} AND name = ? AND type = 'folder' AND deleted_at IS NULL`
    )
      .bind(...(parentId ? [repoId, parentId, part] : [repoId, part]))
      .first<{ id: string; path: string }>();
    if (existing) {
      parentId = existing.id;
      parentPath = existing.path;
    } else {
      const id = generateId();
      const ts = now();
      const path = joinPath(parentPath, part);
      await c.env.DB.prepare(
        "INSERT INTO nodes (id, repo_id, parent_id, type, name, path, created_at, updated_at) VALUES (?, ?, ?, 'folder', ?, ?, ?, ?)"
      )
        .bind(id, repoId, parentId, part, path, ts, ts)
        .run();
      parentId = id;
      parentPath = path;
    }
  }
  return parentId;
}

// Create the final file node with content buffer
export async function createFileNode(
  c: AppContext,
  repoId: string,
  ownerId: string,
  parentId: string | null,
  fileName: string,
  data: ArrayBuffer | Uint8Array,
  overwrite = true
): Promise<NodeRow | { error: string }> {
  const name = sanitizeName(fileName);
  if (!name) return { error: 'Nama file tidak valid' };
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const size = bytes.length;

  let parentPath = '/';
  if (parentId) {
    const parent = await c.env.DB.prepare('SELECT path FROM nodes WHERE id = ?').bind(parentId).first<{ path: string }>();
    parentPath = parent?.path || '/';
  }

  // Overwrite existing file with same name in same folder
  const existing = await c.env.DB.prepare(
    `SELECT * FROM nodes WHERE repo_id = ? AND ${parentId ? 'parent_id = ?' : 'parent_id IS NULL'} AND name = ? AND type = 'file' AND deleted_at IS NULL`
  )
    .bind(...(parentId ? [repoId, parentId, name] : [repoId, name]))
    .first<NodeRow>();

  const storage = getStorage(c.env);
  const mime = mimeOf(name);
  const ts = now();

  if (existing && overwrite && existing.storage_key) {
    const delta = size - existing.size_bytes;
    await storage.put(existing.storage_key, bytes, mime);
    await c.env.DB.prepare('UPDATE nodes SET size_bytes = ?, mime_type = ?, updated_at = ? WHERE id = ?')
      .bind(size, mime, ts, existing.id)
      .run();
    await adjustUserStorage(c.env, ownerId, delta);
    await adjustRepoSize(c.env, repoId, delta);
    return { ...existing, size_bytes: size, mime_type: mime };
  }

  const id = generateId();
  const storageKey = `files/${repoId}/${id}`;
  const path = joinPath(parentPath, name);
  await storage.put(storageKey, bytes, mime);
  await c.env.DB.prepare(
    "INSERT INTO nodes (id, repo_id, parent_id, type, name, path, size_bytes, mime_type, storage_key, created_at, updated_at) VALUES (?, ?, ?, 'file', ?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(id, repoId, parentId, name, path, size, mime, storageKey, ts, ts)
    .run();
  await adjustUserStorage(c.env, ownerId, size);
  await adjustRepoSize(c.env, repoId, size);
  return (await c.env.DB.prepare('SELECT * FROM nodes WHERE id = ?').bind(id).first<NodeRow>()) as NodeRow;
}

// ---- Simple (small) direct upload: multipart/form-data ----
uploads.post('/direct', async (c) => {
  const user = c.get('user');
  const form = await c.req.formData();
  const repoId = String(form.get('repo_id') || '');
  const parentId = (form.get('parent_id') as string) || null;
  const relPath = (form.get('relative_path') as string) || ''; // for folder upload: dir path within target
  const file = form.get('file') as File | null;

  if (!repoId || !file) return jsonError(c, 400, 'repo_id dan file wajib diisi', 'validation');
  const repo = await assertRepoAccess(c as unknown as AppContext, repoId);
  if (!repo) return jsonError(c, 404, 'Repository tidak ditemukan', 'not_found');

  const maxFile = parseInt(c.env.MAX_FILE_BYTES, 10);
  if (file.size > maxFile)
    return jsonError(c, 413, `Ukuran file melebihi batas maksimum ${(maxFile / 1024 / 1024).toFixed(1)}MB`, 'too_large');
  const quotaLeft = user.quota_bytes - user.storage_used_bytes;
  if (file.size > quotaLeft) return jsonError(c, 400, 'Kuota storage tidak mencukupi', 'quota_exceeded');

  const dir = relPath.includes('/') ? relPath.slice(0, relPath.lastIndexOf('/')) : '';
  const leafParent = await ensureFolderPath(c as unknown as AppContext, repoId, parentId, dir);
  const result = await createFileNode(
    c as unknown as AppContext,
    repoId,
    repo.owner_id as string,
    leafParent,
    file.name,
    await file.arrayBuffer()
  );
  if ('error' in result) return jsonError(c, 400, result.error, 'validation');
  await logActivity(c.env, user.id, 'upload', 'node', result.id, `Mengunggah ${file.name}`);
  return ok(c, { node: result });
});

// ---- Chunked upload (pause/resume/cancel) ----

uploads.post('/init', async (c) => {
  const user = c.get('user');
  const body = await c.req
    .json<{ repo_id?: string; parent_id?: string | null; file_name?: string; file_size?: number; mime_type?: string; chunk_size?: number; relative_path?: string }>()
    .catch(() => ({}) as Record<string, never>);
  if (!body.repo_id || !body.file_name || !body.file_size)
    return jsonError(c, 400, 'Data upload tidak lengkap', 'validation');
  const repo = await assertRepoAccess(c as unknown as AppContext, body.repo_id);
  if (!repo) return jsonError(c, 404, 'Repository tidak ditemukan', 'not_found');

  const maxFile = parseInt(c.env.MAX_FILE_BYTES, 10);
  if (body.file_size > maxFile)
    return jsonError(c, 413, `Ukuran file melebihi batas maksimum ${(maxFile / 1024 / 1024).toFixed(1)}MB`, 'too_large');
  const quotaLeft = user.quota_bytes - user.storage_used_bytes;
  if (body.file_size > quotaLeft) return jsonError(c, 400, 'Kuota storage tidak mencukupi', 'quota_exceeded');

  const chunkSize = Math.min(Math.max(body.chunk_size || 512 * 1024, 64 * 1024), 900 * 1024);
  const totalChunks = Math.max(1, Math.ceil(body.file_size / chunkSize));
  const id = generateId();
  const ts = now();

  // resolve folder path for folder-uploads
  const relPath = body.relative_path || '';
  const dir = relPath.includes('/') ? relPath.slice(0, relPath.lastIndexOf('/')) : '';
  const leafParent = await ensureFolderPath(c as unknown as AppContext, body.repo_id, body.parent_id || null, dir);

  await c.env.DB.prepare(
    'INSERT INTO upload_sessions (id, user_id, repo_id, parent_id, file_name, file_size, mime_type, chunk_size, total_chunks, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(id, user.id, body.repo_id, leafParent, body.file_name, body.file_size, body.mime_type || mimeOf(body.file_name), chunkSize, totalChunks, ts, ts)
    .run();
  return ok(c, { session_id: id, chunk_size: chunkSize, total_chunks: totalChunks });
});

uploads.get('/:sessionId/status', async (c) => {
  const user = c.get('user');
  const session = await c.env.DB.prepare('SELECT * FROM upload_sessions WHERE id = ? AND user_id = ?')
    .bind(c.req.param('sessionId'), user.id)
    .first<{ received_chunks: string; total_chunks: number; status: string }>();
  if (!session) return jsonError(c, 404, 'Sesi upload tidak ditemukan', 'not_found');
  return ok(c, {
    received: JSON.parse(session.received_chunks) as number[],
    total_chunks: session.total_chunks,
    status: session.status,
  });
});

uploads.put('/:sessionId/chunk/:index', async (c) => {
  const user = c.get('user');
  const sessionId = c.req.param('sessionId');
  const index = parseInt(c.req.param('index'), 10);
  const session = await c.env.DB.prepare("SELECT * FROM upload_sessions WHERE id = ? AND user_id = ? AND status = 'active'")
    .bind(sessionId, user.id)
    .first<{ id: string; total_chunks: number; received_chunks: string; chunk_size: number }>();
  if (!session) return jsonError(c, 404, 'Sesi upload tidak ditemukan', 'not_found');
  if (index < 0 || index >= session.total_chunks) return jsonError(c, 400, 'Index chunk tidak valid', 'validation');

  const data = await c.req.arrayBuffer();
  await getStorage(c.env).put(`upload/${sessionId}/${index}`, data);

  const received = new Set(JSON.parse(session.received_chunks) as number[]);
  received.add(index);
  await c.env.DB.prepare('UPDATE upload_sessions SET received_chunks = ?, updated_at = ? WHERE id = ?')
    .bind(JSON.stringify([...received].sort((a, b) => a - b)), now(), sessionId)
    .run();
  return ok(c, { received: received.size, total: session.total_chunks });
});

uploads.post('/:sessionId/complete', async (c) => {
  const user = c.get('user');
  const sessionId = c.req.param('sessionId');
  const session = await c.env.DB.prepare("SELECT * FROM upload_sessions WHERE id = ? AND user_id = ? AND status = 'active'")
    .bind(sessionId, user.id)
    .first<{
      id: string; repo_id: string; parent_id: string | null; file_name: string; file_size: number;
      mime_type: string | null; total_chunks: number; received_chunks: string;
    }>();
  if (!session) return jsonError(c, 404, 'Sesi upload tidak ditemukan', 'not_found');

  const received = JSON.parse(session.received_chunks) as number[];
  if (received.length !== session.total_chunks)
    return jsonError(c, 400, `Chunk belum lengkap (${received.length}/${session.total_chunks})`, 'incomplete');

  const repo = await assertRepoAccess(c as unknown as AppContext, session.repo_id);
  if (!repo) return jsonError(c, 404, 'Repository tidak ditemukan', 'not_found');

  // Assemble chunks
  const storage = getStorage(c.env);
  const parts: Uint8Array[] = [];
  let totalLen = 0;
  for (let i = 0; i < session.total_chunks; i++) {
    const buf = await storage.getBuffer(`upload/${sessionId}/${i}`);
    if (!buf) return jsonError(c, 500, `Chunk ${i} hilang, silakan upload ulang`, 'chunk_missing');
    const u8 = new Uint8Array(buf);
    parts.push(u8);
    totalLen += u8.length;
  }
  const assembled = new Uint8Array(totalLen);
  let offset = 0;
  for (const p of parts) {
    assembled.set(p, offset);
    offset += p.length;
  }

  const result = await createFileNode(
    c as unknown as AppContext,
    session.repo_id,
    repo.owner_id as string,
    session.parent_id,
    session.file_name,
    assembled
  );
  if ('error' in result) return jsonError(c, 400, result.error, 'validation');

  // Cleanup staged chunks + session
  await storage.deletePrefix(`upload/${sessionId}/`);
  await c.env.DB.prepare("UPDATE upload_sessions SET status = 'completed', updated_at = ? WHERE id = ?")
    .bind(now(), sessionId)
    .run();
  await logActivity(c.env, user.id, 'upload', 'node', result.id, `Mengunggah ${session.file_name}`);
  return ok(c, { node: result });
});

uploads.delete('/:sessionId', async (c) => {
  const user = c.get('user');
  const sessionId = c.req.param('sessionId');
  const session = await c.env.DB.prepare('SELECT id FROM upload_sessions WHERE id = ? AND user_id = ?')
    .bind(sessionId, user.id)
    .first();
  if (!session) return jsonError(c, 404, 'Sesi upload tidak ditemukan', 'not_found');
  await getStorage(c.env).deletePrefix(`upload/${sessionId}/`);
  await c.env.DB.prepare("UPDATE upload_sessions SET status = 'aborted', updated_at = ? WHERE id = ?")
    .bind(now(), sessionId)
    .run();
  return ok(c);
});

export default uploads;
