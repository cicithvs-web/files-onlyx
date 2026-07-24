import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ChevronRight, FolderPlus, FilePlus, Upload, Download, Pencil, Trash2, Copy,
  Scissors, Share2, Star, Info, Archive, FileArchive, Boxes, PanelLeft, X, FolderUp, MoreVertical,
} from 'lucide-react';
import { api, apiRaw, API_URL, formatBytes, formatDateTime } from '../services/api';
import { useToast } from '../hooks/useToast';
import { uploader } from '../services/uploader';
import {
  Btn, Modal, ContextMenu, EmptyState, SkeletonRows, NodeIcon, Spinner,
  isTextExt, isImageExt, isVideoExt, isAudioExt, isPdfExt, type CtxMenuItem,
} from '../components/ui';
import { ShareModal } from '../components/ShareModal';
import type { FileNode, Repo } from '../types';

interface TreeNodeData extends FileNode {
  children?: TreeNodeData[];
}

function buildTree(nodes: FileNode[]): TreeNodeData[] {
  const map = new Map<string, TreeNodeData>();
  const roots: TreeNodeData[] = [];
  nodes.forEach((n) => map.set(n.id, { ...n, children: [] }));
  map.forEach((n) => {
    if (n.parent_id && map.has(n.parent_id)) map.get(n.parent_id)!.children!.push(n);
    else roots.push(n);
  });
  const sortFn = (a: TreeNodeData, b: TreeNodeData) =>
    a.type !== b.type ? (a.type === 'folder' ? -1 : 1) : a.name.localeCompare(b.name);
  const sortRec = (list: TreeNodeData[]) => {
    list.sort(sortFn);
    list.forEach((n) => n.children && sortRec(n.children));
  };
  sortRec(roots);
  return roots;
}

function TreeView({
  nodes, selectedId, expandedIds, onToggle, onSelect, onDropNode,
}: {
  nodes: TreeNodeData[];
  selectedId: string | null;
  expandedIds: Set<string>;
  onToggle: (id: string) => void;
  onSelect: (n: TreeNodeData) => void;
  onDropNode: (dragId: string, targetFolderId: string | null) => void;
}) {
  const [dropId, setDropId] = useState<string | null>(null);

  const render = (list: TreeNodeData[], depth: number) =>
    list.map((n) => (
      <div key={n.id}>
        <div
          className={`tree-node${selectedId === n.id ? ' selected' : ''}${dropId === n.id ? ' drop-target' : ''}`}
          style={{ paddingLeft: 8 + depth * 16 }}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData('application/x-node-id', n.id);
            e.dataTransfer.effectAllowed = 'move';
          }}
          onDragOver={(e) => {
            if (n.type === 'folder' && e.dataTransfer.types.includes('application/x-node-id')) {
              e.preventDefault();
              setDropId(n.id);
            }
          }}
          onDragLeave={() => setDropId((d) => (d === n.id ? null : d))}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setDropId(null);
            const dragId = e.dataTransfer.getData('application/x-node-id');
            if (dragId && dragId !== n.id && n.type === 'folder') onDropNode(dragId, n.id);
          }}
          onClick={() => {
            if (n.type === 'folder') onToggle(n.id);
            onSelect(n);
          }}
        >
          {n.type === 'folder' ? (
            <ChevronRight size={13} className={`chevron${expandedIds.has(n.id) ? ' open' : ''}`} />
          ) : (
            <span style={{ width: 13, flexShrink: 0 }} />
          )}
          <NodeIcon type={n.type} name={n.name} size={15} open={expandedIds.has(n.id)} />
          <span className="truncate">{n.name}</span>
        </div>
        {n.type === 'folder' && expandedIds.has(n.id) && n.children && render(n.children, depth + 1)}
      </div>
    ));

  return <div>{render(nodes, 0)}</div>;
}

