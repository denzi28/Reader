import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointer } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { flattenOutline } from '../lib/book/fromPdf';
import { STABLE_BASE } from '../lib/book/model';
import { useBookSettings } from '../lib/book/settings';
import { ocrEstimate } from '../lib/ocr';
import { acquirePdf, pageSize, readPageSizes, releasePdf, renderPagePreview, type PageSize } from '../lib/pdf';
import { getBookMarks, getMeta, patchMeta, recordBookMark } from '../lib/storage';
import type { BookMark, DocMeta } from '../lib/types';
import { usePhone } from '../lib/usePhone';
import { flipLeaf } from '../lib/pageFlip';
import { BookSheet, ReadingPanel } from './BookSheets';
import {
  AaIcon, BackIcon, BookmarkIcon, BookOpenIcon, CloseIcon, ListIcon, MinusIcon, MoonIcon, MoreVIcon, PencilIcon, PlusIcon, SunIcon,
} from './icons';

interface Props {
  docId: string;
  startPage?: number;
  dark: boolean;
  onTheme: () => void;
  onClose: () => void;
  onPdf?: () => void;
  /** Reading the pages into text, if that was asked for. */
  scan: { done: number; total: number } | null;
  /** Starts reading the pages (all of them, or a few from a page). */
  onScan: (only?: { from: number; count: number }) => void;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 6;
const ZOOM_KEY = 'reader.pagezoom';
interface View { zoom: number; /** How far across and down is scrolled (0 to 1). */ x: number; y: number; /** The page being read when it was kept (scrolling a long strip). */ p?: number; /** Nothing was kept yet. */ fresh?: boolean }
/** How close each document was last read, and where on the page (1 is the whole page in view), kept on this device. */
function readView(id: string): View {
  try {
    const kept = (JSON.parse(localStorage.getItem(ZOOM_KEY) ?? '{}') as Record<string, number | View>)[id];
    if (typeof kept === 'number') return { zoom: clamp(kept, ZOOM_MIN, ZOOM_MAX), x: 0.5, y: 0 };
    if (kept) return { zoom: clamp(kept.zoom, ZOOM_MIN, ZOOM_MAX), x: clamp(kept.x ?? 0.5, 0, 1), y: clamp(kept.y ?? 0, 0, 1), p: kept.p };
  } catch { /* none kept */ }
  return { zoom: 1, x: 0.5, y: 0, fresh: true };
}
function keepView(id: string, view: View) {
  try {
    const all = JSON.parse(localStorage.getItem(ZOOM_KEY) ?? '{}') as Record<string, number | View>;
    delete all[id];
    all[id] = { zoom: Math.round(view.zoom * 100) / 100, x: Math.round(view.x * 1000) / 1000, y: Math.round(view.y * 1000) / 1000, ...(view.p !== undefined ? { p: view.p } : {}) };
    const ids = Object.keys(all);
    if (ids.length > 200) for (const old of ids.slice(0, ids.length - 200)) delete all[old];
    localStorage.setItem(ZOOM_KEY, JSON.stringify(all));
  } catch { /* storage unavailable */ }
}

/** One page of the PDF drawn as a picture; kept drawn while it is near the page being read. */
function PageCanvas({ pdf, index, width, drawn, ratio, shown }: { pdf: PDFDocumentProxy; index: number; width: number; drawn: number; ratio: number; shown: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    // Sharp for the screen, but never bigger than a canvas can reasonably be.
    const px = Math.min(3600, Math.round(drawn * Math.min(window.devicePixelRatio || 1, 2.5)));
    void renderPagePreview(pdf, index, canvas, px).catch(() => undefined);
  }, [pdf, index, drawn]);
  return (
    <canvas
      ref={ref}
      className="bk-pg"
      data-i={index}
      width={Math.round(drawn)}
      height={Math.round(drawn / ratio)}
      style={{ width, display: shown ? 'block' : 'none' }}
      aria-hidden={!shown}
    />
  );
}

/**
 * A scanned PDF in book mode, as it is: its own pages, one or two at a time, in the book's colours
 * and with its eye comfort filter. Nothing is read or changed. Only asking for something that needs
 * text (highlighting, notes) offers to read the pages, with how long it takes.
 */
