import { useEffect, useRef, useState } from 'react';
import { adoptGuestDocs, currentSpace, deleteDoc, guestDocs, listDocs } from '../lib/storage';
import { downloadPdf } from '../lib/sync/engine';
import { useSyncStatus } from '../lib/sync/useSync';
import type { DocMeta } from '../lib/types';
import { CloudIcon, FileIcon, MoonIcon, SunIcon, TrashIcon } from './icons';
import { SyncControl } from './SyncControl';

interface Props {
  dark: boolean;
  onTheme: () => void;
  onOpen: (id: string) => void;
  onImport: (file: File) => Promise<void>;
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

export function Library({ dark, onTheme, onOpen, onImport, busy, error, onDismissError }: Props) {
  const [docs, setDocs] = useState<DocMeta[] | null>(null);
  const [dragging, setDragging] = useState(false);
  const [fetching, setFetching] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const sync = useSyncStatus();

  const refresh = () => listDocs().then(setDocs).catch(() => setDocs([]));
  useEffect(() => { void refresh(); }, [busy, sync.libraryVersion]);

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
    const file = files?.[0];
    if (file) void onImport(file);
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

      <div
        className={`dropzone${dragging ? ' over' : ''}${busy ? ' busy' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
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
          hidden
          onChange={(e) => { take(e.target.files); e.target.value = ''; }}
        />
        <p className="drop-title">{busy ? 'Adding to your library…' : 'Drop a PDF here'}</p>
        <button className="button" disabled={busy} onClick={() => input.current?.click()}>
          Choose a file
        </button>
        <p className="drop-note">Word, Excel and PowerPoint support is coming next.</p>
      </div>

      {docs && docs.length > 0 && (
        <>
          <h2 className="shelf-title">Your shelf</h2>
          <ul className="shelf">
            {docs.map((d, i) => (
              <li key={d.id} className="book" style={{ ['--i' as string]: i }}>
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
                <button
                  className="book-delete"
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
