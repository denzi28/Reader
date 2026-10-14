import { IMPORT_ACCEPT } from '../lib/fileTypes';
import { count as plural, t } from '../lib/i18n';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FOLDER_COLORS, folderColor, liveFolders, MAX_FOLDER_NAME } from '../lib/folders';
import { matchRanges, searchTerms } from '../lib/search';
import {
  adoptGuestDocs, createFolder, currentSpace, deleteDoc, deleteFolder, getFolderLog, guestDocs,
  getMarkCounts, listDocs, moveDocs, patchMeta, renameFolder, setFolderColor,
} from '../lib/storage';
import { openPaywall, PlanLimit } from '../lib/plan';
import { downloadPdf } from '../lib/sync/engine';
import { useDownloadProgress, useSyncStatus } from '../lib/sync/useSync';
import type { DocMeta, Folder } from '../lib/types';
import {
  ArrowIcon, BackIcon, BookOpenIcon, CloudOffIcon, DownloadIcon, GridIcon, ListIcon, MarkIcon, StarIcon, CheckIcon, CloseIcon, CloudIcon, FileIcon, FolderIcon, FolderMoveIcon, FolderPlusIcon, PencilIcon, SearchIcon,
  MoreVIcon, SortIcon, TrashIcon, UploadIcon,
} from './icons';
import { AddSheet, BookSheet, MePage, PhoneNav, type PhoneTab, ToolsPage } from './PhoneParts';
import { TopBar } from './TopBar';
import { Intro, introSeen, markIntroSeen } from './Intro';
import { Wordmark } from './Wordmark';
import { AccountMenu } from './SyncControl';
import { usePhone } from '../lib/usePhone';
import { Cover } from './Cover';
import type { NoteKind, NotebookSpec } from '../lib/notebookSpec';
import { DownloadDialog } from './DownloadDialog';
import { NewNote } from './NewNote';
import type { ToolId } from './toolList';

interface Props {
  dark: boolean;
  onTheme: () => void;
  onOpen: (id: string, page?: number, view?: 'book' | 'pdf') => void;
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
  if (mins < 1) return t('just now');
  if (mins < 60) return t('{n} min ago', { n: mins });
  const hours = Math.round(mins / 60);
  if (hours < 24) return t('{n} h ago', { n: hours });
  const days = Math.round(hours / 24);
  return days === 1 ? t('yesterday') : t('{n} days ago', { n: days });
}


type SortBy = 'opened' | 'added' | 'name' | 'progress';
const SORTS: { id: SortBy; label: string }[] = [
  { id: 'opened', label: t('Recently opened') },
  { id: 'added', label: t('Recently added') },
  { id: 'name', label: t('Name') },
  { id: 'progress', label: t('Progress') },
];
const SORT_TITLES: Record<SortBy, string> = { opened: t('Recent'), added: t('Newest'), name: t('A to Z'), progress: t('In progress') };
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
function sortDocs(list: DocMeta[], by: SortBy) {
  const out = [...list];
  if (by === 'added') out.sort((a, b) => b.addedAt - a.addedAt);
  else if (by === 'name') out.sort((a, b) => collator.compare(a.name, b.name));
  else if (by === 'progress') out.sort((a, b) => progressOf(b) - progressOf(a) || b.openedAt - a.openedAt);
  return out; // 'opened': already newest first
}

const COLOUR_NAMES: Record<(typeof FOLDER_COLORS)[number], string> = {
  amber: t('Amber'), blue: t('Blue'), green: t('Green'), red: t('Red'), purple: t('Purple'), teal: t('Teal'), gold: t('Gold'),
};

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


/** How far through a document the reader is (0 to 1), from the page last read. */
const progressOf = (d: DocMeta) => (d.pages > 1 ? Math.min(1, d.lastPage / (d.pages - 1)) : 0);
const percent = (d: DocMeta) => Math.round(progressOf(d) * 100);

/** A thin bar showing how much of a document has been read. */
function Progress({ doc, className = '' }: { doc: DocMeta; className?: string }) {
  const p = progressOf(doc);
  if (p <= 0) return null;
  return (
    <span className={`progress ${className}`} title={t('Page {page} of {total}', { page: doc.lastPage + 1, total: doc.pages })}>
      <span style={{ width: `${Math.max(3, p * 100)}%` }} />
    </span>
  );
}