export function PageBook({ docId, startPage, dark, onTheme, onClose, onPdf, scan, onScan }: Props) {
  const phone = usePhone();
  const [settings, change] = useBookSettings();
  const themeNow = settings.theme === 'auto' ? (dark ? 'night' : 'paper') : settings.theme;
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [meta, setMeta] = useState<DocMeta | null>(null);
  const [ratio, setRatio] = useState(0.77);
  const [cur, setCur] = useState(0);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [chrome, setChrome] = useState(true);
  const [panel, setPanel] = useState<null | 'aa' | 'contents' | 'menu'>(null);
  const [ask, setAsk] = useState(false);
  // The line that says the pages can be read into text: shown until it is closed (once per document).
  const offerKey = `reader.scanoffer.${docId}`;
  const [offer, setOffer] = useState(() => {
    try { return !localStorage.getItem(offerKey); } catch { return true; }
  });
  const closeOffer = () => {
    setOffer(false);
    try { localStorage.setItem(offerKey, '1'); } catch { /* ignore */ }
  };
  const [scrub, setScrub] = useState<number | null>(null);
  // One long strip of pages to scroll through, or a page (or two) at a time; each is zoomed and placed on its own.
  const scrollMode = settings.flow === 'scroll';
  const viewKey = scrollMode ? `${docId}:s` : docId;
  const start = useRef(readView(viewKey));
  const [zoom, setZoomState] = useState(() => start.current.zoom);
  const [sizes, setSizes] = useState<PageSize[] | null>(null);
  const [scrollY, setScrollY] = useState(0);
  // The picture is drawn again at the new size a moment after the zoom settles; until then it is stretched.
  const [zoomDrawn, setZoomDrawn] = useState(zoom);
  const [outline, setOutline] = useState<{ title: string; level: number; page: number }[]>([]);
  const [marks, setMarks] = useState<Record<string, BookMark>>({});
  const viewRef = useRef<HTMLDivElement>(null);
  const showChrome = chrome || !phone;

  useEffect(() => {
    let live = true;
    let held = false;
    (async () => {
      const m = await getMeta(docId);
      const { getDocFile } = await import('../lib/storage');
      const file = await getDocFile(docId);
      if (!m || !file) return;
      const doc = await acquirePdf(docId, async () => file);
      held = true;
      if (!doc || !live) return;
      const size = await pageSize(doc, 0).catch(() => ({ w: 612, h: 792 }));
      if (!live) return;
      setMeta(m);
      setRatio(size.w / size.h);
      setCur(clamp(startPage ?? m.lastPage, 0, doc.numPages - 1));
      setPdf(doc);
      void flattenOutline(doc).then((o) => { if (live) setOutline(o); }).catch(() => undefined);
      void readPageSizes(doc).then((sz) => {
        if (!live) return;
        // The pages already on screen stay where they are while the real sizes replace the guess.
        const el = viewRef.current;
        if (el && scrollModeRef.current) anchor.current = { page: curRef.current, within: el.scrollTop - (topsRef.current[curRef.current] ?? 0) };
        setSizes(sz);
      }).catch(() => undefined);
      void patchMeta(docId, { openedAt: Date.now(), view: 'book' });
    })().catch(() => undefined);
    void getBookMarks(docId).then((m) => { if (live) setMarks(m); });
    return () => { live = false; if (held) releasePdf(docId); };
  }, [docId]); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    const el = viewRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setBox({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const n = pdf?.numPages ?? 0;
  // Two pages side by side only while the whole pages are in view; zoomed in, one at a time.
  const cols = !scrollMode && !phone && settings.spread === 'two' && box.w >= 900 && zoom <= 1.25 ? 2 : 1;
  const first = cols === 2 ? cur - (cur % 2) : cur; // a spread starts on an even page
  const pad = phone ? 8 : 24;
  const GAP = phone ? 8 : 14;
  // One page at a time fits the whole page in view; the strip fits the page's width (up to a readable width).
  const fitW = scrollMode
    ? Math.max(60, Math.floor(Math.min(box.w - 2 * pad, phone ? box.w : 960)))
    : Math.max(60, Math.floor(Math.min((box.w - 2 * pad) / cols, (box.h - 2 * pad) * ratio)));
  const pageW = Math.round(fitW * zoom);
  const drawW = Math.round(fitW * zoomDrawn);
  /** The zoom that makes the page as wide as the screen. */
  const fitWidthZoom = scrollMode ? 1 : clamp(((box.w - 2 * pad) / cols) / fitW, 1, ZOOM_MAX);
  /** The zoom that puts a whole page in view. */
  const fitPageZoom = scrollMode ? clamp(((box.h - 2 * pad) * ratio) / fitW, ZOOM_MIN, 1) : 1;
  // A document opened for the first time (nothing kept for it) shows its pages at the width of the screen, when
  // a whole page in view would leave the page narrower than that. Two pages side by side keep to the spread.
  const widthDefault = useRef(false);
  useLayoutEffect(() => {
    if (widthDefault.current || !pdf || box.w === 0) return;
    widthDefault.current = true;
    if (!start.current.fresh || scrollMode || cols !== 1 || fitWidthZoom <= 1.02) return;
    setZoomState(fitWidthZoom);
    setZoomDrawn(fitWidthZoom);
  }, [pdf, box.w, scrollMode, cols, fitWidthZoom]);

  // The strip: where each page sits (the pages are assumed alike until their real sizes are known).
  const heights = useMemo(
    () => (scrollMode ? Array.from({ length: n }, (_, i) => Math.round(pageW * (sizes?.[i] ? sizes[i].h / sizes[i].w : 1 / ratio))) : []),
    [scrollMode, n, pageW, sizes, ratio],
  );
  const tops = useMemo(() => {
    let t = pad;
    return heights.map((h) => { const top = t; t += h + GAP; return top; });
  }, [heights, pad, GAP]);
  const stripH = heights.length ? tops[tops.length - 1] + heights[heights.length - 1] + pad : 0;
  const topsRef = useRef<number[]>([]);
  topsRef.current = tops;
  const scrollModeRef = useRef(scrollMode);
  scrollModeRef.current = scrollMode;
  const curRef = useRef(0);
  curRef.current = cur;
  const anchor = useRef<{ page: number; within: number } | null>(null);
  useLayoutEffect(() => {
    const a = anchor.current;
    anchor.current = null;
    const el = viewRef.current;
    if (a && el && tops[a.page] !== undefined) el.scrollTop = tops[a.page] + a.within;
  }, [sizes]); // eslint-disable-line react-hooks/exhaustive-deps

  // Zooming keeps the spot under the fingers (or the middle of the screen) where it is.
  const focus = useRef<{ fx: number; fy: number; mx: number; my: number } | null>(null);
  const setZoom = useCallback((value: number, at?: { x: number; y: number }) => {
    const el = viewRef.current;
    const next = clamp(value, ZOOM_MIN, ZOOM_MAX);
    if (el) {
      const mx = at?.x ?? el.clientWidth / 2;
      const my = at?.y ?? el.clientHeight / 2;
      focus.current = { fx: (el.scrollLeft + mx) / Math.max(1, el.scrollWidth), fy: (el.scrollTop + my) / Math.max(1, el.scrollHeight), mx, my };
    }
    setZoomState(next);
  }, []);
  useLayoutEffect(() => {
    const el = viewRef.current;
    const f = focus.current;
    focus.current = null;
    if (el && f) {
      el.scrollLeft = f.fx * el.scrollWidth - f.mx;
      el.scrollTop = f.fy * el.scrollHeight - f.my;
    }
  }, [zoom]);
  // Turning a page keeps where on the page you are looking (scanned pages of a book have their text in
  // the same place), and so does coming back to the document later.
  const placed = useRef(false);
  /** True while the strip is being put at the place to read from, so the scroll it passes through is not taken as reading. */
  const settling = useRef(true);
  // Changing between the strip and single pages brings that way of reading's own zoom and place.
  const modeShown = useRef(scrollMode);
  useLayoutEffect(() => {
    if (modeShown.current === scrollMode) return;
    modeShown.current = scrollMode;
    const v = readView(viewKey);
    start.current = v;
    placed.current = false;
    settling.current = true;
    setZoomState(v.zoom);
    setZoomDrawn(v.zoom);
  }, [scrollMode, viewKey]);
  useLayoutEffect(() => {
    const el = viewRef.current;
    if (!pdf || !el || box.w === 0 || placed.current) return;
    placed.current = true;
    const v = start.current;
    const put = () => {
      el.scrollLeft = v.x * Math.max(0, el.scrollWidth - el.clientWidth);
      if (scrollModeRef.current) {
        // In the strip: back at the page being read (and where on the strip, if it is the page that was kept).
        const t = topsRef.current[curRef.current];
        if (t === undefined) return;
        el.scrollTop = !v.fresh && v.p === curRef.current ? v.y * Math.max(0, el.scrollHeight - el.clientHeight) : Math.max(0, t - pad);
      } else {
        el.scrollTop = v.y * Math.max(0, el.scrollHeight - el.clientHeight);
      }
    };
    put();
    requestAnimationFrame(() => {
      put();
      requestAnimationFrame(() => {
        put();
        settling.current = false;
        setScrollY(el.scrollTop);
      });
    });
  }, [pdf, box.w, scrollMode]); // eslint-disable-line react-hooks/exhaustive-deps
  const saveView = useCallback(() => {
    const el = viewRef.current;
    if (!el || !placed.current) return;
    keepView(viewKey, {
      zoom: zoomRef.current,
      x: el.scrollWidth > el.clientWidth ? el.scrollLeft / (el.scrollWidth - el.clientWidth) : 0.5,
      y: el.scrollHeight > el.clientHeight ? el.scrollTop / (el.scrollHeight - el.clientHeight) : 0,
      ...(scrollModeRef.current ? { p: curRef.current } : {}),
    });
  }, [viewKey]);
  const scrollTimer = useRef(0);
  const scrollTick = useRef(0);
  const onScroll = () => {
    clearTimeout(scrollTimer.current);
    scrollTimer.current = window.setTimeout(saveView, 250);
    if (!scrollModeRef.current || scrollTick.current) return;
    scrollTick.current = requestAnimationFrame(() => {
      scrollTick.current = 0;
      const el = viewRef.current;
      if (el) setScrollY(el.scrollTop);
    });
  };
  /** The page at a place on the strip. */
  const pageAt = useCallback((y: number) => {
    let lo = 0;
    let hi = tops.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (tops[mid] <= y) lo = mid; else hi = mid - 1;
    }
    return Math.max(0, lo);
  }, [tops]);
  // The page being read is the one at the reading line, a little way down the screen.
  useEffect(() => {
    if (!scrollMode || !placed.current || settling.current || tops.length === 0) return;
    const page = pageAt(scrollY + box.h * 0.3);
    if (page !== curRef.current) setCur(page);
  }, [scrollY, scrollMode, tops, box.h, pageAt]);
  useEffect(() => () => { clearTimeout(scrollTimer.current); saveView(); }, [saveView]);
  useEffect(() => {
    const t = window.setTimeout(() => { setZoomDrawn(zoom); saveView(); }, 180);
    return () => clearTimeout(t);
  }, [zoom, saveView]);

  // The place is kept as a page (the same as the PDF reader's), shortly after it stops changing.
  const saveTimer = useRef(0);
  useEffect(() => {
    if (!pdf) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => { saveTimer.current = 0; void patchMeta(docId, { lastPage: first, bookPos: undefined }); }, 600);
  }, [first, pdf, docId]);
  useEffect(() => () => {
    if (saveTimer.current) void patchMeta(docId, { lastPage: firstRef.current, bookPos: undefined });
  }, [docId]);
  const firstRef = useRef(0);
  firstRef.current = first;

  // A page turn swings a leaf round the spine; the pages under it change at once (and are covered until it lands).
  const spreadRef = useRef<HTMLDivElement>(null);
  const flipping = useRef(false);
  const flipRef = useRef<(target: number) => void>(undefined);
  const reduced = useMemo(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches, []);
  flipRef.current = (target) => {
    const sp = spreadRef.current;
    const view = viewRef.current;
    if (!sp || !view || scrollMode || flipping.current || reduced || box.w === 0) return;
    const nextFirst = cols === 2 ? target - (target % 2) : target;
    if (Math.abs(nextFirst - first) !== cols || nextFirst < 0 || nextFirst >= n) return;
    const forward = nextFirst > first;
    const base = sp.getBoundingClientRect();
    const seen = [...sp.children].filter((e): e is HTMLElement => e instanceof HTMLElement && e.classList.contains('bk-pg') && e.offsetWidth > 0);
    if (!seen.length) return;
    const boxOf = (e: HTMLElement) => { const r = e.getBoundingClientRect(); return { left: r.left - base.left, top: r.top - base.top, width: r.width, height: r.height }; };
    const slotL = boxOf(seen[0]);
    const slotR = cols === 2 ? (seen[1] ? boxOf(seen[1]) : { ...slotL, left: slotL.left + slotL.width }) : slotL;
    const blank = () => { const d = document.createElement('div'); d.className = 'bk-pg bk-blank'; return d; };
    const copyOf = (i: number): HTMLElement => {
      const src = i >= 0 && i < n ? sp.querySelector<HTMLCanvasElement>(`canvas[data-i="${i}"]`) : null;
      if (!src) return blank();
      const c = document.createElement('canvas');
      c.width = src.width;
      c.height = src.height;
      c.className = 'bk-pg';
      c.getContext('2d')?.drawImage(src, 0, 0);
      return c;
    };
    /** One strip of a page, for the leaf to be bent from. */
    const stripOf = (i: number) => (k: number, count: number): HTMLElement => {
      const src = i >= 0 && i < n ? sp.querySelector<HTMLCanvasElement>(`canvas[data-i="${i}"]`) : null;
      if (!src) return blank();
      // (as sharp as the page itself, so that the leaf and the page it lands as are alike to the eye)
      const x0 = Math.round((k * src.width) / count);
      const x1 = Math.round(((k + 1) * src.width) / count);
      const c = document.createElement('canvas');
      c.width = Math.max(1, x1 - x0);
      c.height = Math.max(1, src.height);
      c.className = 'bk-pg';
      c.getContext('2d')?.drawImage(src, x0, 0, x1 - x0, src.height, 0, 0, c.width, c.height);
      return c;
    };
    const area = cols === 2 ? { left: slotL.left, top: slotL.top, width: slotR.left + slotR.width - slotL.left, height: slotL.height } : slotL;
    const common = { host: sp, leaf: slotR, area, forward, slices: 9, ...(cols === 2 ? { gutter: 30 } : {}) };
    let spec: Parameters<typeof flipLeaf>[0];
    if (cols === 2) {
      spec = forward
        ? { ...common, front: stripOf(first + 1), back: stripOf(nextFirst), cover: { box: slotL, node: copyOf(first) } }
        : { ...common, front: stripOf(nextFirst + 1), back: stripOf(first), cover: { box: slotR, node: copyOf(first + 1) } };
    } else {
      spec = forward
        ? { ...common, leaf: slotL, front: stripOf(first), back: stripOf(-1) }
        : { ...common, leaf: slotL, front: stripOf(nextFirst), back: stripOf(-1), cover: { box: slotL, node: copyOf(first) } };
    }
    flipping.current = true;
    view.style.overflow = 'hidden';
    void flipLeaf({ ...spec, duration: phone ? 620 : 780 }).finally(() => { flipping.current = false; view.style.overflow = ''; });
  };

  const go = useCallback((page: number) => {
    const target = clamp(page, 0, Math.max(0, n - 1));
    if (scrollModeRef.current && viewRef.current && topsRef.current[target] !== undefined) {
      viewRef.current.scrollTop = Math.max(0, topsRef.current[target] - pad);
      setPanel(null);
      if (phone) setChrome(false);
      return;
    }
    flipRef.current?.(target);
    setCur(target);
    setPanel(null);
    if (phone) setChrome(false);
  }, [n, phone, pad]);
  const next = useCallback(() => { if (first + cols < n) go(first + cols); }, [first, cols, n, go]);
  const prev = useCallback(() => { if (first > 0) go(first - cols); }, [first, cols, go]);

  // ---- touching the pages ---------------------------------------------------------
  const zoomed = zoom > 1.02;
  const down = useRef<{ x: number; y: number; t: number; sl: number; st: number } | null>(null);
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; zoom: number } | null>(null);
  const moved = useRef(false);
  const spread = (): { dist: number; x: number; y: number } | null => {
    const pts = [...touches.current.values()];
    if (pts.length < 2) return null;
    const r = viewRef.current!.getBoundingClientRect();
    return { dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y), x: (pts[0].x + pts[1].x) / 2 - r.left, y: (pts[0].y + pts[1].y) / 2 - r.top };
  };
  const onDown = (e: ReactPointer) => {
    const el = viewRef.current;
    down.current = { x: e.clientX, y: e.clientY, t: e.timeStamp, sl: el?.scrollLeft ?? 0, st: el?.scrollTop ?? 0 };
    moved.current = false;
    if (e.pointerType === 'touch') {
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const sp = spread();
      if (sp) pinch.current = { dist: sp.dist, zoom };
    }
  };
  const onMove = (e: ReactPointer) => {
    const d = down.current;
    if (e.pointerType === 'touch' && touches.current.has(e.pointerId)) {
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const sp = spread();
      if (sp && pinch.current) {
        moved.current = true;
        setZoom(pinch.current.zoom * (sp.dist / Math.max(1, pinch.current.dist)), { x: sp.x, y: sp.y });
        return;
      }
    }
    // A mouse drags the page about when it is zoomed in (a finger does that by itself).
    if (d && e.pointerType === 'mouse' && (zoomed || scrollMode) && e.buttons === 1) {
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (Math.hypot(dx, dy) > 4) {
        moved.current = true;
        viewRef.current!.scrollLeft = d.sl - dx;
        viewRef.current!.scrollTop = d.st - dy;
      }
    }
  };
  const onUp = (e: ReactPointer) => {
    touches.current.delete(e.pointerId);
    if (touches.current.size < 2) pinch.current = null;
    const d = down.current;
    down.current = null;
    if (!d || panel || ask || moved.current) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    const dt = e.timeStamp - d.t;
    if (!scrollMode && !zoomed && e.pointerType !== 'mouse' && Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.4 && dt < 700) { if (dx < 0) next(); else prev(); return; }
    if (Math.hypot(dx, dy) > 10 || dt > 450) return;
    const r = viewRef.current!.getBoundingClientRect();
    const rel = (e.clientX - r.left) / r.width;
    const edge = phone ? 0.3 : 0.16;
    if (!scrollMode && rel < edge) prev(); else if (!scrollMode && rel > 1 - edge) next(); else if (phone) setChrome((c) => !c);
  };
  const wheelLock = useRef(0);
  const wheel = useRef(0);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  useEffect(() => {
    const el = viewRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (panel || ask) return;
      // Ctrl and the wheel (or a pinch on a trackpad) zoom, wherever the pointer is.
      if (e.ctrlKey) {
        e.preventDefault();
        const r = el.getBoundingClientRect();
        setZoom(zoomRef.current * Math.exp(-e.deltaY * 0.0025), { x: e.clientX - r.left, y: e.clientY - r.top });
        return;
      }
      if (zoomRef.current > 1.02 || scrollModeRef.current) return; // zoomed in, or in the strip, the wheel scrolls
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
  }, [panel, ask, next, prev, setZoom]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (panel || ask || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || e.altKey) return;
      if (e.key === '+' || e.key === '=') { e.preventDefault(); setZoom(zoomRef.current * 1.25); return; }
      if (e.key === '-' || e.key === '_') { e.preventDefault(); setZoom(zoomRef.current / 1.25); return; }
      if (e.key === '0') { e.preventDefault(); setZoom(1); return; }
      if (e.ctrlKey || e.metaKey) return;
      // In the strip the keys scroll as they always do.
      if (scrollModeRef.current) { if (e.key === 'Home') go(0); else if (e.key === 'End') go(n - 1); return; }
      const sideways = zoomRef.current > 1.02;
      if (['ArrowRight', 'PageDown'].includes(e.key) || (!sideways && e.key === 'ArrowDown') || (e.key === ' ' && !e.shiftKey)) { e.preventDefault(); next(); }
      else if (['ArrowLeft', 'PageUp'].includes(e.key) || (!sideways && e.key === 'ArrowUp') || (e.key === ' ' && e.shiftKey)) { e.preventDefault(); prev(); }
      else if (e.key === 'Home') go(0);
      else if (e.key === 'End') go(n - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [panel, ask, next, prev, go, n, setZoom]);

  // ---- bookmarks: kept like a book's, by page, so they carry over once the pages are read ----
  const here = Object.entries(marks).filter(([, m]) => m.k === 'bm' && m.a[0] >= STABLE_BASE + first * 4096 && m.a[0] < STABLE_BASE + (first + cols) * 4096);
  const marked = here.length > 0;
  const toggleBookmark = () => {
    if (marked) {
      here.forEach(([id]) => { void recordBookMark(docId, id, null); });
      setMarks((m) => { const out = { ...m }; here.forEach(([id]) => delete out[id]); return out; });
      return;
    }
    const id = `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    const mark: BookMark = { k: 'bm', a: [STABLE_BASE + first * 4096, 0], q: `Page ${first + 1}` };
    void recordBookMark(docId, id, mark);
    setMarks((m) => ({ ...m, [id]: mark }));
  };

  // The pages near the screen are drawn; the rest of the strip is empty space of the right size.
  const near = useMemo(() => {
    if (!scrollMode) return [] as number[];
    const out: number[] = [];
    for (let i = 0; i < tops.length; i++) if (tops[i] + heights[i] >= scrollY - box.h && tops[i] <= scrollY + box.h * 2) out.push(i);
    return out;
  }, [scrollMode, tops, heights, scrollY, box.h]);
  const frac = scrollMode
    ? (stripH > box.h ? clamp(scrollY / (stripH - box.h), 0, 1) : 0)
    : n > 1 ? first / Math.max(1, n - cols) : 0;
  const shown = scrub ?? frac;
  const pageLabel = n === 0 ? '' : scrollMode ? `Page ${cur + 1} of ${n}` : cols === 2 ? `Pages ${first + 1}–${Math.min(n, first + 2)} of ${n}` : `Page ${first + 1} of ${n}`;
  const window_ = useMemo(() => {
    const out: number[] = [];
    for (let i = first - cols; i < first + cols * 3; i++) if (i >= 0 && i < n) out.push(i);
    return out;
  }, [first, cols, n]);
  const commitScrub = () => {
    if (scrub === null) return;
    const f = scrub;
    setScrub(null);
    const el = viewRef.current;
    if (scrollMode && el) el.scrollTop = f * Math.max(0, el.scrollHeight - el.clientHeight);
    else go(Math.round(f * Math.max(0, n - cols)));
  };

  const openAsk = () => { setPanel(null); setAsk(true); };
  const toolRow = (
    <div className="bk-tools">
      <button className="bk-tool" onClick={() => setPanel((p) => (p === 'contents' ? null : 'contents'))} aria-label="Contents" aria-pressed={panel === 'contents'}><ListIcon /></button>
      <button className="bk-tool" onClick={openAsk} aria-label="Highlight or take notes" title="Highlight or take notes"><PencilIcon /></button>
      <button className={`bk-tool${marked ? ' on' : ''}`} onClick={toggleBookmark} aria-label={marked ? 'Remove bookmark' : 'Add bookmark'} aria-pressed={marked}><BookmarkIcon filled={marked} /></button>
      <button className="bk-tool" onClick={() => setPanel((p) => (p === 'aa' ? null : 'aa'))} aria-label="Reading settings" aria-pressed={panel === 'aa'}><AaIcon /></button>
      {onPdf && <button className="bk-tool on" onClick={onPdf} aria-label="Back to the original PDF" title="Back to the original PDF"><BookOpenIcon /></button>}
    </div>
  );

  return (
    <div className={`bk bk-pages bk-t-${themeNow} ${phone ? 'bk-phone' : 'bk-desk'}${showChrome ? '' : ' bk-quiet'}`} data-cols={cols}
      style={{ ['--bk-pad' as string]: `${pad}px` }}>
      <header className="bk-top">
        <button className="bk-icon" onClick={onClose} aria-label="Back to the library"><BackIcon /></button>
        <div className="bk-title">
          <b>{meta?.name ?? 'Opening…'}</b>
          <span>The original pages · view only</span>
        </div>
        {phone ? (
          <div className="bk-menu-wrap">
            <button className="bk-icon" onClick={() => setPanel((p) => (p === 'menu' ? null : 'menu'))} aria-label="More" aria-haspopup="menu" aria-expanded={panel === 'menu'}><MoreVIcon /></button>
            {panel === 'menu' && (
              <>
                <div className="bk-dim bk-clear" onClick={() => setPanel(null)} aria-hidden="true" />
                <div className="bk-menu" role="menu">
                  <button role="menuitem" onClick={() => { setPanel(null); onTheme(); change({ theme: 'auto' }); }}>{dark ? <SunIcon /> : <MoonIcon />}{dark ? 'Day paper' : 'Night paper'}</button>
                  <button role="menuitem" onClick={() => { setPanel(null); setZoom(zoom * 1.5); }}><PlusIcon />Zoom in</button>
                  <button role="menuitem" onClick={() => { setPanel(null); setZoom(zoom / 1.5); }}><MinusIcon />Zoom out</button>
                  <button role="menuitem" onClick={() => { setPanel(null); setZoom(zoom > 1.02 ? 1 : fitWidthZoom); }}><AaIcon />{zoom > 1.02 ? 'Fit the whole page' : 'Fit the page width'}</button>
                  <button role="menuitem" onClick={openAsk}><PencilIcon />Highlight or take notes</button>
                  {onPdf && <button role="menuitem" onClick={onPdf}><BookOpenIcon />Original PDF</button>}
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="bk-actions">
            <button className="bk-icon" onClick={() => setZoom(zoom / 1.25)} aria-label="Zoom out" title="Zoom out (−)"><MinusIcon /></button>
            <button className="bk-zoom" onClick={() => setZoom(1)} aria-label="Fit the whole page" title="Fit the whole page (0)">{Math.round(zoom * 100)}%</button>
            <button className="bk-icon" onClick={() => setZoom(zoom * 1.25)} aria-label="Zoom in" title="Zoom in (+)"><PlusIcon /></button>
            <button className="bk-icon" onClick={() => setPanel((p) => (p === 'contents' ? null : 'contents'))} aria-label="Contents" aria-pressed={panel === 'contents'}><ListIcon /></button>
            <button className="bk-pill" onClick={openAsk} aria-label="Highlight or take notes" title="Read the pages into text to search, highlight and take notes"><PencilIcon />Read text</button>
            <button className={`bk-icon${marked ? ' on' : ''}`} onClick={toggleBookmark} aria-label={marked ? 'Remove bookmark' : 'Add bookmark'} aria-pressed={marked}><BookmarkIcon filled={marked} /></button>
            <button className="bk-icon" onClick={() => setPanel((p) => (p === 'aa' ? null : 'aa'))} aria-label="Reading settings" aria-pressed={panel === 'aa'}><AaIcon /></button>
            <button className="bk-icon" onClick={() => { onTheme(); change({ theme: 'auto' }); }} aria-label={dark ? 'Day paper' : 'Night paper'}>{dark ? <SunIcon /> : <MoonIcon />}</button>
            {onPdf && <button className="bk-icon on" onClick={onPdf} aria-label="Back to the original PDF" title="Back to the original PDF"><BookOpenIcon /></button>}
          </div>
        )}
      </header>

      <div className={`bk-view${zoomed ? ' zoomed' : ''}${scrollMode ? ' strip' : ''}`} ref={viewRef} onScroll={onScroll} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={(e) => { down.current = null; touches.current.delete(e.pointerId); pinch.current = null; }}>
        {pdf && box.w > 0 && !scrollMode && (
          <div className="bk-spread" ref={spreadRef}>
            {window_.map((i) => (
              <PageCanvas key={i} pdf={pdf} index={i} width={pageW} drawn={drawW} ratio={ratio} shown={i >= first && i < first + cols} />
            ))}
            {cols === 2 && first + 1 >= n && <div className="bk-pg bk-blank" style={{ width: pageW, height: Math.round(pageW / ratio) }} aria-hidden="true" />}
            {cols === 2 && <i className="bk-gutter" aria-hidden="true" />}
          </div>
        )}
        {pdf && box.w > 0 && scrollMode && (
          <div className="bk-strip" style={{ width: pageW, height: stripH }}>
            {near.map((i) => (
              <div key={i} className="bk-slot" style={{ top: tops[i], height: heights[i] }}>
                <PageCanvas pdf={pdf} index={i} width={pageW} drawn={drawW} ratio={sizes?.[i] ? sizes[i].w / sizes[i].h : ratio} shown />
              </div>
            ))}
          </div>
        )}
      </div>

      {offer && !scan && !ask && pdf && showChrome && (
        <div className="bk-offer" role="region" aria-label="Read the text">
          <span className="bk-offer-text"><b>These pages are pictures.</b> Read them into text to search, highlight and take notes.</span>
          <button className="button button-small" onClick={() => { closeOffer(); onScan({ from: first, count: n }); }}>
            Read the text <small>{ocrEstimate(n)}</small>
          </button>
          {n > 24 && <button className="chip-button" onClick={() => { closeOffer(); onScan({ from: first, count: 20 }); }}>Next 20 pages</button>}
          <button className="bk-offer-x" onClick={closeOffer} aria-label="Not now" title="Not now"><CloseIcon /></button>
        </div>
      )}

      {scan && !phone && (
        <div className="bk-scan" role="status" aria-label={`Reading the pages, ${scan.done} of ${scan.total}. The text opens in a moment.`}><span>{scan.done}/{scan.total}</span></div>
      )}

      <footer className="bk-bottom">
        <div className="bk-progress">
          {scrub !== null && <div className="bk-scrub" aria-hidden="true">Page {(scrollMode ? pageAt(scrub * Math.max(0, stripH - box.h) + box.h * 0.3) : Math.round(scrub * Math.max(0, n - cols))) + 1}</div>}
          <input
            type="range" className="bk-slider" min={0} max={1000} value={Math.round(shown * 1000)} aria-label="Position in the book"
            aria-valuetext={pageLabel}
            onChange={(e) => setScrub(Number(e.target.value) / 1000)}
            onPointerUp={commitScrub} onKeyUp={commitScrub} onBlur={() => setScrub(null)}
            style={{ ['--p' as string]: `${shown * 100}%` }}
          />
          <div className="bk-labels"><span>{pageLabel}</span>{scan && phone && <span className="bk-scanchip" role="status" aria-label={`Reading the pages, ${scan.done} of ${scan.total}. The text opens in a moment.`}>{scan.done}/{scan.total}</span>}<span>{Math.round(shown * 100)}%</span></div>
        </div>
        {phone && toolRow}
      </footer>
      {phone && !showChrome && <div className="bk-status"><span>{meta?.name}</span>{scan && phone && <span className="bk-scanchip" role="status" aria-label={`Reading the pages, ${scan.done} of ${scan.total}. The text opens in a moment.`}>{scan.done}/{scan.total}</span>}<span>{Math.round(frac * 100)}%</span></div>}

      {settings.comfort && <div className="bk-shield" style={{ opacity: settings.warmth / 100 }} aria-hidden="true" />}

      {panel === 'aa' && (
        <BookSheet kind="pop" label="Reading settings" onClose={() => setPanel(null)}>
          <ReadingPanel settings={settings} change={change} themeNow={themeNow} wide={!phone} onPdf={onPdf} imageOnly
            zoom={{ value: zoom, min: ZOOM_MIN, max: ZOOM_MAX, onChange: (v) => setZoom(v), onFitPage: () => setZoom(fitPageZoom), onFitWidth: () => setZoom(fitWidthZoom) }} />
        </BookSheet>
      )}
      {panel === 'contents' && (
        <BookSheet kind={phone ? 'pop' : 'drawer'} label="Contents" onClose={() => setPanel(null)}>
          <div className="bk-contents">
            <h3 className="bk-panel-title">Contents</h3>
            {outline.length === 0 ? <p className="bk-empty">This PDF has no contents list. Use the slider to move through it.</p> : (
              <ul className="bk-toc">
                {outline.map((o, i) => (
                  <li key={i} className={`lvl-${Math.min(o.level, 2)}`}>
                    <button onClick={() => go(o.page)}><span>{o.title}</span></button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </BookSheet>
      )}
      {ask && (
        <>
          <div className="bk-dim bk-clear" onClick={() => setAsk(false)} aria-hidden="true" />
          <div className="bk-ask" role="dialog" aria-label="Take notes on the text">
            <b>Highlight or take notes?</b>
            {scan ? <p>Reading the pages… {scan.done} of {scan.total}</p> : (
              <>
                <p>These pages are pictures. To highlight or write notes in book mode, the app reads them into text on your device. The PDF is not changed.</p>
                <div className="bk-ask-actions">
                  <button className="button button-small" onClick={() => { setAsk(false); onScan({ from: first, count: n }); }}>
                    Read the whole book <small>{ocrEstimate(n)}</small>
                  </button>
                  {n > 24 && (
                    <button className="chip-button" onClick={() => { setAsk(false); onScan({ from: first, count: 20 }); }}>
                      Next 20 pages <small>{ocrEstimate(20)}</small>
                    </button>
                  )}
                  <button className="chip-button" onClick={() => setAsk(false)}>Not now</button>
                </div>
                {onPdf && <p className="bk-ask-alt">Or <button className="link" onClick={() => { setAsk(false); onPdf(); }}>open the PDF</button> to write with the pen.</p>}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
