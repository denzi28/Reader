import type { PDFDocumentProxy } from 'pdfjs-dist';
import {
  useCallback, useEffect, useLayoutEffect, useRef, useState,
} from 'react';
import { BRUSH_SIZES, HIGHLIGHT_COLORS, PEN_COLORS } from '../lib/ink';
import { openPdf, readPageSizes } from '../lib/pdf';
import { PALM_WINDOW_MS, type PointerHub } from '../lib/pointerHub';
import { getDocFile, getMeta, loadInk, patchMeta, saveInk } from '../lib/storage';
import type { DocInk, DocMeta, InkTool, Stroke, Tool } from '../lib/types';
import { BackIcon, MoonIcon, SunIcon } from './icons';
import { PageView } from './PageView';
import { Toolbar } from './Toolbar';

interface Props {
  docId: string;
  dark: boolean;
  onTheme: () => void;
  onClose: () => void;
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

export function Viewer({ docId, dark, onTheme, onClose }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const [meta, setMeta] = useState<DocMeta | null>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [sizes, setSizes] = useState<{ w: number; h: number }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ink, setInk] = useState<DocInk>({});
  const [inkLoaded, setInkLoaded] = useState(false);

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
  useEffect(() => {
    let cancelled = false;
    let doc: PDFDocumentProxy | null = null;
    (async () => {
      const [m, file, saved] = await Promise.all([getMeta(docId), getDocFile(docId), loadInk(docId)]);
      if (!m || !file) throw new Error('This document is no longer on this device.');
      doc = await openPdf(await file.arrayBuffer());
      const pageSizes = await readPageSizes(doc);
      if (cancelled) return;
      setMeta(m);
      setInk(saved);
      setInkLoaded(true);
      setPdf(doc);
      setSizes(pageSizes);
      setCurrent(Math.min(m.lastPage, doc.numPages - 1));
      void patchMeta(docId, { openedAt: Date.now() });
    })().catch((err: unknown) => {
      if (!cancelled) setError(err instanceof Error ? err.message : 'Could not open this document.');
    });
    return () => {
      cancelled = true;
      void doc?.loadingTask.destroy();
    };
  }, [docId]);

