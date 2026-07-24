import { API_URL, ApiError } from './api';
import type { FileNode } from '../types';

export type UploadStatus = 'queued' | 'uploading' | 'paused' | 'done' | 'error' | 'cancelled';

export interface UploadTask {
  id: string;
  file: File;
  relativePath: string;
  repoId: string;
  parentId: string | null;
  status: UploadStatus;
  progress: number; // 0-100
  error?: string;
  sessionId?: string;
  node?: FileNode;
}

type Listener = (tasks: UploadTask[]) => void;

const CHUNK_THRESHOLD = 512 * 1024; // files larger than this use chunked upload
const CHUNK_SIZE = 512 * 1024;

class UploaderService {
  private tasks: UploadTask[] = [];
  private listeners = new Set<Listener>();
  private active = 0;
  private maxConcurrent = 2;
  private pauseFlags = new Map<string, boolean>();
  private cancelFlags = new Map<string, boolean>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn([...this.tasks]);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    const snapshot = [...this.tasks];
    this.listeners.forEach((fn) => fn(snapshot));
  }

  getTasks(): UploadTask[] {
    return [...this.tasks];
  }

  addFiles(files: Array<{ file: File; relativePath?: string }>, repoId: string, parentId: string | null): void {
    for (const { file, relativePath } of files) {
      this.tasks.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        file,
        relativePath: relativePath || file.name,
        repoId,
        parentId,
        status: 'queued',
        progress: 0,
      });
    }
    this.emit();
    this.pump();
  }

  pause(taskId: string): void {
    this.pauseFlags.set(taskId, true);
    const t = this.tasks.find((x) => x.id === taskId);
    if (t && t.status === 'queued') {
      t.status = 'paused';
      this.emit();
    }
  }

  resume(taskId: string): void {
    this.pauseFlags.delete(taskId);
    const t = this.tasks.find((x) => x.id === taskId);
    if (t && t.status === 'paused') {
      t.status = 'queued';
      this.emit();
      this.pump();
    }
  }

  async cancel(taskId: string): Promise<void> {
    this.cancelFlags.set(taskId, true);
    const t = this.tasks.find((x) => x.id === taskId);
    if (t) {
      if (t.sessionId) {
        fetch(`${API_URL}/api/uploads/${t.sessionId}`, { method: 'DELETE', credentials: 'include' }).catch(() => {});
      }
      if (t.status === 'queued' || t.status === 'paused') {
        t.status = 'cancelled';
        this.emit();
      }
    }
  }

  clearFinished(): void {
    this.tasks = this.tasks.filter((t) => t.status === 'uploading' || t.status === 'queued' || t.status === 'paused');
    this.emit();
  }

  private pump(): void {
    while (this.active < this.maxConcurrent) {
      const next = this.tasks.find((t) => t.status === 'queued' && !this.pauseFlags.get(t.id) && !this.cancelFlags.get(t.id));
      if (!next) break;
      this.active++;
      next.status = 'uploading';
      this.emit();
      this.runTask(next).finally(() => {
        this.active--;
        this.pump();
      });
    }
  }

  private async runTask(task: UploadTask): Promise<void> {
    try {
      if (task.file.size <= CHUNK_THRESHOLD) {
        await this.uploadDirect(task);
      } else {
        await this.uploadChunked(task);
      }
      if (task.status === 'uploading') {
        task.status = 'done';
        task.progress = 100;
      }
    } catch (err) {
      if (task.status !== 'cancelled' && task.status !== 'paused') {
        task.status = 'error';
        task.error = err instanceof Error ? err.message : 'Upload gagal';
      }
    }
    this.emit();
  }

  private async uploadDirect(task: UploadTask): Promise<void> {
    const form = new FormData();
    form.append('repo_id', task.repoId);
    if (task.parentId) form.append('parent_id', task.parentId);
    form.append('relative_path', task.relativePath);
    form.append('file', task.file, task.file.name);

    const res = await fetch(`${API_URL}/api/uploads/direct`, { method: 'POST', credentials: 'include', body: form });
    const json = (await res.json()) as { success: boolean; data?: { node: FileNode }; error?: { message: string } };
    if (!json.success) throw new ApiError(json.error?.message || 'Upload gagal', 'upload', res.status);
    task.node = json.data?.node;
    task.progress = 100;
    this.emit();
  }

  private async uploadChunked(task: UploadTask): Promise<void> {
    // init or reuse session
    if (!task.sessionId) {
      const res = await fetch(`${API_URL}/api/uploads/init`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo_id: task.repoId,
          parent_id: task.parentId,
          file_name: task.file.name,
          file_size: task.file.size,
          mime_type: task.file.type,
          chunk_size: CHUNK_SIZE,
          relative_path: task.relativePath,
        }),
      });
      const json = (await res.json()) as {
        success: boolean;
        data?: { session_id: string; chunk_size: number; total_chunks: number };
        error?: { message: string };
      };
      if (!json.success || !json.data) throw new ApiError(json.error?.message || 'Gagal memulai upload', 'upload', res.status);
      task.sessionId = json.data.session_id;
    }

    // fetch already received chunks (resume support)
    const statusRes = await fetch(`${API_URL}/api/uploads/${task.sessionId}/status`, { credentials: 'include' });
    const statusJson = (await statusRes.json()) as { success: boolean; data?: { received: number[]; total_chunks: number } };
    const received = new Set(statusJson.data?.received || []);
    const totalChunks = statusJson.data?.total_chunks || Math.ceil(task.file.size / CHUNK_SIZE);

    for (let i = 0; i < totalChunks; i++) {
      if (this.cancelFlags.get(task.id)) {
        task.status = 'cancelled';
        this.emit();
        return;
      }
      if (this.pauseFlags.get(task.id)) {
        task.status = 'paused';
        this.emit();
        return;
      }
      if (received.has(i)) {
        task.progress = Math.round(((i + 1) / totalChunks) * 95);
        continue;
      }
      const start = i * CHUNK_SIZE;
      const chunk = task.file.slice(start, Math.min(start + CHUNK_SIZE, task.file.size));
      const res = await fetch(`${API_URL}/api/uploads/${task.sessionId}/chunk/${i}`, {
        method: 'PUT',
        credentials: 'include',
        body: chunk,
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: { message: string } } | null;
        throw new ApiError(j?.error?.message || `Gagal mengunggah chunk ${i}`, 'upload', res.status);
      }
      task.progress = Math.round(((i + 1) / totalChunks) * 95);
      this.emit();
    }

    const completeRes = await fetch(`${API_URL}/api/uploads/${task.sessionId}/complete`, {
      method: 'POST',
      credentials: 'include',
    });
    const completeJson = (await completeRes.json()) as { success: boolean; data?: { node: FileNode }; error?: { message: string } };
    if (!completeJson.success) throw new ApiError(completeJson.error?.message || 'Gagal menyelesaikan upload', 'upload', completeRes.status);
    task.node = completeJson.data?.node;
    task.progress = 100;
    this.emit();
  }
}

export const uploader = new UploaderService();
