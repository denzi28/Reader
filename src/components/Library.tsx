import { useEffect, useRef, useState } from 'react';
import { deleteDoc, listDocs } from '../lib/storage';
import type { DocMeta } from '../lib/types';
import { FileIcon, MoonIcon, SunIcon, TrashIcon } from './icons';

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
  const input = useRef<HTMLInputElement>(null);

  const refresh = () => listDocs().then(setDocs).catch(() => setDocs([]));
  useEffect(() => { void refresh(); }, [busy]);

  const take = (files: FileList | null) => {
    const file = files?.[0];
    if (file) void onImport(file);
  };

  return (
    <main className="library">
      <header className="library-head">
        <div>
          <h1 className="brand">Reader</h1>
          <p className="tagline">Read, mark up and keep your documents. Everything stays on this device.</p>
        </div>
        <button
          className="icon-button"
          onClick={onTheme}
          aria-label={dark ? 'Switch to day paper' : 'Switch to night paper'}
        >
          {dark ? <SunIcon /> : <MoonIcon />}
        </button>
      </header>

      {error && (
        <div className="notice" role="alert">
          <span>{error}</span>
          <button className="link" onClick={onDismissError}>Dismiss</button>
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
                <button className="book-open" onClick={() => onOpen(d.id)}>
                  <span className="cover"><Cover meta={d} /></span>
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
    </main>
  );
}
