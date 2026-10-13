import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointer } from 'react';
import { posFromPoint, posNear, pickedSelection, rectOfPos, type Picked } from '../lib/book/dom';
import { loadBook, NoTextError, type Loaded } from '../lib/book/load';
import {
  chapterTitle, fractionAt, formatLeft, fromStable, posAtFraction, sliceText, toStable, WORDS_PER_MINUTE, type Pos,
} from '../lib/book/model';
import {
  HIGHLIGHT_NAMES, LINE_HEIGHT, MARGIN, useBookSettings, FONT_STACKS, type HighlightColor,
} from '../lib/book/settings';
import { acquirePdf, releasePdf } from '../lib/pdf';
import { ocrEstimate, recognisePages, recognisedPages } from '../lib/ocr';
import { getBookMarks, getDocFile, patchMeta, recordBookMark } from '../lib/storage';
import { onRemoteInk, syncDoc } from '../lib/sync/engine';
import type { BookMark } from '../lib/types';
import { usePhone } from '../lib/usePhone';
import { BlockView, type MarkRange } from './BookText';
import { BookSheet, ContentsPanel, MarkBar, NoteEditor, ReadingPanel } from './BookSheets';
import { BookLoader } from './BookLoader';
import { PageBook } from './PageBook';
import {
  AaIcon, BackIcon, BookmarkIcon, BookOpenIcon, ListIcon, MoonIcon, MoreVIcon, SearchIcon, SunIcon,
} from './icons';

