import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { liveFolders, MAX_FOLDER_NAME } from '../lib/folders';
import {
  adoptGuestDocs, createFolder, currentSpace, deleteDoc, deleteFolder, getFolderLog, guestDocs,
  listDocs, moveDocs, renameFolder,
} from '../lib/storage';
import { downloadPdf } from '../lib/sync/engine';
import { useSyncStatus } from '../lib/sync/useSync';
import type { DocMeta, Folder } from '../lib/types';
import {
  BackIcon, CheckIcon, CloudIcon, FileIcon, FolderIcon, FolderMoveIcon, FolderPlusIcon, MoonIcon, SunIcon,
  TrashIcon,
} from './icons';
import { SyncControl } from './SyncControl';

interface Props {
  dark: boolean;
  onTheme: () => void;
  onOpen: (id: string) => void;
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

function Cover({ meta }: { meta: DocMeta }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!meta.thumb) return;
    const u = URL.createObjectURL(meta.thumb);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [meta.thumb]);
  return url ? (
    <img src={url} alt="" draggable={false} />
  ) : (
    <span className="cover-fallback"><FileIcon /></span>
  );
}

const DOC_TYPE = 'application/x-reader-doc';
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
    // The menu is placed once, so scrolling the shelf closes it.
    const scroll = (e: Event) => { if (!box.current?.contains(e.target as Node)) onClose(); };
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', key);
    window.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('pointerdown', away, true);
      document.removeEventListener('keydown', key);
      window.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', onClose);
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
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [moving, setMoving] = useState<{ id: string; anchor: DOMRect } | null>(null);
  const [dropOn, setDropOn] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const sync = useSyncStatus();

  const refresh = () =>
    Promise.all([listDocs(), getFolderLog()])
      .then(([d, log]) => { setDocs(d); setFolders(liveFolders(log)); })
      .catch(() => setDocs([]));
  useEffect(() => { void refresh(); }, [busy, sync.libraryVersion]);

  // A folder removed (here or on another device) shows the whole shelf again.
  const current = folders.find((f) => f.id === folder) ?? null;
  const live = new Set(folders.map((f) => f.id));
  const placeOf = (d: DocMeta) => (d.folder && live.has(d.folder) ? d.folder : null);
  const shown = (docs ?? []).filter((d) => placeOf(d) === (current?.id ?? null));
  const counts = new Map<string, number>();
  for (const d of docs ?? []) {
    const f = placeOf(d);
    if (f) counts.set(f, (counts.get(f) ?? 0) + 1);
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

  const removeFolder = async (f: Folder) => {
    const n = counts.get(f.id) ?? 0;
    const note = n ? ` The ${plural(n, 'document', 'documents')} in it will go back to your shelf.` : '';
    if (!window.confirm(`Delete the folder “${f.name}”?${note}`)) return;
    await deleteFolder(f.id);
    onFolder(null);
    void refresh();
  };


  return (
    <main className="library">
      <header className="library-head">
        <div>
          <h1 className="brand">The Reader</h1>
          <p className="tagline">
            Read, mark up and keep your documents.{' '}
            {sync.connected ? 'Kept in step with your Google Drive.' : 'Everything stays on this device.'}
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

      {current && (
        <nav className="folder-bar" aria-label="Folder">
          <button
            className={`crumb${dropOn === 'shelf' ? ' drop' : ''}`}
            onClick={() => onFolder(null)}
            {...dropTarget(null)}
          >
            <BackIcon />
            All documents
          </button>
          <div className="folder-heading">
            <span className="folder-heading-icon"><FolderIcon /></span>
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
            {!renaming && (
              <span className="folder-actions">
                <button className="link" onClick={() => setRenaming(true)}>Rename</button>
                <button className="link" onClick={() => void removeFolder(current)}>Delete</button>
              </span>
            )}
          </div>
        </nav>
      )}

      <div
        className={`dropzone${dragging ? ' over' : ''}${busy ? ' busy' : ''}`}
        onDragOver={(e) => {
          if (isBook(e)) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          take(e.dataTransfer.files);
        }}
      >
        <input
          ref={input}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          hidden
          onChange={(e) => { take(e.target.files); e.target.value = ''; }}
        />
        <p className="drop-title">
          {busy ? 'Adding to your library…' : current ? `Drop PDFs into “${current.name}”` : 'Drop PDFs here'}
        </p>
        <button className="button" disabled={busy} onClick={() => input.current?.click()}>
          Choose files
        </button>
        <p className="drop-note">You can pick several at once. Word, Excel and PowerPoint support is coming next.</p>
      </div>

      {!current && docs && (
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
              {folders.map((f, i) => (
                <li key={f.id} style={{ ['--i' as string]: i }}>
                  <button
                    className={`folder-tile${dropOn === f.id ? ' drop' : ''}`}
                    onClick={() => onFolder(f.id)}
                    {...dropTarget(f.id)}
                  >
                    <span className="folder-tile-icon"><FolderIcon /></span>
                    <span className="folder-tile-name">{f.name}</span>
                    <span className="folder-tile-count">{plural(counts.get(f.id) ?? 0, 'document', 'documents')}</span>
                  </button>
                </li>
              ))}
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
          {!current && <h2 className="shelf-title">{folders.length ? 'Not in a folder' : 'Your shelf'}</h2>}
          {current && shown.length === 0 && (
            <p className="empty-note empty-folder">
              This folder is empty. Add PDFs above, or use the folder button on any document to move it here.
            </p>
          )}
          <ul className="shelf">
            {shown.map((d, i) => (
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
                    {d.cloudOnly && (
                      <span className="cover-cloud" title="In your Google Drive; opens after downloading">
                        <CloudIcon />
                        {fetching === d.id ? 'Downloading…' : 'In Drive'}
                      </span>
                    )}
                  </span>
                  <span className="book-name">{d.name}</span>
                  <span className="book-meta">
                    {d.pages} pages · {formatSize(d.size)} · {ago(d.openedAt)}
                  </span>
                </button>
                <span className="book-tools">
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
            ))}
          </ul>
        </>
      )}
      <footer className="library-foot">
        <a href="/privacy.html">Privacy</a>
        <span aria-hidden="true">·</span>
        <a href="/terms.html">Terms</a>
      </footer>
    </main>
  );
}
