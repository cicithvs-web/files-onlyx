import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Star, Boxes } from 'lucide-react';
import { api, formatBytes, timeAgo } from '../services/api';
import { EmptyState, SkeletonRows, NodeIcon } from '../components/ui';
import type { Repo, FileNode } from '../types';

export default function Favorites() {
  const navigate = useNavigate();
  const [repos, setRepos] = useState<Repo[]>([]);
  const [nodes, setNodes] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<{ repos: Repo[]; nodes: FileNode[] }>('/api/favorites')
      .then((d) => {
        setRepos(d.repos);
        setNodes(d.nodes);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const isEmpty = !repos.length && !nodes.length;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="page-title">Favorit</h1>
        <p className="page-sub">Akses cepat ke repository, folder, dan file yang Anda tandai.</p>
      </div>

      {loading ? (
        <SkeletonRows count={5} height={56} />
      ) : isEmpty ? (
        <div className="card">
          <EmptyState
            icon={<Star size={36} />}
            title="Belum ada favorit"
            desc="Tandai repository atau file dengan bintang melalui menu klik kanan untuk akses cepat."
          />
        </div>
      ) : (
        <>
          {repos.length > 0 && (
            <div className="card" style={{ padding: 12 }}>
              <div className="text-dim text-xs font-semibold" style={{ padding: '8px 12px', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Repository
              </div>
              {repos.map((r) => (
                <div key={r.id} className="file-row" onClick={() => navigate(`/app/repos/${r.id}`)}>
                  <div style={{ width: 34, height: 34, borderRadius: 11, background: r.color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Boxes size={16} color="#fff" />
                  </div>
                  <div className="flex-1" style={{ minWidth: 0 }}>
                    <div className="truncate text-sm font-semibold">{r.name}</div>
                    <div className="text-dim text-xs">{formatBytes(r.size_bytes)} · diperbarui {timeAgo(r.updated_at)}</div>
                  </div>
                  <Star size={15} color="var(--warning)" fill="var(--warning)" />
                </div>
              ))}
            </div>
          )}
          {nodes.length > 0 && (
            <div className="card" style={{ padding: 12 }}>
              <div className="text-dim text-xs font-semibold" style={{ padding: '8px 12px', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                File & Folder
              </div>
              {nodes.map((n) => (
                <div
                  key={n.id}
                  className="file-row"
                  onClick={() => navigate(n.type === 'folder' ? `/app/repos/${n.repo_id}?folder=${n.id}` : `/app/repos/${n.repo_id}?file=${n.id}`)}
                >
                  <NodeIcon type={n.type} name={n.name} size={19} />
                  <div className="flex-1" style={{ minWidth: 0 }}>
                    <div className="truncate text-sm">{n.name}</div>
                    <div className="text-dim text-xs truncate">{n.repo_name}{n.path}</div>
                  </div>
                  <Star size={15} color="var(--warning)" fill="var(--warning)" />
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
