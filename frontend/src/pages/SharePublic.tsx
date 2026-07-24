import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Boxes, Lock, Download, ChevronRight, FolderOpen, AlertTriangle } from 'lucide-react';
import { API_URL, APP_NAME, formatBytes, formatDateTime } from '../services/api';
import { Btn, Spinner, NodeIcon, EmptyState } from '../components/ui';

interface ShareInfo {
  needs_password: boolean;
  target_type: 'repo' | 'node';
  expires_at: number | null;
}

interface ShareTarget {
  id: string;
  name: string;
  type?: 'file' | 'folder';
  size_bytes: number;
  color?: string;
  description?: string;
  updated_at: number;
}

interface ShareNode {
  id: string;
  parent_id: string | null;
  type: 'file' | 'folder';
  name: string;
  size_bytes: number;
  updated_at: number;
}

export default function SharePublic() {
  const { token } = useParams<{ token: string }>();
  const [info, setInfo] = useState<ShareInfo | null>(null);
  const [target, setTarget] = useState<ShareTarget | null>(null);
  const [nodes, setNodes] = useState<ShareNode[]>([]);
  const [crumbs, setCrumbs] = useState<ShareNode[]>([]);
  const [currentFolder, setCurrentFolder] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [listLoading, setListLoading] = useState(false);

  const loadInfo = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/shares/public/${token}`);
      const json = await res.json() as { success: boolean; data?: { share: ShareInfo; target: ShareTarget | null }; error?: { message: string } };
      if (!json.success) throw new Error(json.error?.message || 'Tautan tidak valid');
      setInfo(json.data!.share);
      setTarget(json.data!.target);
      if (!json.data!.share.needs_password) setVerified(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Tautan tidak valid atau sudah kedaluwarsa');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadInfo();
  }, [loadInfo]);

  const loadList = useCallback(
    async (folderId: string | null) => {
      if (!info || !verified) return;
      setListLoading(true);
      try {
        const url = new URL(`${API_URL}/api/shares/public/${token}/list`);
        if (folderId) url.searchParams.set('parent_id', folderId);
        const res = await fetch(url.toString(), { headers: password ? { 'X-Share-Password': password } : {} });
        const json = await res.json() as { success: boolean; data?: { nodes: ShareNode[]; breadcrumbs: ShareNode[] }; error?: { message: string } };
        if (!json.success) throw new Error(json.error?.message || 'Gagal memuat');
        setNodes(json.data!.nodes);
        setCrumbs(json.data!.breadcrumbs || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Gagal memuat isi');
      } finally {
        setListLoading(false);
      }
    },
    [info, verified, token, password]
  );

  useEffect(() => {
    const isBrowsable = info && verified && (info.target_type === 'repo' || target?.type === 'folder');
    if (isBrowsable) loadList(currentFolder);
  }, [info, verified, currentFolder, loadList, target]);

  const verify = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const res = await fetch(`${API_URL}/api/shares/public/${token}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const json = await res.json() as { success: boolean; error?: { message: string } };
      if (!json.success) throw new Error(json.error?.message || 'Password salah');
      setVerified(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Password salah');
    }
  };

  const downloadUrl = (nodeId?: string) => {
    const base = nodeId
      ? `${API_URL}/api/shares/public/${token}/file/${nodeId}`
      : `${API_URL}/api/shares/public/${token}/download`;
    const u = new URL(base);
    if (password) u.searchParams.set('pw', password);
    return u.toString();
  };

  if (loading) {
    return (
      <div className="auth-wrap">
        <div className="aurora-bg" />
        <Spinner size={34} />
      </div>
    );
  }

  if (error && !info) {
    return (
      <div className="auth-wrap">
        <div className="aurora-bg" />
        <div className="card auth-card anim-scale-in" style={{ textAlign: 'center' }}>
          <AlertTriangle size={40} color="var(--warning)" style={{ margin: '0 auto' }} />
          <h2 style={{ fontSize: 19 }}>Tautan tidak tersedia</h2>
          <p className="text-muted text-sm">{error}</p>
          <Link to="/"><Btn variant="primary" style={{ width: '100%' }}>Ke Beranda {APP_NAME}</Btn></Link>
        </div>
      </div>
    );
  }

  if (info && info.needs_password && !verified) {
    return (
      <div className="auth-wrap">
        <div className="aurora-bg" />
        <div className="card auth-card anim-scale-in">
          <div style={{ textAlign: 'center' }}>
            <div style={{ width: 52, height: 52, borderRadius: 16, margin: '0 auto 14px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(var(--accent-rgb), 0.16)' }}>
              <Lock size={24} color="var(--accent)" />
            </div>
            <h2 style={{ fontSize: 19 }}>Konten dilindungi password</h2>
            <p className="text-muted text-sm mt-1">Masukkan password untuk mengakses konten yang dibagikan.</p>
          </div>
          <form onSubmit={verify} className="flex flex-col gap-3">
            <input className="input" type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus required />
            {error && <div className="badge danger" style={{ padding: '9px 13px', borderRadius: 10, justifyContent: 'center' }}>{error}</div>}
            <Btn type="submit" variant="primary" size="lg" style={{ width: '100%' }}>Buka</Btn>
          </form>
        </div>
      </div>
    );
  }

  const isSingleFile = info?.target_type === 'node' && target?.type === 'file';

  return (
    <div style={{ minHeight: '100vh', position: 'relative' }}>
      <div className="aurora-bg" />
      <nav className="landing-nav">
        <Link to="/" className="flex items-center gap-2" style={{ color: 'var(--text-0)', fontWeight: 700, fontSize: 16 }}>
          <div style={{ width: 34, height: 34, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, var(--accent), var(--accent-2))' }}>
            <Boxes size={17} color="#fff" />
          </div>
          {APP_NAME}
        </Link>
        <span className="badge neutral">Konten dibagikan</span>
      </nav>

      <div style={{ maxWidth: 860, margin: '0 auto', padding: '28px 20px 60px' }}>
        <div className="card anim-fade-up" style={{ padding: 26, marginBottom: 16 }}>
          <div className="flex items-center gap-3" style={{ flexWrap: 'wrap' }}>
            {info?.target_type === 'repo' ? (
              <div style={{ width: 46, height: 46, borderRadius: 14, background: target?.color || 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Boxes size={21} color="#fff" />
              </div>
            ) : (
              <NodeIcon type={target?.type || 'file'} name={target?.name || ''} size={34} />
            )}
            <div className="flex-1" style={{ minWidth: 0 }}>
              <h2 className="truncate" style={{ fontSize: 19 }}>{target?.name}</h2>
              <p className="text-dim text-sm">
                {formatBytes(target?.size_bytes || 0)} · diperbarui {formatDateTime(target?.updated_at)}
                {info?.expires_at ? ` · berlaku hingga ${formatDateTime(info.expires_at)}` : ''}
              </p>
            </div>
            {isSingleFile ? (
              <a href={downloadUrl(target?.id)} target="_blank" rel="noreferrer">
                <Btn variant="primary"><Download size={16} /> Download</Btn>
              </a>
            ) : (
              <a href={downloadUrl()} target="_blank" rel="noreferrer">
                <Btn variant="primary"><Download size={16} /> Download ZIP</Btn>
              </a>
            )}
          </div>
          {target?.description && <p className="text-muted text-sm mt-2">{target.description}</p>}
        </div>

        {!isSingleFile && (
          <div className="card anim-fade-up" style={{ padding: 16 }}>
            <div className="breadcrumb mb-2" style={{ padding: '0 6px' }}>
              <span className="crumb" onClick={() => setCurrentFolder(null)}>{target?.name}</span>
              {crumbs.map((c, i) => (
                <span key={c.id} className="flex items-center gap-1">
                  <ChevronRight size={13} color="var(--text-2)" />
                  <span className={`crumb${i === crumbs.length - 1 ? ' current' : ''}`} onClick={() => setCurrentFolder(c.id)}>
                    {c.name}
                  </span>
                </span>
              ))}
            </div>
            {listLoading ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><Spinner /></div>
            ) : !nodes.length ? (
              <EmptyState icon={<FolderOpen size={32} />} title="Folder kosong" />
            ) : (
              nodes.map((n) => (
                <div
                  key={n.id}
                  className="file-row"
                  onClick={() => {
                    if (n.type === 'folder') setCurrentFolder(n.id);
                    else window.open(downloadUrl(n.id), '_blank');
                  }}
                >
                  <NodeIcon type={n.type} name={n.name} size={19} />
                  <span className="truncate flex-1" style={{ fontSize: 14 }}>{n.name}</span>
                  <div className="file-meta">
                    <span className="date-col">{formatDateTime(n.updated_at)}</span>
                    <span style={{ minWidth: 64, textAlign: 'right' }}>{n.type === 'file' ? formatBytes(n.size_bytes) : '—'}</span>
                  </div>
                  {n.type === 'file' && <Download size={15} color="var(--text-2)" />}
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
