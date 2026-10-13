import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointer } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { flattenOutline } from '../lib/book/fromPdf';
import { STABLE_BASE } from '../lib/book/model';
import { useBookSettings } from '../lib/book/settings';
import { ocrEstimate } from '../lib/ocr';
import { acquirePdf, pageSize, releasePdf, renderPagePreview } from '../lib/pdf';
import { getBookMarks, getMeta, patchMeta, recordBookMark } from '../lib/storage';
import type { BookMark, DocMeta } from '../lib/types';
import { usePhone } from '../lib/usePhone';
import { BookSheet, ReadingPanel } from './BookSheets';
import {
  AaIcon, BackIcon, BookmarkIcon, BookOpenIcon, ListIcon, MinusIcon, MoonIcon, MoreVIcon, PencilIcon, PlusIcon, SunIcon,
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
/** How close each document was last read (1 is the whole page in view), kept on this device. */
function readZoom(id: string): number {
  try {
    const kept = (JSON.parse(localStorage.getItem(ZOOM_KEY) ?? '{}') as Record<string, number>)[id];
    return kept ? clamp(kept, ZOOM_MIN, ZOOM_MAX) : 1;
  } catch { return 1; }
}
function keepZoom(id: string, zoom: number) {
  try {
    const all = JSON.parse(localStorage.getItem(ZOOM_KEY) ?? '{}') as Record<string, number>;
    delete all[id];
    all[id] = Math.round(zoom * 100) / 100;
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
  const [scrub, setScrub] = useState<number | null>(null);
  const [zoom, setZoomState] = useState(() => readZoom(docId));
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
  const cols = !phone && settings.spread === 'two' && box.w >= 900 && zoom <= 1.25 ? 2 : 1;
  const first = cols === 2 ? cur - (cur % 2) : cur; // a spread starts on an even page
  const pad = phone ? 8 : 24;
  const fitW = Math.max(60, Math.floor(Math.min((box.w - 2 * pad) / cols, (box.h - 2 * pad) * ratio)));
  const pageW = Math.round(fitW * zoom);
  const drawW = Math.round(fitW * zoomDrawn);
  /** The zoom that makes the page as wide as the screen. */
  const fitWidthZoom = clamp(((box.w - 2 * pad) / cols) / fitW, 1, ZOOM_MAX);

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
  useEffect(() => {
    const t = window.setTimeout(() => setZoomDrawn(zoom), 180);
    keepZoom(docId, zoom);
    return () => clearTimeout(t);
  }, [zoom, docId]);
  // A new page starts at its top (the sideways position is kept, so the same column stays in view).
  useLayoutEffect(() => { if (viewRef.current) viewRef.current.scrollTop = 0; }, [first]);

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

  const go = useCallback((page: number) => {
    setCur(clamp(page, 0, Math.max(0, n - 1)));
    setPanel(null);
    if (phone) setChrome(false);
  }, [n, phone]);
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
    if (d && e.pointerType === 'mouse' && zoomed && e.buttons === 1) {
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
    if (!zoomed && e.pointerType !== 'mouse' && Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.4 && dt < 700) { if (dx < 0) next(); else prev(); return; }
    if (Math.hypot(dx, dy) > 10 || dt > 450) return;
    const r = viewRef.current!.getBoundingClientRect();
    const rel = (e.clientX - r.left) / r.width;
    const edge = phone ? 0.3 : 0.16;
    if (rel < edge) prev(); else if (rel > 1 - edge) next(); else if (phone) setChrome((c) => !c);
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
      if (zoomRef.current > 1.02) return; // zoomed in, the wheel scrolls the page
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

  const frac = n > 1 ? first / Math.max(1, n - cols) : 0;
  const shown = scrub ?? frac;
  const pageLabel = n === 0 ? '' : cols === 2 ? `Pages ${first + 1}–${Math.min(n, first + 2)} of ${n}` : `Page ${first + 1} of ${n}`;
  const window_ = useMemo(() => {
    const out: number[] = [];
    for (let i = first - cols; i < first + cols * 3; i++) if (i >= 0 && i < n) out.push(i);
    return out;
  }, [first, cols, n]);
  const commitScrub = () => { if (scrub !== null) { const f = scrub; setScrub(null); go(Math.round(f * Math.max(0, n - cols))); } };

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
            <button className="bk-icon" onClick={openAsk} aria-label="Highlight or take notes" title="Highlight or take notes"><PencilIcon /></button>
            <button className={`bk-icon${marked ? ' on' : ''}`} onClick={toggleBookmark} aria-label={marked ? 'Remove bookmark' : 'Add bookmark'} aria-pressed={marked}><BookmarkIcon filled={marked} /></button>
            <button className="bk-icon" onClick={() => setPanel((p) => (p === 'aa' ? null : 'aa'))} aria-label="Reading settings" aria-pressed={panel === 'aa'}><AaIcon /></button>
            <button className="bk-icon" onClick={() => { onTheme(); change({ theme: 'auto' }); }} aria-label={dark ? 'Day paper' : 'Night paper'}>{dark ? <SunIcon /> : <MoonIcon />}</button>
            {onPdf && <button className="bk-icon on" onClick={onPdf} aria-label="Back to the original PDF" title="Back to the original PDF"><BookOpenIcon /></button>}
          </div>
        )}
      </header>

      <div className={`bk-view${zoomed ? ' zoomed' : ''}`} ref={viewRef} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={(e) => { down.current = null; touches.current.delete(e.pointerId); pinch.current = null; }}>
        {pdf && box.w > 0 && (
          <div className="bk-spread">
            {window_.map((i) => (
              <PageCanvas key={i} pdf={pdf} index={i} width={pageW} drawn={drawW} ratio={ratio} shown={i >= first && i < first + cols} />
            ))}
            {cols === 2 && <i className="bk-gutter" aria-hidden="true" />}
          </div>
        )}
      </div>

      {scan && (
        <div className="bk-scan" role="status"><span>Reading the pages… {scan.done} of {scan.total}. The text opens in a moment.</span></div>
      )}

      <footer className="bk-bottom">
        <div className="bk-progress">
          {scrub !== null && <div className="bk-scrub" aria-hidden="true">Page {Math.round(scrub * Math.max(0, n - cols)) + 1}</div>}
          <input
            type="range" className="bk-slider" min={0} max={1000} value={Math.round(shown * 1000)} aria-label="Position in the book"
            aria-valuetext={pageLabel}
            onChange={(e) => setScrub(Number(e.target.value) / 1000)}
            onPointerUp={commitScrub} onKeyUp={commitScrub} onBlur={() => setScrub(null)}
            style={{ ['--p' as string]: `${shown * 100}%` }}
          />
          <div className="bk-labels"><span>{pageLabel}</span><span>{Math.round(shown * 100)}%</span></div>
        </div>
        {phone && toolRow}
      </footer>
      {phone && !showChrome && <div className="bk-status" aria-hidden="true"><span>{meta?.name}</span><span>{Math.round(frac * 100)}%</span></div>}

      {settings.comfort && <div className="bk-shield" style={{ opacity: settings.warmth / 100 }} aria-hidden="true" />}

      {panel === 'aa' && (
        <BookSheet kind="pop" label="Reading settings" onClose={() => setPanel(null)}>
          <ReadingPanel settings={settings} change={change} themeNow={themeNow} wide={!phone} onPdf={onPdf} imageOnly
            zoom={{ value: zoom, min: ZOOM_MIN, max: ZOOM_MAX, onChange: (v) => setZoom(v), onFitPage: () => setZoom(1), onFitWidth: () => setZoom(fitWidthZoom) }} />
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
