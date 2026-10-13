import type { PDFDocumentProxy } from 'pdfjs-dist';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { PdfOpError, pageCount } from '../lib/pdfOps';
import { acquirePdf, releasePdf } from '../lib/pdf';
import { matchRanges, searchTerms } from '../lib/search';
import { getDocFile } from '../lib/storage';
import type { PageMove } from '../lib/carryNotes';
import { downloadPdf } from '../lib/sync/engine';
import type { DocMeta } from '../lib/types';
import { Cover } from './Cover';
import { BackIcon, CheckIcon, CloseIcon, MarkIcon, SearchIcon, UploadIcon } from './icons';
import { TOOLS, type ToolId } from './toolList';

/** A document a tool works on: from the library, or a file picked from the device that is not kept. */
export type ToolDoc = DocMeta & { temp?: Blob };

/** A finished PDF, held in memory until the reader chooses to save or download it. */
export interface OutputSpec {
  name: string;
  bytes: Uint8Array;
  pages: number;
  /** A folder to file it in when saved. */
  folder: string | null;
  /** Several files made together go in one new folder, made when they are saved. */
  newFolder?: string;
  /** Library documents whose notes may come along, with where each page of theirs goes. */
  sources: { docId: string; moves: PageMove[] }[];
}

export interface ToolContext {
  docs: DocMeta[];
  folderOf: (d: DocMeta) => string | null;
  /** The tools page shown before sign-in: no library, files come from the device. */
  guest?: boolean;
  /** The work is done: show the finished files. */
  finish: (result: { title: string; outputs: OutputSpec[] }) => void;
}

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
export const cleanName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Document';
export const errorText = (err: unknown) =>
  err instanceof PdfOpError ? err.message : err instanceof Error ? err.message : 'Something went wrong.';

/** The stored file for a document, fetched from Drive first if it is only there. */
export async function fileOf(doc: ToolDoc): Promise<Blob> {
  if (doc.temp) return doc.temp;
  let file = await getDocFile(doc.id);
  if (!file && doc.cloudOnly) {
    await downloadPdf(doc.id);
    file = await getDocFile(doc.id);
  }
  if (!file) throw new PdfOpError(`“${doc.name}” is not on this device.`);
  return file;
}

