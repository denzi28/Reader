import type { PDFDocumentProxy } from 'pdfjs-dist';
import { useEffect, useRef, useState } from 'react';
import { drawStrokes } from '../lib/ink';
import { collectNotes, type PageNotes } from '../lib/notes';
import { openPdfFile, pageTextBoxes, renderPagePreview } from '../lib/pdf';
import { getCachedNotes, getDocFile, getInkStamps, loadInk, putCachedNotes } from '../lib/storage';
import type { DocMeta } from '../lib/types';
import { CopyIcon, FolderIcon, MarkIcon, PenIcon, PrintIcon } from './icons';

interface Props {
  /** Documents with marks, newest opened first. */
  docs: DocMeta[];
  folderName: (doc: DocMeta) => string | null;
  onOpen: (id: string, page: number) => void;
}

interface Loaded {
  notes: PageNotes[];
  /** False when the PDF is only in Drive, so its text could not be read. */
  hasFile: boolean;
}

// Open PDFs for drawing previews: a few at most, the least recently used
// closed first. Previews are drawn one at a time.
const MAX_OPEN = 3;
const openDocs = new Map<string, Promise<PDFDocumentProxy | null>>();
function docFor(id: string) {
  let doc = openDocs.get(id);
  if (doc) {
    openDocs.delete(id); // most recent last
  } else {
    doc = getDocFile(id).then((f) => (f ? openPdfFile(f) : null)).catch(() => null);
  }
  openDocs.set(id, doc);
  while (openDocs.size > MAX_OPEN) {
    const [oldest, p] = openDocs.entries().next().value!;
    openDocs.delete(oldest);
    void p.then((d) => d?.loadingTask.destroy());
  }
  return doc;
}
function closeDocs() {
  openDocs.forEach((p) => void p.then((d) => d?.loadingTask.destroy()));
  openDocs.clear();
}
let previewChain: Promise<unknown> = Promise.resolve();
const queuePreview = (job: () => Promise<void>) => {
  previewChain = previewChain.then(job, job).catch(() => undefined);
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** A small picture of the page with its ink, drawn once it scrolls into view. */
function Preview({ id, page, hasFile }: { id: string; page: number; hasFile: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = canvas.current;
    if (!c || !hasFile) return;
    let gone = false;
    const seen = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      seen.disconnect();
      queuePreview(async () => {
        if (gone) return;
        const [pdf, ink] = await Promise.all([docFor(id), loadInk(id)]);
        if (gone || !pdf) return;
        await renderPagePreview(pdf, page, c, 180);
        const ctx = c.getContext('2d');
        if (gone || !ctx) return;
        // Thin pen lines would vanish at this size; draw every mark at least 2 px wide.
        const strokes = (ink[page] ?? []).map((st) => ({ ...st, size: Math.max(st.size, 2 / c.width) }));
        drawStrokes(ctx, strokes, c.width, false);
      });
    }, { rootMargin: '300px' });
    seen.observe(c);
    return () => { gone = true; seen.disconnect(); };
  }, [id, page, hasFile]);
  return <canvas ref={canvas} className="note-preview" width={180} height={254} aria-hidden="true" />;
}

/** Works out a document's notes from its ink and the PDF's text. */
async function readNotes(id: string): Promise<Loaded> {
  const [ink, file] = await Promise.all([loadInk(id), getDocFile(id)]);
  const pdf = file ? await openPdfFile(file).catch(() => null) : null;
  try {
    return { notes: await collectNotes(ink, pdf ? (p) => pageTextBoxes(pdf, p) : null), hasFile: Boolean(pdf) };
  } finally {
    void pdf?.loadingTask.destroy();
  }
}

