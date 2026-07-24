import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { HardDrive, Boxes } from 'lucide-react';
import { api, formatBytes } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import { EmptyState, SkeletonRows } from '../components/ui';
import type { Repo } from '../types';

export default function Storage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [repos, setRepos] = useState<Repo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<{ repos: Repo[] }>('/api/repos')
      .then((d) => setRepos(d.repos.sort((a, b) => b.size_bytes - a.size_bytes)))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const quota = user?.quota_bytes ?? 1;
  const used = user?.storage_used_bytes ?? 0;
  const pct = Math.min(100, Math.round((used / quota) * 100));
  const totalRepoBytes = repos.reduce((s, r) => s + r.size_bytes, 0) || 1;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="page-title">Storage</h1>
        <p className="page-sub">Pantau penggunaan kuota penyimpanan Anda per repository.</p>
      </div>

      <div className="card" style={{ padding: 24 }}>
        <div className="flex items-center gap-3 mb-3">
          <div style={{ width: 44, height: 44, borderRadius: 13, background: 'rgba(var(--accent-rgb), 0.16)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <HardDrive size={21} color="var(--accent)" />
          </div>
          <div className="flex-1">
            <div className="font-semibold" style={{ fontSize: 16 }}>
              {formatBytes(used)} <span className="text-dim" style={{ fontWeight: 400 }}>dari {formatBytes(quota)} terpakai</span>
            </div>
            <div className="text-dim text-sm">{pct}% kuota terpakai · sisa {formatBytes(Math.max(0, quota - used))}</div>
          </div>
        </div>
        <div className="progress-track" style={{ height: 10 }}>
          <div className="progress-fill" style={{ width: `${pct}%`, background: pct > 90 ? 'var(--danger)' : pct > 75 ? 'var(--warning)' : undefined }} />
        </div>
      </div>

      <div className="card" style={{ padding: 22 }}>
        <h3 style={{ fontSize: 16, marginBottom: 14 }}>Penggunaan per Repository</h3>
        {loading ? (
          <SkeletonRows count={4} height={48} />
        ) : !repos.length ? (
          <EmptyState icon={<Boxes size={34} />} title="Belum ada repository" desc="Penggunaan storage per repository akan muncul di sini." />
        ) : (
          <div className="flex flex-col gap-3">
            {repos.map((r) => {
              const rp = Math.round((r.size_bytes / totalRepoBytes) * 100);
              return (
                <div key={r.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/app/repos/${r.id}`)}>
                  <div className="flex items-center gap-2 mb-1">
                    <div style={{ width: 26, height: 26, borderRadius: 8, background: r.color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <Boxes size={13} color="#fff" />
                    </div>
                    <span className="truncate flex-1 text-sm font-semibold">{r.name}</span>
                    <span className="text-dim text-sm">{formatBytes(r.size_bytes)}</span>
                  </div>
                  <div className="progress-track" style={{ height: 7 }}>
                    <div className="progress-fill" style={{ width: `${Math.max(rp, 2)}%`, background: r.color }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