/** A document opened for previews, shared with the reader and released on leaving. */
export function usePdf(doc: ToolDoc | null) {
  const [state, setState] = useState<{ pdf: PDFDocumentProxy | null; error: string | null }>({ pdf: null, error: null });
  useEffect(() => {
    setState({ pdf: null, error: null });
    if (!doc) return;
    let gone = false;
    let held = false;
    (async () => {
      const blob = await fileOf(doc);
      held = true;
      const pdf = await acquirePdf(doc.id, async () => blob);
      if (gone) return;
      setState(pdf ? { pdf, error: null } : { pdf: null, error: `“${doc.name}” could not be read.` });
    })().catch((err) => { if (!gone) setState({ pdf: null, error: errorText(err) }); });
    return () => {
      gone = true;
      if (held) releasePdf(doc.id);
    };
  }, [doc?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return state;
}

// Thumbnails are drawn one at a time, as they come into view.
let thumbChain: Promise<unknown> = Promise.resolve();
const queueThumb = (job: () => Promise<void>) => {
  thumbChain = thumbChain.then(job, job).catch(() => undefined);
};

/** Draws one page, turned by `turn` degrees on top of its own turn. */
export async function drawPage(pdf: PDFDocumentProxy, index: number, canvas: HTMLCanvasElement, cssWidth: number, turn = 0) {
  const page = await pdf.getPage(index + 1);
  const rotation = (((page.rotate + turn) % 360) + 360) % 360;
  const base = page.getViewport({ scale: 1, rotation });
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const viewport = page.getViewport({ scale: (cssWidth * dpr) / base.width, rotation });
  const w = Math.floor(viewport.width);
  const h = Math.floor(viewport.height);
  const off = document.createElement('canvas');
  off.width = w;
  off.height = h;
  await page.render({ canvas: off, viewport }).promise;
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')?.drawImage(off, 0, 0);
}

/** A small picture of a page; drawn when it scrolls near, redrawn when `turn` changes. */
export function PageThumb({ pdf, page, turn = 0, width = 150 }: { pdf: PDFDocumentProxy | null; page: number; turn?: number; width?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const seen = new IntersectionObserver((e) => { if (e.some((x) => x.isIntersecting)) { setNear(true); seen.disconnect(); } }, { rootMargin: '400px' });
    seen.observe(c);
    return () => seen.disconnect();
  }, []);
  useEffect(() => {
    const c = canvas.current;
    if (!near || !pdf || !c) return;
    let gone = false;
    queueThumb(async () => {
      if (!gone) await drawPage(pdf, page, c, width, turn);
    });
    return () => { gone = true; };
  }, [near, pdf, page, turn, width]);
  return <canvas ref={canvas} className="thumb-canvas" aria-hidden="true" />;
}

/** The full-screen workspace every tool lives in. */
export function Shell({ title, subtitle, color, onBack, onClose, footer, children }: {
  title: string;
  subtitle?: string;
  color: string;
  onBack?: () => void;
  onClose: () => void;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);
  return createPortal(
    <div className="workspace" role="dialog" aria-modal="true" aria-label={title}>
      <div className="tool-backdrop" onClick={onClose} />
      <section className={`tool-sheet c-${color}`}>
        <header className="tool-head">
          {onBack && <button className="icon-button" onClick={onBack} aria-label="Back"><BackIcon /></button>}
          <div className="tool-head-text">
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close"><CloseIcon /></button>
        </header>
        <div className="tool-body">{children}</div>
        {footer && <footer className="tool-foot">{footer}</footer>}
      </section>
    </div>,
    document.body,
  );
}

/** Working: a message and, when known, how far along. */
export function Busy({ label, fraction }: { label: string; fraction?: number }) {
  return (
    <div className="tool-busy" role="status">
      <span className="tool-busy-spin" />
      <p>{label}</p>
      {fraction !== undefined && <span className="progress"><span style={{ width: `${Math.max(4, fraction * 100)}%` }} /></span>}
    </div>
  );
}

/** The choice to keep a new file off Google Drive, shown when saving it. */
export function SaveOption({ signedIn, localOnly, onChange }: { signedIn: boolean; localOnly: boolean; onChange: (v: boolean) => void }) {
  if (!signedIn) return null;
  return (
    <label className="save-option">
      <input type="checkbox" checked={localOnly} onChange={(e) => onChange(e.target.checked)} />
      <span className="save-option-box" aria-hidden="true"><CheckIcon /></span>
      <span className="save-option-text">
        <strong>Keep only on this device</strong>
        <small>{localOnly ? 'It will not be uploaded to Google Drive.' : 'It will sync with your Google Drive.'}</small>
      </span>
    </label>
  );
}

/** Before saving: should the notes made on the original come along? */
export function NotesAsk({ marks, plural: many, onChoose, onCancel }: {
  marks: number;
  /** More than one new file. */
  plural: boolean;
  onChoose: (bring: boolean) => void;
  onCancel: () => void;
}) {
  return (
    <div className="tool-busy tool-ask" role="alertdialog" aria-label="Bring your notes along?">
      <div className="tool-ask-card">
        <span className="tool-ask-icon"><MarkIcon /></span>
        <h3>Bring your notes along?</h3>
        <p>
          The original has {plural(marks, 'mark', 'marks')} (highlights and pen). Copy them onto the new {many ? 'files' : 'file'}, in the right place?
        </p>
        <button className="button" onClick={() => onChoose(true)}>Yes, bring my notes</button>
        <button className="chip-button" onClick={() => onChoose(false)}>No, a clean copy</button>
        <button className="link" onClick={onCancel}>Back</button>
      </div>
    </div>
  );
}

export function Notice({ children }: { children: React.ReactNode }) {
  return <p className="tool-error" role="alert">{children}</p>;
}

/** A list of library documents with a search box; each row is tappable. */
export function DocList({ docs, selected, onPick, empty, badge }: {
  docs: DocMeta[];
  selected?: ReadonlySet<string>;
  onPick: (d: DocMeta) => void;
  empty?: string;
  /** Text shown at the end of a row (a position number, say). */
  badge?: (d: DocMeta) => React.ReactNode;
}) {
  const [query, setQuery] = useState('');
  const terms = searchTerms(query);
  const shown = terms.length ? docs.filter((d) => matchRanges(d.name, terms)) : docs;
  return (
    <div className="doclist">
      {docs.length > 6 && (
        <label className="doclist-search">
          <SearchIcon />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search your documents" aria-label="Search your documents" />
        </label>
      )}
      <ul>
        {shown.map((d) => (
          <li key={d.id}>
            <button className={`docrow${selected?.has(d.id) ? ' on' : ''}`} onClick={() => onPick(d)}>
              <span className="docrow-cover"><Cover meta={d} /></span>
              <span className="docrow-text">
                <span className="docrow-name">{d.name}</span>
                <span className="docrow-meta">{plural(d.pages, 'page', 'pages')}{d.cloudOnly ? ' · in Drive' : ''}</span>
              </span>
              {badge?.(d) ?? (selected?.has(d.id) ? <span className="docrow-check"><CheckIcon /></span> : null)}
            </button>
          </li>
        ))}
      </ul>
      {!shown.length && <p className="empty-note">{terms.length ? 'Nothing matches.' : empty ?? 'No documents.'}</p>}
    </div>
  );
}

/** The first screen of a one-document tool: choose the document. */
export function PickOne({ ctx, tool, onPick, onClose }: { ctx: ToolContext; tool: ToolId; onPick: (d: ToolDoc) => void; onClose: () => void }) {
  const meta = TOOLS.find((t) => t.id === tool)!;
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  // A file from the device is worked on without being added to the library.
  const device = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setReading(true);
    setError(null);
    try {
      const pages = await pageCount(file);
      const now = Date.now();
      onPick({
        id: `temp-${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        name: file.name.replace(/\.pdf$/i, ''),
        size: file.size,
        pages,
        addedAt: now,
        openedAt: now,
        lastPage: 0,
        temp: file,
      });
    } catch (err) {
      setError(errorText(err));
      setReading(false);
    }
  };
  return (
    <Shell title={meta.title} subtitle="Choose a document" color={meta.color} onClose={onClose}>
      {reading && <Busy label="Reading the file…" />}
      {error && <Notice>{error}</Notice>}
      {!ctx.guest && <DocList docs={ctx.docs} onPick={onPick} empty="Add a PDF to your library, or choose a file from this device." />}
      <button className={`chip-button pick-device${ctx.guest ? ' pick-big' : ''}`} onClick={() => input.current?.click()}>
        <UploadIcon /> Choose a PDF from this device
      </button>
      <p className="tool-hint">{ctx.guest ? 'The file stays on your device. Nothing is uploaded.' : 'A file chosen this way is not added to your library unless you save the result.'}</p>
      <input ref={input} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => { void device(e.target.files); e.target.value = ''; }} />
    </Shell>
  );
}
