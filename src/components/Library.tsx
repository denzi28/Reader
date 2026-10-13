import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FOLDER_COLORS, folderColor, liveFolders, MAX_FOLDER_NAME } from '../lib/folders';
import { matchRanges, searchTerms } from '../lib/search';
import {
  adoptGuestDocs, createFolder, currentSpace, deleteDoc, deleteFolder, getFolderLog, guestDocs,
  getMarkCounts, listDocs, moveDocs, patchMeta, renameFolder, setFolderColor,
} from '../lib/storage';
import { downloadPdf } from '../lib/sync/engine';
import { useDownloadProgress, useSyncStatus } from '../lib/sync/useSync';
import type { DocMeta, Folder } from '../lib/types';
import {
  ArrowIcon, BackIcon, BooksIcon, GridIcon, ListIcon, MarkIcon, StarIcon, CheckIcon, CloseIcon, CloudIcon, FileIcon, FolderIcon, FolderMoveIcon, FolderPlusIcon, MoonIcon, PencilIcon, SearchIcon, SunIcon,
  TrashIcon, UploadIcon,
} from './icons';
import { SyncControl } from './SyncControl';

interface Props {
  dark: boolean;
  onTheme: () => void;
  onOpen: (id: string, page?: number) => void;
  onImport: (files: File[], into: string | null) => Promise<void>;
  /** The folder being looked at; null is the whole shelf. */
  folder: string | null;
  onFolder: (id: string | null) => void;
  busy: boolean;
  error: string | null;
  onDismissError: () => void;
}

