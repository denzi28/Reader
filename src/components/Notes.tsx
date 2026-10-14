import type { PDFDocumentProxy } from 'pdfjs-dist';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { count, t } from '../lib/i18n';
import { drawStrokes } from '../lib/ink';
import { collectNotes, type PageNotes } from '../lib/notes';
import { pageText } from '../lib/ocr';
import { acquirePdf, releasePdf, renderPagePreview } from '../lib/pdf';
import { STABLE_BASE } from '../lib/book/model';
import { getBookMarks, getCachedNotes, getDocFile, getInkStamps, loadInk, putCachedNotes } from '../lib/storage';
import type { DocMeta } from '../lib/types';
import { BookLoader } from './BookLoader';
import { downloadPdf } from '../lib/sync/engine';
import { useDownloadProgress } from '../lib/sync/useSync';
import { HIGHLIGHTS, type HighlightColor } from '../lib/book/settings';
import { ArrowIcon, BackIcon, ChevronIcon, CloseIcon, FolderIcon, MarkIcon, PenIcon, TextNoteIcon } from './icons';

interface Props {
  /** Documents with marks, newest opened first. */
  docs: DocMeta[];
  folderName: (doc: DocMeta) => string | null;
  onOpen: (id: string, page: number) => void;
  /** Typed notes (docs): listed with their first lines. */
  typed?: DocMeta[];
}

/** A highlight made in book mode: the words, the colour, the reader's note, and the PDF page it is on (a PDF book). */
interface BookNote { text: string; color: string; note?: string; page?: number }

interface Loaded {
  notes: PageNotes[];
  /** Highlights made in book mode (left out of notes kept before they were shown here). */
  book?: BookNote[];
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
    doc = acquirePdf(id, () => getDocFile(id));
  }
  openDocs.set(id, doc);
  while (openDocs.size > MAX_OPEN) {
    const [oldest] = openDocs.keys();
    openDocs.delete(oldest);
    releasePdf(oldest);
  }
  return doc;
}
function closeDocs() {
  openDocs.forEach((_, id) => releasePdf(id));
  openDocs.clear();
}
let previewChain: Promise<unknown> = Promise.resolve();
const queuePreview = (job: () => Promise<void>) => {
  previewChain = previewChain.then(job, job).catch(() => undefined);
};

// Which documents are opened up, kept while the app is open.
let openDocs_ = new Set<string>();

/** A small picture of the page with its ink, drawn once it scrolls into view. */
function Preview({ id, page, hasFile, starting }: { id: string; page: number; hasFile: boolean; starting: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  // Coming down from Drive: the picture becomes a book with turning pages until it is here.
  const progress = useDownloadProgress(id);
  const fetching = !hasFile && (starting || progress !== null);
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
        await renderPagePreview(pdf, page, c, 260);
        const ctx = c.getContext('2d');
        if (gone || !ctx) return;
        // Thin pen lines would vanish at this size; draw every mark at least 2 px wide.
        const strokes = (ink[page] ?? []).map((st) => ({ ...st, size: Math.max(st.size, 2 / c.width) }));
        drawStrokes(ctx, strokes, c.width, false);
      });
    }, {
      // Within the sideways row of pages: draw those in view and the next one along.
      root: c.closest('.note-grid'),
      rootMargin: '0px 160px',
    });
    seen.observe(c);
    return () => { gone = true; seen.disconnect(); };
  }, [id, page, hasFile]);
  return (
    <span className="note-preview-wrap">
      <canvas ref={canvas} className="note-preview" width={260} height={367} aria-hidden="true" />
      {fetching && (
        <span className="note-fetching" role="status">
          <BookLoader size={22} label={t('Downloading from Google Drive')} />
          {progress !== null && <span>{Math.round(progress * 100)}%</span>}
        </span>
      )}
    </span>
  );
}

/**
 * One noted page, large: only that page is read and drawn, so it shows in a
 * moment however big the document. Steps through every noted page.
 */
