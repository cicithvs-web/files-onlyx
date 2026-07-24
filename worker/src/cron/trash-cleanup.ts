// Cron Trigger: hard-delete Trash items older than TRASH_RETENTION_DAYS.

import type { Env } from '../types';
import { getStorage } from '../lib/storage';

export async function cleanupTrash(env: Env): Promise<void> {
  const retentionDays = parseInt(env.TRASH_RETENTION_DAYS || '30', 10);
  const cutoff = Date.now() - retentionDays * 24 * 3600 * 1000;
  const storage = getStorage(env);

  // Expired trashed repositories
  const repos = await env.DB.prepare(
    'SELECT id, owner_id, size_bytes FROM repositories WHERE deleted_at IS NOT NULL AND deleted_at < ?'
  )
    .bind(cutoff)
    .all<{ id: string; owner_id: string; size_bytes: number }>();
  for (const r of repos.results) {
    await storage.deletePrefix(`files/${r.id}/`);
    await env.DB.prepare('UPDATE users SET storage_used_bytes = MAX(0, storage_used_bytes - ?) WHERE id = ?')
      .bind(r.size_bytes, r.owner_id)
      .run();
    await env.DB.prepare('DELETE FROM nodes WHERE repo_id = ?').bind(r.id).run();
    await env.DB.prepare('DELETE FROM repositories WHERE id = ?').bind(r.id).run();
  }

  // Expired trashed nodes (repo still alive)
  const nodes = await env.DB.prepare(
    `SELECT n.id, n.repo_id, n.size_bytes, n.storage_key, r.owner_id
     FROM nodes n JOIN repositories r ON r.id = n.repo_id
     WHERE n.deleted_at IS NOT NULL AND n.deleted_at < ? AND r.deleted_at IS NULL`
  )
    .bind(cutoff)
    .all<{ id: string; repo_id: string; size_bytes: number; storage_key: string | null; owner_id: string }>();
  for (const n of nodes.results) {
    if (n.storage_key) {
      await storage.delete(n.storage_key);
      await env.DB.prepare('UPDATE users SET storage_used_bytes = MAX(0, storage_used_bytes - ?) WHERE id = ?')
        .bind(n.size_bytes, n.owner_id)
        .run();
      await env.DB.prepare('UPDATE repositories SET size_bytes = MAX(0, size_bytes - ?) WHERE id = ?')
        .bind(n.size_bytes, n.repo_id)
        .run();
    }
    await env.DB.prepare('DELETE FROM nodes WHERE id = ?').bind(n.id).run();
  }

  // Stale upload sessions (>48h) cleanup
  const staleCutoff = Date.now() - 48 * 3600 * 1000;
  const sessions = await env.DB.prepare(
    "SELECT id FROM upload_sessions WHERE updated_at < ? AND status != 'completed'"
  )
    .bind(staleCutoff)
    .all<{ id: string }>();
  for (const s of sessions.results) {
    await storage.deletePrefix(`upload/${s.id}/`);
    await env.DB.prepare('DELETE FROM upload_sessions WHERE id = ?').bind(s.id).run();
  }

  // Expired refresh tokens cleanup
  await env.DB.prepare('DELETE FROM refresh_tokens WHERE expires_at < ?').bind(Date.now()).run();
}
