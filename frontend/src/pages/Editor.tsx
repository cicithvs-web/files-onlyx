import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { searchKeymap, highlightSelectionMatches, openSearchPanel } from '@codemirror/search';
import { bracketMatching, indentOnInput, foldGutter, foldKeymap, syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { closeBrackets, closeBracketsKeymap, autocompletion, completionKeymap } from '@codemirror/autocomplete';
import { tags } from '@lezer/highlight';
import { javascript } from '@codemirror/lang-javascript';
import { html as htmlLang } from '@codemirror/lang-html';
import { css as cssLang } from '@codemirror/lang-css';
import { json as jsonLang } from '@codemirror/lang-json';
import { markdown as mdLang } from '@codemirror/lang-markdown';
import { xml as xmlLang } from '@codemirror/lang-xml';
import { yaml as yamlLang } from '@codemirror/lang-yaml';
import { marked } from 'marked';
import {
  ArrowLeft, Save, Download, Eye, EyeOff, Search as SearchIcon, ListTree, WrapText,
} from 'lucide-react';
import { api, apiRaw, API_URL, formatBytes } from '../services/api';
import { useToast } from '../hooks/useToast';
import { Btn, Spinner, extOf } from '../components/ui';
import type { FileNode } from '../types';

const editorTheme = EditorView.theme(
  {
    '&': { backgroundColor: 'transparent', color: 'var(--text-0)' },
    '.cm-gutters': { backgroundColor: 'rgba(0,0,0,0.22)', color: 'var(--text-2)', border: 'none' },
    '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,0.035)' },
    '.cm-activeLineGutter': { backgroundColor: 'rgba(255,255,255,0.05)' },
    '.cm-selectionBackground, ::selection': { backgroundColor: 'rgba(124,108,240,0.28) !important' },
    '.cm-cursor': { borderLeftColor: 'var(--accent)' },
    '.cm-content': { fontFamily: "'JetBrains Mono', 'Fira Code', monospace", caretColor: 'var(--accent)' },
    '.cm-panels': { backgroundColor: 'var(--bg-3)', color: 'var(--text-0)' },
    '.cm-panels input': { background: 'rgba(0,0,0,0.3)', color: 'var(--text-0)', border: '1px solid var(--glass-border)', borderRadius: '6px' },
    '.cm-panels button': { color: 'var(--text-0)' },
    '.cm-searchMatch': { backgroundColor: 'rgba(240,179,92,0.3)' },
    '.cm-searchMatch-selected': { backgroundColor: 'rgba(240,179,92,0.55)' },
  },
  { dark: true }
);

const highlight = HighlightStyle.define([
  { tag: tags.keyword, color: '#c792ea' },
  { tag: tags.string, color: '#5ecf9a' },
  { tag: tags.number, color: '#f0b35c' },
  { tag: tags.comment, color: '#5b617a', fontStyle: 'italic' },
  { tag: tags.function(tags.variableName), color: '#4cc9f0' },
  { tag: tags.definition(tags.variableName), color: '#8ab4f8' },
  { tag: tags.typeName, color: '#f072b6' },
  { tag: tags.propertyName, color: '#8ab4f8' },
  { tag: tags.tagName, color: '#f26d7d' },
  { tag: tags.attributeName, color: '#f0b35c' },
  { tag: tags.heading, color: '#4cc9f0', fontWeight: 'bold' },
  { tag: tags.link, color: 'var(--accent)' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strong, fontWeight: 'bold' },
  { tag: tags.operator, color: '#89ddff' },
  { tag: tags.bool, color: '#f0b35c' },
  { tag: tags.null, color: '#f0b35c' },
]);

function langFor(name: string): Extension | null {
  const ext = extOf(name);
  if (['js', 'jsx', 'mjs', 'cjs'].includes(ext)) return javascript();
  if (['ts', 'tsx'].includes(ext)) return javascript({ typescript: true, jsx: ext === 'tsx' });
  if (['html', 'htm'].includes(ext)) return htmlLang();
  if (['css', 'scss'].includes(ext)) return cssLang();
  if (ext === 'json') return jsonLang();
  if (['md', 'markdown'].includes(ext)) return mdLang();
  if (['xml', 'svg'].includes(ext)) return xmlLang();
  if (['yaml', 'yml'].includes(ext)) return yamlLang();
  return null;
}

interface OutlineEntry {
  label: string;
  line: number;
  depth: number;
}