function Peek({ stops, at, onMove, onOpen, onClose }: {
  stops: { doc: DocMeta; page: number }[];
  at: number;
  onMove: (i: number) => void;
  onOpen: (id: string, page: number) => void;
  onClose: () => void;
}) {
  const { doc, page } = stops[at];
  const canvas = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    let gone = false;
    setReady(false);
    (async () => {
      const [pdf, ink] = await Promise.all([docFor(doc.id), loadInk(doc.id)]);
      if (gone || !pdf) return;
      const box = c.parentElement!.getBoundingClientRect();
      const width = Math.round(Math.min(box.width, 900) * Math.min(window.devicePixelRatio || 1, 2));
      const off = document.createElement('canvas');
      await renderPagePreview(pdf, page, off, width);
      if (gone) return;
      drawStrokes(off.getContext('2d')!, ink[page] ?? [], off.width, false);
      c.width = off.width;
      c.height = off.height;
      c.getContext('2d')!.drawImage(off, 0, 0);
      setReady(true);
    })().catch(() => undefined);
    return () => { gone = true; };
  }, [doc.id, page]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && at > 0) onMove(at - 1);
      if (e.key === 'ArrowRight' && at < stops.length - 1) onMove(at + 1);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [at, stops.length, onMove, onClose]);
  // At the top of the page, clear of the animated notes list.
  return createPortal(
    <div className="peek" role="dialog" aria-modal="true" aria-label={t('{name}, page {n}', { name: doc.name, n: page + 1 })}>
      <div className="peek-backdrop" onClick={onClose} />
      <div className="peek-sheet">
        <header className="peek-head">
          <div className="peek-title">
            <strong>{doc.name}</strong>
            <span>{t('Page {n} of {total}', { n: page + 1, total: doc.pages })}</span>
          </div>
          <button className="icon-button" onClick={onClose} aria-label={t('Close')}><CloseIcon /></button>
        </header>
        <div className={`peek-page${ready ? ' ready' : ''}`}>
          <canvas ref={canvas} />
          {!ready && <span className="peek-loading" />}
        </div>
        <footer className="peek-foot">
          <button className="icon-button" disabled={at === 0} onClick={() => onMove(at - 1)} aria-label={t('Previous note')}><BackIcon /></button>
          <span className="peek-count">{at + 1} / {stops.length}</span>
          <button className="icon-button peek-next" disabled={at === stops.length - 1} onClick={() => onMove(at + 1)} aria-label={t('Next note')}><BackIcon /></button>
          <button className="button button-small peek-open" onClick={() => onOpen(doc.id, page)}>
            {t('Open in document')}
            <ArrowIcon />
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

/** Works out a document's notes from its ink and the PDF's text. */
async function readNotes(id: string): Promise<Loaded> {
  const [ink, pdf, marks] = await Promise.all([loadInk(id), acquirePdf(id, () => getDocFile(id)), getBookMarks(id)]);
  const book = Object.values(marks)
    .filter((m) => m.k === 'hl' && m.q)
    .sort((a, b) => a.a[0] - b.a[0] || a.a[1] - b.a[1])
    .map((m): BookNote => ({
      text: m.q!.replace(/\s+/g, ' ').trim(),
      color: HIGHLIGHTS[m.c as HighlightColor] ?? HIGHLIGHTS.yellow,
      ...(m.n?.trim() ? { note: m.n.trim() } : {}),
      ...(m.a[0] >= STABLE_BASE ? { page: Math.floor((m.a[0] - STABLE_BASE) / 4096) } : {}),
    }));
  try {
    return { notes: await collectNotes(ink, pdf ? (p) => pageText(pdf, id, p).then((x) => x.boxes) : null), book, hasFile: Boolean(pdf) };
  } finally {
    releasePdf(id);
  }
}

export function Notes({ docs, folderName, onOpen, typed = [] }: Props) {
  const [loaded, setLoaded] = useState<Map<string, Loaded>>(new Map());
  const [peek, setPeek] = useState<number | null>(null);
  // Documents being brought down from Drive, and the note to show once one is here.
  const [fetching, setFetching] = useState<ReadonlySet<string>>(new Set());
  const [want, setWant] = useState<{ id: string; page: number } | null>(null);
  const [opened, setOpened] = useState(openDocs_);
  const toggle = (id: string) => setOpened((cur) => {
    const next = new Set(cur);
    if (!next.delete(id)) next.add(id);
    openDocs_ = next;
    return next;
  });
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
        const usable = c && c.stamp === stamps.get(id) && c.notes.book !== undefined && (c.notes.hasFile || docs.find((d) => d.id === id)?.cloudOnly);
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

  // A note made for a page sits inside the document it was made for; one whose
  // document is not here stands on its own.
  const linkedTo = (id: string) => docs
    .filter((x) => x.attached?.doc === id)
    .sort((a, b) => a.attached!.page - b.attached!.page || a.addedAt - b.addedAt);
  const top = docs.filter((d) => !(d.attached && docs.some((x) => x.id === d.attached!.doc)));
  const ordered = top.flatMap((d) => [d, ...linkedTo(d.id)]);
  const markCount = (id: string) => (loaded.get(id)?.notes.reduce((a, p) => a + p.highlights.length + p.untextedHighlights + p.pens + (p.texts?.length ?? 0), 0) ?? 0) + (loaded.get(id)?.book?.length ?? 0);

  // Every noted page in order, for stepping through them in the large view.
  const stops = ordered.flatMap((d) => {
    const l = loaded.get(d.id);
    return l?.hasFile ? l.notes.map((p) => ({ doc: d, page: p.page })) : [];
  });

  useEffect(() => {
    if (!want) return;
    const i = stops.findIndex((s) => s.doc.id === want.id && s.page === want.page);
    if (i < 0) return;
    setWant(null);
    setPeek(i);
  }, [want, stops.length]); // eslint-disable-line react-hooks/exhaustive-deps

  /** A document that is only in Drive: bring it down (its notes' pictures show a turning book), then show the note. */
  const fetchThenShow = async (doc: DocMeta, page: number) => {
    if (fetching.has(doc.id)) return;
    setFetching((s) => new Set(s).add(doc.id));
    try {
      await downloadPdf(doc.id);
      const result = await readNotes(doc.id);
      if (!result.hasFile) throw new Error('not here');
      const stamps = await getInkStamps([doc.id]);
      void putCachedNotes(doc.id, { stamp: stamps.get(doc.id) ?? 0, notes: result });
      setLoaded((m) => new Map(m).set(doc.id, result));
      setWant({ id: doc.id, page });
    } catch {
      onOpen(doc.id, page); // the document's own screen says what went wrong
    } finally {
      setFetching((s) => { const n = new Set(s); n.delete(doc.id); return n; });
    }
  };

  const total = docs.reduce((n, d) => n + markCount(d.id), 0);

  /** What was highlighted and noted while reading it as a book: the words, the note, and where to find it. */
  const bookList = (d: DocMeta, l: Loaded) => (l.book?.length ? (
    <section className="note-book" aria-label={t('Highlights from book mode')}>
      <h3>{t('From reading as a book')}</h3>
      <ul>
        {l.book.map((b, i) => (
          <li key={i}>
            <button onClick={() => onOpen(d.id, b.page ?? 0)} style={{ ['--hl' as string]: b.color }}>
              <q>{b.text}</q>
              {b.note && <span className="note-book-note">{b.note}</span>}
              {b.page !== undefined && <span className="note-book-page">{t('p. {n}', { n: b.page + 1 })}</span>}
            </button>
          </li>
        ))}
      </ul>
    </section>
  ) : null);

  /** A document's noted pages as small pictures, with the highlighted text. */
  const grid = (d: DocMeta, l: Loaded) => (
    <ol className="note-grid">
      {l.notes.map((p) => {
        const marked = p.highlights.length + p.untextedHighlights;
        return (
          <li key={p.page}>
            <button
              className="note-tile"
              aria-label={t('Page {n}: {parts}', { n: p.page + 1, parts: [
                marked ? count(marked, 'highlight', 'highlights') : '',
                p.pens ? count(p.pens, 'pen mark', 'pen marks') : '',
                p.texts?.length ? count(p.texts.length, 'typed note', 'typed notes') : '',
              ].filter(Boolean).join(', ') })}
              onClick={() => (l.hasFile
                ? setPeek(stops.findIndex((s) => s.doc.id === d.id && s.page === p.page))
                : void fetchThenShow(d, p.page))}
            >
              <Preview id={d.id} page={p.page} hasFile={l.hasFile} starting={fetching.has(d.id)} />
              <span className="note-tile-foot">
                <span className="note-tile-page">{t('p. {n}', { n: p.page + 1 })}</span>
                <span className="note-tile-marks">
                  {marked > 0 && <span><MarkIcon />{marked}</span>}
                  {p.pens > 0 && <span><PenIcon />{p.pens}</span>}
                  {!!p.texts?.length && <span><TextNoteIcon />{p.texts.length}</span>}
                </span>
              </span>
              {p.highlights[0] && (
                <span className="note-snippet" style={{ ['--hl' as string]: p.highlights[0].color }}>
                  {p.highlights[0].text}
                </span>
              )}
              {p.texts?.[0] && <span className="note-snippet typed">{p.texts[0]}</span>}
            </button>
          </li>
        );
      })}
    </ol>
  );

  /** The notes typed as docs: a card each, with the first lines. */
  const docsList = typed.length > 0 && (
    <section className="note-docs" aria-label={t('Docs')}>
      <h3>{t('Docs')}</h3>
      <ul>
        {typed.map((d) => (
          <li key={d.id}>
            <button onClick={() => onOpen(d.id, 0)}>
              <b>{d.name}</b>
              {d.preview && <span>{d.preview}</span>}
              <small>{t('{n} words', { n: d.words ?? 0 })}{folderName(d) ? ` · ${folderName(d)}` : ''}</small>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );

  if (!docs.length && typed.length) {
    return (
      <section className="notes" aria-label={t('Notes')}>
        <div className="notes-head"><div><h2 className="notes-title">{t('Your notes')}</h2></div></div>
        {docsList}
      </section>
    );
  }
  if (!docs.length) {
    return (
      <section className="notes-empty">
        <span className="drop-icon"><MarkIcon /></span>
        <h2>{t('No notes yet')}</h2>
        <p>{t('Highlight or write on any page, or highlight while reading as a book, and it shows up here: the highlighted text, page by page.')}</p>
      </section>
    );
  }

  return (
    <section className="notes" aria-label={t('Notes')}>
      <div className="notes-head">
        <div>
          <h2 className="notes-title">{t('Your notes')}</h2>
          <p className="notes-sub">{t('{marks} in {docs}', { marks: count(total, 'mark', 'marks'), docs: count(top.length, 'document', 'documents') })}</p>
        </div>
      </div>

      {docsList}
      {top.map((d, i) => {
        const l = loaded.get(d.id);
        const isOpen = opened.has(d.id);
        const folder = folderName(d);
        const linked = linkedTo(d.id);
        const marks = markCount(d.id) + linked.reduce((n, x) => n + markCount(x.id), 0);
        const notedPages = (l?.notes.length ?? 0) + linked.reduce((n, x) => n + (loaded.get(x.id)?.notes.length ?? 0), 0);
        return (
          <article
            key={d.id}
            className={`note-doc${isOpen ? ' open' : ''}`}
            // Room kept for it while off screen (where it is not drawn), so scrolling doesn't jump.
            style={{ ['--i' as string]: i, containIntrinsicSize: `auto ${isOpen ? 330 : 72}px` }}
          >
            <button className="note-doc-head" aria-expanded={isOpen} onClick={() => toggle(d.id)}>
              <span className="note-doc-text">
                <span className="note-doc-name">{d.name}</span>
                <span className="note-doc-meta">
                  {folder && <><FolderIcon />{folder} · </>}
                  {l
                    ? [t('{marks} on {pages}', { marks: count(marks, 'mark', 'marks'), pages: count(notedPages, 'page', 'pages') }), ...(linked.length ? [count(linked.length, 'dedicated note', 'dedicated notes')] : [])].join(' · ')
                    : t('Reading…')}
                </span>
              </span>
              <span className="note-chevron" aria-hidden="true"><ChevronIcon /></span>
            </button>
            {!isOpen ? null : !l ? (
              <div className="note-loading" />
            ) : (
              <>
                {l.notes.length > 0 && grid(d, l)}
                {bookList(d, l)}
                {linked.map((n) => {
                  const nl = loaded.get(n.id);
                  return (
                    <section key={n.id} className="note-linked" aria-label={t('Note for page {n}', { n: n.attached!.page + 1 })}>
                      <div className="note-linked-head">
                        <span className="note-linked-text">
                          <b>{t('Note for page {n}', { n: n.attached!.page + 1 })}</b>
                          <span>{n.name}</span>
                        </span>
                        <button className="chip-button" onClick={() => onOpen(n.id, 0)}>{t('Open')} <ArrowIcon /></button>
                      </div>
                      {!nl ? <div className="note-loading" /> : nl.notes.length ? grid(n, nl) : <p className="empty-note">{t('Nothing written in it yet.')}</p>}
                    </section>
                  );
                })}
              </>
            )}
            {isOpen && l && !l.hasFile && l.notes.length > 0 && <p className="empty-note">{t('In your Google Drive only: tap a page to bring the document down and see it here.')}</p>}
          </article>
        );
      })}
      {peek !== null && stops[peek] && (
        <Peek
          stops={stops}
          at={peek}
          onMove={setPeek}
          onOpen={(id, page) => { setPeek(null); onOpen(id, page); }}
          onClose={() => setPeek(null)}
        />
      )}
    </section>
  );
}
