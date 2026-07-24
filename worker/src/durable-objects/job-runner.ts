// Durable Object that executes background jobs (large repo duplication,
// future: large ZIP compress/extract). Progress is written to the D1
// `jobs` table so the client can poll job status.

import type { Env, NodeRow } from '../types';
import { generateId } from '../lib/crypto';
import { getStorage } from '../lib/storage';

interface JobRow {
  id: string;
  user_id: string;
  type: string;
  status: string;
  payload: string;
}

export class JobRunner implements DurableObject {
  constructor(
    private state: DurableObjectState,
    private env: Env
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/run' && request.method === 'POST') {
      const { job_id } = (await request.json()) as { job_id: string };
      // Run in background within the DO
      this.state.waitUntil(this.runJob(job_id));
      return new Response(JSON.stringify({ started: true }), { headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('Not found', { status: 404 });
  }

  private async updateJob(jobId: string, fields: Record<string, unknown>): Promise<void> {
    const sets = Object.keys(fields)
      .map((k) => `${k} = ?`)
      .join(', ');
    await this.env.DB.prepare(`UPDATE jobs SET ${sets}, updated_at = ? WHERE id = ?`)
      .bind(...Object.values(fields), Date.now(), jobId)
      .run();
  }

  private async runJob(jobId: string): Promise<void> {
    const job = await this.env.DB.prepare('SELECT * FROM jobs WHERE id = ?').bind(jobId).first<JobRow>();
    if (!job || job.status !== 'queued') return;
    await this.updateJob(jobId, { status: 'running', progress: 0 });
    try {
      const payload = JSON.parse(job.payload) as Record<string, string>;
      if (job.type === 'repo_duplicate') {
        const newRepoId = await this.duplicateRepo(jobId, payload.repo_id, payload.user_id);
        await this.updateJob(jobId, { status: 'done', progress: 100, result: JSON.stringify({ repo_id: newRepoId }) });
      } else {
        await this.updateJob(jobId, { status: 'failed', error: 'Tipe job tidak dikenal' });
      }
    } catch (err) {
      await this.updateJob(jobId, { status: 'failed', error: String(err) });
    }
  }

  private async duplicateRepo(jobId: string, repoId: string, userId: string): Promise<string> {
    const db = this.env.DB;
    const storage = getStorage(this.env);
    const repo = await db.prepare('SELECT * FROM repositories WHERE id = ?').bind(repoId).first<Record<string, unknown>>();
    if (!repo) throw new Error('Repository tidak ditemukan');

    // Unique name "name (copy)"
    let newName = `${repo.name} (copy)`;
    let i = 2;
    while (
      await db
        .prepare('SELECT id FROM repositories WHERE owner_id = ? AND name = ? AND deleted_at IS NULL')
        .bind(repo.owner_id, newName)
        .first()
    ) {
      newName = `${repo.name} (copy ${i++})`;
    }

    const newRepoId = generateId();
    const ts = Date.now();
    await db
      .prepare(
        'INSERT INTO repositories (id, owner_id, name, description, icon, color, is_public, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .bind(newRepoId, repo.owner_id, newName, repo.description, repo.icon, repo.color, 0, ts, ts)
      .run();

    // Copy all nodes (deep copy of storage objects)
    const nodes = await db
      .prepare('SELECT * FROM nodes WHERE repo_id = ? AND deleted_at IS NULL ORDER BY path ASC')
      .bind(repoId)
      .all<NodeRow>();

    const idMap = new Map<string, string>(); // old node id -> new node id
    let done = 0;
    let copiedBytes = 0;
    const total = nodes.results.length || 1;

    for (const node of nodes.results) {
      const newId = generateId();
      idMap.set(node.id, newId);
      const newParent = node.parent_id ? idMap.get(node.parent_id) || null : null;
      let storageKey: string | null = null;
      if (node.type === 'file' && node.storage_key) {
        storageKey = `files/${newRepoId}/${newId}`;
        const copied = await storage.copy(node.storage_key, storageKey);
        if (copied) copiedBytes += node.size_bytes;
      }
      await db
        .prepare(
          'INSERT INTO nodes (id, repo_id, parent_id, type, name, path, size_bytes, mime_type, storage_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        )
        .bind(newId, newRepoId, newParent, node.type, node.name, node.path, node.size_bytes, node.mime_type, storageKey, ts, ts)
        .run();
      done++;
      if (done % 10 === 0 || done === total) {
        await this.updateJob(jobId, { progress: Math.round((done / total) * 100) });
      }
    }

    await db.prepare('UPDATE repositories SET size_bytes = ? WHERE id = ?').bind(copiedBytes, newRepoId).run();
    await db
      .prepare('UPDATE users SET storage_used_bytes = storage_used_bytes + ? WHERE id = ?')
      .bind(copiedBytes, repo.owner_id)
      .run();
    return newRepoId;
  }
}
