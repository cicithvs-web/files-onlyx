// ============================================================
// Storage Adapter abstraction.
//
// The backend never talks to a storage backend directly; all file
// content operations go through the StorageAdapter interface.
// Current active implementation: D1StorageAdapter (file blobs in D1).
// To switch to Cloudflare R2 later, implement R2StorageAdapter with
// the same interface and change STORAGE_PROVIDER env var — no
// frontend changes required.
// ============================================================

import type { Env } from '../types';

export interface StorageObject {
  body: ReadableStream | ArrayBuffer;
  size: number;
  contentType?: string;
}

export interface StorageAdapter {
  /** Store an object. `data` may be string, ArrayBuffer, or Uint8Array. */
  put(key: string, data: string | ArrayBuffer | Uint8Array, contentType?: string): Promise<void>;
  /** Retrieve an object, or null when missing. */
  get(key: string): Promise<StorageObject | null>;
  /** Retrieve object contents as ArrayBuffer, or null when missing. */
  getBuffer(key: string): Promise<ArrayBuffer | null>;
  /** Delete an object (idempotent). */
  delete(key: string): Promise<void>;
  /** Copy an object to a new key (deep copy). */
  copy(srcKey: string, dstKey: string): Promise<boolean>;
  /** Delete all objects whose key starts with prefix. */
  deletePrefix(prefix: string): Promise<void>;
}

const CHUNK_ROW_BYTES = 950_000; // stay below D1 ~1MB value limit per row

function toUint8(data: string | ArrayBuffer | Uint8Array): Uint8Array {
  if (typeof data === 'string') return new TextEncoder().encode(data);
  if (data instanceof Uint8Array) return data;
  return new Uint8Array(data);
}

/**
 * D1StorageAdapter — stores file contents in the `blobs` table.
 * Large payloads are split across multiple rows (seq column) to stay
 * below D1's per-value size limit.
 */
export class D1StorageAdapter implements StorageAdapter {
  constructor(private db: D1Database) {}

  async put(key: string, data: string | ArrayBuffer | Uint8Array, contentType?: string): Promise<void> {
    const bytes = toUint8(data);
    await this.delete(key);
    const stmts: D1PreparedStatement[] = [];
    const total = Math.max(1, Math.ceil(bytes.length / CHUNK_ROW_BYTES));
    for (let i = 0; i < total; i++) {
      const slice = bytes.slice(i * CHUNK_ROW_BYTES, (i + 1) * CHUNK_ROW_BYTES);
      stmts.push(
        this.db
          .prepare('INSERT INTO blobs (key, seq, data, content_type, size) VALUES (?, ?, ?, ?, ?)')
          .bind(key, i, slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength), contentType || null, bytes.length)
      );
    }
    // D1 batch is transactional
    await this.db.batch(stmts);
  }

  async getBuffer(key: string): Promise<ArrayBuffer | null> {
    const rows = await this.db
      .prepare('SELECT seq, data FROM blobs WHERE key = ? ORDER BY seq ASC')
      .bind(key)
      .all<{ seq: number; data: ArrayBuffer }>();
    if (!rows.results.length) return null;
    let totalLen = 0;
    const parts = rows.results.map((r) => new Uint8Array(r.data));
    for (const p of parts) totalLen += p.length;
    const out = new Uint8Array(totalLen);
    let offset = 0;
    for (const p of parts) {
      out.set(p, offset);
      offset += p.length;
    }
    return out.buffer;
  }

  async get(key: string): Promise<StorageObject | null> {
    const meta = await this.db
      .prepare('SELECT content_type, size FROM blobs WHERE key = ? AND seq = 0')
      .bind(key)
      .first<{ content_type: string | null; size: number }>();
    if (!meta) return null;
    const buf = await this.getBuffer(key);
    if (!buf) return null;
    return { body: buf, size: meta.size, contentType: meta.content_type || undefined };
  }

  async delete(key: string): Promise<void> {
    await this.db.prepare('DELETE FROM blobs WHERE key = ?').bind(key).run();
  }

  async copy(srcKey: string, dstKey: string): Promise<boolean> {
    const rows = await this.db
      .prepare('SELECT seq, data, content_type, size FROM blobs WHERE key = ? ORDER BY seq ASC')
      .bind(srcKey)
      .all<{ seq: number; data: ArrayBuffer; content_type: string | null; size: number }>();
    if (!rows.results.length) return false;
    await this.delete(dstKey);
    const stmts = rows.results.map((r) =>
      this.db
        .prepare('INSERT INTO blobs (key, seq, data, content_type, size) VALUES (?, ?, ?, ?, ?)')
        .bind(dstKey, r.seq, r.data, r.content_type, r.size)
    );
    await this.db.batch(stmts);
    return true;
  }

  async deletePrefix(prefix: string): Promise<void> {
    await this.db.prepare("DELETE FROM blobs WHERE key LIKE ? || '%'").bind(prefix).run();
  }
}

/**
 * Factory — resolves the active storage adapter from env config.
 * Add new providers here (e.g. `case 'r2': return new R2StorageAdapter(env.STORAGE)`).
 */
export function getStorage(env: Env): StorageAdapter {
  switch (env.STORAGE_PROVIDER) {
    case 'd1':
    default:
      return new D1StorageAdapter(env.DB);
  }
}