const formatSize = (bytes: number) =>
  bytes > 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`;

function ago(ts: number) {
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

// Each shelf refresh reads the covers afresh from storage; keeping one picture
// address per cover means the browser decodes each cover only once.
const coverUrls = new Map<string, string>();
function coverUrl(meta: DocMeta) {
  const thumb = meta.thumb;
  if (!thumb) return undefined;
  const key = `${meta.id}:${thumb.size}:${thumb.type}`;
  let url = coverUrls.get(key);
  if (!url) {
    url = URL.createObjectURL(thumb);
    coverUrls.set(key, url);
  }
  return url;
}

function Cover({ meta }: { meta: DocMeta }) {
  const url = coverUrl(meta);
  return url ? (
    <img src={url} alt="" draggable={false} decoding="async" loading="lazy" />
  ) : (
    <span className="cover-fallback"><FileIcon /></span>
  );
}

type SortBy = 'opened' | 'added' | 'name' | 'progress';
const SORTS: { id: SortBy; label: string }[] = [
  { id: 'opened', label: 'Recently opened' },
  { id: 'added', label: 'Recently added' },
  { id: 'name', label: 'Name' },
  { id: 'progress', label: 'Progress' },
];
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
function sortDocs(list: DocMeta[], by: SortBy) {
  const out = [...list];
  if (by === 'added') out.sort((a, b) => b.addedAt - a.addedAt);
  else if (by === 'name') out.sort((a, b) => collator.compare(a.name, b.name));
  else if (by === 'progress') out.sort((a, b) => progressOf(b) - progressOf(a) || b.openedAt - a.openedAt);
  return out; // 'opened': already newest first
}

/** A remembered setting on this device (falls back quietly if storage is off). */
function usePref<T extends string>(key: string, initial: T, allowed: readonly T[]) {
  const [value, setValue] = useState<T>(() => {
    try {
      const v = localStorage.getItem(key) as T | null;
      return v && allowed.includes(v) ? v : initial;
    } catch {
      return initial;
    }
  });
  const update = (v: T) => {
    setValue(v);
    try { localStorage.setItem(key, v); } catch { /* ignore */ }
  };
  return [value, update] as const;
}

function greeting(now = new Date()) {
  const h = now.getHours();
  return h < 5 ? 'Good evening' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

/** How far through a document the reader is (0 to 1), from the page last read. */
const progressOf = (d: DocMeta) => (d.pages > 1 ? Math.min(1, d.lastPage / (d.pages - 1)) : 0);
const percent = (d: DocMeta) => Math.round(progressOf(d) * 100);

/** A thin bar showing how much of a document has been read. */
function Progress({ doc, className = '' }: { doc: DocMeta; className?: string }) {
  const p = progressOf(doc);
  if (p <= 0) return null;
  return (
    <span className={`progress ${className}`} title={`Page ${doc.lastPage + 1} of ${doc.pages}`}>
      <span style={{ width: `${Math.max(3, p * 100)}%` }} />
    </span>
  );
}

// The notes page reads PDFs, so it comes with the PDF engine, when first opened.
const Notes = lazy(() => import('./Notes').then((m) => ({ default: m.Notes })));
// The shelf's tab, kept while the app is open (coming back from a document).
let lastTab: 'shelf' | 'notes' = 'shelf';

const DOC_TYPE = 'application/x-reader-doc';
/** When the move menu is a bottom sheet; matches the media query in styles.css. */
const SHEET_MEDIA = '(max-width: 520px), (hover: none) and (pointer: coarse)';
// Kept while the app is open, so coming back from a document shows the results.
let lastQuery = '';

/** `text` with the matched parts marked. */
function Marked({ text, ranges }: { text: string; ranges: [number, number][] | null }) {
  if (!ranges?.length) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  let at = 0;
  for (const [a, b] of ranges) {
    if (a > at) parts.push(text.slice(at, a));
    parts.push(<mark key={a}>{text.slice(a, b)}</mark>);
    at = b;
  }
  parts.push(text.slice(at));
  return <>{parts}</>;
}
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** A one-line text field that saves on Enter or when it loses focus. */
function NameField({ initial = '', label, onSave, onCancel }: {
  initial?: string;
  label: string;
  onSave: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const done = useRef(false);
  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    if (save && value.trim()) onSave(value);
    else onCancel();
  };
  return (
    <form className="name-field" onSubmit={(e) => { e.preventDefault(); finish(true); }}>
      <input
        autoFocus
        value={value}
        maxLength={MAX_FOLDER_NAME}
        aria-label={label}
        placeholder={label}
        enterKeyHint="done"
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => finish(true)}
        onKeyDown={(e) => { if (e.key === 'Escape') finish(false); }}
        onFocus={(e) => e.currentTarget.select()}
      />
    </form>
  );
}

/** Where a document can be moved: the shelf, any folder, or a new folder. */
function MoveMenu({ doc, folders, current, anchor, onMove, onClose }: {
  doc: DocMeta;
  /** The button that opened it; the menu hangs below it (on phones it is a sheet). */
  anchor: DOMRect;
  folders: Folder[];
  current: string | null;
  onMove: (folder: string | null) => void;
  onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [naming, setNaming] = useState(false);
  useEffect(() => {
    const away = (e: PointerEvent) => {
      const el = e.target as Element;
      // The button that opened the menu toggles it itself, and the phone
      // backdrop closes it on click, so the tap doesn't reach what's beneath.
      if (box.current?.contains(el) || el.closest?.('[aria-expanded="true"], .sheet-backdrop')) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    // The menu is placed once, so scrolling the shelf closes it. Not the phone
    // sheet: it stays put, and the keyboard opening for a new name resizes.
    const sheet = window.matchMedia(SHEET_MEDIA).matches;
    // A scroll that was already ending when the menu opened doesn't count.
    const startY = window.scrollY;
    const scroll = (e: Event) => {
      if (sheet || box.current?.contains(e.target as Node)) return;
      if (e.target !== document || Math.abs(window.scrollY - startY) > 24) onClose();
    };
    const resize = () => { if (!sheet) onClose(); };
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', key);
    window.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', resize);
    return () => {
      document.removeEventListener('pointerdown', away, true);
      document.removeEventListener('keydown', key);
      window.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', resize);
    };
  }, [onClose]);
  const option = (id: string | null, name: string, icon: React.ReactNode) => (
    <button
      key={id ?? 'shelf'}
      className={`move-option${current === id ? ' on' : ''}`}
      role="menuitemradio"
      aria-checked={current === id}
      onClick={() => (current === id ? onClose() : onMove(id))}
    >
      {icon}
      <span>{name}</span>
      {current === id && <CheckIcon />}
    </button>
  );
  const below = anchor.bottom + 6;
  const above = window.innerHeight - anchor.top + 6;
  const place: React.CSSProperties = {
    right: Math.max(8, window.innerWidth - anchor.right),
    // Open upwards when the button is low on the screen.
    ...(below > window.innerHeight * 0.55 ? { bottom: above } : { top: below }),
  };
  // Rendered at the top of the page, clear of the shelf's animated cards.
  return createPortal(
    <>
      <div className="sheet-backdrop" aria-hidden="true" onClick={onClose} />
      <div className="move-menu" ref={box} role="menu" aria-label={`Move ${doc.name}`} style={place}>
        <p className="move-title">Move “{doc.name}” to</p>
        <div className="move-list">
          {option(null, 'Shelf (no folder)', <FileIcon />)}
          {folders.map((f) => option(f.id, f.name, <FolderIcon />))}
        </div>
        {naming ? (
          <NameField
            label="New folder name"
            onSave={async (name) => onMove((await createFolder(name)).id)}
            onCancel={() => setNaming(false)}
          />
        ) : (
          <button className="move-option move-new" onClick={() => setNaming(true)}>
            <FolderPlusIcon />
            <span>New folder…</span>
          </button>
        )}
      </div>
    </>,
    document.body,
  );
}

export function Library(props: Props) {
  const { dark, onTheme, onOpen, onImport, busy, error, onDismissError, folder, onFolder } = props;
  const [docs, setDocs] = useState<DocMeta[] | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [dragging, setDragging] = useState(false);
  const [fetching, setFetching] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const downloaded = useDownloadProgress(fetching);
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [coloring, setColoring] = useState(false);
  const colorBox = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!coloring) return;
    const away = (e: PointerEvent) => { if (!colorBox.current?.contains(e.target as Node)) setColoring(false); };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [coloring]);
  const [moving, setMoving] = useState<{ id: string; anchor: DOMRect } | null>(null);
  const [dropOn, setDropOn] = useState<string | null>(null);
  const [query, setQuery] = useState(lastQuery);
  const [tab, setTabState] = useState(lastTab);
  const setTab = (t: 'shelf' | 'notes') => { lastTab = t; setTabState(t); };
  const [markCounts, setMarkCounts] = useState<Map<string, number>>(new Map());
  const [sortBy, setSortBy] = usePref<SortBy>('reader.sort', 'opened', SORTS.map((x) => x.id));
  const [view, setView] = usePref<'grid' | 'list'>('reader.view', 'grid', ['grid', 'list']);
  const input = useRef<HTMLInputElement>(null);
  const searchBox = useRef<HTMLInputElement>(null);
  const sync = useSyncStatus();
  useEffect(() => { lastQuery = query; }, [query]);

  // "/" or Ctrl/Cmd+K jumps to the search box.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const typing = (e.target as Element)?.closest?.('input, textarea, [contenteditable="true"]');
      if ((e.key === '/' && !typing) || (e.key.toLowerCase() === 'k' && (e.ctrlKey || e.metaKey))) {
        e.preventDefault();
        searchBox.current?.focus();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);

  // Fetch the reader and start the PDF engine while the shelf is idle, so the
  // first document opens without waiting for either.
  useEffect(() => {
    const later = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 1200));
    later(() => {
      void import('./Viewer');
      void import('../lib/pdf').then((m) => m.warmUp());
    });
  }, []);

  const refresh = () =>
    Promise.all([listDocs(), getFolderLog()])
      .then(async ([d, log]) => {
        setDocs(d);
        setFolders(liveFolders(log));
        setMarkCounts(await getMarkCounts(d.map((x) => x.id)));
      })
      .catch(() => setDocs([]));
  useEffect(() => { void refresh(); }, [busy, sync.libraryVersion]);

  // A folder removed (here or on another device) shows the whole shelf again.
  const current = folders.find((f) => f.id === folder) ?? null;
  const live = new Set(folders.map((f) => f.id));
  const placeOf = (d: DocMeta) => (d.folder && live.has(d.folder) ? d.folder : null);
  const shown = sortDocs((docs ?? []).filter((d) => placeOf(d) === (current?.id ?? null)), sortBy);
  const starred = (docs ?? []).filter((d) => d.starred);
  const folderName = new Map(folders.map((f) => [f.id, f.name]));
  // Searching looks through every document and folder, wherever it is filed.
  const terms = searchTerms(query);
  const onNotes = !current && tab === 'notes';
  const searching = !current && !onNotes && terms.length > 0; // the search box is on the main shelf
  const docHits = searching
    ? (docs ?? []).flatMap((d) => {
      const name = matchRanges(d.name, terms);
      const inFolder = placeOf(d);
      const folderMatch = inFolder ? matchRanges(folderName.get(inFolder) ?? '', terms) : null;
      return name || folderMatch ? [{ d, name }] : [];
    })
    : [];
  const folderHits = searching
    ? folders.flatMap((f) => { const r = matchRanges(f.name, terms); return r ? [{ f, r }] : []; })
    : [];
  const counts = new Map<string, number>();
  const inFolder = new Map<string, DocMeta[]>(); // newest opened first, like the shelf
  for (const d of docs ?? []) {
    const f = placeOf(d);
    if (!f) continue;
    counts.set(f, (counts.get(f) ?? 0) + 1);
    inFolder.set(f, [...(inFolder.get(f) ?? []), d]);
  }

  // Documents added on this device without an account are never uploaded on
  // their own; the signed-in person is asked first.
  const [guestCount, setGuestCount] = useState(0);
  const promptKey = `reader.guestprompt.${currentSpace()}`;
  useEffect(() => {
    let dismissed = false;
    try { dismissed = localStorage.getItem(promptKey) === '1'; } catch { /* ignore */ }
    if (!sync.connected || dismissed) return setGuestCount(0);
    void guestDocs().then((g) => setGuestCount(g.length));
  }, [sync.connected, sync.libraryVersion, promptKey]);
  const dismissGuest = () => {
    try { localStorage.setItem(promptKey, '1'); } catch { /* ignore */ }
    setGuestCount(0);
  };
  const adoptGuest = async () => {
    await adoptGuestDocs();
    setGuestCount(0);
    void refresh();
  };

  const openBook = async (d: DocMeta) => {
    if (!d.cloudOnly) return onOpen(d.id);
    // Only in Drive so far: bring the PDF to this device first.
    setFetching(d.id);
    setFetchError(null);
    try {
      await downloadPdf(d.id);
      onOpen(d.id);
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Could not download this document.');
    } finally {
      setFetching(null);
    }
  };

  const take = (files: FileList | null) => {
    if (files?.length) void onImport([...files], current?.id ?? null);
  };

  const move = async (id: string, to: string | null) => {
    setMoving(null);
    await moveDocs([id], to);
    void refresh();
  };

  // Desktop: drag a book onto a folder (or back onto "All documents").
  const isBook = (e: React.DragEvent) => e.dataTransfer.types.includes(DOC_TYPE);
  const dropTarget = (id: string | null) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!isBook(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setDropOn(id ?? 'shelf');
    },
    onDragLeave: () => setDropOn(null),
    onDrop: (e: React.DragEvent) => {
      const doc = e.dataTransfer.getData(DOC_TYPE);
      setDropOn(null);
      if (!doc) return;
      e.preventDefault();
      void move(doc, id);
    },
  });

  const totalMarks = [...markCounts.values()].reduce((a, b) => a + b, 0);
  const reading = (docs ?? []).filter((d) => progressOf(d) > 0 && progressOf(d) < 1).length;

  // The document opened most recently, ready to pick up again.
  const resume = !current && !searching && !onNotes ? docs?.[0] : undefined;

  // Files dragged in from outside can be dropped anywhere on the page.
  const dragDepth = useRef(0);
  const hasFiles = (e: React.DragEvent) => e.dataTransfer.types.includes('Files');
  const addButton = (
    <button className="button add-button" disabled={busy} onClick={() => input.current?.click()}>
      <UploadIcon />
      <span>{busy ? 'Adding…' : 'Add PDFs'}</span>
    </button>
  );

  const removeFolder = async (f: Folder) => {
    const n = counts.get(f.id) ?? 0;
    const note = n ? ` The ${plural(n, 'document', 'documents')} in it will go back to your shelf.` : '';
    if (!window.confirm(`Delete the folder “${f.name}”?${note}`)) return;
    await deleteFolder(f.id);
    onFolder(null);
    void refresh();
  };


  const folderTile = (f: Folder, i: number, marks: [number, number][] | null = null) => {
    // Up to three of its covers, fanned out, the most recent on top.
    const stack = (inFolder.get(f.id) ?? []).slice(0, 3).reverse();
    return (
      <li key={f.id} style={{ ['--i' as string]: i }}>
        <button
          className={`folder-tile c-${folderColor(f.color)}${dropOn === f.id ? ' drop' : ''}`}
          onClick={() => { setQuery(''); onFolder(f.id); }}
          {...dropTarget(f.id)}
        >
          <span className={`folder-stack n${stack.length}`} aria-hidden="true">
            {stack.length ? (
              stack.map((d, k) => (
                <span key={d.id} className={`stack-cover k${stack.length - 1 - k}`}>
                  <Cover meta={d} />
                </span>
              ))
            ) : (
              <span className="folder-tile-icon"><FolderIcon /></span>
            )}
          </span>
          <span className="folder-tile-text">
            <span className="folder-tile-name"><Marked text={f.name} ranges={marks} /></span>
            <span className="folder-tile-count">{plural(counts.get(f.id) ?? 0, 'document', 'documents')}</span>
          </span>
        </button>
      </li>
    );
  };

  /** One document on the shelf (or in the search results). */
  const book = (d: DocMeta, i: number, marks: [number, number][] | null = null, showFolder = false) => (
    <li
      key={d.id}
      className="book"
      style={{ ['--i' as string]: i }}
      draggable={folders.length > 0}
      onDragStart={(e) => {
        e.dataTransfer.setData(DOC_TYPE, d.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onDragEnd={() => setDropOn(null)}
    >
      <button
        className={`book-open${fetching === d.id ? ' fetching' : ''}`}
        onClick={() => void openBook(d)}
        disabled={fetching !== null}
      >
        <span className="cover">
          <Cover meta={d} />
          <Progress doc={d} className="cover-progress" />
          {(markCounts.get(d.id) ?? 0) > 0 && (
            <span className="cover-marks" title={plural(markCounts.get(d.id)!, 'mark', 'marks')}>
              <MarkIcon />
              {markCounts.get(d.id)}
            </span>
          )}
          {d.cloudOnly && (
            <span className="cover-cloud" title="In your Google Drive; opens after downloading">
              <CloudIcon />
              {fetching === d.id ? `Downloading${downloaded === null ? '…' : ` ${Math.round(downloaded * 100)}%`}` : 'In Drive'}
            </span>
          )}
        </span>
        <span className="book-name"><Marked text={d.name} ranges={marks} /></span>
        <span className="book-meta">
          {plural(d.pages, 'page', 'pages')} · {formatSize(d.size)} · {ago(d.openedAt)}
        </span>
        {showFolder && placeOf(d) && (
          <span className="book-folder"><FolderIcon />{folderName.get(placeOf(d)!)}</span>
        )}
      </button>
      <span className="book-tools">
        <button
          className={`book-tool star-tool${d.starred ? ' on' : ''}`}
          aria-label={d.starred ? `Unstar ${d.name}` : `Star ${d.name}`}
          aria-pressed={Boolean(d.starred)}
          title={d.starred ? 'Starred' : 'Star'}
          onClick={async () => { await patchMeta(d.id, { starred: !d.starred }); void refresh(); }}
        >
          <StarIcon />
        </button>
        <button
          className="book-tool"
          aria-label={`Move ${d.name} to a folder`}
          title="Move to a folder"
          aria-haspopup="menu"
          aria-expanded={moving?.id === d.id}
          onClick={(e) => setMoving(
            moving?.id === d.id ? null : { id: d.id, anchor: e.currentTarget.getBoundingClientRect() },
          )}
        >
          <FolderMoveIcon />
        </button>
        <button
          className="book-tool"
          aria-label={`Remove ${d.name}`}
          title="Remove from this device"
          onClick={async () => {
            if (window.confirm(`Remove “${d.name}” and its notes from this device?`)) {
              await deleteDoc(d.id);
              void refresh();
            }
          }}
        >
          <TrashIcon />
        </button>
      </span>
      {moving?.id === d.id && (
        <MoveMenu
          doc={d}
          anchor={moving.anchor}
          folders={folders}
          current={placeOf(d)}
          onMove={(to) => void move(d.id, to)}
          onClose={() => setMoving(null)}
        />
      )}
    </li>
  );

  return (
    <main
      className="library"
      onDragEnter={(e) => {
        if (!hasFiles(e)) return;
        dragDepth.current++;
        setDragging(true);
      }}
      onDragOver={(e) => { if (hasFiles(e)) e.preventDefault(); }}
      onDragLeave={(e) => {
        if (hasFiles(e) && --dragDepth.current <= 0) { dragDepth.current = 0; setDragging(false); }
      }}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        take(e.dataTransfer.files);
      }}
    >
      <header className="library-head">
        <div>
          <h1 className="brand">The Reader</h1>
          <p className="tagline">
            {docs?.length ? (
              <>
                <strong>{greeting()}{sync.name ? `, ${sync.name.split(' ')[0]}` : ''}.</strong>{' '}
                {reading > 0
                  ? `${plural(reading, 'document', 'documents')} in progress.`
                  : `${plural(docs.length, 'document', 'documents')} on your shelf.`}
              </>
            ) : (
              <>
                Read, mark up and keep your documents.{' '}
                {sync.connected ? 'Kept in step with your Google Drive.' : 'Everything stays on this device.'}
              </>
            )}
          </p>
        </div>
        <div className="library-actions">
          <SyncControl />
          <button
            className="icon-button"
            onClick={onTheme}
            aria-label={dark ? 'Switch to day paper' : 'Switch to night paper'}
          >
            {dark ? <SunIcon /> : <MoonIcon />}
          </button>
        </div>
      </header>

      {guestCount > 0 && (
        <div className="notice notice-info" role="status">
          <span>
            {guestCount === 1 ? '1 document on this device was' : `${guestCount} documents on this device were`} added
            without an account. Add {guestCount === 1 ? 'it' : 'them'} to {sync.email ?? 'your account'}?
          </span>
          <span className="notice-actions">
            <button className="button button-small" onClick={() => void adoptGuest()}>Add to my account</button>
            <button className="link" onClick={dismissGuest}>Not now</button>
          </span>
        </div>
      )}

      {(error || fetchError) && (
        <div className="notice" role="alert">
          <span>{error ?? fetchError}</span>
          <button className="link" onClick={() => { onDismissError(); setFetchError(null); }}>Dismiss</button>
        </div>
      )}

      <input
        ref={input}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        hidden
        onChange={(e) => { take(e.target.files); e.target.value = ''; }}
      />

      {!current && docs && docs.length > 0 && (
        <div className="tabs" role="tablist" aria-label="Library or notes">
          <button role="tab" aria-selected={!onNotes} className={onNotes ? '' : 'on'} onClick={() => setTab('shelf')}>
            <BooksIcon />
            Library
          </button>
          <button role="tab" aria-selected={onNotes} className={onNotes ? 'on' : ''} onClick={() => setTab('notes')}>
            <MarkIcon />
            Notes
            {totalMarks > 0 && <span className="tab-count">{totalMarks}</span>}
          </button>
        </div>
      )}

      {current ? (
        <nav className="folder-bar" aria-label="Folder">
          <button
            className={`crumb${dropOn === 'shelf' ? ' drop' : ''}`}
            onClick={() => onFolder(null)}
            {...dropTarget(null)}
          >
            <BackIcon />
            All documents
          </button>
          <div className="folder-title">
            <span className="color-wrap" ref={colorBox}>
              <button
                className={`folder-head-icon c-${folderColor(current.color)}`}
                onClick={() => setColoring((v) => !v)}
                aria-label="Folder colour"
                title="Folder colour"
                aria-expanded={coloring}
              >
                <FolderIcon />
              </button>
              {coloring && (
                <span className="color-pop" role="menu" aria-label="Folder colour">
                  {FOLDER_COLORS.map((c) => (
                    <button
                      key={c}
                      className={`color-dot c-${c}${folderColor(current.color) === c ? ' on' : ''}`}
                      role="menuitemradio"
                      aria-checked={folderColor(current.color) === c}
                      aria-label={c}
                      onClick={async () => { setColoring(false); await setFolderColor(current.id, c); void refresh(); }}
                    />
                  ))}
                </span>
              )}
            </span>
            <div className="folder-head-text">
              {renaming ? (
                <NameField
                  initial={current.name}
                  label="Folder name"
                  onSave={async (name) => { setRenaming(false); await renameFolder(current.id, name); void refresh(); }}
                  onCancel={() => setRenaming(false)}
                />
              ) : (
                <h2 className="folder-name">{current.name}</h2>
              )}
              <p className="folder-sub">{plural(shown.length, 'document', 'documents')}</p>
            </div>
            {!renaming && (
              <div className="folder-actions">
                <button className="icon-button" onClick={() => setRenaming(true)} aria-label="Rename folder" title="Rename folder">
                  <PencilIcon />
                </button>
                <button
                  className="icon-button icon-danger"
                  onClick={() => void removeFolder(current)}
                  aria-label="Delete folder"
                  title="Delete folder"
                >
                  <TrashIcon />
                </button>
                {addButton}
              </div>
            )}
          </div>
        </nav>
      ) : docs && docs.length > 0 && !onNotes && (
        <div className="shelf-bar">
          <div className={`search${query ? ' active' : ''}`} role="search">
            <SearchIcon />
            <input
              ref={searchBox}
              type="search"
              value={query}
              placeholder="Search documents and folders"
              aria-label="Search documents and folders"
              enterKeyHint="search"
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') { setQuery(''); e.currentTarget.blur(); }
                if (e.key === 'Enter') e.currentTarget.blur(); // phones: hide the keyboard
              }}
            />
            {query ? (
              <button
                className="search-clear"
                aria-label="Clear search"
                onClick={() => { setQuery(''); searchBox.current?.focus(); }}
              >
                <CloseIcon />
              </button>
            ) : (
              <kbd className="search-key" aria-hidden="true">/</kbd>
            )}
          </div>
          {addButton}
        </div>
      )}

      {resume && (
        <button
          className={`resume${fetching === resume.id ? ' fetching' : ''}`}
          onClick={() => void openBook(resume)}
          disabled={fetching !== null}
        >
          <span className="resume-cover">
            <Cover meta={resume} />
          </span>
          <span className="resume-text">
            <span className="resume-eyebrow">{resume.lastPage > 0 ? 'Continue reading' : 'Start reading'}</span>
            <span className="resume-title">{resume.name}</span>
            <span className="resume-where">
              {resume.lastPage > 0
                ? `Page ${resume.lastPage + 1} of ${resume.pages}`
                : plural(resume.pages, 'page', 'pages')}
              {placeOf(resume) && <> · <FolderIcon /> {folderName.get(placeOf(resume)!)}</>}
            </span>
            {resume.lastPage > 0 && (
              <span className="resume-progress">
                <Progress doc={resume} />
                <span>{percent(resume)}%</span>
              </span>
            )}
          </span>
          <span className="resume-go" aria-hidden="true">
            {resume.cloudOnly ? <CloudIcon /> : <ArrowIcon />}
          </span>
        </button>
      )}

      {searching && (
        <section className="results" aria-label="Search results">
          <h2 className="shelf-title" aria-live="polite">
            {docHits.length + folderHits.length
              ? `${plural(docHits.length + folderHits.length, 'result', 'results')} for “${query.trim()}”`
              : `Nothing matches “${query.trim()}”`}
          </h2>
          {folderHits.length > 0 && <ul className="folders">{folderHits.map(({ f, r }, i) => folderTile(f, i, r))}</ul>}
          {docHits.length > 0 && (
            <ul className={`shelf view-${view}`}>{docHits.map(({ d, name }, i) => book(d, i, name, true))}</ul>
          )}
          {docHits.length + folderHits.length === 0 && (
            <p className="empty-note">Try fewer letters, or another word from the title.</p>
          )}
        </section>
      )}

      {onNotes && (
        <Suspense fallback={<div className="note-loading" />}>
          <Notes
            docs={(docs ?? []).filter((d) => (markCounts.get(d.id) ?? 0) > 0)}
            folderName={(d) => (placeOf(d) ? folderName.get(placeOf(d)!) ?? null : null)}
            onOpen={(id, page) => onOpen(id, page)}
          />
        </Suspense>
      )}

      {!searching && !onNotes && (
        <>
          {docs?.length === 0 && (
            // An empty library gets a big, friendly place to start.
            <div className={`dropzone${dragging ? ' over' : ''}${busy ? ' busy' : ''}`}>
              <span className="drop-icon"><UploadIcon /></span>
              <p className="drop-title">{busy ? 'Adding to your library…' : 'Drop PDFs here'}</p>
              <button className="button" disabled={busy} onClick={() => input.current?.click()}>
                Choose files
              </button>
              <p className="drop-note">You can pick several at once. Word, Excel and PowerPoint support is coming next.</p>
            </div>
          )}

          {!current && starred.length > 0 && (
            <section aria-label="Starred">
              <div className="section-head">
                <h2 className="shelf-title"><span className="title-star"><StarIcon /></span>Starred</h2>
              </div>
              <ul className={`shelf view-${view}`}>{starred.map((d, i) => book(d, i, null, true))}</ul>
            </section>
          )}

          {!current && docs && docs.length > 0 && (
            <section className="folders-section" aria-label="Folders">
              <div className="section-head">
                <h2 className="shelf-title">Folders</h2>
                <button className="chip-button" onClick={() => setCreating(true)} disabled={creating}>
                  <FolderPlusIcon />
                  New folder
                </button>
              </div>
              {folders.length === 0 && !creating ? (
                <p className="empty-note">Group your notes by course, project or client. Create a folder, then move documents into it.</p>
              ) : (
                <ul className="folders">
                  {folders.map((f, i) => folderTile(f, i))}
                  {creating && (
                    <li className="folder-tile folder-tile-new">
                      <span className="folder-tile-icon"><FolderIcon /></span>
                      <NameField
                        label="Folder name"
                        onSave={async (name) => { setCreating(false); await createFolder(name); void refresh(); }}
                        onCancel={() => setCreating(false)}
                      />
                    </li>
                  )}
                </ul>
              )}
            </section>
          )}

          {docs && (shown.length > 0 || current) && (
            <>
              {shown.length > 1 || (!current && shown.length > 0) ? (
                <div className={`section-head${current ? ' bare' : ''}`}>
                  {!current && <h2 className="shelf-title">{folders.length ? 'Not in a folder' : 'Your shelf'}</h2>}
                  {shown.length > 1 && (
                    <span className="shelf-controls">
                      <label className="sort">
                        <span className="sr-only">Sort by</span>
                        <select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortBy)}>
                          {SORTS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                        </select>
                      </label>
                      <span className="view-toggle" role="group" aria-label="View">
                        <button className={view === 'grid' ? 'on' : ''} aria-pressed={view === 'grid'} aria-label="Grid" title="Grid" onClick={() => setView('grid')}><GridIcon /></button>
                        <button className={view === 'list' ? 'on' : ''} aria-pressed={view === 'list'} aria-label="List" title="List" onClick={() => setView('list')}><ListIcon /></button>
                      </span>
                    </span>
                  )}
                </div>
              ) : null}
              {current && shown.length === 0 && (
                <p className="empty-note empty-folder">
                  This folder is empty. Add PDFs, drop them anywhere on this page, or move documents here with
                  the folder button on each one.
                </p>
              )}
              <ul className={`shelf view-${view}`}>
                {shown.map((d, i) => book(d, i))}
              </ul>
            </>
          )}
        </>
      )}

      {dragging && (
        <div className="drop-overlay" aria-hidden="true">
          <div className="drop-overlay-card">
            <UploadIcon />
            <p>{current ? `Drop to add to “${current.name}”` : 'Drop PDFs to add them'}</p>
          </div>
        </div>
      )}
      <footer className="library-foot">
        <a href="/privacy.html">Privacy</a>
        <span aria-hidden="true">·</span>
        <a href="/terms.html">Terms</a>
      </footer>
    </main>
  );
}
