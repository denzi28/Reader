import type { PDFDocumentProxy } from 'pdfjs-dist';
import { flushSync } from 'react-dom';
import {
  useCallback, useEffect, useLayoutEffect, useRef, useState,
} from 'react';
import { BRUSH_SIZES, HIGHLIGHT_COLORS, PEN_COLORS } from '../lib/ink';
import { acquirePdf, pageSize, type PageSize, readPageSizes, releasePdf } from '../lib/pdf';
import { PALM_WINDOW_MS, type PointerHub } from '../lib/pointerHub';
import { setRenderFocus } from '../lib/renderQueue';
import {
  getDocFile, getMeta, getPageSizes, loadInk, patchMeta, putPageSizes, recordInkEdit,
} from '../lib/storage';
import { downloadPdf, onRemoteInk, syncDoc } from '../lib/sync/engine';
import { useDownloadProgress } from '../lib/sync/useSync';
import type { DocInk, DocMeta, InkTool, Stroke, Tool } from '../lib/types';
import { BackIcon, MoonIcon, SunIcon } from './icons';
import { SyncBadge } from './SyncControl';
import { PageView } from './PageView';
import { Toolbar } from './Toolbar';

interface Props {
  docId: string;
  /** Open at this page (zero-based) instead of where the reader left off. */
  startPage?: number;
  dark: boolean;
  onTheme: () => void;
  onClose: () => void;
}

/** A spot on a page (as fractions of its size) and where on the screen it should stay. */
interface Focus {
  page: HTMLElement;
  fx: number;
  fy: number;
  x: number;
  y: number;
}

/** Scrolls so the focused spot on its page sits at its screen position. */
function keepUnder(scroller: HTMLElement, f: Focus) {
  const r = f.page.getBoundingClientRect();
  scroller.scrollLeft += r.left + f.fx * r.width - f.x;
  scroller.scrollTop += r.top + f.fy * r.height - f.y;
}

interface Edit {
  page: number;
  prev: Stroke[];
  next: Stroke[];
}

const NO_STROKES: Stroke[] = [];
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 5;
const GUTTER = 14;
const MAX_BASE = 900;

