import { useEffect, useRef, type ReactNode, type MouseEvent, type ButtonHTMLAttributes } from 'react';
import {
  FileText, FileCode, FileJson, FileImage, FileVideo, FileAudio, FileArchive,
  File as FileIcon, Folder, FolderOpen, FileType, FileSpreadsheet, Loader2,
} from 'lucide-react';

/* ---------- Ripple button ---------- */
export function rippleEffect(e: MouseEvent<HTMLElement>) {
  const el = e.currentTarget;
  const rect = el.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height) * 2; // Diameter of ripple circle
  const span = document.createElement('span');
  span.className = 'ripple';
  span.style.width = span.style.height = `${size}px`;
  span.style.left = `${e.clientX - rect.left - size / 2}px`;
  span.style.top = `${e.clientY - rect.top - size / 2}px`;
  span.style.zIndex = '0';
  el.appendChild(span);
  setTimeout(() => span.remove(), 650);
}

interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'primary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg' | 'icon';
  loading?: boolean;
}

export function Btn({ variant = 'default', size = 'md', loading, children, className = '', onClick, disabled, ...rest }: BtnProps) {
  const cls = [
    'btn',
    variant === 'primary' && 'btn-primary',
    variant === 'danger' && 'btn-danger',
    variant === 'ghost' && 'btn-ghost',
    size === 'sm' && 'btn-sm',
    size === 'lg' && 'btn-lg',
    size === 'icon' && 'btn-icon',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button
      className={cls}
      disabled={disabled || loading}
      onClick={(e) => {
        rippleEffect(e);
        onClick?.(e);
      }}
      {...rest}
    >
      {loading && <Loader2 size={15} className="spin" style={{ animation: 'spin 0.9s linear infinite' }} />}
      {children}
    </button>
  );
}

/* ---------- Modal ---------- */
export function Modal({
  open, onClose, title, desc, children, wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  desc?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? ' wide' : ''}`}>
        <div className="modal-title">{title}</div>
        {desc && <div className="modal-desc">{desc}</div>}
        {children}
      </div>
    </div>
  );
}

/* ---------- Context menu ---------- */
export interface CtxMenuItem {
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  sep?: boolean;
  onClick?: () => void;
}

export function ContextMenu({
  x, y, items, onClose,
}: {
  x: number;
  y: number;
  items: CtxMenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = () => onClose();
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', esc);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', esc);
      window.removeEventListener('blur', close);
    };
  }, [onClose]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.right > window.innerWidth) el.style.left = `${Math.max(4, x - rect.width)}px`;
    if (rect.bottom > window.innerHeight) el.style.top = `${Math.max(4, y - rect.height)}px`;
  }, [x, y]);

  return (
    <div ref={ref} className="context-menu" style={{ left: x, top: y }} onMouseDown={(e) => e.stopPropagation()}>
      {items.map((item, i) =>
        item.sep ? (
          <div key={i} className="context-menu-sep" />
        ) : (
          <div
            key={i}
            className={`context-menu-item${item.danger ? ' danger' : ''}`}
            onClick={() => {
              item.onClick?.();
              onClose();
            }}
          >
            {item.icon}
            {item.label}
          </div>
        )
      )}
    </div>
  );
}

/* ---------- Empty state ---------- */
export function EmptyState({ icon, title, desc, action }: { icon: ReactNode; title: string; desc?: string; action?: ReactNode }) {
  return (
    <div className="empty-state anim-fade-up">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      {desc && <p>{desc}</p>}
      {action}
    </div>
  );
}

/* ---------- Spinner ---------- */
export function Spinner({ size = 22 }: { size?: number }) {
  return <Loader2 size={size} style={{ animation: 'spin 0.9s linear infinite', color: 'var(--accent)' }} />;
}

/* ---------- Skeleton rows ---------- */
export function SkeletonRows({ count = 5, height = 44 }: { count?: number; height?: number }) {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="skeleton" style={{ height, opacity: 1 - i * 0.13 }} />
      ))}
    </div>
  );
}

/* ---------- File icon by extension ---------- */
const codeExts = new Set(['js', 'jsx', 'ts', 'tsx', 'py', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'cs', 'php', 'rb', 'swift', 'kt', 'sh', 'bash', 'sql', 'vue', 'svelte']);
const imgExts = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp', 'avif']);
const videoExts = new Set(['mp4', 'webm', 'mkv', 'avi', 'mov']);
const audioExts = new Set(['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac']);
const archiveExts = new Set(['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz']);
const docExts = new Set(['doc', 'docx', 'pdf', 'odt', 'rtf']);
const sheetExts = new Set(['xls', 'xlsx', 'csv', 'ods']);

export function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1).toLowerCase() : '';
}

export function NodeIcon({ type, name, open, size = 18 }: { type: 'file' | 'folder'; name: string; open?: boolean; size?: number }) {
  if (type === 'folder') {
    return open ? <FolderOpen size={size} color="var(--accent)" /> : <Folder size={size} color="var(--accent)" />;
  }
  const ext = extOf(name);
  if (ext === 'json') return <FileJson size={size} color="#f0b35c" />;
  if (ext === 'md' || ext === 'txt') return <FileText size={size} color="#8ab4f8" />;
  if (ext === 'html' || ext === 'htm' || ext === 'css' || ext === 'scss') return <FileCode size={size} color="#f072b6" />;
  if (codeExts.has(ext)) return <FileCode size={size} color="#5ecf9a" />;
  if (imgExts.has(ext)) return <FileImage size={size} color="#4cc9f0" />;
  if (videoExts.has(ext)) return <FileVideo size={size} color="#f26d7d" />;
  if (audioExts.has(ext)) return <FileAudio size={size} color="#c792ea" />;
  if (archiveExts.has(ext)) return <FileArchive size={size} color="#f0b35c" />;
  if (docExts.has(ext)) return <FileType size={size} color="#8ab4f8" />;
  if (sheetExts.has(ext)) return <FileSpreadsheet size={size} color="#5ecf9a" />;
  return <FileIcon size={size} color="var(--text-1)" />;
}

export const isTextExt = (name: string): boolean => {
  const ext = extOf(name);
  return (
    codeExts.has(ext) ||
    ['md', 'txt', 'json', 'html', 'htm', 'css', 'scss', 'xml', 'yaml', 'yml', 'toml', 'ini', 'env', 'csv', 'log', 'svg', 'gitignore', 'conf', 'cfg', 'lock', 'editorconfig'].includes(ext) ||
    !name.includes('.')
  );
};

export const isImageExt = (name: string): boolean => imgExts.has(extOf(name));
export const isVideoExt = (name: string): boolean => videoExts.has(extOf(name));
export const isAudioExt = (name: string): boolean => audioExts.has(extOf(name));
export const isPdfExt = (name: string): boolean => extOf(name) === 'pdf';