  // ---- measure the reading area -----------------------------------------
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setContainerWidth(el.clientWidth));
    ro.observe(el);
    setContainerWidth(el.clientWidth);
    return () => ro.disconnect();
  }, [pdf]);

  const baseWidth = Math.max(240, Math.min(MAX_BASE, containerWidth - GUTTER * 2));
  const pageWidth = baseWidth * zoom;
  const renderWidth = baseWidth * renderZoom;

  // ---- zoom -------------------------------------------------------------
  const pendingRatio = useRef<number | null>(null);
  /** Exact scroll position to land on once a pinch's new zoom has rendered. */
  const pendingScroll = useRef<{ left: number; top: number } | null>(null);
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
    const target = pendingScroll.current;
    pendingRatio.current = null;
    pendingScroll.current = null;
    if (!el) return;
    if (target) {
      el.scrollLeft = target.left;
      el.scrollTop = target.top;
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
    };
  }, [hub, pdf]);

  // ---- two fingers scroll and zoom the document ------------------------
  // The browser's own page zoom is switched off in the viewer (see CSS), as it
  // would magnify the toolbars off screen; pinching zooms the document instead.
  //
  // Drawing mode: one finger draws, so all touch scrolling is done here. The
  // pointer handlers run in the capture phase, before React's page handlers, so
  // a second finger can claim the gesture and drop the stroke the first started.
  //
  // Reading mode: one finger scrolls natively; two fingers are taken over here
  // through touch events, which can cancel the browser's handling of them.
  useEffect(() => {
    const el = scroller.current;
    if (!el || !pdf) return;
    const drawing = tool !== 'hand';
    const touches = new Map<number, { x: number; y: number }>();
    let start: { dist: number; zoom: number; cx: number; cy: number } | null = null;
    let raf = 0;
    let fling = 0;
    let last = { x: 0, y: 0, t: 0 };
    let vx = 0;
    let vy = 0;
    let pinched = false;

    const pair = () => {
      const [a, b] = touches.values();
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, dist: Math.hypot(a.x - b.x, a.y - b.y) };
    };
    const padding = () => {
      const cs = getComputedStyle(el);
      return { left: parseFloat(cs.paddingLeft) || 0, top: parseFloat(cs.paddingTop) || 0 };
    };

    const begin = () => {
      const m = pair();
      const rect = el.getBoundingClientRect();
      start = {
        dist: Math.max(m.dist, 1),
        zoom: zoomRef.current,
        cx: el.scrollLeft + m.x - rect.left,
        cy: el.scrollTop + m.y - rect.top,
      };
      last = { x: m.x, y: m.y, t: performance.now() };
      vx = vy = 0;
      pinched = false;
    };

    const update = () => {
      raf = 0;
      if (!start || touches.size < 2) return;
      const m = pair();
      const rect = el.getBoundingClientRect();
      const pad = padding();
      const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, start.zoom * (m.dist / start.dist)));
      const r = z / start.zoom;
      if (Math.abs(r - 1) > 0.04) pinched = true;
      // Keep the content that was under the fingers under the fingers.
      const left = (start.cx - pad.left) * r + pad.left - (m.x - rect.left);
      const top = (start.cy - pad.top) * r + pad.top - (m.y - rect.top);
      if (z !== zoomRef.current) {
        pendingScroll.current = { left, top };
        setZoom(z);
      } else {
        el.scrollLeft = left;
        el.scrollTop = top;
      }
      const now = performance.now();
      const dt = Math.max(1, now - last.t);
      vx = vx * 0.6 + (-(m.x - last.x) / dt) * 0.4;
      vy = vy * 0.6 + (-(m.y - last.y) / dt) * 0.4;
      last = { x: m.x, y: m.y, t: now };
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
      if (e.pointerType !== 'touch') return;
      if (e.timeStamp - hub.lastPenAt < PALM_WINDOW_MS) return; // palm while writing
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size < 2) return;
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
      if (hub.gesture && touches.size >= 2 && !raf) raf = requestAnimationFrame(update);
    };

    const onUp = (e: PointerEvent) => {
      if (!touches.delete(e.pointerId)) return;
      if (touches.size >= 2) {
        begin();
      } else if (start) {
        start = null;
        cancelAnimationFrame(raf);
        raf = 0;
        launchFling();
      }
      // The finger left behind after a gesture must not start drawing.
      if (touches.size === 0) hub.gesture = false;
    };

    // Reading mode: mirror the touch list into `touches` and reuse the above.
    let owned = false; // false when the browser had already begun scrolling
    const syncTouches = (e: TouchEvent) => {
      touches.clear();
      for (const t of Array.from(e.touches)) touches.set(t.identifier, { x: t.clientX, y: t.clientY });
    };
    const onTouchStart = (e: TouchEvent) => {
      cancelAnimationFrame(fling);
      syncTouches(e);
      if (touches.size >= 2) {
        begin();
        owned = true;
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      syncTouches(e);
      if (!start || touches.size < 2) return;
      if (!e.cancelable) owned = false;
      if (!owned) {
        start = null; // the browser is already scrolling; let it carry on
        return;
      }
      e.preventDefault();
      if (!raf) raf = requestAnimationFrame(update);
    };
    const onTouchEnd = (e: TouchEvent) => {
      syncTouches(e);
      if (touches.size >= 2) {
        begin();
      } else if (start) {
        start = null;
        cancelAnimationFrame(raf);
        raf = 0;
        launchFling();
      }
    };

    if (drawing) {
      el.addEventListener('pointerdown', onDown, true);
      el.addEventListener('pointermove', onMove, true);
      el.addEventListener('pointerup', onUp, true);
      el.addEventListener('pointercancel', onUp, true);
    } else {
      el.addEventListener('touchstart', onTouchStart, { passive: true });
      el.addEventListener('touchmove', onTouchMove, { passive: false });
      el.addEventListener('touchend', onTouchEnd, { passive: true });
      el.addEventListener('touchcancel', onTouchEnd, { passive: true });
    }
    return () => {
      el.removeEventListener('pointerdown', onDown, true);
      el.removeEventListener('pointermove', onMove, true);
      el.removeEventListener('pointerup', onUp, true);
      el.removeEventListener('pointercancel', onUp, true);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
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

  useEffect(() => {
    const el = scroller.current;
    if (!el || !pdf) return;
    let raf = 0;
    let save = 0;
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
        clearTimeout(save);
        save = window.setTimeout(() => void patchMeta(docId, { lastPage: best }), 600);
      }
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(update); };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(raf);
      clearTimeout(save);
    };
  }, [pdf, docId]);

  const goToPage = (n: number) => {
    const i = Math.min(Math.max(n, 1), pdf?.numPages ?? 1) - 1;
    const el = pageEls.current.get(i);
    if (el && scroller.current) {
      scroller.current.scrollTo({ top: el.offsetTop - 70, behavior: 'smooth' });
    }
  };

  // ---- ink: commit, undo, redo, persist ---------------------------------
  const commit = useCallback((page: number, prev: Stroke[], next: Stroke[]) => {
    setInk((cur) => ({ ...cur, [page]: next }));
    undoStack.current.push({ page, prev, next });
    redoStack.current = [];
    bump((n) => n + 1);
  }, []);

  const undo = useCallback(() => {
    const edit = undoStack.current.pop();
    if (!edit) return;
    redoStack.current.push(edit);
    setInk((cur) => ({ ...cur, [edit.page]: edit.prev }));
    bump((n) => n + 1);
  }, []);

  const redo = useCallback(() => {
    const edit = redoStack.current.pop();
    if (!edit) return;
    undoStack.current.push(edit);
    setInk((cur) => ({ ...cur, [edit.page]: edit.next }));
    bump((n) => n + 1);
  }, []);

  const inkRef = useRef(ink);
  inkRef.current = ink;
  const dirty = useRef(false);
  useEffect(() => {
    if (!inkLoaded) return;
    dirty.current = true;
    const t = setTimeout(() => {
      dirty.current = false;
      void saveInk(docId, ink);
    }, 500);
    return () => clearTimeout(t);
  }, [ink, inkLoaded, docId]);

  useEffect(() => {
    const flush = () => {
      if (dirty.current) {
        dirty.current = false;
        void saveInk(docId, inkRef.current);
      }
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', flush);
      flush();
    };
  }, [docId]);

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
            <span>Opening your document…</span>
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
