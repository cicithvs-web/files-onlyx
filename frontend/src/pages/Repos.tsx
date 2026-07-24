import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Boxes, Plus, Star, MoreVertical, Pencil, Trash2, Copy, Archive, ArchiveRestore,
  Download, Share2, Globe, Lock, FolderGit2,
} from 'lucide-react';
import { api, API_URL, formatBytes, timeAgo } from '../services/api';
import { useToast } from '../hooks/useToast';
import { Btn, Modal, ContextMenu, EmptyState, SkeletonRows, type CtxMenuItem } from '../components/ui';
import { ShareModal } from '../components/ShareModal';
import type { Repo } from '../types';

const repoColors = ['#7c6cf0', '#4cc9f0', '#f072b6', '#5ecf9a', '#f0b35c', '#f26d7d', '#c792ea', '#8ab4f8'];

function RepoFormModal({
  open, onClose, repo, onSaved,
}: {
  open: boolean;
  onClose: () => void;
  repo: Repo | null;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState(repoColors[0]);
  const [isPublic, setIsPublic] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(repo?.name || '');
      setDescription(repo?.description || '');
      setColor(repo?.color || repoColors[0]);
      setIsPublic(repo?.is_public === 1);
    }
  }, [open, repo]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (repo) {
        await api(`/api/repos/${repo.id}`, { method: 'PATCH', body: { name, description, color, is_public: isPublic } });
        toast('Repository berhasil diperbarui', 'success');
      } else {
        await api('/api/repos', { method: 'POST', body: { name, description, color, is_public: isPublic } });
        toast('Repository berhasil dibuat', 'success');
      }
      onSaved();
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal menyimpan', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={repo ? 'Edit Repository' : 'Repository Baru'} desc={repo ? 'Perbarui detail repository Anda.' : 'Buat wadah baru untuk file dan folder Anda.'}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <div className="field">
          <label>Nama</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="mis. proyek-website" required maxLength={80} autoFocus />
        </div>
        <div className="field">
          <label>Deskripsi (opsional)</label>
          <textarea className="textarea" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Deskripsi singkat repository" maxLength={300} />
        </div>
        <div className="field">
          <label>Warna</label>
          <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
            {repoColors.map((c) => (
              <div key={c} className={`accent-swatch${color === c ? ' active' : ''}`} style={{ background: c }} onClick={() => setColor(c)} />
            ))}
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm text-muted" style={{ cursor: 'pointer' }}>
          <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} style={{ accentColor: 'var(--accent)', width: 15, height: 15 }} />
          Jadikan publik (dapat dilihat siapa saja yang memiliki tautan)
        </label>
        <div className="flex gap-2 justify-between mt-2">
          <Btn type="button" variant="ghost" onClick={onClose}>Batal</Btn>
          <Btn type="submit" variant="primary" loading={saving}>{repo ? 'Simpan' : 'Buat Repository'}</Btn>
        </div>
      </form>
    </Modal>
  );
}