function extractOutline(content: string, name: string): OutlineEntry[] {
  const ext = extOf(name);
  const lines = content.split('\n');
  const out: OutlineEntry[] = [];
  if (['md', 'markdown'].includes(ext)) {
    lines.forEach((l, i) => {
      const m = l.match(/^(#{1,6})\s+(.+)/);
      if (m) out.push({ label: m[2].trim(), line: i + 1, depth: m[1].length - 1 });
    });
  } else if (['js', 'jsx', 'ts', 'tsx', 'py'].includes(ext)) {
    lines.forEach((l, i) => {
      const fn = l.match(/^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)/) ||
        l.match(/^\s*(?:export\s+)?(?:const|let)\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?\(/) ||
        l.match(/^\s*(?:export\s+)?class\s+([A-Za-z0-9_$]+)/) ||
        l.match(/^\s*def\s+([A-Za-z0-9_]+)/) ||
        l.match(/^\s*class\s+([A-Za-z0-9_]+)/);
      if (fn) out.push({ label: fn[1], line: i + 1, depth: Math.floor((l.match(/^\s*/)?.[0].length || 0) / 2) });
    });
  }
  return out.slice(0, 200);
}

export default function Editor() {
  const { repoId, nodeId } = useParams<{ repoId: string; nodeId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [node, setNode] = useState<FileNode | null>(null);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showOutline, setShowOutline] = useState(false);
  const [wrap, setWrap] = useState(true);
  const [cursor, setCursor] = useState({ line: 1, col: 1 });
  const [charCount, setCharCount] = useState(0);
  const [previewContent, setPreviewContent] = useState('');

  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const contentRef = useRef('');
  const dirtyRef = useRef(false);

  const ext = node ? extOf(node.name) : '';
  const isMd = ['md', 'markdown'].includes(ext);
  const isHtml = ['html', 'htm'].includes(ext);
  const canPreview = isMd || isHtml;

  const outline = useMemo(
    () => (showOutline && node ? extractOutline(contentRef.current, node.name) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [showOutline, node, charCount]
  );

  const save = useCallback(async () => {
    if (!nodeId || !dirtyRef.current) return;
    setSaving(true);
    try {
      const content = viewRef.current?.state.doc.toString() ?? contentRef.current;
      await api<{ size_bytes: number }>(`/api/nodes/${nodeId}/content`, {
        method: 'PUT',
        rawBody: content,
        headers: { 'Content-Type': 'text/plain' },
      });
      dirtyRef.current = false;
      setDirty(false);
      toast('File berhasil disimpan', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal menyimpan', 'error');
    } finally {
      setSaving(false);
    }
  }, [nodeId, toast]);

  useEffect(() => {
    if (!nodeId) return;
    let destroyed = false;

    (async () => {
      try {
        const tree = await api<{ nodes: FileNode[] }>(`/api/nodes/repo/${repoId}/tree`);
        const found = tree.nodes.find((n) => n.id === nodeId);
        if (!found) throw new Error('File tidak ditemukan');
        if (destroyed) return;
        setNode(found);

        const res = await apiRaw(`/api/nodes/${nodeId}/content`);
        const text = await res.text();
        if (destroyed) return;
        contentRef.current = text;
        setCharCount(text.length);
        if (['md', 'markdown', 'html', 'htm'].includes(extOf(found.name))) setPreviewContent(text);
        setLoading(false);
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Gagal memuat file', 'error');
        navigate(`/app/repos/${repoId}`);
      }
    })();

    return () => {
      destroyed = true;
    };
  }, [nodeId, repoId, navigate, toast]);

  // init CodeMirror after content loaded
  useEffect(() => {
    if (loading || !node || !editorRef.current) return;
    const lang = langFor(node.name);
    const extensions: Extension[] = [
      lineNumbers(),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      drawSelection(),
      history(),
      foldGutter(),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      autocompletion(),
      highlightSelectionMatches(),
      syntaxHighlighting(highlight),
      editorTheme,
      keymap.of([
        {
          key: 'Mod-s',
          run: () => {
            save();
            return true;
          },
        },
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...searchKeymap,
        ...historyKeymap,
        ...foldKeymap,
        ...completionKeymap,
        indentWithTab,
      ]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          dirtyRef.current = true;
          setDirty(true);
          const text = update.state.doc.toString();
          contentRef.current = text;
          setCharCount(text.length);
          setPreviewContent(text);
        }
        if (update.selectionSet || update.docChanged) {
          const pos = update.state.selection.main.head;
          const line = update.state.doc.lineAt(pos);
          setCursor({ line: line.number, col: pos - line.from + 1 });
        }
      }),
    ];
    if (wrap) extensions.push(EditorView.lineWrapping);
    if (lang) extensions.push(lang);

    const state = EditorState.create({ doc: contentRef.current, extensions });
    const view = new EditorView({ state, parent: editorRef.current });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, node, wrap]);

  // warn on unsaved changes
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  const mdHtml = useMemo(() => {
    if (!isMd || !showPreview) return '';
    try {
      return marked.parse(previewContent, { async: false }) as string;
    } catch {
      return '<p>Gagal merender markdown</p>';
    }
  }, [isMd, showPreview, previewContent]);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
        <Spinner size={32} />
      </div>
    );
  }

  return (
    <div className="editor-layout">
      <div className="editor-toolbar">
        <Btn variant="ghost" size="icon" onClick={() => navigate(`/app/repos/${repoId}${node?.parent_id ? `?folder=${node.parent_id}` : ''}`)} data-tooltip="Kembali">
          <ArrowLeft size={17} />
        </Btn>
        <div className="flex items-center gap-2" style={{ minWidth: 0 }}>
          <span className="font-semibold truncate" style={{ fontSize: 14 }}>{node?.name}</span>
          {dirty && <span className="badge warning">Belum disimpan</span>}
        </div>
        <div className="flex-1" />
        <Btn variant="ghost" size="sm" onClick={() => viewRef.current && openSearchPanel(viewRef.current)} data-tooltip="Cari & ganti (Ctrl+F)">
          <SearchIcon size={15} />
        </Btn>
        <Btn variant="ghost" size="sm" onClick={() => setWrap(!wrap)} data-tooltip={wrap ? 'Matikan word wrap' : 'Aktifkan word wrap'}>
          <WrapText size={15} style={{ opacity: wrap ? 1 : 0.45 }} />
        </Btn>
        <Btn variant="ghost" size="sm" onClick={() => setShowOutline(!showOutline)} data-tooltip="Outline">
          <ListTree size={15} style={{ opacity: showOutline ? 1 : 0.45 }} />
        </Btn>
        {canPreview && (
          <Btn variant="ghost" size="sm" onClick={() => setShowPreview(!showPreview)}>
            {showPreview ? <EyeOff size={15} /> : <Eye size={15} />}
            Preview
          </Btn>
        )}
        <Btn variant="ghost" size="sm" onClick={() => window.open(`${API_URL}/api/nodes/${nodeId}/download`, '_blank')} data-tooltip="Download">
          <Download size={15} />
        </Btn>
        <Btn variant="primary" size="sm" loading={saving} onClick={save} disabled={!dirty}>
          <Save size={15} /> Simpan
        </Btn>
      </div>

      <div className="editor-body">
        <div className="editor-pane" style={{ display: showPreview && window.innerWidth < 780 ? 'none' : 'flex' }}>
          <div ref={editorRef} style={{ flex: 1, overflow: 'auto' }} />
        </div>

        {showPreview && isMd && (
          <div className="preview-pane dark-preview">
            <div className="markdown-body" dangerouslySetInnerHTML={{ __html: mdHtml }} />
          </div>
        )}
        {showPreview && isHtml && (
          <div className="preview-pane">
            <iframe title="Preview" sandbox="allow-scripts" srcDoc={previewContent} />
          </div>
        )}

        {showOutline && (
          <div className="outline-panel">
            <div className="text-dim text-xs font-semibold mb-2" style={{ padding: '0 8px', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Outline
            </div>
            {outline.length === 0 ? (
              <p className="text-dim text-xs" style={{ padding: '0 8px' }}>Tidak ada simbol terdeteksi.</p>
            ) : (
              outline.map((o, i) => (
                <div
                  key={i}
                  className="outline-item"
                  style={{ paddingLeft: 8 + o.depth * 12 }}
                  onClick={() => {
                    const view = viewRef.current;
                    if (!view) return;
                    const line = view.state.doc.line(Math.min(o.line, view.state.doc.lines));
                    view.dispatch({ selection: { anchor: line.from }, scrollIntoView: true });
                    view.focus();
                  }}
                >
                  {o.label}
                </div>
              ))
            )}
          </div>
        )}
      </div>

      <div className="editor-statusbar">
        <span>Baris {cursor.line}, Kolom {cursor.col}</span>
        <span>{charCount.toLocaleString('id-ID')} karakter</span>
        <span>{formatBytes(new Blob([contentRef.current]).size)}</span>
        <span className="flex-1" />
        <span>{ext ? ext.toUpperCase() : 'TXT'}</span>
        <span>UTF-8</span>
      </div>
    </div>
  );
}
