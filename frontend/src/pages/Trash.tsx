import { useCallback, useEffect, useState } from 'react';
import { Trash2, RotateCcw, Boxes, AlertTriangle } from 'lucide-react';
import { api, formatBytes, timeAgo } from '../services/api';
import { useToast } from '../hooks/useToast';
import { Btn, Modal, EmptyState, SkeletonRows, NodeIcon } from '../components/ui';
import type { TrashData } from '../types';

export default function Trash() {
  const { toast } = useToast();
  const [data, setData] = useState<TrashData | null>(null);
  const [loading, setLoading] = useState(true);
  const [emptyConfirm, setEmptyConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api<TrashData>('/api/trash');
      setData(d);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal memuat Trash', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const restore = async (itemType: string, id: string) => {
    try {
      await api('/api/trash/restore', { method: 'POST', body: { item_type: itemType, id } });
      toast('Berhasil dipulihkan', 'success');
      load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal memulihkan', 'error');
    }
  };

  const deleteForever = async (itemType: string, id: string) => {
    try {
      await api('/api/trash/delete-forever', { method: 'POST', body: { item_type: itemType, id } });
      toast('Dihapus permanen', 'success');
      load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal menghapus', 'error');
    }
  };

  const emptyTrash = async () => {
    setBusy(true);
    try {
      await api('/api/trash/empty', { method: 'POST' });
      toast('Trash berhasil dikosongkan', 'success');
      setEmptyConfirm(false);
      load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal mengosongkan Trash', 'error');
    } finally {
      setBusy(false);
    }
  };

  const isEmpty = !data?.repos.length && !data?.nodes.length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 className="page-title">Trash</h1>
          <p className="page-sub">Item dihapus permanen otomatis setelah {data?.retention_days ?? 30} hari.</p>
        </div>
        {!isEmpty && (
          <Btn variant="danger" onClick={() => setEmptyConfirm(true)}>
            <Trash2 size={16} /> Kosongkan Trash
          </Btn>
        )}
      </div>

      {loading ? (
        <SkeletonRows count={5} height={56} />
      ) : isEmpty ? (
        <div className="card">
          <EmptyState icon={<Trash2 size={36} />} title="Trash kosong" desc="Item yang Anda hapus akan muncul di sini sebelum dihapus permanen." />
        </div>
      ) : (
        <div className="card" style={{ padding: 12 }}>
          {data!.repos.map((r) => (
            <div key={r.id} className="file-row" style={{ cursor: 'default' }}>
              <div style={{ width: 34, height: 34, borderRadius: 11, background: r.color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Boxes size={16} color="#fff" />
              </div>
              <div className="flex-1" style={{ minWidth: 0 }}>
                <div className="truncate text-sm font-semibold">{r.name}</div>
                <div className="text-dim text-xs">Repository · {formatBytes(r.size_bytes)} · dihapus {timeAgo(r.deleted_at)}</div>
              </div>
              <Btn variant="ghost" size="sm" onClick={() => restore('repo', r.id)}><RotateCcw size={14} /> Pulihkan</Btn>
              <Btn variant="danger" size="sm" onClick={() => deleteForever('repo', r.id)}><Trash2 size={14} /></Btn>
            </div>
          ))}
          {data!.nodes.map((n) => (
            <div key={n.id} className="file-row" style={{ cursor: 'default' }}>
              <NodeIcon type={n.type as 'file' | 'folder'} name={n.name} size={19} />
              <div className="flex-1" style={{ minWidth: 0 }}>
                <div className="truncate text-sm">{n.name}</div>
                <div className="text-dim text-xs truncate">{n.repo_name}{n.path} · dihapus {timeAgo(n.deleted_at)}</div>
              </div>
              <Btn variant="ghost" size="sm" onClick={() => restore('node', n.id)}><RotateCcw size={14} /> Pulihkan</Btn>
              <Btn variant="danger" size="sm" onClick={() => deleteForever('node', n.id)}><Trash2 size={14} /></Btn>
            </div>
          ))}
        </div>
      )}

      <Modal open={emptyConfirm} onClose={() => setEmptyConfirm(false)} title="Kosongkan Trash?" desc="Semua item di Trash akan dihapus permanen dan tidak dapat dipulihkan.">
        <div className="flex items-center gap-2 mb-3" style={{ padding: '10px 14px', borderRadius: 12, background: 'rgba(242,109,125,0.1)', border: '1px solid rgba(242,109,125,0.3)' }}>
          <AlertTriangle size={17} color="var(--danger)" />
          <span className="text-sm">Tindakan ini tidak dapat dibatalkan.</span>
        </div>
        <div className="flex gap-2 justify-between">
          <Btn variant="ghost" onClick={() => setEmptyConfirm(false)}>Batal</Btn>
          <Btn variant="danger" loading={busy} onClick={emptyTrash}><Trash2 size={15} /> Hapus Permanen</Btn>
        </div>
      </Modal>
    </div>
  );
}