interface Props {
  docId: string;
  startPage?: number;
  dark: boolean;
  onTheme: () => void;
  onClose: () => void;
  /** Go to the original PDF (not for ePub books). */
  onPdf?: () => void;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const GAP = 72;
const before = (a: Pos, b: Pos) => a.b < b.b || (a.b === b.b && a.o < b.o);

export interface ScanState { done: number; total: number }
/** Which pages to read: this many from this page on. */
export interface ScanOnly { from: number; count: number }

/** Loads the book (making it from a PDF the first time), then hands it to the reader. */
export function BookReader(props: Props) {
  const { docId } = props;
  const [data, setData] = useState<Loaded | null>(null);
  const [state, setState] = useState<{ progress: number } | { error: string; scanned: boolean } | null>({ progress: 0 });
  const [scan, setScan] = useState<ScanState | null>(null);
  const gone = useRef(false);
  const rebuilding = useRef(false);
  const scanning = useRef(false);
  const current = useRef<Loaded | null>(null);

  useEffect(() => {
    gone.current = false;
    let last = 0;
    setState({ progress: 0 });
    loadBook(docId, (done, total) => {
      const now = performance.now();
      if (gone.current || (now - last < 120 && done < total)) return;
      last = now;
      setState({ progress: done / Math.max(1, total) });
    }, () => gone.current).then((l) => {
      if (gone.current) { l.dispose(); return; }
      current.current = l;
      setData(l);
      setState(null);
    }).catch((err: unknown) => {
      if (gone.current) return;
      setState({ error: err instanceof Error ? err.message : 'Could not open this book.', scanned: err instanceof NoTextError });
    });
    return () => { gone.current = true; current.current?.dispose(); };
  }, [docId]);

  /** Makes the book again from the pages read so far, and swaps it in under the reader. */
  const rebuild = async (partial: boolean) => {
    if (rebuilding.current) return false;
    rebuilding.current = true;
    try {
      const fresh = await loadBook(docId, () => undefined, () => gone.current, { partial });
      if (gone.current) { fresh.dispose(); return false; }
      current.current?.dispose();
      current.current = fresh;
      setData(fresh);
      setState(null);
      return true;
    } catch (err) {
      if (!(err instanceof NoTextError)) console.warn('Could not rebuild the book', err);
      return false;
    } finally {
      rebuilding.current = false;
    }
  };

  /**
   * Reads the pages that have no text, from their pictures. The book opens as soon as the first
   * pages are read and grows as the rest come in, so there is no waiting for a whole scan.
   */
  const startScan = async (only?: ScanOnly) => {
    if (scanning.current) return;
    scanning.current = true;
    const file = await getDocFile(docId);
    const pdf = file ? await acquirePdf(docId, async () => file) : null;
    if (!pdf) { scanning.current = false; return; }
    try {
      const read = await recognisedPages(docId);
      const blank = current.current?.book.blank;
      // The pages with no text (all of them, when nothing has been read yet), minus those already read.
      let todo = (blank ?? Array.from({ length: pdf.numPages }, (_, i) => i)).filter((i) => !read.has(i));
      // From where the reader is (a few pages, or on to the end and then the pages before).
      if (only) {
        const after = todo.filter((i) => i >= only.from);
        todo = [...after, ...todo.filter((i) => i < only.from)].slice(0, only.count);
      }
      if (!todo.length) return;
      setScan({ done: 0, total: todo.length });
      const first = Math.min(3, todo.length);
      const step = Math.max(8, Math.ceil(todo.length / 20));
      let built = current.current !== null;
      let at = 0;
      await recognisePages(pdf, docId, todo, (done, total) => {
        setScan({ done, total });
        if (done >= total || gone.current) return;
        if (done - at >= (built ? step : first)) {
          at = done;
          void rebuild(true).then((ok) => { if (ok) built = true; });
        }
      }, () => gone.current);
    } catch (err) {
      console.warn('Reading the pages stopped', err);
    } finally {
      releasePdf(docId);
      scanning.current = false;
      setScan(null);
    }
    if (!gone.current) {
      // The whole book, kept for next time. (If reading was cut short, what was read is still kept and the
      // book is offered again with the rest to read.)
      while (rebuilding.current) await new Promise((r) => setTimeout(r, 100));
      await rebuild(false);
    }
  };

  // (one function for good, so the pages of the book are not drawn again each time the scan moves on)
  const startRef = useRef(startScan);
  startRef.current = startScan;
  const scanFn = useCallback((only?: ScanOnly) => { void startRef.current(only); }, []);

  if (data) return <Reader data={data} {...props} scan={scan} onScan={scanFn} />;
  const error = state && 'error' in state ? state : null;
  // A scanned PDF opens as its own pages; reading them into text is only offered when something needs text.
  if (error?.scanned) {
    return <PageBook docId={docId} startPage={props.startPage} dark={props.dark} onTheme={props.onTheme} onClose={props.onClose} onPdf={props.onPdf} scan={scan} onScan={scanFn} />;
  }
  const progress = state && 'progress' in state ? state.progress : 0;
  return (
    <div className="viewer-loading loading bk-loading" role="status">
      {error ? (
        <div className="bk-problem">
          <h2>This could not be opened as a book</h2>
          <p>{error.error}</p>
          <div className="bk-problem-actions">
            {props.onPdf && <button className="button" onClick={props.onPdf}>Open the PDF</button>}
            <button className="chip-button" onClick={props.onClose}>Back</button>
          </div>
        </div>
      ) : (
        <>
          <BookLoader size={46} label="Preparing your book" />
          <span>{progress > 0 ? `Preparing your book… ${Math.round(progress * 100)}%` : 'Preparing your book…'}</span>
        </>
      )}
    </div>
  );
}

function Reader({ data, docId, startPage, dark, onTheme, onClose, onPdf, scan, onScan }: Props & { data: Loaded; scan: ScanState | null; onScan: (only?: ScanOnly) => void }) {
  const { meta, book, ix, image } = data;
  const phone = usePhone();
  const [settings, change] = useBookSettings();
  const themeNow = settings.theme === 'auto' ? (dark ? 'night' : 'paper') : settings.theme;
  const reduced = useMemo(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches, []);

  // ---- where the reader is --------------------------------------------------
  const lastBlock = ix.blocks.length - 1;
  const initial = useMemo<Pos>(() => {
    if (book.fromPdf) {
      const page = startPage ?? meta.lastPage;
      const saved = meta.bookPos ? { b: fromStable(ix, meta.bookPos.b), o: meta.bookPos.o } : undefined;
      const savedPage = saved ? ix.blocks[saved.b]?.pg : undefined;
      if (saved && startPage === undefined && savedPage === meta.lastPage) return saved;
      const b = ix.blocks.findIndex((x) => (x.pg ?? 0) >= page);
      return { b: b < 0 ? 0 : b, o: 0 };
    }
    return meta.bookPos ? { b: fromStable(ix, meta.bookPos.b), o: meta.bookPos.o } : { b: 0, o: 0 };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const posRef = useRef<Pos>(initial);
  const [pos, setPos] = useState<Pos>(initial);
  const [chapter, setChapter] = useState(() => ix.chapterOf[Math.min(initial.b, lastBlock)] ?? 0);
  const [screen, setScreen] = useState(0);
  const [screens, setScreens] = useState(1);
  const [anim, setAnim] = useState(false);
  const pending = useRef<'last' | number | null>(null);

  const saveTimer = useRef(0);
  const save = useCallback(() => {
    clearTimeout(saveTimer.current);
    saveTimer.current = 0;
    const p = posRef.current;
    // The shelf shows progress as a page: the PDF's own page, or for a book how far through it is.
    const page = book.fromPdf ? ix.blocks[p.b]?.pg : Math.floor(fractionAt(ix, p) * meta.pages);
    void patchMeta(docId, {
      bookPos: { b: toStable(ix, p.b), o: p.o },
      ...(page !== undefined ? { lastPage: Math.min(page, Math.max(0, meta.pages - 1)) } : {}),
    });
  }, [docId, book.fromPdf, ix, meta.pages]);
  const commitPos = useCallback((p: Pos) => {
    posRef.current = p;
    setPos(p);
    clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(save, 700);
  }, [save]);
  useEffect(() => {
    const flush = () => { if (saveTimer.current) save(); };
    window.addEventListener('pagehide', flush);
    return () => { window.removeEventListener('pagehide', flush); flush(); };
  }, [save]);
  useEffect(() => {
    void patchMeta(docId, { openedAt: Date.now(), view: 'book' });
    void syncDoc(docId);
  }, [docId]);

  // ---- marks -------------------------------------------------------------------
  const [marks, setMarks] = useState<Record<string, BookMark>>({});
  useEffect(() => {
    let on = true;
    const load = () => void getBookMarks(docId).then((m) => { if (on) setMarks(m); });
    load();
    const off = onRemoteInk(docId, load);
    return () => { on = false; off(); };
  }, [docId]);
  // Marks are kept by stable places (see BookIndex.stable); here they are used by block number.
  const live = useMemo(() => {
    const out: Record<string, BookMark> = {};
    for (const [id, m] of Object.entries(marks)) {
      out[id] = { ...m, a: [fromStable(ix, m.a[0]), m.a[1]], ...(m.z ? { z: [fromStable(ix, m.z[0]), m.z[1]] as [number, number] } : {}) };
    }
    return out;
  }, [marks, ix]);
  /** Saves a mark given by block numbers (or removes it when `mark` is null). */
  const putMark = (id: string, mark: BookMark | null) => {
    const kept = mark && {
      ...mark,
      a: [toStable(ix, mark.a[0]), mark.a[1]] as [number, number],
      ...(mark.z ? { z: [toStable(ix, mark.z[0]), mark.z[1]] as [number, number] } : {}),
    };
    setMarks((m) => {
      const next = { ...m };
      if (kept) next[id] = kept; else delete next[id];
      return next;
    });
    void recordBookMark(docId, id, kept);
  };
  const ranges = useMemo(() => {
    const map = new Map<number, MarkRange[]>();
    for (const [id, m] of Object.entries(live)) {
      if (m.k !== 'hl' || !m.z) continue;
      const color = (HIGHLIGHT_NAMES as string[]).includes(m.c ?? '') ? (m.c as HighlightColor) : 'yellow';
      for (let b = m.a[0]; b <= m.z[0] && b < ix.blocks.length; b++) {
        const t = ix.blocks[b];
        const len = t.t === 'p' || t.t === 'h' ? t.x.length : 0;
        const start = b === m.a[0] ? m.a[1] : 0;
        const end = b === m.z[0] ? m.z[1] : len;
        if (end > start) (map.get(b) ?? map.set(b, []).get(b)!).push({ id, start, end, color, note: Boolean(m.n) });
      }
    }
    return map;
  }, [live, ix]);

  // ---- the page ------------------------------------------------------------------
  const viewRef = useRef<HTMLDivElement>(null);
  const flowRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = viewRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setBox({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const paged = settings.flow === 'pages';
  const dims = useMemo(() => {
    const cols = !phone && settings.spread === 'two' && box.w >= 900 ? 2 : 1;
    if (phone) {
      const padX = clamp(box.w * MARGIN[settings.margins], 20, 56);
      const clipW = Math.max(120, Math.floor(box.w - 2 * padX));
      return { cols, gap: 32, clipW, clipH: Math.max(120, box.h - 20), clipLeft: padX, clipTop: 10, sheetW: box.w, sheetH: box.h, sheetLeft: 0, sheetTop: 0, stride: clipW + 32, padX, measure: 0 };
    }
    const measure = { narrow: 760, medium: 660, wide: 560 }[settings.margins] * (cols === 2 ? 0.74 : 1);
    const padX = 52;
    const colW = Math.max(240, Math.min(measure, ((box.w - 2 * padX - 48) - (cols - 1) * GAP) / cols));
    const clipW = Math.floor(cols * colW + (cols - 1) * GAP);
    const sheetH = Math.max(200, box.h - 12);
    const sheetW = clipW + 2 * padX;
    return {
      cols, gap: GAP, clipW, clipH: sheetH - 80, clipLeft: padX, clipTop: 40, sheetW, sheetH,
      sheetLeft: Math.max(0, (box.w - sheetW) / 2), sheetTop: 6, stride: clipW + GAP, padX: 40, measure,
    };
  }, [box.w, box.h, phone, settings.margins, settings.spread]);

  // Which block starts where, in the chapter on screen (the flow's children, in order).
  const screenOfPos = useCallback((p: Pos) => {
    const f = flowRef.current;
    if (!f) return 0;
    const r = rectOfPos(f, p);
    if (!r) return 0;
    return Math.max(0, Math.floor((r.left - f.getBoundingClientRect().left + 1) / dims.stride));
  }, [dims.stride]);

  /** The first place on a screen: the first line at or after its left edge. */
  const posOfScreen = useCallback((s: number): Pos => {
    const f = flowRef.current;
    if (!f) return posRef.current;
    const x0 = s * dims.stride;
    const base = f.getBoundingClientRect().left;
    const kids = f.children;
    let lo = 0;
    let hi = kids.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const rs = kids[mid].getClientRects();
      const last = rs.length ? rs[rs.length - 1] : kids[mid].getBoundingClientRect();
      if (last.right - base > x0 + 2) { found = mid; hi = mid - 1; } else lo = mid + 1;
    }
    if (found < 0) found = kids.length - 1;
    const el = kids[found] as HTMLElement;
    const b = Number(el.dataset.b);
    const rs = el.getClientRects();
    const first = rs.length ? rs[0] : el.getBoundingClientRect();
    if (first.left - base >= x0 - 2) return { b, o: 0 };
    // The block began on an earlier screen: find the first character that is on this one.
    const len = Number(el.dataset.len) || 0;
    let a = 0;
    let z = len;
    while (a < z) {
      const mid = (a + z) >> 1;
      const r = rectOfPos(f, { b, o: mid });
      if (r && r.left - base >= x0 - 2) z = mid; else a = mid + 1;
    }
    return { b, o: a };
  }, [dims.stride]);

  const measure = useCallback(() => {
    const f = flowRef.current;
    if (!f || !paged) return;
    const n = Math.max(1, Math.ceil((f.scrollWidth + dims.gap) / dims.stride - 0.02));
    const want = pending.current;
    pending.current = null;
    let s = want === 'last' ? n - 1 : typeof want === 'number' ? want : screenOfPos(posRef.current);
    s = clamp(s, 0, n - 1);
    setAnim(false);
    setScreens(n);
    setScreen(s);
    if (want === 'last') commitPos(posOfScreen(s));
  }, [paged, dims.gap, dims.stride, screenOfPos, posOfScreen, commitPos]);

  useLayoutEffect(() => { measure(); }, [measure, chapter, dims.clipW, dims.clipH, dims.cols, settings.font, settings.size, settings.spacing, settings.flow, box.w, box.h]);
  useEffect(() => { void document.fonts?.ready.then(measure); }, [measure]);

  const turnTo = useCallback((s: number) => {
    setAnim(!reduced);
    setScreen(s);
    commitPos(posOfScreen(s));
    if (phone) setChrome(false);
  }, [reduced, posOfScreen, commitPos, phone]);

  const shown = useRef(0);
  useLayoutEffect(() => {
    const f = flowRef.current;
    const from = shown.current;
    shown.current = screen;
    if (!f || !anim || from === screen) return;
    const slide = f.animate(
      [{ transform: `translateX(${(screen - from) * dims.stride}px)` }, { transform: 'translateX(0)' }],
      { duration: 260, easing: 'cubic-bezier(.3,.7,.2,1)' },
    );
    return () => slide.cancel();
  }, [screen]); // eslint-disable-line react-hooks/exhaustive-deps

  const openChapter = useCallback((c: number, where: 'first' | 'last') => {
    pending.current = where === 'last' ? 'last' : 0;
    if (where === 'first') commitPos({ b: ix.first[c], o: 0 });
    setChapter(c);
    if (phone) setChrome(false);
  }, [ix, commitPos, phone]);

  const next = useCallback(() => {
    if (!paged) {
      const el = scrollRef.current;
      el?.scrollBy({ top: el.clientHeight * 0.9, behavior: reduced ? 'auto' : 'smooth' });
      return;
    }
    if (screen + 1 < screens) turnTo(screen + 1);
    else if (chapter + 1 < book.chapters.length) openChapter(chapter + 1, 'first');
  }, [paged, screen, screens, chapter, book.chapters.length, turnTo, openChapter, reduced]);
  const prev = useCallback(() => {
    if (!paged) {
      const el = scrollRef.current;
      el?.scrollBy({ top: -el.clientHeight * 0.9, behavior: reduced ? 'auto' : 'smooth' });
      return;
    }
    if (screen > 0) turnTo(screen - 1);
    else if (chapter > 0) openChapter(chapter - 1, 'last');
  }, [paged, screen, chapter, turnTo, openChapter, reduced]);

  /** Scroll mode: put a place at the top. */
  const scrollToPos = useCallback((p: Pos) => {
    const el = scrollRef.current;
    if (!el) return;
    const place = () => {
      const r = rectOfPos(el, p);
      if (r) el.scrollTop += r.top - el.getBoundingClientRect().top - 12;
    };
    place();
    requestAnimationFrame(() => { place(); requestAnimationFrame(place); });
  }, []);

  /** Goes to any place in the book. */
  const goTo = useCallback((p: Pos, keepSearch = false) => {
    const b = clamp(p.b, 0, lastBlock);
    const place = { b, o: p.o };
    const c = ix.chapterOf[b];
    commitPos(place);
    if (!keepSearch) setTerm('');
    setPanel(null);
    if (phone) setChrome(false);
    if (!paged) { scrollToPos(place); return; }
    if (c !== chapter) { pending.current = null; setChapter(c); return; }
    const s = screenOfPos(place);
    setAnim(false);
    setScreen(clamp(s, 0, screens - 1));
  }, [ix, lastBlock, commitPos, paged, scrollToPos, chapter, screenOfPos, screens, phone]);

  // The book grew (more scanned pages were read): block numbers moved, so the place is found again by its
  // stable anchor, and the page is laid out again around it.
  const lastBook = useRef(book);
  const lastIx = useRef(ix);
  useLayoutEffect(() => {
    if (lastBook.current === book) return;
    const old = lastIx.current;
    lastBook.current = book;
    lastIx.current = ix;
    const from = posRef.current;
    const id = toStable(old, from.b);
    const b = fromStable(ix, id);
    const here: Pos = { b, o: ix.stable[b] === id ? from.o : 0 };
    posRef.current = here;
    setPos(here);
    if (!paged) { scrollToPos(here); return; }
    const c = ix.chapterOf[Math.min(b, lastBlock)] ?? 0;
    if (c !== chapter) { pending.current = null; setChapter(c); } else measure();
  }, [book]); // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll mode: the place follows the scrolling, and a settings change keeps the place.
  useLayoutEffect(() => {
    if (!paged) scrollToPos(posRef.current);
  }, [paged, settings.font, settings.size, settings.spacing, box.w, scrollToPos]);
  const scrollTick = useRef(0);
  const onScroll = () => {
    if (scrollTick.current) return;
    scrollTick.current = requestAnimationFrame(() => {
      scrollTick.current = 0;
      const el = scrollRef.current;
      if (!el) return;
      const p = posNear(el.getBoundingClientRect(), 16);
      if (p) commitPos(p);
    });
  };

  // ---- chrome and panels --------------------------------------------------------------
  const [chrome, setChrome] = useState(true);
  const showChrome = chrome || !phone;
  const [panel, setPanel] = useState<null | 'aa' | 'contents' | 'menu'>(null);
  const [tab, setTab] = useState<'contents' | 'marks' | 'search'>('contents');
  const [term, setTerm] = useState('');
  const [scrub, setScrub] = useState<number | null>(null);
  const open = (p: 'aa' | 'contents', t?: 'contents' | 'marks' | 'search') => {
    setPanel((cur) => (cur === p && (!t || t === tab) ? null : p));
    if (t) setTab(t);
  };

  // ---- reading the room ----------------------------------------------------------------
  const frac = fractionAt(ix, pos);
  const shownFrac = scrub ?? frac;
  const toc = book.toc;
  const currentToc = useMemo(() => {
    let cur = 0;
    for (let i = 0; i < toc.length; i++) if (ix.first[toc[i].c] + toc[i].b <= pos.b) cur = i;
    return cur;
  }, [toc, ix, pos.b]);
  const chapterIdx = ix.chapterOf[Math.min(pos.b, lastBlock)] ?? 0;
  const title = toc[currentToc]?.title ?? chapterTitle(book, ix, pos.b);
  const wordsHere = ix.words[Math.min(pos.b, lastBlock)] ?? 0;
  const chapterLeft = Math.max(0, (ix.words[ix.first[chapterIdx + 1]] ?? ix.total) - wordsHere) / WORDS_PER_MINUTE;
  const bookLeft = Math.max(0, ix.total * (1 - shownFrac)) / WORDS_PER_MINUTE;
  // Pages: counted by the screen being read, with the rest of the book estimated by words per screen.
  const chapterWords = (ix.words[ix.first[chapter + 1]] ?? ix.total) - (ix.words[ix.first[chapter]] ?? 0);
  const perScreen = paged && screens > 1 && chapterWords > 150 ? chapterWords / screens : 220 * dims.cols;
  const totalScreens = Math.max(1, Math.round(ix.total / perScreen));
  const screenNow = clamp(Math.floor(shownFrac * totalScreens) + 1, 1, totalScreens);
  // A book made from a PDF says which page of the PDF it is on (steady while the rest is still being read).
  const pdfPage = book.fromPdf ? (ix.blocks[Math.min((scrub !== null ? posAtFraction(ix, scrub) : pos).b, lastBlock)]?.pg ?? 0) + 1 : 0;
  const pageLabel = !paged ? `${Math.round(shownFrac * 100)}%`
    : book.fromPdf ? `Page ${Math.min(pdfPage, meta.pages)} of ${meta.pages}`
    : dims.cols === 2 ? `Pages ${screenNow * 2 - 1}–${screenNow * 2} of ${totalScreens * 2}` : `Page ${screenNow} of ${totalScreens}`;

  // ---- touching the page -------------------------------------------------------------------
  const down = useRef<{ x: number; y: number; t: number } | null>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [markBar, setMarkBar] = useState<{ id: string; rect: DOMRect } | null>(null);
  const [noteFor, setNoteFor] = useState<{ id: string } | null>(null);
  const clearPick = () => { window.getSelection()?.removeAllRanges(); setPicked(null); };

  const onDown = (e: ReactPointer) => { down.current = { x: e.clientX, y: e.clientY, t: e.timeStamp }; };
  const onUp = (e: ReactPointer) => {
    const d = down.current;
    down.current = null;
    if (!d || panel) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    const dt = e.timeStamp - d.t;
    const selecting = !!window.getSelection()?.toString();
    if (paged && e.pointerType !== 'mouse' && Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.4 && dt < 700 && !selecting) {
      if (dx < 0) next(); else prev();
      return;
    }
    if (Math.hypot(dx, dy) > 10 || dt > 450 || selecting) return;
    const hit = (e.target as Element).closest<HTMLElement>('[data-m]');
    if (hit?.dataset.m) { setMarkBar({ id: hit.dataset.m, rect: hit.getBoundingClientRect() }); return; }
    if (markBar || picked) { setMarkBar(null); clearPick(); return; }
    const r = viewRef.current!.getBoundingClientRect();
    const rel = (e.clientX - r.left) / r.width;
    const edge = phone ? 0.3 : 0.16;
    if (paged && rel < edge) prev();
    else if (paged && rel > 1 - edge) next();
    else if (phone) setChrome((c) => !c);
  };

  const wheelLock = useRef(0);
  const wheel = useRef(0);
  useEffect(() => {
    const el = viewRef.current;
    if (!el || !paged) return;
    const onWheel = (e: WheelEvent) => {
      if (panel) return;
      e.preventDefault();
      if (performance.now() < wheelLock.current) return;
      wheel.current += Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (Math.abs(wheel.current) < 40) return;
      if (wheel.current > 0) next(); else prev();
      wheel.current = 0;
      wheelLock.current = performance.now() + 380;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [paged, panel, next, prev]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (panel || noteFor || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (['ArrowRight', 'PageDown'].includes(e.key) || (e.key === ' ' && !e.shiftKey)) { e.preventDefault(); next(); }
      else if (['ArrowLeft', 'PageUp'].includes(e.key) || (e.key === ' ' && e.shiftKey)) { e.preventDefault(); prev(); }
      else if (e.key === 'ArrowDown' && paged) { e.preventDefault(); next(); }
      else if (e.key === 'ArrowUp' && paged) { e.preventDefault(); prev(); }
      else if (e.key === 'Home') goTo({ b: 0, o: 0 });
      else if (e.key === 'End') goTo({ b: lastBlock, o: 0 });
      else if (e.key === 'Escape' && (picked || markBar)) { setMarkBar(null); clearPick(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [panel, noteFor, next, prev, paged, goTo, lastBlock, picked, markBar]);

  // A selection offers highlighting.
  const contentRoot = () => (paged ? flowRef.current : scrollRef.current);
  useEffect(() => {
    let timer = 0;
    const onChange = () => {
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        const root = contentRoot();
        const p = root ? pickedSelection(root) : null;
        setPicked(p);
        if (p) setMarkBar(null);
      }, 140);
    };
    document.addEventListener('selectionchange', onChange);
    return () => { clearTimeout(timer); document.removeEventListener('selectionchange', onChange); };
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const newId = () => `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const highlight = (color: HighlightColor, withNote = false) => {
    if (!picked) return;
    const id = newId();
    putMark(id, { k: 'hl', a: [picked.a.b, picked.a.o], z: [picked.z.b, picked.z.o], c: color, q: picked.text.slice(0, 300) });
    clearPick();
    if (withNote) setNoteFor({ id });
  };
  const copyPicked = () => {
    if (picked) void navigator.clipboard?.writeText(picked.text).catch(() => undefined);
    clearPick();
  };

  // Bookmarks: the screen being read has one, or not.
  const screenSpan = useCallback((): [Pos, Pos] => {
    const from = posRef.current;
    if (!paged) {
      const el = scrollRef.current;
      const r = el?.getBoundingClientRect();
      const end = r ? posFromPoint(r.left + 20, r.bottom - 10) : null;
      return [from, end ?? { b: lastBlock, o: Number.MAX_SAFE_INTEGER }];
    }
    if (screen + 1 < screens) return [from, posOfScreen(screen + 1)];
    return [from, { b: ix.first[chapter + 1] - 1, o: Number.MAX_SAFE_INTEGER }];
  }, [paged, screen, screens, posOfScreen, ix, chapter, lastBlock]);
  const bookmarksHere = (): string[] => {
    const [from, to] = screenSpan();
    return Object.entries(live).filter(([, m]) => m.k === 'bm' && !before({ b: m.a[0], o: m.a[1] }, from) && before({ b: m.a[0], o: m.a[1] }, to)).map(([id]) => id);
  };
  const marked = useMemo(() => bookmarksHere().length > 0, [live, pos, screen, screens, chapter, paged]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggleBookmark = () => {
    const here = bookmarksHere();
    if (here.length) { here.forEach((id) => putMark(id, null)); return; }
    const p = posRef.current;
    putMark(newId(), { k: 'bm', a: [p.b, p.o], q: sliceText(ix, p, { b: Math.min(p.b + 1, lastBlock), o: 0 }, 90) });
  };

  const editedMark = noteFor ? live[noteFor.id] : undefined;
  const barMark = markBar ? live[markBar.id] : undefined;
  const barColor = barMark?.c as HighlightColor | undefined;

  // ---- drawing ---------------------------------------------------------------------------------
  const lang = book.lang || (book.fromPdf ? undefined : 'en');
  const vars = {
    ['--bk-fs' as string]: `${settings.size}px`,
    ['--bk-lh' as string]: LINE_HEIGHT[settings.spacing],
    ['--bk-font' as string]: FONT_STACKS[settings.font],
    ['--bk-ch' as string]: `${dims.clipH}px`,
    ['--bk-pad' as string]: `${dims.padX}px`,
    ['--bk-measure' as string]: dims.measure ? `${dims.measure}px` : 'none',
  };
  const termLower = term.trim().toLowerCase();
  const searching = panel === 'contents' && tab === 'search' && termLower.length >= 2 ? termLower : '';
  const onImage = useCallback(() => { requestAnimationFrame(measure); }, [measure]);
  const blockEls = (from: number, to: number) => {
    const out = [];
    for (let i = from; i < to; i++) {
      out.push(<BlockView key={i} block={ix.blocks[i]} index={i} marks={ranges.get(i)} term={searching} image={image} onImage={onImage} />);
    }
    return out;
  };
  const stepsLeft = paged ? screens - screen - 1 : 1;
  void stepsLeft;

  const slider = (
    <input
      type="range" className="bk-slider" min={0} max={1000} value={Math.round(shownFrac * 1000)} aria-label="Position in the book"
      aria-valuetext={`${Math.round(shownFrac * 100)} percent`}
      onChange={(e) => setScrub(Number(e.target.value) / 1000)}
      onPointerUp={() => { if (scrub !== null) { const f = scrub; setScrub(null); goTo(posAtFraction(ix, f)); } }}
      onKeyUp={() => { if (scrub !== null) { const f = scrub; setScrub(null); goTo(posAtFraction(ix, f)); } }}
      onBlur={() => setScrub(null)}
      style={{ ['--p' as string]: `${shownFrac * 100}%` }}
    />
  );
  const scrubTitle = scrub !== null ? chapterTitle(book, ix, posAtFraction(ix, scrub).b) : '';

  const toolRow = (
    <div className="bk-tools">
      <button className="bk-tool" onClick={() => open('contents', 'contents')} aria-label="Contents" aria-pressed={panel === 'contents' && tab === 'contents'}><ListIcon /></button>
      <button className="bk-tool" onClick={() => open('contents', 'search')} aria-label="Search" aria-pressed={panel === 'contents' && tab === 'search'}><SearchIcon /></button>
      <button className={`bk-tool${marked ? ' on' : ''}`} onClick={toggleBookmark} aria-label={marked ? 'Remove bookmark' : 'Add bookmark'} aria-pressed={marked}><BookmarkIcon filled={marked} /></button>
      <button className="bk-tool" onClick={() => open('aa')} aria-label="Reading settings" aria-pressed={panel === 'aa'}><AaIcon /></button>
      {onPdf && <button className="bk-tool on" onClick={onPdf} aria-label="Back to the original PDF" title="Back to the original PDF"><BookOpenIcon /></button>}
    </div>
  );

  return (
    <div className={`bk bk-t-${themeNow} ${phone ? 'bk-phone' : 'bk-desk'}${showChrome ? '' : ' bk-quiet'}`} style={vars} lang={lang} data-flow={settings.flow} data-cols={dims.cols}>
      <header className="bk-top">
        <button className="bk-icon" onClick={onClose} aria-label="Back to the library"><BackIcon /></button>
        <div className="bk-title">
          <b>{book.title}</b>
          <span>{title && title !== book.title ? `${title} · ` : ''}{formatLeft(chapterLeft)}</span>
        </div>
        {phone ? (
          <div className="bk-menu-wrap">
            <button className="bk-icon" onClick={() => setPanel((p) => (p === 'menu' ? null : 'menu'))} aria-label="More" aria-haspopup="menu" aria-expanded={panel === 'menu'}><MoreVIcon /></button>
            {panel === 'menu' && (
              <>
                <div className="bk-dim bk-clear" onClick={() => setPanel(null)} aria-hidden="true" />
                <div className="bk-menu" role="menu">
                  <button role="menuitem" onClick={() => { setPanel(null); onTheme(); change({ theme: 'auto' }); }}>{dark ? <SunIcon /> : <MoonIcon />}{dark ? 'Day paper' : 'Night paper'}</button>
                  <button role="menuitem" onClick={() => { setPanel('contents'); setTab('marks'); }}><BookmarkIcon />Highlights and notes</button>
                  {onPdf && <button role="menuitem" onClick={onPdf}><BookOpenIcon />Original PDF</button>}
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="bk-actions">
            <button className="bk-icon" onClick={() => open('contents', 'contents')} aria-label="Contents" aria-pressed={panel === 'contents' && tab === 'contents'}><ListIcon /></button>
            <button className="bk-icon" onClick={() => open('contents', 'search')} aria-label="Search" aria-pressed={panel === 'contents' && tab === 'search'}><SearchIcon /></button>
            <button className={`bk-icon${marked ? ' on' : ''}`} onClick={toggleBookmark} aria-label={marked ? 'Remove bookmark' : 'Add bookmark'} aria-pressed={marked}><BookmarkIcon filled={marked} /></button>
            <button className="bk-icon" onClick={() => open('aa')} aria-label="Reading settings" aria-pressed={panel === 'aa'}><AaIcon /></button>
            <button className="bk-icon" onClick={() => { onTheme(); change({ theme: 'auto' }); }} aria-label={dark ? 'Day paper' : 'Night paper'}>{dark ? <SunIcon /> : <MoonIcon />}</button>
            {onPdf && <button className="bk-icon on" onClick={onPdf} aria-label="Back to the original PDF" title="Back to the original PDF"><BookOpenIcon /></button>}
          </div>
        )}
      </header>

      <div className="bk-view" ref={viewRef} onPointerDown={onDown} onPointerUp={onUp} onPointerCancel={() => { down.current = null; }}>
        {paged ? (
          <div className="bk-sheet" style={{ left: dims.sheetLeft, top: dims.sheetTop, width: dims.sheetW, height: dims.sheetH }}>
            {!phone && dims.cols === 2 && <i className="bk-gutter" aria-hidden="true" />}
            <div className="bk-clip" style={{ left: dims.clipLeft, top: dims.clipTop, width: dims.clipW, height: dims.clipH }}>
              <div
                ref={flowRef}
                className="bk-flow"
                style={{
                  width: dims.clipW, height: dims.clipH, columnCount: dims.cols, columnGap: dims.gap,
                  // Resting pages are placed by layout, not by a transform: a transformed layer is drawn
                  // without sub-pixel text smoothing and looks softer. A turn slides with a transform only while it moves.
                  left: -screen * dims.stride,
                }}
              >
                {blockEls(ix.first[chapter], ix.first[chapter + 1])}
              </div>
            </div>
            {phone && marked && <i className="bk-ribbon" aria-hidden="true" />}
          </div>
        ) : (
          <div className="bk-scroll" ref={scrollRef} onScroll={onScroll}>
            <div className="bk-column">
              {book.chapters.map((_, i) => (
                <section key={i} className="bk-chapter" data-chapter={i}>{blockEls(ix.first[i], ix.first[i + 1])}</section>
              ))}
              <p className="bk-end">The end</p>
            </div>
          </div>
        )}
      </div>

      {(scan || (book.fromPdf && (book.blank?.length ?? 0) > meta.pages * 0.3)) && (
        <div className="bk-scan" role="status">
          {scan ? <span>Reading the pages… {scan.done} of {scan.total}</span> : (
            <button onClick={() => onScan()}>{book.blank!.length} pages have no text yet · Read them ({ocrEstimate(book.blank!.length)})</button>
          )}
        </div>
      )}

      <footer className="bk-bottom">
        <div className="bk-progress">
          {scrub !== null && <div className="bk-scrub" aria-hidden="true">{scrubTitle}</div>}
          {slider}
          <div className="bk-labels"><span>{pageLabel}</span><span>{Math.round(shownFrac * 100)}% · {formatLeft(bookLeft)}</span></div>
        </div>
        {phone && toolRow}
      </footer>
      {phone && !showChrome && <div className="bk-status" aria-hidden="true"><span>{title}</span><span>{Math.round(frac * 100)}%</span></div>}

      {picked && !panel && (
        <MarkBar rect={picked.rect} area={{ width: box.w, height: window.innerHeight }} mode="select" onColor={(c) => highlight(c)} onNote={() => highlight('yellow', true)} onCopy={copyPicked} />
      )}
      {markBar && barMark && !panel && (
        <MarkBar rect={markBar.rect} area={{ width: box.w, height: window.innerHeight }} mode="mark" color={barColor ?? 'yellow'} hasNote={Boolean(barMark.n)}
          onColor={(c) => { putMark(markBar.id, { ...barMark, c }); setMarkBar(null); }}
          onNote={() => { setNoteFor({ id: markBar.id }); setMarkBar(null); }}
          onRemove={() => { putMark(markBar.id, null); setMarkBar(null); }} />
      )}
      {noteFor && editedMark && (
        <NoteEditor quote={editedMark.q ?? ''} value={editedMark.n ?? ''}
          onCancel={() => setNoteFor(null)}
          onSave={(n) => { putMark(noteFor.id, { ...editedMark, n: n || undefined }); setNoteFor(null); }} />
      )}

      {settings.comfort && <div className="bk-shield" style={{ opacity: settings.warmth / 100 }} aria-hidden="true" />}

      {panel === 'aa' && (
        <BookSheet kind="pop" label="Reading settings" onClose={() => setPanel(null)}>
          <ReadingPanel settings={settings} change={change} themeNow={themeNow} wide={!phone} onPdf={onPdf} />
        </BookSheet>
      )}
      {panel === 'contents' && (
        <BookSheet kind={phone ? 'pop' : 'drawer'} label="Contents and marks" onClose={() => { setPanel(null); setTerm(''); }}>
          <ContentsPanel tab={tab} onTab={setTab} book={book} ix={ix} currentToc={currentToc} marks={live}
            onGo={(p) => goTo(p, tab === 'search')} term={term} onTerm={setTerm}
            onDeleteMark={(id) => putMark(id, null)} onEditNote={(id) => { setPanel(null); setNoteFor({ id }); }} />
        </BookSheet>
      )}
    </div>
  );
}