export function Notes({ docs, folderName, onOpen }: Props) {
  const [loaded, setLoaded] = useState<Map<string, Loaded>>(new Map());
  const [copied, setCopied] = useState(false);
  const ids = docs.map((d) => d.id).join();

  // Notes worked out before are reused until that document's ink changes;
  // only changed documents are read again.
  useEffect(() => {
    let gone = false;
    (async () => {
      const list = docs.map((d) => d.id);
      const [stamps, cached] = await Promise.all([getInkStamps(list), getCachedNotes<Loaded>(list)]);
      if (gone) return;
      const ready = new Map<string, Loaded>();
      const stale: string[] = [];
      for (const id of list) {
        const c = cached.get(id);
        // Notes made while the PDF was only in Drive lack its text: redo them once it is here.
        const usable = c && c.stamp === stamps.get(id) && (c.notes.hasFile || docs.find((d) => d.id === id)?.cloudOnly);
        if (usable) ready.set(id, c.notes);
        else stale.push(id);
      }
      setLoaded(ready);
      // Three at a time, in shelf order.
      let next = 0;
      await Promise.all([0, 1, 2].map(async () => {
        while (!gone && next < stale.length) {
          const id = stale[next++];
          const result = await readNotes(id).catch(() => null);
          if (gone || !result) continue;
          void putCachedNotes(id, { stamp: stamps.get(id) ?? 0, notes: result });
          setLoaded((m) => new Map(m).set(id, result));
        }
      }));
    })();
    return () => { gone = true; };
  }, [ids]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => closeDocs, []);

  const total = docs.reduce((n, d) => n + (loaded.get(d.id)?.notes.reduce((a, p) => a + p.highlights.length + p.untextedHighlights + p.pens, 0) ?? 0), 0);

  const asText = () => docs.map((d) => {
    const notes = loaded.get(d.id)?.notes ?? [];
    const lines = notes.flatMap((p) => [
      ...p.highlights.map((h) => `- p. ${p.page + 1}: “${h.text}”`),
      ...(p.pens ? [`- p. ${p.page + 1}: ${plural(p.pens, 'pen mark', 'pen marks')}`] : []),
    ]);
    return `## ${d.name}\n${lines.join('\n')}`;
  }).join('\n\n');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`# Notes\n\n${asText()}\n`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard refused */ }
  };

  if (!docs.length) {
    return (
      <section className="notes-empty">
        <span className="drop-icon"><MarkIcon /></span>
        <h2>No notes yet</h2>
        <p>Highlight or write on any page and it shows up here: the highlighted text, page by page, ready to copy or print.</p>
      </section>
    );
  }

  return (
    <section className="notes" aria-label="Notes">
      <div className="notes-head">
        <div>
          <h2 className="notes-title">Your notes</h2>
          <p className="notes-sub">{plural(total, 'mark', 'marks')} in {plural(docs.length, 'document', 'documents')}</p>
        </div>
        <span className="notes-actions">
          <button className="chip-button" onClick={() => void copy()}>
            <CopyIcon />
            {copied ? 'Copied' : 'Copy all'}
          </button>
          <button className="chip-button" onClick={() => window.print()}>
            <PrintIcon />
            Print or PDF
          </button>
        </span>
      </div>

      {docs.map((d, i) => {
        const l = loaded.get(d.id);
        const folder = folderName(d);
        return (
          <article
            key={d.id}
            className="note-doc"
            // Room kept for it while off screen (where it is not drawn), so scrolling doesn't jump.
            style={{ ['--i' as string]: i, containIntrinsicSize: `auto ${70 + (l?.notes.length ?? 1) * 104}px` }}
          >
            <header className="note-doc-head">
              <h3>{d.name}</h3>
              <span className="note-doc-meta">
                {folder && <><FolderIcon />{folder} · </>}
                {l ? plural(l.notes.reduce((a, p) => a + p.highlights.length + p.untextedHighlights + p.pens, 0), 'mark', 'marks') : 'Reading…'}
              </span>
            </header>
            {!l ? (
              <div className="note-loading" />
            ) : (
              <ol className="note-pages">
                {l.notes.map((p) => (
                  <li key={p.page}>
                    <button className="note-page" onClick={() => onOpen(d.id, p.page)}>
                      <Preview id={d.id} page={p.page} hasFile={l.hasFile} />
                      <span className="note-body">
                        <span className="note-where">Page {p.page + 1}</span>
                        {p.highlights.map((h, k) => (
                          <q key={k} className="note-quote" style={{ ['--hl' as string]: h.color }}>{h.text}</q>
                        ))}
                        {(p.untextedHighlights > 0 || p.pens > 0) && (
                          <span className="note-extra">
                            {p.untextedHighlights > 0 && <><MarkIcon />{plural(p.untextedHighlights, 'highlight', 'highlights')}</>}
                            {p.pens > 0 && <><PenIcon />{plural(p.pens, 'pen mark', 'pen marks')}</>}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            )}
            {l && !l.hasFile && <p className="empty-note">This document is in your Google Drive only. Open it once to see the highlighted text.</p>}
          </article>
        );
      })}
    </section>
  );
}