// The notes page reads PDFs, so it comes with the PDF engine, when first opened.
const Notes = lazy(() => import('./Notes').then((m) => ({ default: m.Notes })));
// The PDF tools (merge, split, crop, edit) and their library come on first use.
const PdfTools = lazy(() => import('./PdfTools'));
// The shelf's tab, kept while the app is open (coming back from a document).
let lastTab: PhoneTab = 'shelf';

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
function MoveMenu({ doc, folders, current, anchor, onMove, onClose, onSyncOn }: {
  doc: DocMeta;
  /** For a document kept off Drive: start syncing it. */
  onSyncOn?: () => void;
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
      <div className="move-menu" ref={box} role="menu" aria-label={t('Move {name}', { name: doc.name })} style={place}>
        <p className="move-title">{t('Move “{name}” to', { name: doc.name })}</p>
        <div className="move-list">
          {option(null, t('Library (no folder)'), <FileIcon />)}
          {folders.map((f) => option(f.id, f.name, <FolderIcon />))}
        </div>
        {naming ? (
          <NameField
            label={t('New folder name')}
            onSave={async (name) => onMove((await createFolder(name)).id)}
            onCancel={() => setNaming(false)}
          />
        ) : (
          <button className="move-option move-new" onClick={() => setNaming(true)}>
            <FolderPlusIcon />
            <span>{t('New folder…')}</span>
          </button>
        )}
        {onSyncOn && (
          <button className="move-option move-sync" onClick={onSyncOn}>
            <CloudOffIcon />
            <span>{t('Only on this device. Sync with Google Drive')}</span>
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
  const [newNote, setNewNote] = useState(false);
  const [intro, setIntro] = useState(false);
  const [downloading, setDownloading] = useState<DocMeta | null>(null);
  const [makingNote, setMakingNote] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [tool, setTool] = useState<ToolId | null>(null);
  const [toolStart, setToolStart] = useState<DocMeta[] | undefined>(undefined);
  const [tab, setTabState] = useState(lastTab);
  const setTab = (next: PhoneTab) => { lastTab = next; setTabState(next); };
  const phone = usePhone();
  const [searchOpen, setSearchOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [menuFor, setMenuFor] = useState<DocMeta | null>(null);
  // The phone's Tools and Me pages only exist on a phone; elsewhere the shelf is shown.
  const page: PhoneTab = !phone && tab === 'me' ? 'shelf' : tab;
  const [markCounts, setMarkCounts] = useState<Map<string, number>>(new Map());
  const [sortBy, setSortBy] = usePref<SortBy>('reader.sort', 'opened', SORTS.map((x) => x.id));
  const [view, setView] = usePref<'grid' | 'list'>('reader.view', 'grid', ['grid', 'list']);
  const input = useRef<HTMLInputElement>(null);
  const searchBox = useRef<HTMLInputElement>(null);
  const sync = useSyncStatus();
  useEffect(() => { lastQuery = query; }, [query]);
  useEffect(() => { if (searchOpen) searchBox.current?.focus(); }, [searchOpen]);

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

  // A tool is a step in the browser history, so the Back button closes it.
  useEffect(() => {
    const onPop = () => { if (!history.state?.tool) setTool(null); };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const closeTools = () => {
    setTool(null);
    // "Back to library": on a computer the tools list is a sidebar page, so go back to the shelf.
    if (!phone) setTab('shelf');
    if (history.state?.tool) history.back();
  };
  /** A tool picked on the phone's Tools page: a history step, so Back closes it. */
  const pickFromTools = (id: ToolId, start?: DocMeta[]) => {
    history.pushState({ ...history.state, tool: 1 }, '');
    setToolStart(start);
    setTool(id);
  };

  /** Makes an empty notebook (in the open folder, if any) and opens it, pen in hand. */
  const createNote = async (spec: NotebookSpec, kind: NoteKind = 'notebook') => {
    setMakingNote(true);
    setNoteError(null);
    try {
      const made = kind === 'doc'
        ? await (await import('../lib/typedNote')).createTypedNote(spec.name, current?.id)
        : await (await import('../lib/createNote')).createNotebook(spec, { folder: current?.id });
      setNewNote(false);
      void refresh();
      onOpen(made.id);
    } catch (err) {
      if (err instanceof PlanLimit) { setNewNote(false); openPaywall('docs'); return; }
      setNoteError(err instanceof Error ? err.message : t('The note could not be made.'));
    } finally {
      setMakingNote(false);
    }
  };

  // Shortcuts on the home screen (and the store listing) open a place directly: /?tab=tools, /?new=note.
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    const tab = q.get('tab');
    const make = q.get('new');
    if (!tab && !make) return;
    if (tab === 'tools' || tab === 'notes') setTab(tab);
    if (make === 'note') { setNoteError(null); setNewNote(true); }
    history.replaceState(history.state, '', location.pathname);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Someone new, with an empty library, is shown a short tour once; anyone who already has documents never is.
  useEffect(() => {
    if (!docs) return;
    if (docs.length > 0) { if (!introSeen()) markIntroSeen(); return; }
    if (introSeen()) return;
    const id = window.setTimeout(() => setIntro(true), 900);
    return () => window.clearTimeout(id);
  }, [docs]);

  // A document with a note made for one of its pages is listed in Notes too, whether or not it has marks of its own.
  const notesDocs = (() => {
    const all = docs ?? [];
    const marked = new Set(all.filter((d) => (markCounts.get(d.id) ?? 0) > 0).map((d) => d.id));
    const parents = new Set(all.filter((d) => marked.has(d.id) && d.attached).map((d) => d.attached!.doc));
    return all.filter((d) => marked.has(d.id) || parents.has(d.id));
  })();

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
  const onNotes = !current && page === 'notes';
  const onTools = !current && page === 'tools';
  const onMe = !current && page === 'me';
  const searching = !current && !onNotes && !onTools && !onMe && terms.length > 0; // the search box is on the main shelf
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

  const openBook = async (d: DocMeta, view?: 'book') => {
    if (!d.cloudOnly) return onOpen(d.id, undefined, view);
    // Only in Drive so far: bring the PDF to this device first.
    setFetching(d.id);
    setFetchError(null);
    try {
      await downloadPdf(d.id);
      onOpen(d.id, undefined, view);
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : t('Could not download this document.'));
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

  // The document opened most recently, ready to pick up again.
  const resume = !current && !searching && !onNotes && !onTools && !onMe ? docs?.[0] : undefined;

  // Files dragged in from outside can be dropped anywhere on the page.
  const dragDepth = useRef(0);
  const hasFiles = (e: React.DragEvent) => e.dataTransfer.types.includes('Files');
  const addButton = (
    <button className="button add-button" disabled={busy} onClick={() => input.current?.click()}>
      <UploadIcon />
      <span>{busy ? t('Adding…') : t('Add files')}</span>
    </button>
  );

  const removeFolder = async (f: Folder) => {
    const n = counts.get(f.id) ?? 0;
    const question = n
      ? t('Delete the folder “{name}”? The {docs} in it will go back to your library.', { name: f.name, docs: plural(n, 'document', 'documents') })
      : t('Delete the folder “{name}”?', { name: f.name });
    if (!window.confirm(question)) return;
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
          {phone && d.starred && <span className="cover-star" aria-label={t('Starred')}><StarIcon /></span>}
          {(markCounts.get(d.id) ?? 0) > 0 && (
            <span className="cover-marks" title={plural(markCounts.get(d.id)!, 'mark', 'marks')}>
              <MarkIcon />
              {markCounts.get(d.id)}
            </span>
          )}
          {d.localOnly && sync.connected && (
            <span className="cover-local" title={t('Only on this device: not synced to Google Drive')}>
              <CloudOffIcon />
            </span>
          )}
          {d.cloudOnly && (
            <span className="cover-cloud" title={t('In your Google Drive; opens after downloading')}>
              <CloudIcon />
              {fetching === d.id ? (downloaded === null ? t('Downloading…') : t('Downloading {percent}%', { percent: Math.round(downloaded * 100) })) : t('In Drive')}
            </span>
          )}
        </span>
        <span className="book-name"><Marked text={d.name} ranges={marks} /></span>
        <span className="book-meta">
          {d.kind === 'note' ? t('{n} words', { n: d.words ?? 0 }) : plural(d.pages, 'page', 'pages')} · {formatSize(d.size)} · {ago(d.openedAt)}
        </span>
        {showFolder && placeOf(d) && (
          <span className="book-folder"><FolderIcon />{folderName.get(placeOf(d)!)}</span>
        )}
      </button>
      {!d.notebook && !d.attached && d.kind !== 'note' && (
        <button className="cover-book" aria-label={t('Read {name} as a book', { name: d.name })} title={t('Read as a book')} disabled={fetching !== null} onClick={() => void openBook(d, 'book')}>
          <BookOpenIcon />
        </button>
      )}
      {phone && (
        <button className="book-more" aria-label={t('Actions for {name}', { name: d.name })} aria-haspopup="dialog" onClick={() => setMenuFor(d)}><MoreVIcon /></button>
      )}
      {!phone && <span className="book-tools">
        <button
          className={`book-tool star-tool${d.starred ? ' on' : ''}`}
          aria-label={d.starred ? t('Unstar {name}', { name: d.name }) : t('Star {name}', { name: d.name })}
          aria-pressed={Boolean(d.starred)}
          title={d.starred ? t('Starred') : t('Star')}
          onClick={async () => { await patchMeta(d.id, { starred: !d.starred }); void refresh(); }}
        >
          <StarIcon />
        </button>
        <button
          className="book-tool"
          aria-label={t('Move {name} to a folder', { name: d.name })}
          title={t('Move to a folder')}
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
          aria-label={t('Download {name}', { name: d.name })}
          title={t('Download to this device')}
          onClick={() => setDownloading(d)}
        >
          <DownloadIcon />
        </button>
        <button
          className="book-tool"
          aria-label={t('Remove {name}', { name: d.name })}
          title={t('Remove from this device')}
          onClick={async () => {
            if (window.confirm(t('Remove “{name}” and its notes from this device?', { name: d.name }))) {
              await deleteDoc(d.id);
              void refresh();
            }
          }}
        >
          <TrashIcon />
        </button>
      </span>}
      {moving?.id === d.id && (
        <MoveMenu
          doc={d}
          anchor={moving.anchor}
          onSyncOn={d.localOnly && sync.connected ? async () => {
            await patchMeta(d.id, { localOnly: undefined });
            setMoving(null);
            void refresh();
          } : undefined}
          folders={folders}
          current={placeOf(d)}
          onMove={(to) => void move(d.id, to)}
          onClose={() => setMoving(null)}
        />
      )}
    </li>
  );

  const content = (
    <>
      {phone ? (
        <header className="library-head phone-head">
          <h1 className="brand">{onTools ? t('Tools') : onMe ? t('Me') : <Wordmark />}</h1>
          {!onTools && !onMe && !onNotes && !current && docs && docs.length > 0 && (
            <button className="icon-button" aria-label={t('Search')} aria-pressed={searchOpen || Boolean(query)} onClick={() => { if (query) setQuery(''); setSearchOpen((v) => !v); }}>
              <SearchIcon />
            </button>
          )}
        </header>
      ) : null}

      {guestCount > 0 && (
        <div className="notice notice-info" role="status">
          <span>
            {sync.email
              ? guestCount === 1
                ? t('1 document on this device was added without an account. Add it to {email}?', { email: sync.email })
                : t('{n} documents on this device were added without an account. Add them to {email}?', { n: guestCount, email: sync.email })
              : guestCount === 1
                ? t('1 document on this device was added without an account. Add it to your account?')
                : t('{n} documents on this device were added without an account. Add them to your account?', { n: guestCount })}
          </span>
          <span className="notice-actions">
            <button className="button button-small" onClick={() => void adoptGuest()}>{t('Add to my account')}</button>
            <button className="link" onClick={dismissGuest}>{t('Not now')}</button>
          </span>
        </div>
      )}

      {(error || fetchError) && (
        <div className="notice" role="alert">
          <span>{error ?? fetchError}</span>
          <button className="link" onClick={() => { onDismissError(); setFetchError(null); }}>{t('Dismiss')}</button>
        </div>
      )}

      <input
        ref={input}
        type="file"
        accept={IMPORT_ACCEPT}
        multiple
        hidden
        onChange={(e) => { take(e.target.files); e.target.value = ''; }}
      />

      {current ? (
        <nav className="folder-bar" aria-label={t('Folder')}>
          <button
            className={`crumb${dropOn === 'shelf' ? ' drop' : ''}`}
            onClick={() => onFolder(null)}
            {...dropTarget(null)}
          >
            <BackIcon />
            {t('All documents')}
          </button>
          <div className="folder-title">
            <span className="color-wrap" ref={colorBox}>
              <button
                className={`folder-head-icon c-${folderColor(current.color)}`}
                onClick={() => setColoring((v) => !v)}
                aria-label={t('Folder colour')}
                title={t('Folder colour')}
                aria-expanded={coloring}
              >
                <FolderIcon />
              </button>
              {coloring && (
                <span className="color-pop" role="menu" aria-label={t('Folder colour')}>
                  {FOLDER_COLORS.map((c) => (
                    <button
                      key={c}
                      className={`color-dot c-${c}${folderColor(current.color) === c ? ' on' : ''}`}
                      role="menuitemradio"
                      aria-checked={folderColor(current.color) === c}
                      aria-label={COLOUR_NAMES[c]}
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
                  label={t('Folder name')}
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
                <button className="icon-button" onClick={() => setRenaming(true)} aria-label={t('Rename folder')} title={t('Rename folder')}>
                  <PencilIcon />
                </button>
                <button
                  className="icon-button icon-danger"
                  onClick={() => void removeFolder(current)}
                  aria-label={t('Delete folder')}
                  title={t('Delete folder')}
                >
                  <TrashIcon />
                </button>
                {phone && addButton}
              </div>
            )}
          </div>
        </nav>
      ) : phone && docs && docs.length > 0 && !onNotes && !onTools && !onMe && (searchOpen || query) && (
        <div className="shelf-bar">
          <div className={`search${query ? ' active' : ''}`} role="search">
            <SearchIcon />
            <input
              ref={searchBox}
              type="search"
              value={query}
              placeholder={t('Search documents and folders')}
              aria-label={t('Search documents and folders')}
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
                aria-label={t('Clear search')}
                onClick={() => { setQuery(''); searchBox.current?.focus(); }}
              >
                <CloseIcon />
              </button>
            ) : (
              <kbd className="search-key" aria-hidden="true">/</kbd>
            )}
          </div>
          <button className="tools-button note-button" onClick={() => { setNoteError(null); setNewNote(true); }} aria-label={t('New note')} title={t('New note: an empty notebook to write on')}>
            <PencilIcon />
            <span>{t('New note')}</span>
          </button>
          {addButton}
        </div>
      )}

      {!phone && page === 'shelf' && !searching && (folders.length > 0 || (docs && docs.length > 0)) && (
        <div className="top-chips" role="group" aria-label={t('Folders')}>
          <button
            className={`chip${!current ? ' on' : ''}${dropOn === 'shelf' ? ' drop' : ''}`}
            onClick={() => { setQuery(''); onFolder(null); }}
            aria-pressed={!current}
            {...dropTarget(null)}
          >
            {t('All')} <small>{docs?.length ?? 0}</small>
          </button>
          {folders.map((f) => (
            <button
              key={f.id}
              className={`chip c-${folderColor(f.color)}${current?.id === f.id ? ' on' : ''}${dropOn === f.id ? ' drop' : ''}`}
              onClick={() => { setQuery(''); onFolder(f.id); }}
              aria-pressed={current?.id === f.id}
              {...dropTarget(f.id)}
            >
              <i className="chip-dot" aria-hidden="true" />{f.name} <small>{counts.get(f.id) ?? 0}</small>
            </button>
          ))}
          {creating ? (
            <span className="chip chip-new">
              <NameField
                label={t('Folder name')}
                onSave={async (name) => { setCreating(false); await createFolder(name); void refresh(); }}
                onCancel={() => setCreating(false)}
              />
            </span>
          ) : (
            <button className="chip chip-add" onClick={() => setCreating(true)}>{t('+ Folder')}</button>
          )}
        </div>
      )}

      {phone && page === 'shelf' && !current && !searching && docs && docs.length > 0 && (
        <div className="chip-row">
          <button className="folder-chip on" aria-pressed="true">{t('All')} <small>{docs.length}</small></button>
          {folders.map((f) => (
            <button key={f.id} className={`folder-chip c-${folderColor(f.color)}`} onClick={() => { setQuery(''); setSearchOpen(false); onFolder(f.id); }}>
              <FolderIcon />{f.name} <small>{counts.get(f.id) ?? 0}</small>
            </button>
          ))}
          {creating ? (
            <span className="folder-chip folder-chip-new">
              <NameField
                label={t('Folder name')}
                onSave={async (name) => { setCreating(false); await createFolder(name); void refresh(); }}
                onCancel={() => setCreating(false)}
              />
            </span>
          ) : (
            <button className="folder-chip add" aria-label={t('New folder')} onClick={() => setCreating(true)}><FolderPlusIcon /></button>
          )}
        </div>
      )}

      {!phone && (onTools || onNotes) && <h2 className="page-title">{onTools ? t('PDF tools') : t('Notes')}</h2>}
      {onTools && <ToolsPage phone={phone} docs={docs ?? []} onPick={pickFromTools} />}
      {onMe && <MePage dark={dark} onTheme={onTheme} onTour={() => setIntro(true)} docCount={(docs ?? []).filter((d) => !d.attached).length} />}

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
            <span className="resume-eyebrow">{resume.kind === 'note' ? t('Continue writing') : resume.lastPage > 0 ? t('Continue reading') : t('Start reading')}</span>
            <span className="resume-title">{resume.name}</span>
            <span className="resume-where">
              {resume.kind === 'note'
                ? t('{n} words', { n: resume.words ?? 0 })
                : resume.lastPage > 0
                  ? t('Page {page} of {total}', { page: resume.lastPage + 1, total: resume.pages })
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
        <section className="results" aria-label={t('Search results')}>
          <h2 className="shelf-title" aria-live="polite">
            {docHits.length + folderHits.length
              ? t('{results} for “{query}”', { results: plural(docHits.length + folderHits.length, 'result', 'results'), query: query.trim() })
              : t('Nothing matches “{query}”', { query: query.trim() })}
          </h2>
          {folderHits.length > 0 && <ul className="folders">{folderHits.map(({ f, r }, i) => folderTile(f, i, r))}</ul>}
          {docHits.length > 0 && (
            <ul className={`shelf view-${view}`}>{docHits.map(({ d, name }, i) => book(d, i, name, true))}</ul>
          )}
          {docHits.length + folderHits.length === 0 && (
            <p className="empty-note">{t('Try fewer letters, or another word from the title.')}</p>
          )}
        </section>
      )}

      {onNotes && (
        <Suspense fallback={<div className="note-loading" />}>
          <Notes
            docs={notesDocs}
            typed={sortDocs((docs ?? []).filter((d) => d.kind === 'note'), 'opened')}
            folderName={(d) => (placeOf(d) ? folderName.get(placeOf(d)!) ?? null : null)}
            onOpen={(id, page) => onOpen(id, page)}
          />
        </Suspense>
      )}

      {!searching && !onNotes && !onTools && !onMe && (
        <>
          {docs?.length === 0 && (
            // An empty library gets a big, friendly place to start.
            <div className={`dropzone${dragging ? ' over' : ''}${busy ? ' busy' : ''}`}>
              <svg className="drop-art" viewBox="0 0 160 100" aria-hidden="true" focusable="false">
                <rect className="da-back" x="30" y="22" width="46" height="62" rx="5" transform="rotate(-9 53 53)" />
                <rect className="da-back" x="84" y="22" width="46" height="62" rx="5" transform="rotate(8 107 53)" />
                <rect className="da-front" x="58" y="12" width="46" height="70" rx="5" />
                <path className="da-line" d="M67 28h28M67 36h28M67 44h28M67 52h18" />
                <path className="da-accent" d="M80 66v-9m-4 4 4-4 4 4" />
              </svg>
              <p className="drop-title">{busy ? t('Adding to your library…') : phone ? t('Add your first document') : t('Drop files here to start your library')}</p>
              {!busy && <p className="drop-sub">{t('PDFs, ePub books, Office files, text or pictures')}</p>}
              <button className="button" disabled={busy} onClick={() => input.current?.click()}>
                {t('Choose files')}
              </button>
              <button className="chip-button" disabled={busy} aria-label={t('New note')} onClick={() => { setNoteError(null); setNewNote(true); }}>
                <PencilIcon /> {t('Or start a blank note')}
              </button>
              <p className="drop-note">{t('Pick several at once. ePub books open as books; Word, Excel, PowerPoint, text and pictures are turned into PDFs on your device.')}</p>
            </div>
          )}

          {docs === null && (
            <ul className="shelf view-grid shelf-skeleton" aria-hidden="true">
              {[0, 1, 2, 3, 4, 5].map((i) => <li key={i} className="sk-book" style={{ ['--i' as string]: i }} />)}
            </ul>
          )}

          {!current && starred.length > 0 && (
            <section aria-label={t('Starred')}>
              <div className="section-head">
                <h2 className="shelf-title"><span className="title-star"><StarIcon /></span>{t('Starred')}</h2>
              </div>
              <ul className={`shelf view-${view}`}>{starred.map((d, i) => book(d, i, null, true))}</ul>
            </section>
          )}

          {docs && (shown.length > 0 || current) && (
            <>
              {shown.length > 1 || (!current && shown.length > 0) ? (
                <div className={`section-head${current ? ' bare' : ''}`}>
                  {!current && <h2 className="shelf-title">{phone ? SORT_TITLES[sortBy] : t('All documents')}</h2>}
                  {shown.length > 1 && phone && (
                    <span className="shelf-controls phone-controls">
                      <label className="icon-button sort-icon" aria-label={t('Sort')}>
                        <SortIcon />
                        <select value={sortBy} aria-label={t('Sort by')} onChange={(e) => setSortBy(e.target.value as SortBy)}>
                          {SORTS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                        </select>
                      </label>
                      <button className="icon-button" aria-label={view === 'grid' ? t('Show as a list') : t('Show as a grid')} onClick={() => setView(view === 'grid' ? 'list' : 'grid')}>
                        {view === 'grid' ? <ListIcon /> : <GridIcon />}
                      </button>
                    </span>
                  )}
                  {shown.length > 1 && !phone && (
                    <span className="shelf-controls">
                      <label className="sort">
                        <span className="sr-only">{t('Sort by')}</span>
                        <select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortBy)}>
                          {SORTS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                        </select>
                      </label>
                      <span className="view-toggle" role="group" aria-label={t('View')}>
                        <button className={view === 'grid' ? 'on' : ''} aria-pressed={view === 'grid'} aria-label={t('Grid')} title={t('Grid')} onClick={() => setView('grid')}><GridIcon /></button>
                        <button className={view === 'list' ? 'on' : ''} aria-pressed={view === 'list'} aria-label={t('List')} title={t('List')} onClick={() => setView('list')}><ListIcon /></button>
                      </span>
                    </span>
                  )}
                </div>
              ) : null}
              {current && shown.length === 0 && (
                <p className="empty-note empty-folder">
                  {t('This folder is empty. Add files, drop them anywhere on this page, or move documents here with the folder button on each one.')}
                </p>
              )}
              <ul className={`shelf view-${view}`}>
                {shown.map((d, i) => book(d, i))}
              </ul>
            </>
          )}
        </>
      )}

      {downloading && <DownloadDialog doc={downloading} onClose={() => setDownloading(null)} />}
      {intro && <Intro onClose={() => setIntro(false)} />}
      {newNote && <NewNote busy={makingNote} error={noteError} onCreate={(spec, kind) => void createNote(spec, kind)} onClose={() => setNewNote(false)} />}
      {tool && (
        <Suspense fallback={<div className="workspace"><div className="tool-backdrop" /><div className="tool-sheet"><div className="note-loading" /></div></div>}>
          <PdfTools
            tool={tool}
            start={toolStart}
            signedIn={sync.connected}
            docs={(docs ?? []).filter((d) => !d.kind)}
            folderOf={placeOf}
            onClose={closeTools}
            onChanged={() => void refresh()}
            onOpen={(id) => {
              // The tool's history step becomes the shelf's, then the document opens on top.
              history.replaceState({ ...history.state, tool: undefined }, '');
              setTool(null);
              onOpen(id);
            }}
          />
        </Suspense>
      )}

      {dragging && (
        <div className="drop-overlay" aria-hidden="true">
          <div className="drop-overlay-card">
            <UploadIcon />
            <p>{current ? t('Drop to add to “{name}”', { name: current.name }) : t('Drop files to add them')}</p>
          </div>
        </div>
      )}
      {phone && addOpen && (
        <AddSheet
          onClose={() => setAddOpen(false)}
          onFiles={() => { setAddOpen(false); input.current?.click(); }}
          onNote={() => { setAddOpen(false); setNoteError(null); setNewNote(true); }}
          onFolder={current ? undefined : () => { setAddOpen(false); setTab('shelf'); setCreating(true); }}
        />
      )}
      {phone && menuFor && (
        <BookSheet
          doc={menuFor}
          canMove={folders.length > 0}
          onClose={() => setMenuFor(null)}
          onStar={async () => { const d = menuFor; setMenuFor(null); await patchMeta(d.id, { starred: !d.starred }); void refresh(); }}
          onMove={() => { const d = menuFor; setMenuFor(null); setMoving({ id: d.id, anchor: new DOMRect(window.innerWidth / 2, window.innerHeight, 0, 0) }); }}
          onDownload={() => { const d = menuFor; setMenuFor(null); setDownloading(d); }}
          onRemove={async () => {
            const d = menuFor;
            setMenuFor(null);
            if (window.confirm(t('Remove “{name}” and its notes from this device?', { name: d.name }))) { await deleteDoc(d.id); void refresh(); }
          }}
        />
      )}
      {phone && (
        <PhoneNav
          tab={page}
          onAdd={() => setAddOpen(true)}
          onTab={(next) => { if (current) onFolder(null); setQuery(''); setSearchOpen(false); setCreating(false); setTab(next); window.scrollTo(0, 0); }}
        />
      )}
      <footer className="library-foot">
        <a href="/privacy.html">{t('Privacy')}</a>
        <span aria-hidden="true">·</span>
        <a href="/terms.html">{t('Terms')}</a>
      </footer>
    </>
  );

  return (
    <main
      className={`library${phone ? ' phone' : ' desk'}`}
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
      {phone ? content : (
        <div className="lib-shell">
      <TopBar
        tab={page === 'notes' ? 'notes' : page === 'tools' ? 'tools' : 'shelf'}
        onTab={(next) => { if (current) onFolder(null); setQuery(''); setCreating(false); setTab(next); }}
        search={(
          <div className={`search top-search${query ? ' active' : ''}`} role="search">
            <SearchIcon />
            <input
              ref={searchBox}
              type="search"
              value={query}
              placeholder={t('Search')}
              aria-label={t('Search documents and folders')}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => {
                setQuery(e.target.value);
                if (e.target.value && (page !== 'shelf' || current)) { if (current) onFolder(null); setTab('shelf'); }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') { setQuery(''); e.currentTarget.blur(); }
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
            />
            {query ? (
              <button className="search-clear" aria-label={t('Clear search')} onClick={() => { setQuery(''); searchBox.current?.focus(); }}><CloseIcon /></button>
            ) : (
              <kbd className="search-key" aria-hidden="true">/</kbd>
            )}
          </div>
        )}
        actions={(
          <>
            <button className="tools-button note-button" onClick={() => { setNoteError(null); setNewNote(true); }} aria-label={t('New note')} title={t('New note: an empty notebook to write on')}>
              <PencilIcon />
              <span>{t('New note')}</span>
            </button>
            {addButton}
          </>
        )}
        account={<AccountMenu dark={dark} onTheme={onTheme} docCount={docs?.length ?? 0} onTour={() => setIntro(true)} />}
      />
          <div className="lib-main">{content}</div>
        </div>
      )}
    </main>
  );
}
