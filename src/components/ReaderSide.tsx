import type { PDFDocumentProxy } from 'pdfjs-dist';
import { useEffect, useRef, useState } from 'react';
import { count, t } from '../lib/i18n';
import { displayColor } from '../lib/ink';
import { collectNotes, type PageNotes } from '../lib/notes';
import { pageText } from '../lib/ocr';
import { renderPagePreview, type PageSize } from '../lib/pdf';
import type { DocInk, DocMeta } from '../lib/types';
import { NotePlusIcon, PenIcon, TextNoteIcon } from './icons';

// Thumbnails are drawn one at a time, so a long document does not crowd out the page being read.
let chain: Promise<unknown> = Promise.resolve();
const queue = <T,>(job: () => Promise<T>) => {
  const next = chain.then(() => new Promise((r) => setTimeout(r, 30))).then(job, job);
  chain = next.catch(() => undefined);
  return next;
};

function Thumb({ pdf, index, aspect, active, dark, onGo }: {
  pdf: PDFDocumentProxy; index: number; aspect: number; active: boolean; dark: boolean; onGo: (page: number) => void;
}) {
  const wrap = useRef<HTMLButtonElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = wrap.current;
    const root = el?.closest('.rail');
    if (!el || !root) return;
    const io = new IntersectionObserver((entries) => setNear(entries.some((e) => e.isIntersecting)), { root, rootMargin: '300px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    if (!near) { c.width = 0; c.height = 0; return; }
    let dead = false;
    void queue(async () => {
      if (dead) return;
      await renderPagePreview(pdf, index, c, Math.round(110 * Math.min(window.devicePixelRatio || 1, 2)));
    }).catch(() => undefined);
    return () => { dead = true; };
  }, [near, pdf, index]);
  return (
    <button ref={wrap} className={`rail-thumb${active ? ' on' : ''}`} data-thumb={index} onClick={() => onGo(index + 1)} aria-label={t('Page {n}', { n: index + 1 })} aria-current={active ? 'page' : undefined}>
      <span className="rail-sheet" style={{ aspectRatio: `1 / ${aspect}` }}>
        <canvas ref={canvas} className={dark ? 'night' : ''} />
      </span>
      <span className="rail-num">{index + 1}</span>
    </button>
  );
}

/** Small pictures of the pages, down the left side; a tap goes to one. */
export function PageRail({ pdf, sizes, current, dark, onGo }: {
  pdf: PDFDocumentProxy; sizes: PageSize[]; current: number; dark: boolean; onGo: (page: number) => void;
}) {
  const box = useRef<HTMLElement>(null);
  useEffect(() => {
    box.current?.querySelector(`[data-thumb="${current}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [current]);
  return (
    <aside className="rail" aria-label={t('Pages')} ref={box}>
      {sizes.map((s, i) => (
        <Thumb key={i} pdf={pdf} index={i} aspect={s.h / s.w} active={i === current} dark={dark} onGo={onGo} />
      ))}
    </aside>
  );
}

/** Everything marked in this document, page by page, and the notes made for the page being read. */
export function DocPanel({ pdf, docId, ink, current, dark, links, canNote, onGo, onOpen, onNote }: {
  pdf: PDFDocumentProxy | null;
  docId: string;
  ink: DocInk;
  current: number;
  dark: boolean;
  links: { doc: DocMeta; page: number; label: string; sub: string }[];
  /** A note can be made for this page (the document is not itself a note). */
  canNote: boolean;
  onGo: (page: number) => void;
  onOpen: (id: string, page: number) => void;
  onNote: () => void;
}) {
  const [notes, setNotes] = useState<PageNotes[] | null>(null);
  // Looked at again a moment after the marks stop changing.
  useEffect(() => {
    let dead = false;
    const timer = setTimeout(() => {
      void collectNotes(ink, pdf ? (p) => pageText(pdf, docId, p).then((x) => x.boxes) : null)
        .then((n) => { if (!dead) setNotes(n); })
        .catch(() => { if (!dead) setNotes([]); });
    }, 600);
    return () => { dead = true; clearTimeout(timer); };
  }, [ink, pdf, docId]);
  const total = (notes ?? []).reduce((a, n) => a + n.highlights.length + n.untextedHighlights + n.pens + (n.texts?.length ?? 0), 0);
  return (
    <aside className="docpanel" aria-label={t('This document')}>
      <h2>{t('This document')}</h2>
      <p className="docpanel-sub">{notes === null ? t('Looking…') : total ? t('{marks} on {pages}', { marks: count(total, 'mark', 'marks'), pages: count(notes.length, 'page', 'pages') }) : t('Nothing marked yet')}</p>
      {notes && notes.length === 0 && <p className="docpanel-empty">{t('Highlights, typed notes and pen marks collect here, page by page.')}</p>}
      <div className="docpanel-list">
        {(notes ?? []).map((n) => (
          <section key={n.page} className={`dp-page${n.page === current ? ' here' : ''}`}>
            <button className="dp-head" onClick={() => onGo(n.page + 1)}>{t('Page {n}', { n: n.page + 1 })}</button>
            {n.highlights.map((h, i) => (
              <button key={`h${i}`} className="dp-item" onClick={() => onGo(n.page + 1)}>
                <i className="dp-swatch" style={{ background: displayColor(h.color, dark) }} aria-hidden="true" />
                <span>{h.text}</span>
              </button>
            ))}
            {n.untextedHighlights > 0 && (
              <button className="dp-item muted" onClick={() => onGo(n.page + 1)}>
                <i className="dp-swatch" aria-hidden="true" /><span>{count(n.untextedHighlights, 'highlight', 'highlights')}</span>
              </button>
            )}
            {n.texts?.map((txt, i) => (
              <button key={`t${i}`} className="dp-item" onClick={() => onGo(n.page + 1)}>
                <TextNoteIcon /><span>{txt}</span>
              </button>
            ))}
            {n.pens > 0 && (
              <button className="dp-item muted" onClick={() => onGo(n.page + 1)}>
                <PenIcon /><span>{n.pens === 1 ? t('1 pen mark') : t('{n} pen marks', { n: n.pens })}</span>
              </button>
            )}
          </section>
        ))}
      </div>
      {(links.length > 0 || canNote) && (
        <section className="dp-notes">
          <h3>{t('Notes for page {n}', { n: current + 1 })}</h3>
          {links.map((l) => (
            <button key={`${l.doc.id}:${l.page}`} className="dp-item" onClick={() => onOpen(l.doc.id, l.page)}>
              <NotePlusIcon /><span>{l.label}<small>{l.sub}</small></span>
            </button>
          ))}
          {canNote && <button className="dp-add" onClick={onNote}><NotePlusIcon />{t('Add a note for this page')}</button>}
        </section>
      )}
    </aside>
  );
}
