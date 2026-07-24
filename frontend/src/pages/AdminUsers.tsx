import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Users, Plus, Pencil, Trash2, ShieldCheck, Ban } from 'lucide-react';
import { api, formatBytes, formatDateTime } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { Btn, Modal, EmptyState, SkeletonRows } from '../components/ui';
import type { User } from '../types';

const GB = 1024 * 1024 * 1024;
const MB = 1024 * 1024;

function UserFormModal({
  open, onClose, target, onSaved,
}: {
  open: boolean;
  onClose: () => void;
  target: User | null;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'user' | 'super_admin'>('user');
  const [quotaGb, setQuotaGb] = useState('1');
  const [status, setStatus] = useState<'active' | 'suspended'>('active');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setUsername(target?.username || '');
      setDisplayName(target?.display_name || '');
      setPassword('');
      setRole((target?.role as 'user' | 'super_admin') || 'user');
      setQuotaGb(target ? String(Math.round((target.quota_bytes / GB) * 100) / 100) : '1');
      setStatus((target?.status as 'active' | 'suspended') || 'active');
    }
  }, [open, target]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const quota_bytes = Math.max(Math.round(parseFloat(quotaGb) * GB), 10 * MB);
      if (target) {
        await api(`/api/users/${target.id}`, {
          method: 'PATCH',
          body: {
            username: username.trim(),
            display_name: displayName.trim(),
            role,
            quota_bytes,
            status,
            ...(password ? { password } : {}),
          },
        });
        toast('User berhasil diperbarui', 'success');
      } else {
        await api('/api/users', {
          method: 'POST',
          body: { username: username.trim(), display_name: displayName.trim(), password, role, quota_bytes },
        });
        toast('User berhasil dibuat', 'success');
      }
      onSaved();
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal menyimpan user', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={target ? `Edit User: ${target.username}` : 'User Baru'} desc={target ? 'Perbarui data user.' : 'Buat akun user baru. Kredensial dibagikan secara manual.'}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="field">
            <label>Username</label>
            <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} required minLength={3} maxLength={32} pattern="[a-zA-Z0-9_.-]+" title="Huruf, angka, titik, strip, underscore" />
          </div>
          <div className="field">
            <label>Nama tampilan</label>
            <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={60} />
          </div>
        </div>
        <div className="field">
          <label>{target ? 'Password baru (kosongkan jika tidak diganti)' : 'Password'}</label>
          <input className="input" type="text" value={password} onChange={(e) => setPassword(e.target.value)} required={!target} minLength={8} placeholder="Minimal 8 karakter" />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="field">
            <label>Role</label>
            <select className="select" value={role} onChange={(e) => setRole(e.target.value as 'user' | 'super_admin')}>
              <option value="user">User</option>
              <option value="super_admin">Super Admin</option>
            </select>
          </div>
          <div className="field">
            <label>Kuota storage (GB)</label>
            <input className="input" type="number" step="0.1" min="0.01" value={quotaGb} onChange={(e) => setQuotaGb(e.target.value)} required />
          </div>
        </div>
        {target && (
          <div className="field">
            <label>Status</label>
            <select className="select" value={status} onChange={(e) => setStatus(e.target.value as 'active' | 'suspended')}>
              <option value="active">Aktif</option>
              <option value="suspended">Ditangguhkan</option>
            </select>
          </div>
        )}
        <div className="flex gap-2 justify-between mt-2">
          <Btn type="button" variant="ghost" onClick={onClose}>Batal</Btn>
          <Btn type="submit" variant="primary" loading={saving}>{target ? 'Simpan' : 'Buat User'}</Btn>
        </div>
      </form>
    </Modal>
  );
}

export default function AdminUsers() {
  const { user: me } = useAuth();
  const { toast } = useToast();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<User | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api<{ users: User[] }>('/api/users');
      setUsers(d.users);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal memuat users', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const doDelete = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      await api(`/api/users/${deleteTarget.id}`, { method: 'DELETE' });
      toast('User beserta seluruh datanya dihapus', 'success');
      setDeleteTarget(null);
      load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal menghapus user', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 className="page-title">Manajemen User</h1>
          <p className="page-sub">{users.length} akun terdaftar. Hanya Super Admin yang dapat mengelola user.</p>
        </div>
        <Btn variant="primary" onClick={() => { setEditTarget(null); setFormOpen(true); }}>
          <Plus size={16} /> User Baru
        </Btn>
      </div>

      {loading ? (
        <SkeletonRows count={5} height={56} />
      ) : !users.length ? (
        <div className="card">
          <EmptyState icon={<Users size={36} />} title="Belum ada user" desc="Buat akun user pertama Anda." />
        </div>
      ) : (
        <div className="table-wrap card" style={{ padding: 0 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Status</th>
                <th>Storage</th>
                <th>Login terakhir</th>
                <th style={{ width: 100 }}>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const pct = Math.min(100, Math.round((u.storage_used_bytes / u.quota_bytes) * 100));
                return (
                  <tr key={u.id}>
                    <td>
                      <div className="flex items-center gap-2">
                        <div className="avatar" style={{ width: 32, height: 32, fontSize: 13 }}>
                          {(u.display_name || u.username).charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div className="font-semibold text-sm">{u.display_name || u.username}</div>
                          <div className="text-dim text-xs">@{u.username}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      {u.role === 'super_admin' ? (
                        <span className="badge"><ShieldCheck size={11} /> Super Admin</span>
                      ) : (
                        <span className="badge neutral">User</span>
                      )}
                    </td>
                    <td>
                      {u.status === 'active' ? (
                        <span className="badge success">Aktif</span>
                      ) : (
                        <span className="badge danger"><Ban size={11} /> Ditangguhkan</span>
                      )}
                    </td>
                    <td style={{ minWidth: 150 }}>
                      <div className="text-xs text-muted mb-1">{formatBytes(u.storage_used_bytes)} / {formatBytes(u.quota_bytes)}</div>
                      <div className="progress-track" style={{ height: 5 }}>
                        <div className="progress-fill" style={{ width: `${pct}%`, background: pct > 90 ? 'var(--danger)' : undefined }} />
                      </div>
                    </td>
                    <td className="text-sm text-muted">{u.last_login_at ? formatDateTime(u.last_login_at) : 'Belum pernah'}</td>
                    <td>
                      <div className="flex gap-1">
                        <Btn variant="ghost" size="icon" onClick={() => { setEditTarget(u); setFormOpen(true); }} data-tooltip="Edit">
                          <Pencil size={15} />
                        </Btn>
                        {u.id !== me?.id && (
                          <Btn variant="ghost" size="icon" onClick={() => setDeleteTarget(u)} data-tooltip="Hapus">
                            <Trash2 size={15} color="var(--danger)" />
                          </Btn>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <UserFormModal open={formOpen} onClose={() => { setFormOpen(false); setEditTarget(null); }} target={editTarget} onSaved={load} />

      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Hapus User?" desc={`Akun "${deleteTarget?.username}" beserta SEMUA repository, file, dan data lainnya akan dihapus permanen. Tindakan ini tidak dapat dibatalkan.`}>
        <div className="flex gap-2 justify-between">
          <Btn variant="ghost" onClick={() => setDeleteTarget(null)}>Batal</Btn>
          <Btn variant="danger" loading={busy} onClick={doDelete}><Trash2 size={15} /> Hapus Permanen</Btn>
        </div>
      </Modal>
    </div>
  );
}