export function Viewer({ docId, startPage, dark, onTheme, onClose }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const [meta, setMeta] = useState<DocMeta | null>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [sizes, setSizes] = useState<PageSize[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ink, setInk] = useState<DocInk>({});

  const [tool, setTool] = useState<Tool>('hand');
  const [penColor, setPenColor] = useState(PEN_COLORS[0]);
  const [hlColor, setHlColor] = useState(HIGHLIGHT_COLORS[0]);
  const [sizeIdx, setSizeIdx] = useState(1);

  const [containerWidth, setContainerWidth] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [renderZoom, setRenderZoom] = useState(1);
  const [visible, setVisible] = useState<ReadonlySet<number>>(new Set());
  const [current, setCurrent] = useState(0);

  const undoStack = useRef<Edit[]>([]);
  const redoStack = useRef<Edit[]>([]);
  const [, bump] = useState(0);
  const hub = useRef<PointerHub>({
    lastPenAt: -Infinity,
    gesture: false,
    cancelStroke: null,
    overlay: null,
  }).current;
  const overlay = useRef<HTMLCanvasElement>(null);

  // ---- load the document ------------------------------------------------
  const downloaded = useDownloadProgress(docId);
  const currentRef = useRef(0);
  /** Keeps the page being read in place while the layout changes under it. */
  const anchor = useRef<{ page: number; offset: number } | null>(null);
  /** A jump to a page that is still scrolling there. */
  const jumping = useRef<{ page: number; until: number } | null>(null);
  useEffect(() => {
    let cancelled = false;
    let doc: PDFDocumentProxy | null = null;
    let held = false;
    (async () => {
      const [m, saved, known] = await Promise.all([getMeta(docId), loadInk(docId), getPageSizes(docId)]);
      let file = await getDocFile(docId);
      if (!file && m?.cloudOnly) {
        await downloadPdf(docId);
        file = await getDocFile(docId);
      }
      if (!m || !file || m.deleted) throw new Error('This document is no longer on this device.');
      const stored = file;
      held = true;
      doc = await acquirePdf(docId, async () => stored);
      if (!doc) throw new Error('This PDF could not be opened.');
      const start = Math.max(0, Math.min(startPage ?? m.lastPage, doc.numPages - 1));
      // Show the document straight away. Page sizes measured on an earlier
      // visit are exact; the first time, every page is assumed to match the
      // first (true of most documents) and the rest are measured afterwards.
      const exact = known?.length === doc.numPages;
      let guess: PageSize[];
      if (exact) {
        guess = known;
      } else {
        const first = await pageSize(doc, 0);
        guess = Array.from({ length: doc.numPages }, () => first);
        if (start > 0) guess[start] = await pageSize(doc, start);
      }
      if (cancelled) return;
      setMeta(m);
      setInk(saved);
      setPdf(doc);
      setSizes(guess);
      setCurrent(start);
      void patchMeta(docId, { openedAt: Date.now() });
      void syncDoc(docId); // pick up notes made on other devices
      if (exact) return;
      await new Promise((r) => setTimeout(r, 800)); // let the first pages draw first
      if (cancelled) return;
      const real = await readPageSizes(doc);
      if (cancelled) return;
      void putPageSizes(docId, real);
      if (real.some((r, i) => r.w !== guess[i].w || r.h !== guess[i].h)) {
        const el = scroller.current;
        const jump = jumping.current;
        if (jump && Date.now() < jump.until) {
          anchor.current = { page: jump.page, offset: 70 }; // finish the jump under way
        } else if (el) {
          // The page at the top of the screen (where a restored page sits)
          // stays exactly where it is.
          let at = 0;
          pageEls.current.forEach((page, i) => {
            if (page.offsetTop <= el.scrollTop + 71 && i > at) at = i;
          });
          const page = pageEls.current.get(at);
          if (page) anchor.current = { page: at, offset: page.offsetTop - el.scrollTop };
        }
        setSizes(real);
      }
    })().catch((err: unknown) => {
      if (!cancelled) setError(err instanceof Error ? err.message : 'Could not open this document.');
    });
    return () => {
      cancelled = true;
      if (held) releasePdf(docId);
    };
  }, [docId]);

  // ---- measure the reading area -----------------------------------------
  // Measured before anything is drawn: pages laid out at a stand-in width
  // would be drawn twice, and a document opened deep inside would first draw
  // its opening pages.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setContainerWidth(el.clientWidth));
    ro.observe(el);
    setContainerWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const baseWidth = Math.max(240, Math.min(MAX_BASE, containerWidth - GUTTER * 2));
  const pageWidth = baseWidth * zoom;
  const renderWidth = baseWidth * renderZoom;

  // ---- zoom -------------------------------------------------------------
  const pendingRatio = useRef<number | null>(null);
  /** The spot on a page that a pinch keeps under the fingers once its new zoom has rendered. */
  const pendingFocus = useRef<Focus | null>(null);
  const applyZoom = useCallback((next: number) => {
    setZoom((prev) => {
      const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
      if (z !== prev) pendingRatio.current = z / prev;
      return z;
    });
  }, []);

  useLayoutEffect(() => {
    const el = scroller.current;
    const ratio = pendingRatio.current;
    const focus = pendingFocus.current;
    pendingRatio.current = null;
    pendingFocus.current = null;
    if (!el) return;
    if (focus) {
      keepUnder(el, focus);
      return;
    }
    if (ratio === null) return;
    // Keep whatever is in the middle of the screen in the middle.
    el.scrollTop = (el.scrollTop + el.clientHeight / 2) * ratio - el.clientHeight / 2;
    el.scrollLeft = (el.scrollLeft + el.clientWidth / 2) * ratio - el.clientWidth / 2;
  }, [zoom]);

  useEffect(() => {
    const t = setTimeout(() => setRenderZoom(zoom), 160);
    return () => clearTimeout(t);
  }, [zoom]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      applyZoom(zoomRef.current * Math.exp(-e.deltaY * 0.01));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [pdf, applyZoom]);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  // ---- screen-sized canvas for the stroke being drawn --------------------
  useEffect(() => {
    const canvas = overlay.current;
    if (!canvas) return;
    hub.overlay = canvas;
    const size = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      canvas.width = Math.round(canvas.clientWidth * dpr);
      canvas.height = Math.round(canvas.clientHeight * dpr);
    };
    size();
    const ro = new ResizeObserver(size);
    ro.observe(canvas);
    return () => {
      ro.disconnect();
      hub.overlay = null;
      canvas.width = 0; // hand the memory back now, not whenever it is collected
      canvas.height = 0;
    };
  }, [hub, pdf]);

  // ---- fingers scroll and zoom the document -----------------------------
  // The browser's own scrolling and page zoom are switched off over the pages
  // (touch-action: none, see CSS): its page zoom would magnify the toolbars off
  // screen, and its scrolling would carry on underneath a pinch, sliding the
  // page about. So both are done here, by hand, in every mode.
  //
  // Reading: one finger drags the document (and glides on release), two fingers
  // pinch and pan together. Drawing: one finger draws, two fingers do the same
  // as above. The pointer handlers run in the capture phase, before React's page
  // handlers, so a second finger can claim the gesture and drop the stroke the
  // first started.
  useEffect(() => {
    const el = scroller.current;
    if (!el || !pdf) return;
    const drawing = tool !== 'hand';
    const touches = new Map<number, { x: number; y: number }>();
    let start: { dist: number; zoom: number; focus: Focus | null } | null = null;
    let panning = false;
    let raf = 0;
    let fling = 0;
    let last = { x: 0, y: 0, t: 0 };
    let vx = 0;
    let vy = 0;
    let pinched = false;

    const centre = () => {
      const pts = [...touches.values()];
      const [a, b] = pts;
      return b
        ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, dist: Math.hypot(a.x - b.x, a.y - b.y) }
        : { x: a.x, y: a.y, dist: 0 };
    };
    /** The page under (or nearest to) the fingers, and the spot on it they are holding. */
    const focusAt = (x: number, y: number): Focus | null => {
      let best: HTMLElement | null = null;
      let gap = Infinity;
      pageEls.current.forEach((page) => {
        const r = page.getBoundingClientRect();
        const d = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
        if (d < gap) { gap = d; best = page; }
      });
      if (!best) return null;
      const r = (best as HTMLElement).getBoundingClientRect();
      return { page: best, fx: (x - r.left) / r.width, fy: (y - r.top) / r.height, x, y };
    };

    /** Two fingers down (or one lifted and another landed): measure from here. */
    const begin = () => {
      const m = centre();
      start = { dist: Math.max(m.dist, 1), zoom: zoomRef.current, focus: focusAt(m.x, m.y) };
      panning = false;
      last = { x: m.x, y: m.y, t: performance.now() };
      vx = vy = 0;
      pinched = false;
    };
    /** One finger on a reading page: it drags the document. */
    const beginPan = () => {
      const m = centre();
      start = null;
      panning = true;
      last = { x: m.x, y: m.y, t: performance.now() };
      vx = vy = 0;
      pinched = false;
    };
    const track = (m: { x: number; y: number }) => {
      const now = performance.now();
      const dt = Math.max(1, now - last.t);
      vx = vx * 0.6 + (-(m.x - last.x) / dt) * 0.4;
      vy = vy * 0.6 + (-(m.y - last.y) / dt) * 0.4;
      last = { x: m.x, y: m.y, t: now };
    };

    const update = () => {
      raf = 0;
      if (!start || touches.size < 2) return;
      const m = centre();
      const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, start.zoom * (m.dist / start.dist)));
      if (Math.abs(z / start.zoom - 1) > 0.04) pinched = true;
      // Keep the spot that was under the fingers under the fingers.
      const focus = start.focus && { ...start.focus, x: m.x, y: m.y };
      if (z !== zoomRef.current) {
        pendingFocus.current = focus;
        // Committed now, so the new size and the new scroll position land in one frame.
        flushSync(() => setZoom(z));
      } else if (focus) {
        keepUnder(el, focus);
      }
      track(m);
    };

    const launchFling = () => {
      if (pinched || performance.now() - last.t > 80) return;
      let prev = performance.now();
      const step = (now: number) => {
        const dt = now - prev;
        prev = now;
        el.scrollLeft += vx * dt;
        el.scrollTop += vy * dt;
        const decay = Math.pow(0.994, dt);
        vx *= decay;
        vy *= decay;
        if (Math.hypot(vx, vy) > 0.02) fling = requestAnimationFrame(step);
      };
      fling = requestAnimationFrame(step);
    };

    const onDown = (e: PointerEvent) => {
      cancelAnimationFrame(fling); // touching the page stops a glide
      // A stylus drags the document too when reading; when drawing it writes.
      if (e.pointerType !== 'touch' && !(e.pointerType === 'pen' && !drawing)) return;
      if (e.timeStamp - hub.lastPenAt < PALM_WINDOW_MS) return; // palm while writing
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size < 2) {
        if (!drawing) beginPan();
        return;
      }
      if (!hub.gesture) {
        hub.gesture = true;
        hub.cancelStroke?.();
        hub.cancelStroke = null;
      }
      for (const id of touches.keys()) {
        try { el.setPointerCapture(id); } catch { /* pointer already gone */ }
      }
      begin();
    };

    const onMove = (e: PointerEvent) => {
      if (!touches.has(e.pointerId)) return;
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size >= 2) {
        if (hub.gesture && !raf) raf = requestAnimationFrame(update);
      } else if (panning) {
        const m = centre();
        el.scrollLeft -= m.x - last.x;
        el.scrollTop -= m.y - last.y;
        track(m);
      }
    };

    const onUp = (e: PointerEvent) => {
      if (!touches.delete(e.pointerId)) return;
      if (touches.size >= 2) {
        begin();
      } else if (start) {
        // A pinch ended. In reading mode the finger left behind carries on as a drag.
        start = null;
        cancelAnimationFrame(raf);
        raf = 0;
        if (touches.size === 1 && !drawing) beginPan();
        else launchFling();
      } else if (panning) {
        panning = false;
        launchFling();
      }
      // The finger left behind after a gesture must not start drawing.
      if (touches.size === 0) hub.gesture = false;
    };

    el.addEventListener('pointerdown', onDown, true);
    el.addEventListener('pointermove', onMove, true);
    el.addEventListener('pointerup', onUp, true);
    el.addEventListener('pointercancel', onUp, true);
    return () => {
      el.removeEventListener('pointerdown', onDown, true);
      el.removeEventListener('pointermove', onMove, true);
      el.removeEventListener('pointerup', onUp, true);
      el.removeEventListener('pointercancel', onUp, true);
      cancelAnimationFrame(raf);
      cancelAnimationFrame(fling);
      hub.gesture = false;
    };
  }, [pdf, tool, hub]);

  // Safari zooms the whole page with its own gesture events, ignoring
  // touch-action in places. Block that; on a Mac trackpad, zoom the document.
  useEffect(() => {
    let startZoom = 1;
    const touchScreen = navigator.maxTouchPoints > 0;
    const onStart = (e: Event) => {
      e.preventDefault();
      startZoom = zoomRef.current;
    };
    const onChange = (e: Event) => {
      e.preventDefault();
      const scale = (e as Event & { scale?: number }).scale;
      if (!touchScreen && scale) applyZoom(startZoom * scale);
    };
    document.addEventListener('gesturestart', onStart, { passive: false });
    document.addEventListener('gesturechange', onChange, { passive: false });
    return () => {
      document.removeEventListener('gesturestart', onStart);
      document.removeEventListener('gesturechange', onChange);
    };
  }, [applyZoom]);

  // ---- which pages are on screen ----------------------------------------
  const pageEls = useRef(new Map<number, HTMLDivElement>());
  const observer = useRef<IntersectionObserver | null>(null);
  const visibleSet = useRef(new Set<number>());

  const register = useCallback((index: number, el: HTMLDivElement | null) => {
    const prev = pageEls.current.get(index);
    if (prev && prev !== el) observer.current?.unobserve(prev);
    if (el) {
      pageEls.current.set(index, el);
      observer.current?.observe(el);
    } else {
      pageEls.current.delete(index);
      visibleSet.current.delete(index);
    }
  }, []);

  useEffect(() => {
    const root = scroller.current;
    if (!root || !pdf) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const i = Number((entry.target as HTMLElement).dataset.page);
          if (entry.isIntersecting) visibleSet.current.add(i);
          else visibleSet.current.delete(i);
        }
        setVisible(new Set(visibleSet.current));
        recheckCurrent.current();
      },
      { root, rootMargin: '120% 0px' },
    );
    observer.current = io;
    pageEls.current.forEach((el) => io.observe(el));
    return () => {
      io.disconnect();
      observer.current = null;
      visibleSet.current.clear();
    };
  }, [pdf]);

  // ---- current page + remembering it ------------------------------------
  const restored = useRef(false);
  useLayoutEffect(() => {
    if (restored.current || !sizes || !containerWidth) return;
    restored.current = true;
    const el = pageEls.current.get(current);
    if (el && scroller.current) scroller.current.scrollTop = el.offsetTop - 70;
  }, [sizes, containerWidth, current]);

  currentRef.current = current;
  setRenderFocus(current);
  useLayoutEffect(() => {
    const a = anchor.current;
    anchor.current = null;
    const page = a && pageEls.current.get(a.page);
    if (page && scroller.current) scroller.current.scrollTop = page.offsetTop - a.offset;
    if (a) recheckCurrent.current(); // the page counter follows the new layout
  }, [sizes]);

  const recheckCurrent = useRef<() => void>(() => undefined);
  useEffect(() => {
    const el = scroller.current;
    if (!el || !pdf) return;
    let raf = 0;
    let save = 0;
    let saved = -1;
    let pending: number | null = null;
    const persist = () => {
      clearTimeout(save);
      if (pending !== null && pending !== saved) {
        saved = pending;
        void patchMeta(docId, { lastPage: pending });
      }
      pending = null;
    };
    const update = () => {
      raf = 0;
      const box = el.getBoundingClientRect();
      let best = -1;
      let bestArea = 0;
      visibleSet.current.forEach((i) => {
        const r = pageEls.current.get(i)?.getBoundingClientRect();
        if (!r) return;
        const area = Math.max(0, Math.min(r.bottom, box.bottom) - Math.max(r.top, box.top));
        if (area > bestArea) { bestArea = area; best = i; }
      });
      if (best >= 0) {
        setCurrent(best);
        pending = best;
        clearTimeout(save);
        save = window.setTimeout(persist, 600);
      }
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(update); };
    // After a big jump the visible pages are only known once the observer
    // reports, which can be after the last scroll event; check again then.
    recheckCurrent.current = onScroll;
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      recheckCurrent.current = () => undefined;
      cancelAnimationFrame(raf);
      persist(); // don't lose the page if the reader leaves right after scrolling
    };
  }, [pdf, docId]);

  const goToPage = (n: number) => {
    const i = Math.min(Math.max(n, 1), pdf?.numPages ?? 1) - 1;
    const el = pageEls.current.get(i);
    if (el && scroller.current) {
      jumping.current = { page: i, until: Date.now() + 1500 };
      scroller.current.scrollTo({ top: el.offsetTop - 70, behavior: 'smooth' });
    }
  };

  // ---- ink: commit, undo, redo (each is saved as it happens) -------------
  const commit = useCallback((page: number, prev: Stroke[], next: Stroke[]) => {
    void recordInkEdit(docId, page, prev, next);
    setInk((cur) => ({ ...cur, [page]: next }));
    undoStack.current.push({ page, prev, next });
    redoStack.current = [];
    bump((n) => n + 1);
  }, [docId]);

  const undo = useCallback(() => {
    const edit = undoStack.current.pop();
    if (!edit) return;
    redoStack.current.push(edit);
    void recordInkEdit(docId, edit.page, edit.next, edit.prev);
    setInk((cur) => ({ ...cur, [edit.page]: edit.prev }));
    bump((n) => n + 1);
  }, [docId]);

  const redo = useCallback(() => {
    const edit = redoStack.current.pop();
    if (!edit) return;
    undoStack.current.push(edit);
    void recordInkEdit(docId, edit.page, edit.prev, edit.next);
    setInk((cur) => ({ ...cur, [edit.page]: edit.next }));
    bump((n) => n + 1);
  }, [docId]);

  // Another device's notes arrived: show them. The undo history no longer
  // matches what is on the page, so it starts afresh.
  useEffect(
    () =>
      onRemoteInk(docId, () => {
        void loadInk(docId).then((fresh) => {
          setInk(fresh);
          undoStack.current = [];
          redoStack.current = [];
          bump((n) => n + 1);
        });
      }),
    [docId],
  );

  // ---- keyboard ---------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.isContentEditable) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      } else if (!mod && (e.key === '+' || e.key === '=')) applyZoom(zoomRef.current * 1.2);
      else if (!mod && e.key === '-') applyZoom(zoomRef.current / 1.2);
      else if (!mod && e.key === 'Escape') onClose();
      else if (!mod) {
        const map: Record<string, Tool> = { h: 'hand', p: 'pen', l: 'highlighter', e: 'eraser' };
        const next = map[e.key.toLowerCase()];
        if (next) setTool((cur) => (cur === next ? 'hand' : next));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, applyZoom, onClose]);

  // ---- render -----------------------------------------------------------
  if (error) {
    return (
      <div className="viewer-message">
        <p>{error}</p>
        <button className="button" onClick={onClose}>Back to library</button>
      </div>
    );
  }

  const inkTool: InkTool = tool === 'highlighter' ? 'highlighter' : 'pen';
  const brush = BRUSH_SIZES[inkTool][sizeIdx];
  const color = tool === 'highlighter' ? hlColor : penColor;

  return (
    <div className={`viewer tool-${tool}`}>
      <header className="topbar">
        <button className="icon-button" onClick={onClose} aria-label="Back to library" title="Back (Esc)">
          <BackIcon />
        </button>
        <h1 className="doc-title" title={meta?.name}>{meta?.name ?? 'Opening…'}</h1>
        {pdf && (
          <label className="page-jump" title="Go to page">
            <input
              key={current}
              type="number"
              min={1}
              max={pdf.numPages}
              defaultValue={current + 1}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  goToPage(Number(e.currentTarget.value));
                  e.currentTarget.blur();
                }
              }}
              onBlur={(e) => { e.currentTarget.value = String(current + 1); }}
              aria-label="Current page"
            />
            <span>/ {pdf.numPages}</span>
          </label>
        )}
        <SyncBadge />
        <button
          className="icon-button"
          onClick={onTheme}
          aria-label={dark ? 'Switch to day paper' : 'Switch to night paper'}
          title={dark ? 'Day paper' : 'Night paper'}
        >
          {dark ? <SunIcon /> : <MoonIcon />}
        </button>
      </header>

      <div className="scroller" ref={scroller}>
        {!pdf || !sizes ? (
          <div className="loading" role="status">
            <span className="loading-page" />
            <span>
              {downloaded === null ? 'Opening your document…' : `Downloading from Google Drive… ${Math.round(downloaded * 100)}%`}
            </span>
          </div>
        ) : (
          <div className="pages">
            {sizes.map((s, i) => (
              <PageView
                key={i}
                index={i}
                pdf={pdf}
                width={pageWidth}
                height={pageWidth * (s.h / s.w)}
                renderWidth={renderWidth}
                visible={visible.has(i)}
                strokes={ink[i] ?? NO_STROKES}
                tool={tool}
                color={color}
                brush={brush}
                dark={dark}
                hub={hub}
                onCommit={commit}
                register={register}
              />
            ))}
          </div>
        )}
      </div>

      <canvas ref={overlay} className="ink-overlay" aria-hidden="true" />

      <Toolbar
        tool={tool}
        onTool={setTool}
        penColor={penColor}
        hlColor={hlColor}
        onPenColor={setPenColor}
        onHlColor={setHlColor}
        sizeIdx={sizeIdx}
        onSize={setSizeIdx}
        canUndo={undoStack.current.length > 0}
        canRedo={redoStack.current.length > 0}
        onUndo={undo}
        onRedo={redo}
        zoom={zoom}
        onZoom={applyZoom}
        dark={dark}
      />
    </div>
  );
}