export default function Repos() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [params, setParams] = useSearchParams();
  const [repos, setRepos] = useState<Repo[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'active' | 'archived' | 'public'>('all');
  const [formOpen, setFormOpen] = useState(params.get('new') === '1');
  const [editRepo, setEditRepo] = useState<Repo | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; repo: Repo } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Repo | null>(null);
  const [shareTarget, setShareTarget] = useState<Repo | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<{ repos: Repo[] }>('/api/repos');
      setRepos(data.repos);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal memuat', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (params.get('new') === '1') {
      setFormOpen(true);
      params.delete('new');
      setParams(params, { replace: true });
    }
  }, [params, setParams]);

  const filtered = repos.filter((r) => {
    if (filter === 'active') return r.is_archived === 0;
    if (filter === 'archived') return r.is_archived === 1;
    if (filter === 'public') return r.is_public === 1;
    return true;
  });

  const toggleFavorite = async (repo: Repo) => {
    try {
      await api(`/api/repos/${repo.id}`, { method: 'PATCH', body: { is_favorite: repo.is_favorite !== 1 } });
      load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal', 'error');
    }
  };

  const doDuplicate = async (repo: Repo) => {
    try {
      toast('Menduplikasi repository...', 'info');
      const res = await api<{ job_id?: string; repo_id?: string }>(`/api/repos/${repo.id}/duplicate`, { method: 'POST' });
      if (res.job_id) {
        // poll job
        const poll = async () => {
          const j = await api<{ job: { status: string; error?: string } }>(`/api/jobs/${res.job_id}`);
          if (j.job.status === 'done') {
            toast('Repository berhasil diduplikasi', 'success');
            load();
          } else if (j.job.status === 'failed') {
            toast(`Duplikasi gagal: ${j.job.error || ''}`, 'error');
          } else {
            setTimeout(poll, 1500);
          }
        };
        setTimeout(poll, 1200);
      } else {
        toast('Repository berhasil diduplikasi', 'success');
        load();
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal menduplikasi', 'error');
    }
  };

  const toggleArchive = async (repo: Repo) => {
    try {
      await api(`/api/repos/${repo.id}`, { method: 'PATCH', body: { is_archived: repo.is_archived !== 1 } });
      toast(repo.is_archived === 1 ? 'Repository diaktifkan kembali' : 'Repository diarsipkan', 'success');
      load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal', 'error');
    }
  };

  const doDelete = async () => {
    if (!deleteTarget) return;
    try {
      await api(`/api/repos/${deleteTarget.id}`, { method: 'DELETE' });
      toast('Repository dipindahkan ke Trash', 'success');
      setDeleteTarget(null);
      load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal menghapus', 'error');
    }
  };

  const menuItems = (repo: Repo): CtxMenuItem[] => [
    { label: 'Buka', icon: <FolderGit2 size={15} />, onClick: () => navigate(`/app/repos/${repo.id}`) },
    { label: 'Edit', icon: <Pencil size={15} />, onClick: () => { setEditRepo(repo); setFormOpen(true); } },
    { label: repo.is_favorite === 1 ? 'Hapus dari favorit' : 'Tambah ke favorit', icon: <Star size={15} />, onClick: () => toggleFavorite(repo) },
    { label: 'Bagikan', icon: <Share2 size={15} />, onClick: () => setShareTarget(repo) },
    { label: 'Duplikat', icon: <Copy size={15} />, onClick: () => doDuplicate(repo) },
    { label: 'Download ZIP', icon: <Download size={15} />, onClick: () => window.open(`${API_URL}/api/zip/repo/${repo.id}`, '_blank') },
    { label: repo.is_archived === 1 ? 'Batal arsip' : 'Arsipkan', icon: repo.is_archived === 1 ? <ArchiveRestore size={15} /> : <Archive size={15} />, onClick: () => toggleArchive(repo) },
    { label: '', sep: true },
    { label: 'Hapus ke Trash', icon: <Trash2 size={15} />, danger: true, onClick: () => setDeleteTarget(repo) },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 className="page-title">Repositories</h1>
          <p className="page-sub">{repos.length} repository total</p>
        </div>
        <Btn variant="primary" onClick={() => { setEditRepo(null); setFormOpen(true); }}>
          <Plus size={17} /> Repository Baru
        </Btn>
      </div>

      <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
        {([['all', 'Semua'], ['active', 'Aktif'], ['archived', 'Arsip'], ['public', 'Publik']] as const).map(([key, label]) => (
          <button key={key} className={`chip${filter === key ? ' active' : ''}`} onClick={() => setFilter(key)}>
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <SkeletonRows count={4} height={110} />
      ) : filtered.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<Boxes size={36} />}
            title="Belum ada repository"
            desc="Repository adalah wadah utama untuk file dan folder Anda. Buat yang pertama sekarang."
            action={<Btn variant="primary" onClick={() => { setEditRepo(null); setFormOpen(true); }}><Plus size={16} /> Buat Repository</Btn>}
          />
        </div>
      ) : (
        <div className="repo-grid">
          {filtered.map((r, i) => (
            <div
              key={r.id}
              className="card hoverable repo-card anim-fade-up"
              style={{ animationDelay: `${Math.min(i * 50, 400)}ms`, opacity: r.is_archived === 1 ? 0.6 : 1 }}
              onClick={() => navigate(`/app/repos/${r.id}`)}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ x: e.clientX, y: e.clientY, repo: r });
              }}
            >
              <div className="flex items-center gap-3 mb-3">
                <div className="repo-icon" style={{ background: r.color }}>
                  <Boxes size={21} />
                </div>
                <div className="flex-1" style={{ minWidth: 0 }}>
                  <div className="truncate font-semibold" style={{ fontSize: 15.5 }}>{r.name}</div>
                  <div className="text-dim text-xs">diperbarui {timeAgo(r.updated_at)}</div>
                </div>
                <button
                  className="btn btn-ghost btn-icon"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenu({ x: e.clientX, y: e.clientY, repo: r });
                  }}
                >
                  <MoreVertical size={16} />
                </button>
              </div>
              {r.description && <p className="text-muted text-sm truncate mb-2">{r.description}</p>}
              <div className="flex items-center gap-2" style={{ flexWrap: 'wrap' }}>
                <span className="badge neutral">{formatBytes(r.size_bytes)}</span>
                {r.is_public === 1 ? (
                  <span className="badge success"><Globe size={11} /> Publik</span>
                ) : (
                  <span className="badge neutral"><Lock size={11} /> Privat</span>
                )}
                {r.is_archived === 1 && <span className="badge warning"><Archive size={11} /> Arsip</span>}
                {r.is_favorite === 1 && <span className="badge"><Star size={11} /> Favorit</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.repo)} onClose={() => setMenu(null)} />}

      <RepoFormModal open={formOpen} onClose={() => { setFormOpen(false); setEditRepo(null); }} repo={editRepo} onSaved={load} />

      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Hapus Repository?" desc={`"${deleteTarget?.name}" beserta seluruh isinya akan dipindahkan ke Trash. Anda masih dapat memulihkannya dalam 30 hari.`}>
        <div className="flex gap-2 justify-between">
          <Btn variant="ghost" onClick={() => setDeleteTarget(null)}>Batal</Btn>
          <Btn variant="danger" onClick={doDelete}><Trash2 size={15} /> Hapus ke Trash</Btn>
        </div>
      </Modal>

      {shareTarget && (
        <ShareModal open={!!shareTarget} onClose={() => setShareTarget(null)} targetType="repo" targetId={shareTarget.id} targetName={shareTarget.name} />
      )}
    </div>
  );
}
