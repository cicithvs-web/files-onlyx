import { useCallback, useEffect, useState } from 'react';
import { Share2, Copy, Trash2, Lock, Clock, Check } from 'lucide-react';
import { api, formatDateTime } from '../services/api';
import { useToast } from '../hooks/useToast';
import { Btn, EmptyState, SkeletonRows } from '../components/ui';
import type { Share } from '../types';

export default function Shares() {
  const { toast } = useToast();
  const [shares, setShares] = useState<Share[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState('');

  const load = useCallback(async () => {
    try {
      const d = await api<{ shares: Share[] }>('/api/shares');
      setShares(d.shares);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal memuat', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const copy = async (s: Share) => {
    await navigator.clipboard.writeText(`${window.location.origin}/s/${s.token}`);
    setCopiedId(s.id);
    setTimeout(() => setCopiedId(''), 1600);
  };

  const remove = async (s: Share) => {
    try {
      await api(`/api/shares/${s.id}`, { method: 'DELETE' });
      toast('Tautan share dihapus', 'success');
      load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal menghapus', 'error');
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="page-title">Dibagikan</h1>
        <p className="page-sub">Kelola semua tautan share yang pernah Anda buat.</p>
      </div>

      {loading ? (
        <SkeletonRows count={5} height={56} />
      ) : !shares.length ? (
        <div className="card">
          <EmptyState
            icon={<Share2 size={36} />}
            title="Belum ada tautan share"
            desc="Bagikan file, folder, atau repository melalui menu klik kanan, lalu kelola tautannya di sini."
          />
        </div>
      ) : (
        <div className="table-wrap card" style={{ padding: 0 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Target</th>
                <th>Tipe</th>
                <th>Proteksi</th>
                <th>Kedaluwarsa</th>
                <th>Dibuat</th>
                <th style={{ width: 110 }}>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {shares.map((s) => {
                const expired = s.expires_at && s.expires_at < Date.now();
                return (
                  <tr key={s.id} style={{ opacity: expired ? 0.5 : 1 }}>
                    <td className="font-semibold">{s.target_name || '(terhapus)'}</td>
                    <td>
                      <span className="badge neutral">{s.target_type === 'repo' ? 'Repository' : 'File/Folder'}</span>
                    </td>
                    <td>
                      {s.password_hash ? (
                        <span className="badge warning"><Lock size={11} /> Password</span>
                      ) : (
                        <span className="badge success">Publik</span>
                      )}
                    </td>
                    <td className="text-sm text-muted">
                      {s.expires_at ? (
                        <span className="flex items-center gap-1">
                          <Clock size={13} /> {formatDateTime(s.expires_at)} {expired && '(kedaluwarsa)'}
                        </span>
                      ) : (
                        'Tanpa batas'
                      )}
                    </td>
                    <td className="text-sm text-muted">{formatDateTime(s.created_at)}</td>
                    <td>
                      <div className="flex gap-1">
                        <Btn variant="ghost" size="icon" onClick={() => copy(s)} data-tooltip={copiedId === s.id ? 'Tersalin!' : 'Salin tautan'}>
                          {copiedId === s.id ? <Check size={15} color="var(--success)" /> : <Copy size={15} />}
                        </Btn>
                        <Btn variant="ghost" size="icon" onClick={() => remove(s)} data-tooltip="Hapus tautan">
                          <Trash2 size={15} color="var(--danger)" />
                        </Btn>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
