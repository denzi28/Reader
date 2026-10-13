import type { PDFDocumentProxy } from 'pdfjs-dist';
import { useEffect, useRef, useState } from 'react';
import { drawStrokes } from '../lib/ink';
import { collectNotes, type PageNotes } from '../lib/notes';
import { openPdfFile, pageTextBoxes, renderPagePreview } from '../lib/pdf';
import { getDocFile, loadInk } from '../lib/storage';
import type { DocInk, DocMeta } from '../lib/types';
import { CopyIcon, FolderIcon, MarkIcon, PenIcon, PrintIcon } from './icons';

interface Props {
  /** Documents with marks, newest opened first. */
  docs: DocMeta[];
  folderName: (doc: DocMeta) => string | null;
  dark: boolean;
  onOpen: (id: string, page: number) => void;
}

interface Loaded {
  notes: PageNotes[];
  ink: DocInk;
  pdf: PDFDocumentProxy | null;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** A small picture of the page with its ink drawn on top. */
function Preview({ pdf, page, ink, dark }: { pdf: PDFDocumentProxy | null; page: number; ink: DocInk; dark: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = canvas.current;
    if (!c || !pdf) return;
    let gone = false;
    void renderPagePreview(pdf, page, c, 180).then(() => {
      const ctx = c.getContext('2d');
      if (gone || !ctx) return;
      // Thin pen lines would vanish at this size; draw every mark at least 2 px wide.
      const strokes = (ink[page] ?? []).map((st) => ({ ...st, size: Math.max(st.size, 2 / c.width) }));
      drawStrokes(ctx, strokes, c.width, false);
    }).catch(() => undefined);
    return () => { gone = true; };
  }, [pdf, page, ink, dark]);
  return <canvas ref={canvas} className="note-preview" aria-hidden="true" />;
}

export function Notes({ docs, folderName, dark, onOpen }: Props) {
  const [loaded, setLoaded] = useState<Map<string, Loaded>>(new Map());
  const [copied, setCopied] = useState(false);
  const ids = docs.map((d) => d.id).join();

  // Read each document's notes in turn; the PDFs stay open for the previews.
  useEffect(() => {
    let gone = false;
    const opened: PDFDocumentProxy[] = [];
    (async () => {
      for (const d of docs) {
        const [ink, file] = await Promise.all([loadInk(d.id), getDocFile(d.id)]);
        const pdf = file ? await openPdfFile(file).catch(() => null) : null;
        if (pdf) opened.push(pdf);
        if (gone) return;
        const notes = await collectNotes(ink, pdf ? (p) => pageTextBoxes(pdf, p) : null);
        if (gone) return;
        setLoaded((m) => new Map(m).set(d.id, { notes, ink, pdf }));
      }
    })();
    return () => {
      gone = true;
      opened.forEach((p) => void p.loadingTask.destroy());
    };
  }, [ids]); // eslint-disable-line react-hooks/exhaustive-deps

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
          <article key={d.id} className="note-doc" style={{ ['--i' as string]: i }}>
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
                      <Preview pdf={l.pdf} page={p.page} ink={l.ink} dark={dark} />
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
            {!l?.pdf && l && <p className="empty-note">This document is in your Google Drive only. Open it once to see the highlighted text.</p>}
          </article>
        );
      })}
    </section>
  );
}