function PreviewModal({ node, onClose }: { node: FileNode; onClose: () => void }) {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let objectUrl = '';
    apiRaw(`/api/nodes/${node.id}/download?inline=1`)
      .then(async (res) => {
        const blob = await res.blob();
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .finally(() => setLoading(false));
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [node.id]);

  return (
    <Modal open onClose={onClose} title={node.name} wide>
      <div style={{ minHeight: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {loading ? (
          <Spinner size={30} />
        ) : isImageExt(node.name) ? (
          <img src={url} alt={node.name} style={{ maxWidth: '100%', maxHeight: '62vh', borderRadius: 12 }} />
        ) : isVideoExt(node.name) ? (
          <video src={url} controls style={{ maxWidth: '100%', maxHeight: '62vh', borderRadius: 12 }} />
        ) : isAudioExt(node.name) ? (
          <audio src={url} controls style={{ width: '100%' }} />
        ) : isPdfExt(node.name) ? (
          <iframe src={url} title={node.name} style={{ width: '100%', height: '62vh', border: 'none', borderRadius: 12 }} />
        ) : (
          <p className="text-muted">Pratinjau tidak tersedia untuk tipe file ini.</p>
        )}
      </div>
      <div className="flex justify-between mt-3">
        <span className="text-dim text-sm">{formatBytes(node.size_bytes)}</span>
        <Btn variant="primary" size="sm" onClick={() => window.open(`${API_URL}/api/nodes/${node.id}/download`, '_blank')}>
          <Download size={15} /> Download
        </Btn>
      </div>
    </Modal>
  );
}

function PropertiesModal({ nodeId, onClose }: { nodeId: string; onClose: () => void }) {
  const [props, setProps] = useState<Record<string, unknown> | null>(null);
  useEffect(() => {
    api<Record<string, unknown>>(`/api/nodes/${nodeId}/properties`).then(setProps).catch(() => {});
  }, [nodeId]);

  return (
    <Modal open onClose={onClose} title="Properti">
      {!props ? (
        <SkeletonRows count={5} height={30} />
      ) : (
        <div className="flex flex-col gap-2 text-sm">
          {[
            ['Nama', props.name],
            ['Tipe', props.type === 'folder' ? 'Folder' : `File (${props.mime_type || 'tidak diketahui'})`],
            ['Ukuran', formatBytes(props.size_bytes as number)],
            ...(props.type === 'folder' ? [['Isi', `${props.file_count} file, ${props.folder_count} folder`]] : []),
            ['Lokasi', props.location],
            ['Dibuat', formatDateTime(props.created_at as number)],
            ['Diubah', formatDateTime(props.updated_at as number)],
          ].map(([k, v], i) => (
            <div key={i} className="flex justify-between gap-3" style={{ padding: '7px 0', borderBottom: '1px solid var(--glass-border)' }}>
              <span className="text-dim" style={{ flexShrink: 0 }}>{k as string}</span>
              <span style={{ textAlign: 'right', wordBreak: 'break-all' }}>{String(v)}</span>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

async function readDroppedItems(items: DataTransferItemList): Promise<Array<{ file: File; relativePath: string }>> {
  const out: Array<{ file: File; relativePath: string }> = [];

  async function walkEntry(entry: FileSystemEntry, prefix: string): Promise<void> {
    if (entry.isFile) {
      const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
      out.push({ file, relativePath: prefix + file.name });
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      let batch: FileSystemEntry[];
      do {
        batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
        for (const child of batch) await walkEntry(child, `${prefix}${entry.name}/`);
      } while (batch.length > 0);
    }
  }

  const entries: FileSystemEntry[] = [];
  for (let i = 0; i < items.length; i++) {
    const entry = items[i].webkitGetAsEntry?.();
    if (entry) entries.push(entry);
  }
  for (const entry of entries) await walkEntry(entry, '');
  return out;
}

export default function Explorer() {
  const { repoId } = useParams<{ repoId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [params, setParams] = useSearchParams();

  const [repo, setRepo] = useState<Repo | null>(null);
  const [allNodes, setAllNodes] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentFolder, setCurrentFolder] = useState<string | null>(params.get('folder'));
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; node: FileNode | null } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [treeMobileOpen, setTreeMobileOpen] = useState(false);

  // modals
  const [newItemType, setNewItemType] = useState<'file' | 'folder' | null>(null);
  const [newItemName, setNewItemName] = useState('');
  const [renameTarget, setRenameTarget] = useState<FileNode | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<FileNode | null>(null);
  const [shareTarget, setShareTarget] = useState<FileNode | null>(null);
  const [previewTarget, setPreviewTarget] = useState<FileNode | null>(null);
  const [propsTarget, setPropsTarget] = useState<FileNode | null>(null);
  const [clipboard, setClipboard] = useState<{ node: FileNode; cut: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!repoId) return;
    try {
      const [repoData, treeData] = await Promise.all([
        api<{ repo: Repo }>(`/api/repos/${repoId}`),
        api<{ nodes: FileNode[] }>(`/api/nodes/repo/${repoId}/tree`),
      ]);
      setRepo(repoData.repo);
      setAllNodes(treeData.nodes);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal memuat repository', 'error');
      navigate('/app/repos');
    } finally {
      setLoading(false);
    }
  }, [repoId, toast, navigate]);

  useEffect(() => {
    load();
  }, [load]);

  // refresh when uploads complete
  useEffect(() => {
    let doneCount = 0;
    return uploader.subscribe((tasks) => {
      const nowDone = tasks.filter((t) => t.status === 'done').length;
      if (nowDone > doneCount) load();
      doneCount = nowDone;
    });
  }, [load]);

  // open file from search param
  useEffect(() => {
    const fileId = params.get('file');
    if (fileId && allNodes.length) {
      const node = allNodes.find((n) => n.id === fileId);
      if (node) {
        if (isTextExt(node.name)) navigate(`/app/repos/${repoId}/edit/${node.id}`);
        else setPreviewTarget(node);
        params.delete('file');
        setParams(params, { replace: true });
      }
    }
  }, [params, allNodes, navigate, repoId, setParams]);

  const tree = useMemo(() => buildTree(allNodes), [allNodes]);
  const nodeMap = useMemo(() => new Map(allNodes.map((n) => [n.id, n])), [allNodes]);

  const currentChildren = useMemo(() => {
    const list = allNodes.filter((n) => (currentFolder ? n.parent_id === currentFolder : !n.parent_id));
    return list.sort((a, b) => (a.type !== b.type ? (a.type === 'folder' ? -1 : 1) : a.name.localeCompare(b.name)));
  }, [allNodes, currentFolder]);

  const breadcrumbs = useMemo(() => {
    const crumbs: FileNode[] = [];
    let cur = currentFolder ? nodeMap.get(currentFolder) : undefined;
    while (cur) {
      crumbs.unshift(cur);
      cur = cur.parent_id ? nodeMap.get(cur.parent_id) : undefined;
    }
    return crumbs;
  }, [currentFolder, nodeMap]);

  const goToFolder = (id: string | null) => {
    setCurrentFolder(id);
    setSelectedId(null);
    if (id) params.set('folder', id);
    else params.delete('folder');
    setParams(params, { replace: true });
  };

  const openNode = (n: FileNode) => {
    if (n.type === 'folder') {
      goToFolder(n.id);
      setExpandedIds((s) => new Set(s).add(n.id));
    } else if (isTextExt(n.name)) {
      navigate(`/app/repos/${repoId}/edit/${n.id}`);
    } else {
      setPreviewTarget(n);
    }
  };

  const createItem = async (e: FormEvent) => {
    e.preventDefault();
    if (!newItemType || !repoId) return;
    setBusy(true);
    try {
      await api('/api/nodes', {
        method: 'POST',
        body: { repo_id: repoId, parent_id: currentFolder, type: newItemType, name: newItemName.trim() },
      });
      toast(`${newItemType === 'folder' ? 'Folder' : 'File'} berhasil dibuat`, 'success');
      setNewItemType(null);
      setNewItemName('');
      load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal membuat', 'error');
    } finally {
      setBusy(false);
    }
  };

  const doRename = async (e: FormEvent) => {
    e.preventDefault();
    if (!renameTarget) return;
    setBusy(true);
    try {
      await api(`/api/nodes/${renameTarget.id}/rename`, { method: 'PATCH', body: { name: renameValue.trim() } });
      toast('Berhasil diubah nama', 'success');
      setRenameTarget(null);
      load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal mengubah nama', 'error');
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      await api(`/api/nodes/${deleteTarget.id}`, { method: 'DELETE' });
      toast(`"${deleteTarget.name}" dipindahkan ke Trash`, 'success');
      setDeleteTarget(null);
      load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal menghapus', 'error');
    } finally {
      setBusy(false);
    }
  };

  const moveNode = async (dragId: string, targetFolderId: string | null) => {
    try {
      await api(`/api/nodes/${dragId}/move`, { method: 'PATCH', body: { target_parent_id: targetFolderId } });
      toast('Berhasil dipindahkan', 'success');
      load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal memindahkan', 'error');
    }
  };

  const doPaste = async () => {
    if (!clipboard) return;
    try {
      if (clipboard.cut) {
        await api(`/api/nodes/${clipboard.node.id}/move`, { method: 'PATCH', body: { target_parent_id: currentFolder } });
        toast('Berhasil dipindahkan', 'success');
      } else {
        await api(`/api/nodes/${clipboard.node.id}/copy`, { method: 'POST', body: { target_parent_id: currentFolder } });
        toast('Berhasil disalin', 'success');
      }
      setClipboard(null);
      load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal menempel', 'error');
    }
  };

  const toggleFavorite = async (node: FileNode) => {
    try {
      await api(`/api/nodes/${node.id}/favorite`, { method: 'PATCH', body: { favorite: node.is_favorite !== 1 } });
      load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal', 'error');
    }
  };

  const doExtractZip = async (node: FileNode) => {
    toast('Mengekstrak ZIP...', 'info');
    try {
      const res = await api<{ extracted: number; skipped: string[] }>(`/api/zip/extract/${node.id}`, { method: 'POST' });
      toast(`Berhasil mengekstrak ${res.extracted} file${res.skipped.length ? `, ${res.skipped.length} dilewati (terlalu besar)` : ''}`, 'success');
      load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal mengekstrak', 'error');
    }
  };

  const doCompress = async (node: FileNode) => {
    toast('Mengompres ke ZIP...', 'info');
    try {
      await api(`/api/zip/compress/${node.id}`, { method: 'POST' });
      toast('Berhasil dikompres menjadi ZIP', 'success');
      load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal mengompres', 'error');
    }
  };

  const nodeMenuItems = (node: FileNode): CtxMenuItem[] => {
    const items: CtxMenuItem[] = [
      { label: 'Buka', icon: <ChevronRight size={15} />, onClick: () => openNode(node) },
      { label: 'Ubah nama', icon: <Pencil size={15} />, onClick: () => { setRenameTarget(node); setRenameValue(node.name); } },
      { label: 'Salin', icon: <Copy size={15} />, onClick: () => setClipboard({ node, cut: false }) },
      { label: 'Pindahkan (cut)', icon: <Scissors size={15} />, onClick: () => setClipboard({ node, cut: true }) },
      { label: 'Duplikat', icon: <Copy size={15} />, onClick: async () => {
          try {
            await api(`/api/nodes/${node.id}/copy`, { method: 'POST', body: { duplicate: true } });
            toast('Berhasil diduplikasi', 'success');
            load();
          } catch (err) {
            toast(err instanceof Error ? err.message : 'Gagal', 'error');
          }
        } },
      { label: node.is_favorite === 1 ? 'Hapus dari favorit' : 'Tambah ke favorit', icon: <Star size={15} />, onClick: () => toggleFavorite(node) },
      { label: 'Bagikan', icon: <Share2 size={15} />, onClick: () => setShareTarget(node) },
    ];
    if (node.type === 'file') {
      items.push({ label: 'Download', icon: <Download size={15} />, onClick: () => window.open(`${API_URL}/api/nodes/${node.id}/download`, '_blank') });
      if (node.name.toLowerCase().endsWith('.zip')) {
        items.push({ label: 'Ekstrak ZIP di sini', icon: <FileArchive size={15} />, onClick: () => doExtractZip(node) });
      } else {
        items.push({ label: 'Kompres ke ZIP', icon: <Archive size={15} />, onClick: () => doCompress(node) });
      }
    } else {
      items.push({ label: 'Download sebagai ZIP', icon: <Download size={15} />, onClick: () => window.open(`${API_URL}/api/zip/folder/${node.id}`, '_blank') });
      items.push({ label: 'Kompres ke ZIP', icon: <Archive size={15} />, onClick: () => doCompress(node) });
    }
    items.push({ label: 'Properti', icon: <Info size={15} />, onClick: () => setPropsTarget(node) });
    items.push({ label: '', sep: true });
    items.push({ label: 'Hapus ke Trash', icon: <Trash2 size={15} />, danger: true, onClick: () => setDeleteTarget(node) });
    return items;
  };

  const bgMenuItems = (): CtxMenuItem[] => [
    { label: 'Folder baru', icon: <FolderPlus size={15} />, onClick: () => { setNewItemType('folder'); setNewItemName(''); } },
    { label: 'File baru', icon: <FilePlus size={15} />, onClick: () => { setNewItemType('file'); setNewItemName(''); } },
    { label: 'Upload file', icon: <Upload size={15} />, onClick: () => fileInputRef.current?.click() },
    { label: 'Upload folder', icon: <FolderUp size={15} />, onClick: () => folderInputRef.current?.click() },
    ...(clipboard
      ? [{ label: `Tempel "${clipboard.node.name}"`, icon: <Copy size={15} />, onClick: doPaste }]
      : []),
  ];

  const handleDrop = async (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (!repoId) return;
    // internal node move to current folder background
    const dragId = e.dataTransfer.getData('application/x-node-id');
    if (dragId) return;
    const files = await readDroppedItems(e.dataTransfer.items);
    if (files.length) {
      uploader.addFiles(files, repoId, currentFolder);
      toast(`Mengunggah ${files.length} file...`, 'info');
    }
  };

  if (loading) {
    return (
      <div className="page">
        <SkeletonRows count={8} height={48} />
      </div>
    );
  }

  return (
    <div className="explorer-layout">
      {treeMobileOpen && <div className="sidebar-backdrop" style={{ zIndex: 44 }} onClick={() => setTreeMobileOpen(false)} />}
      <div className={`explorer-tree${treeMobileOpen ? ' mobile-open' : ''}`}>
        <div
          className={`tree-node${!currentFolder ? ' selected' : ''}`}
          style={{ fontWeight: 600 }}
          onClick={() => goToFolder(null)}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes('application/x-node-id')) e.preventDefault();
          }}
          onDrop={(e) => {
            e.preventDefault();
            const dragId = e.dataTransfer.getData('application/x-node-id');
            if (dragId) moveNode(dragId, null);
          }}
        >
          <Boxes size={15} color={repo?.color || 'var(--accent)'} />
          <span className="truncate">{repo?.name}</span>
        </div>
        <TreeView
          nodes={tree}
          selectedId={selectedId}
          expandedIds={expandedIds}
          onToggle={(id) =>
            setExpandedIds((s) => {
              const next = new Set(s);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            })
          }
          onSelect={(n) => {
            setSelectedId(n.id);
            if (n.type === 'folder') goToFolder(n.id);
            else openNode(n);
          }}
          onDropNode={moveNode}
        />
      </div>

      <div
        className={`explorer-main${dragOver ? ' drag-over' : ''}`}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('Files')) {
            e.preventDefault();
            setDragOver(true);
          }
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setDragOver(false);
        }}
        onDrop={handleDrop}
        onContextMenu={(e) => {
          if (e.target === e.currentTarget) {
            e.preventDefault();
            setMenu({ x: e.clientX, y: e.clientY, node: null });
          }
        }}
      >
        <div className="flex items-center gap-2 mb-3" style={{ flexWrap: 'wrap' }}>
          <button className="btn btn-ghost btn-icon" style={{ display: window.innerWidth <= 860 ? 'inline-flex' : 'none' }} onClick={() => setTreeMobileOpen(true)}>
            <PanelLeft size={17} />
          </button>
          <div className="breadcrumb flex-1">
            <span className="crumb" onClick={() => navigate('/app/repos')}>Repositories</span>
            <ChevronRight size={13} color="var(--text-2)" />
            <span className={`crumb${!breadcrumbs.length ? ' current' : ''}`} onClick={() => goToFolder(null)}>
              {repo?.name}
            </span>
            {breadcrumbs.map((b, i) => (
              <span key={b.id} className="flex items-center gap-1">
                <ChevronRight size={13} color="var(--text-2)" />
                <span className={`crumb${i === breadcrumbs.length - 1 ? ' current' : ''}`} onClick={() => goToFolder(b.id)}>
                  {b.name}
                </span>
              </span>
            ))}
          </div>
          <div className="flex gap-1">
            <Btn variant="ghost" size="sm" onClick={() => { setNewItemType('folder'); setNewItemName(''); }} data-tooltip="Folder baru">
              <FolderPlus size={16} />
            </Btn>
            <Btn variant="ghost" size="sm" onClick={() => { setNewItemType('file'); setNewItemName(''); }} data-tooltip="File baru">
              <FilePlus size={16} />
            </Btn>
            <Btn variant="ghost" size="sm" onClick={() => folderInputRef.current?.click()} data-tooltip="Upload folder">
              <FolderUp size={16} />
            </Btn>
            <Btn variant="primary" size="sm" onClick={() => fileInputRef.current?.click()}>
              <Upload size={15} /> Upload
            </Btn>
          </div>
        </div>

        {clipboard && (
          <div className="flex items-center gap-2 mb-2 anim-fade-in" style={{ padding: '8px 14px', borderRadius: 12, background: 'rgba(var(--accent-rgb), 0.12)', border: '1px solid rgba(var(--accent-rgb), 0.3)', fontSize: 13 }}>
            <Copy size={14} color="var(--accent)" />
            <span className="flex-1 truncate">
              {clipboard.cut ? 'Dipindahkan' : 'Disalin'}: <b>{clipboard.node.name}</b>
            </span>
            <Btn size="sm" variant="primary" onClick={doPaste}>Tempel di sini</Btn>
            <button className="btn btn-ghost btn-icon" style={{ padding: 4 }} onClick={() => setClipboard(null)}>
              <X size={14} />
            </button>
          </div>
        )}

        {currentChildren.length === 0 ? (
          <EmptyState
            icon={<Upload size={34} />}
            title="Folder ini kosong"
            desc="Seret file ke sini untuk mengunggah, atau gunakan tombol di atas untuk membuat file/folder baru."
          />
        ) : (
          <div className="anim-fade-in">
            {currentChildren.map((n) => (
              <div
                key={n.id}
                className={`file-row${selectedId === n.id ? ' selected' : ''}`}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/x-node-id', n.id);
                }}
                onDragOver={(e) => {
                  if (n.type === 'folder' && e.dataTransfer.types.includes('application/x-node-id')) {
                    e.preventDefault();
                    e.currentTarget.classList.add('drop-target');
                  }
                }}
                onDragLeave={(e) => e.currentTarget.classList.remove('drop-target')}
                onDrop={(e) => {
                  e.currentTarget.classList.remove('drop-target');
                  const dragId = e.dataTransfer.getData('application/x-node-id');
                  if (dragId && dragId !== n.id && n.type === 'folder') {
                    e.preventDefault();
                    e.stopPropagation();
                    moveNode(dragId, n.id);
                  }
                }}
                onClick={() => setSelectedId(n.id)}
                onDoubleClick={() => openNode(n)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setSelectedId(n.id);
                  setMenu({ x: e.clientX, y: e.clientY, node: n });
                }}
              >
                <NodeIcon type={n.type} name={n.name} size={19} />
                <span className="truncate" style={{ fontSize: 14 }}>{n.name}</span>
                {n.is_favorite === 1 && <Star size={13} color="var(--warning)" fill="var(--warning)" />}
                <div className="file-meta">
                  <span className="date-col">{formatDateTime(n.updated_at)}</span>
                  <span style={{ minWidth: 64, textAlign: 'right' }}>{n.type === 'file' ? formatBytes(n.size_bytes) : '—'}</span>
                  <button
                    className="btn btn-icon"
                    style={{ width: 32, height: 32, minWidth: 32, marginLeft: 12 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      const rect = (e.target as HTMLElement).getBoundingClientRect();
                      setSelectedId(n.id);
                      setMenu({ x: rect.right - 140, y: rect.bottom + 4, node: n });
                    }}
                  >
                    <MoreVertical size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* hidden inputs */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files || []).map((f) => ({ file: f }));
          if (files.length && repoId) uploader.addFiles(files, repoId, currentFolder);
          e.target.value = '';
        }}
      />
      <input
        ref={folderInputRef}
        type="file"
        hidden
        // @ts-expect-error non-standard attr
        webkitdirectory=""
        onChange={(e) => {
          const files = Array.from(e.target.files || []).map((f) => ({
            file: f,
            relativePath: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name,
          }));
          if (files.length && repoId) uploader.addFiles(files, repoId, currentFolder);
          e.target.value = '';
        }}
      />

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menu.node ? nodeMenuItems(menu.node) : bgMenuItems()}
          onClose={() => setMenu(null)}
        />
      )}

      <Modal open={!!newItemType} onClose={() => setNewItemType(null)} title={newItemType === 'folder' ? 'Folder Baru' : 'File Baru'}>
        <form onSubmit={createItem} className="flex flex-col gap-3">
          <input
            className="input"
            value={newItemName}
            onChange={(e) => setNewItemName(e.target.value)}
            placeholder={newItemType === 'folder' ? 'nama-folder' : 'nama-file.txt'}
            autoFocus
            required
          />
          <div className="flex gap-2 justify-between">
            <Btn type="button" variant="ghost" onClick={() => setNewItemType(null)}>Batal</Btn>
            <Btn type="submit" variant="primary" loading={busy}>Buat</Btn>
          </div>
        </form>
      </Modal>

      <Modal open={!!renameTarget} onClose={() => setRenameTarget(null)} title="Ubah Nama">
        <form onSubmit={doRename} className="flex flex-col gap-3">
          <input className="input" value={renameValue} onChange={(e) => setRenameValue(e.target.value)} autoFocus required />
          <div className="flex gap-2 justify-between">
            <Btn type="button" variant="ghost" onClick={() => setRenameTarget(null)}>Batal</Btn>
            <Btn type="submit" variant="primary" loading={busy}>Simpan</Btn>
          </div>
        </form>
      </Modal>

      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Hapus ke Trash?" desc={`"${deleteTarget?.name}" akan dipindahkan ke Trash dan dapat dipulihkan dalam 30 hari.`}>
        <div className="flex gap-2 justify-between">
          <Btn variant="ghost" onClick={() => setDeleteTarget(null)}>Batal</Btn>
          <Btn variant="danger" loading={busy} onClick={doDelete}><Trash2 size={15} /> Hapus</Btn>
        </div>
      </Modal>

      {shareTarget && (
        <ShareModal open onClose={() => setShareTarget(null)} targetType="node" targetId={shareTarget.id} targetName={shareTarget.name} />
      )}
      {previewTarget && <PreviewModal node={previewTarget} onClose={() => setPreviewTarget(null)} />}
      {propsTarget && <PropertiesModal nodeId={propsTarget.id} onClose={() => setPropsTarget(null)} />}
    </div>
  );
}
