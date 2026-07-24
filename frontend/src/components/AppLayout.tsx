import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, FolderGit2, Star, Share2, Trash2, HardDrive, Activity as ActivityIcon,
  Settings as SettingsIcon, Users, LogOut, Search, Menu, Boxes, ChevronDown,
  X, Pause, Play, XCircle, CheckCircle2, AlertCircle,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { api, formatBytes, APP_NAME } from '../services/api';
import { uploader, type UploadTask } from '../services/uploader';
import { NodeIcon, rippleEffect } from './ui';
import type { Repo, FileNode } from '../types';

function GlobalSearch() {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<{ repos: Repo[]; nodes: FileNode[] } | null>(null);
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const boxRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    const close = (e: globalThis.MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, []);

  useEffect(() => {
    clearTimeout(timer.current);
    if (!q.trim()) {
      setResults(null);
      return;
    }
    timer.current = setTimeout(async () => {
      try {
        const data = await api<{ repos: Repo[]; nodes: FileNode[] }>(`/api/search?q=${encodeURIComponent(q.trim())}`);
        setResults(data);
        setOpen(true);
      } catch { /* ignore */ }
    }, 280);
  }, [q]);

  return (
    <div className="global-search" ref={boxRef}>
      <Search size={17} />
      <input
        className="input"
        placeholder="Cari repository, folder, atau file..."
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => results && setOpen(true)}
      />
      {open && results && (
        <div className="search-results">
          {results.repos.length === 0 && results.nodes.length === 0 && (
            <div style={{ padding: '18px 16px', color: 'var(--text-2)', fontSize: 13.5, textAlign: 'center' }}>
              Tidak ada hasil untuk "{q}"
            </div>
          )}
          {results.repos.map((r) => (
            <div
              key={r.id}
              className="search-result-item"
              onClick={() => {
                setOpen(false);
                setQ('');
                navigate(`/app/repos/${r.id}`);
              }}
            >
              <div style={{ width: 32, height: 32, borderRadius: 10, background: r.color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Boxes size={16} color="#fff" />
              </div>
              <div className="flex-1" style={{ minWidth: 0 }}>
                <div className="truncate font-semibold" style={{ fontSize: 14 }}>{r.name}</div>
                <div className="text-dim text-xs">Repository</div>
              </div>
            </div>
          ))}
          {results.nodes.map((n) => (
            <div
              key={n.id}
              className="search-result-item"
              onClick={() => {
                setOpen(false);
                setQ('');
                navigate(n.type === 'folder' ? `/app/repos/${n.repo_id}?folder=${n.id}` : `/app/repos/${n.repo_id}?file=${n.id}`);
              }}
            >
              <NodeIcon type={n.type} name={n.name} />
              <div className="flex-1" style={{ minWidth: 0 }}>
                <div className="truncate" style={{ fontSize: 14 }}>{n.name}</div>
                <div className="text-dim text-xs truncate">{n.repo_name}{n.path}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function UploadPanel() {
  const [tasks, setTasks] = useState<UploadTask[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => uploader.subscribe((t) => { setTasks(t); if (t.length > 0) setHidden(false); }), []);

  const activeTasks = tasks.filter((t) => t.status !== 'cancelled');
  if (activeTasks.length === 0 || hidden) return null;

  const activeCount = activeTasks.filter((t) => t.status === 'uploading' || t.status === 'queued').length;
  const doneCount = activeTasks.filter((t) => t.status === 'done').length;

  return (
    <div className="upload-panel">
      <div className="upload-panel-header">
        <span>
          {activeCount > 0 ? `Mengunggah ${activeCount} file...` : `Upload selesai (${doneCount}/${activeTasks.length})`}
        </span>
        <div className="flex gap-1">
          <button className="btn btn-ghost btn-icon" style={{ padding: 4 }} onClick={() => setCollapsed(!collapsed)}>
            <ChevronDown size={16} style={{ transform: collapsed ? 'rotate(180deg)' : 'none', transition: 'transform 250ms' }} />
          </button>
          <button
            className="btn btn-ghost btn-icon"
            style={{ padding: 4 }}
            onClick={() => {
              uploader.clearFinished();
              if (activeCount === 0) setHidden(true);
            }}
          >
            <X size={16} />
          </button>
        </div>
      </div>
      {!collapsed && (
        <div style={{ maxHeight: 280, overflowY: 'auto' }}>
          {activeTasks.map((t) => (
            <div key={t.id} className="upload-item">
              <div className="flex items-center gap-2">
                <NodeIcon type="file" name={t.file.name} size={16} />
                <span className="truncate flex-1 text-sm">{t.relativePath}</span>
                {t.status === 'done' && <CheckCircle2 size={16} color="var(--success)" />}
                {t.status === 'error' && <AlertCircle size={16} color="var(--danger)" />}
                {(t.status === 'uploading' || t.status === 'queued') && (
                  <button className="btn btn-ghost btn-icon" style={{ padding: 3 }} onClick={() => uploader.pause(t.id)} data-tooltip="Jeda">
                    <Pause size={14} />
                  </button>
                )}
                {t.status === 'paused' && (
                  <button className="btn btn-ghost btn-icon" style={{ padding: 3 }} onClick={() => uploader.resume(t.id)} data-tooltip="Lanjutkan">
                    <Play size={14} />
                  </button>
                )}
                {t.status !== 'done' && t.status !== 'error' && (
                  <button className="btn btn-ghost btn-icon" style={{ padding: 3 }} onClick={() => uploader.cancel(t.id)} data-tooltip="Batalkan">
                    <XCircle size={14} />
                  </button>
                )}
              </div>
              {t.status !== 'done' && t.status !== 'error' && (
                <div className="progress-track">
                  <div className="progress-fill" style={{ width: `${t.progress}%` }} />
                </div>
              )}
              {t.status === 'error' && <div className="text-xs" style={{ color: 'var(--danger)' }}>{t.error}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const navItems = [
  { to: '/app', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/app/repos', label: 'Repositories', icon: FolderGit2 },
  { to: '/app/favorites', label: 'Favorit', icon: Star },
  { to: '/app/shares', label: 'Dibagikan', icon: Share2 },
  { to: '/app/trash', label: 'Trash', icon: Trash2 },
  { to: '/app/storage', label: 'Storage', icon: HardDrive },
  { to: '/app/activity', label: 'Aktivitas', icon: ActivityIcon },
  { to: '/app/settings', label: 'Pengaturan', icon: SettingsIcon },
];

export default function AppLayout({ children, fullBleed }: { children: ReactNode; fullBleed?: boolean }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const quotaPct = user ? Math.min(100, Math.round((user.storage_used_bytes / user.quota_bytes) * 100)) : 0;

  return (
    <div className="app-shell">
      <div className="aurora-bg" />
      {sidebarOpen && <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />}
      <aside className={`sidebar${sidebarOpen ? ' open' : ''}`}>
        <div className="sidebar-logo">
          <div className="logo-mark"><Boxes size={20} /></div>
          {APP_NAME}
        </div>
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
            onClick={(e) => {
              rippleEffect(e);
              setSidebarOpen(false);
            }}
          >
            <item.icon size={18} />
            {item.label}
          </NavLink>
        ))}
        {user?.role === 'super_admin' && (
          <NavLink
            to="/app/users"
            className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
            onClick={(e) => {
              rippleEffect(e);
              setSidebarOpen(false);
            }}
          >
            <Users size={18} />
            Manajemen User
          </NavLink>
        )}

        <div className="sidebar-footer flex flex-col gap-2">
          <div style={{ padding: '0 6px' }}>
            <div className="flex justify-between text-xs text-dim mb-1">
              <span>Storage</span>
              <span>{user ? `${formatBytes(user.storage_used_bytes)} / ${formatBytes(user.quota_bytes)}` : ''}</span>
            </div>
            <div className="progress-track" style={{ height: 6 }}>
              <div className="progress-fill" style={{ width: `${quotaPct}%`, background: quotaPct > 90 ? 'var(--danger)' : undefined }} />
            </div>
          </div>
          <div className="sidebar-user" onClick={() => navigate('/app/settings')}>
            <div className="avatar">{(user?.display_name || user?.username || '?').charAt(0).toUpperCase()}</div>
            <div className="flex-1" style={{ minWidth: 0 }}>
              <div className="truncate font-semibold" style={{ fontSize: 13.5 }}>{user?.display_name || user?.username}</div>
              <div className="text-dim text-xs">{user?.role === 'super_admin' ? 'Super Admin' : 'User'}</div>
            </div>
            <button
              className="btn btn-ghost btn-icon"
              style={{ padding: 6 }}
              data-tooltip="Keluar"
              onClick={async (e) => {
                e.stopPropagation();
                await logout();
                navigate('/login');
              }}
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      <div className="main-area">
        <header className="topbar">
          <button className="btn btn-ghost btn-icon menu-toggle" onClick={() => setSidebarOpen(true)}>
            <Menu size={19} />
          </button>
          <GlobalSearch />
        </header>
        <main className={fullBleed ? '' : 'page'}>{children}</main>
      </div>
      <UploadPanel />
    </div>
  );
}
