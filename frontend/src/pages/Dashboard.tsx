import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FolderGit2, FileText, Folder, HardDrive, Boxes, Plus, Upload, Download,
  Pencil, Trash2, Share2, Copy, ArrowRight, Clock,
} from 'lucide-react';
import { api, formatBytes, timeAgo } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import { Btn, SkeletonRows, EmptyState } from '../components/ui';
import type { DashboardData, Activity } from '../types';

const actionIcons: Record<string, typeof Upload> = {
  upload: Upload,
  download: Download,
  create: Plus,
  rename: Pencil,
  delete: Trash2,
  share: Share2,
  copy: Copy,
  move: ArrowRight,
  login: Clock,
};

export function ActivityRow({ a }: { a: Activity }) {
  const Icon = actionIcons[a.action] || Clock;
  return (
    <div className="flex items-center gap-3" style={{ padding: '11px 4px', borderBottom: '1px solid var(--glass-border)' }}>
      <div style={{ width: 34, height: 34, borderRadius: 11, background: 'rgba(var(--accent-rgb), 0.14)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Icon size={15} color="var(--accent)" />
      </div>
      <div className="flex-1" style={{ minWidth: 0 }}>
        <div className="truncate text-sm">{a.detail || a.action}</div>
        <div className="text-dim text-xs">{timeAgo(a.created_at)}</div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<DashboardData>('/api/dashboard')
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const stats = [
    { label: 'Repository', value: data?.repo_count ?? 0, icon: FolderGit2, color: 'var(--accent)' },
    { label: 'File', value: data?.file_count ?? 0, icon: FileText, color: '#4cc9f0' },
    { label: 'Folder', value: data?.folder_count ?? 0, icon: Folder, color: '#f0b35c' },
    { label: 'Storage Terpakai', value: formatBytes(data?.storage_used ?? 0), icon: HardDrive, color: '#5ecf9a' },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 className="page-title">Halo, {user?.display_name || user?.username} 👋</h1>
          <p className="page-sub">Berikut ringkasan aktivitas dan file Anda.</p>
        </div>
        <Btn variant="primary" onClick={() => navigate('/app/repos?new=1')}>
          <Plus size={17} /> Repository Baru
        </Btn>
      </div>

      <div className="stats-grid">
        {stats.map((s, i) => (
          <div key={i} className="card stat-card anim-fade-up" style={{ animationDelay: `${i * 70}ms` }}>
            <div className="stat-icon" style={{ background: `color-mix(in srgb, ${s.color} 16%, transparent)`, color: s.color }}>
              <s.icon size={21} />
            </div>
            <div className="stat-value">{loading ? '—' : s.value}</div>
            <div className="stat-label">{s.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
        <div className="card" style={{ padding: 22 }}>
          <div className="flex items-center justify-between mb-3">
            <h3 style={{ fontSize: 16 }}>Repository Terbaru</h3>
            <Btn variant="ghost" size="sm" onClick={() => navigate('/app/repos')}>Lihat semua</Btn>
          </div>
          {loading ? (
            <SkeletonRows count={4} height={52} />
          ) : !data?.recent_repos.length ? (
            <EmptyState
              icon={<Boxes size={36} />}
              title="Belum ada repository"
              desc="Buat repository pertama Anda untuk mulai menyimpan file."
              action={<Btn variant="primary" size="sm" onClick={() => navigate('/app/repos?new=1')}><Plus size={15} /> Buat Repository</Btn>}
            />
          ) : (
            <div className="flex flex-col">
              {data.recent_repos.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center gap-3"
                  style={{ padding: '11px 6px', borderBottom: '1px solid var(--glass-border)', cursor: 'pointer', borderRadius: 10 }}
                  onClick={() => navigate(`/app/repos/${r.id}`)}
                >
                  <div style={{ width: 38, height: 38, borderRadius: 12, background: r.color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Boxes size={17} color="#fff" />
                  </div>
                  <div className="flex-1" style={{ minWidth: 0 }}>
                    <div className="truncate font-semibold text-sm">{r.name}</div>
                    <div className="text-dim text-xs">{formatBytes(r.size_bytes)} · diperbarui {timeAgo(r.updated_at)}</div>
                  </div>
                  {r.is_public === 1 && <span className="badge success">Publik</span>}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card" style={{ padding: 22 }}>
          <div className="flex items-center justify-between mb-3">
            <h3 style={{ fontSize: 16 }}>Aktivitas Terakhir</h3>
            <Btn variant="ghost" size="sm" onClick={() => navigate('/app/activity')}>Lihat semua</Btn>
          </div>
          {loading ? (
            <SkeletonRows count={5} height={44} />
          ) : !data?.recent_activity.length ? (
            <EmptyState icon={<Clock size={36} />} title="Belum ada aktivitas" desc="Aktivitas Anda akan tercatat di sini." />
          ) : (
            <div className="flex flex-col">
              {data.recent_activity.map((a) => (
                <ActivityRow key={a.id} a={a} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
