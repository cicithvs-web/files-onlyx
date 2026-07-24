import { Hono } from 'hono';
import { unzipSync, zipSync } from 'fflate';
import type { Env, Variables, NodeRow } from '../types';
import { logActivity, jsonError, ok, type AppContext } from '../lib/helpers';
import { getStorage } from '../lib/storage';
import { requireAuth, assertRepoAccess } from '../middleware/auth';
import { ensureFolderPath, createFileNode } from './uploads';
import { assertNodeAccess } from './nodes';

const zip = new Hono<{ Bindings: Env; Variables: Variables }>();
zip.use('*', requireAuth);

// Extract an uploaded ZIP (node id of the .zip file) into its parent folder (or a new subfolder)
zip.post('/extract/:nodeId', async (c) => {
  const user = c.get('user');
  const access = await assertNodeAccess(c as unknown as AppContext, c.req.param('nodeId'));
  if (!access) return jsonError(c, 404, 'File tidak ditemukan', 'not_found');
  const { node, repo } = access;
  if (node.type !== 'file' || !node.storage_key || !node.name.toLowerCase().endsWith('.zip'))
    return jsonError(c, 400, 'Item bukan file ZIP', 'validation');

  const buf = await getStorage(c.env).getBuffer(node.storage_key);
  if (!buf) return jsonError(c, 404, 'Konten ZIP tidak ditemukan', 'not_found');

  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(new Uint8Array(buf));
  } catch {
    return jsonError(c, 400, 'File ZIP rusak atau tidak valid', 'zip_corrupt');
  }

  // Quota check
  let totalSize = 0;
  for (const [name, data] of Object.entries(entries)) {
    if (!name.endsWith('/')) totalSize += data.length;
  }
  const quotaLeft = user.quota_bytes - user.storage_used_bytes;
  if (totalSize > quotaLeft) return jsonError(c, 400, 'Kuota storage tidak mencukupi untuk ekstraksi', 'quota_exceeded');
  const maxFile = parseInt(c.env.MAX_FILE_BYTES, 10);

  const baseName = node.name.replace(/\.zip$/i, '');
  const targetParent = await ensureFolderPath(c as unknown as AppContext, node.repo_id, node.parent_id, baseName);

  let extracted = 0;
  const skipped: string[] = [];
  for (const [entryName, data] of Object.entries(entries)) {
    if (entryName.endsWith('/')) {
      await ensureFolderPath(c as unknown as AppContext, node.repo_id, targetParent, entryName.replace(/\/$/, ''));
      continue;
    }
    if (data.length > maxFile) {
      skipped.push(entryName);
      continue;
    }
    const dir = entryName.includes('/') ? entryName.slice(0, entryName.lastIndexOf('/')) : '';
    const fileName = entryName.includes('/') ? entryName.slice(entryName.lastIndexOf('/') + 1) : entryName;
    if (!fileName) continue;
    const leaf = await ensureFolderPath(c as unknown as AppContext, node.repo_id, targetParent, dir);
    const result = await createFileNode(c as unknown as AppContext, node.repo_id, repo.owner_id as string, leaf, fileName, data);
    if (!('error' in result)) extracted++;
  }
  await logActivity(c.env, user.id, 'create', 'node', node.id, `Mengekstrak ${node.name} (${extracted} file)`);
  return ok(c, { extracted, skipped });
});

// Collect all descendant files of a folder/repo for zipping
async function collectFiles(c: AppContext, repoId: string, basePath: string): Promise<Array<NodeRow>> {
  const like = basePath === '/' ? '/%' : `${basePath}/%`;
  const rows = await c.env.DB.prepare(
    "SELECT * FROM nodes WHERE repo_id = ? AND type = 'file' AND deleted_at IS NULL AND path LIKE ?"
  )
    .bind(repoId, like)
    .all<NodeRow>();
  return rows.results;
}

async function buildZip(c: AppContext, files: NodeRow[], stripPrefix: string): Promise<Uint8Array> {
  const storage = getStorage(c.env);
  const entries: Record<string, Uint8Array> = {};
  for (const f of files) {
    if (!f.storage_key) continue;
    const buf = await storage.getBuffer(f.storage_key);
    if (!buf) continue;
    let rel = f.path.startsWith(stripPrefix) ? f.path.slice(stripPrefix.length) : f.path;
    rel = rel.replace(/^\//, '');
    entries[rel || f.name] = new Uint8Array(buf);
  }
  return zipSync(entries, { level: 6 });
}

// Download folder as ZIP
zip.get('/folder/:nodeId', async (c) => {
  const user = c.get('user');
  const access = await assertNodeAccess(c as unknown as AppContext, c.req.param('nodeId'));
  if (!access) return jsonError(c, 404, 'Folder tidak ditemukan', 'not_found');
  const { node } = access;
  if (node.type !== 'folder') return jsonError(c, 400, 'Item bukan folder', 'validation');

  const files = await collectFiles(c as unknown as AppContext, node.repo_id, node.path);
  const zipped = await buildZip(c as unknown as AppContext, files, node.path);
  await logActivity(c.env, user.id, 'download', 'node', node.id, `Mengunduh folder ${node.name} sebagai ZIP`);
  return new Response(zipped.buffer as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(node.name)}.zip"`,
    },
  });
});

// Download whole repository as ZIP
zip.get('/repo/:repoId', async (c) => {
  const user = c.get('user');
  const repo = await assertRepoAccess(c as unknown as AppContext, c.req.param('repoId'));
  if (!repo) return jsonError(c, 404, 'Repository tidak ditemukan', 'not_found');
  const files = await collectFiles(c as unknown as AppContext, repo.id as string, '/');
  const zipped = await buildZip(c as unknown as AppContext, files, '');
  await logActivity(c.env, user.id, 'download', 'repo', repo.id as string, `Mengunduh repository ${repo.name} sebagai ZIP`);
  return new Response(zipped.buffer as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(repo.name as string)}.zip"`,
    },
  });
});

// Compress folder into a .zip file stored in the repo (sibling of folder)
zip.post('/compress/:nodeId', async (c) => {
  const user = c.get('user');
  const access = await assertNodeAccess(c as unknown as AppContext, c.req.param('nodeId'));
  if (!access) return jsonError(c, 404, 'Item tidak ditemukan', 'not_found');
  const { node, repo } = access;

  let files: NodeRow[];
  let stripPrefix: string;
  if (node.type === 'folder') {
    files = await collectFiles(c as unknown as AppContext, node.repo_id, node.path);
    stripPrefix = node.path;
  } else {
    files = [node];
    stripPrefix = node.path.slice(0, node.path.lastIndexOf('/'));
  }
  const zipped = await buildZip(c as unknown as AppContext, files, stripPrefix);

  const maxFile = parseInt(c.env.MAX_FILE_BYTES, 10);
  if (zipped.length > maxFile)
    return jsonError(c, 413, 'Hasil ZIP melebihi batas ukuran file maksimum', 'too_large');
  const quotaLeft = user.quota_bytes - user.storage_used_bytes;
  if (zipped.length > quotaLeft) return jsonError(c, 400, 'Kuota storage tidak mencukupi', 'quota_exceeded');

  const result = await createFileNode(
    c as unknown as AppContext,
    node.repo_id,
    repo.owner_id as string,
    node.parent_id,
    `${node.name.replace(/\.[^.]+$/, '')}.zip`,
    zipped,
    false
  );
  if ('error' in result) return jsonError(c, 400, result.error, 'validation');
  await logActivity(c.env, user.id, 'create', 'node', result.id, `Mengompres ${node.name} menjadi ZIP`);
  return ok(c, { node: result });
});

export default zip;
