import type { PDFDocumentProxy } from 'pdfjs-dist';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { drawStroke, drawStrokes, newId, strokeHit } from '../lib/ink';
import { PALM_WINDOW_MS, type PointerHub } from '../lib/pointerHub';
import { queueRender } from '../lib/renderQueue';
import type { InkPoint, InkTool, Stroke, Tool } from '../lib/types';

interface Props {
  index: number;
  pdf: PDFDocumentProxy;
  /** Live CSS width/height of the page. */
  width: number;
  height: number;
  /** Debounced CSS width the bitmaps are rendered for. */
  renderWidth: number;
  visible: boolean;
  strokes: Stroke[];
  tool: Tool;
  color: string;
  /** Brush width as a fraction of page width. */
  brush: number;
  /** Night paper recolours the bitmap with a CSS filter instead of a tint. */
  dark: boolean;
  hub: PointerHub;
  onCommit: (page: number, prev: Stroke[], next: Stroke[]) => void;
  register: (index: number, el: HTMLDivElement | null) => void;
}

// Phones have far less memory for canvases than desktops; past these sizes a
// zoomed-in page would freeze the browser rather than look any sharper.
const TOUCH_DEVICE = typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0;
const MAX_PIXELS = TOUCH_DEVICE ? 8_000_000 : 16_000_000;
const MAX_INK_PIXELS = TOUCH_DEVICE ? 4_000_000 : 8_000_000;
const PAPER = '#fffaf0';
const NIGHT_FILTER = 'invert(0.88) hue-rotate(180deg) sepia(0.28) brightness(0.96)';
// Where canvases can filter their own pixels, night paper is baked in once;
// elsewhere a CSS filter on the bitmap does the job.
const CAN_BAKE_FILTER =
  typeof CanvasRenderingContext2D !== 'undefined' && 'filter' in CanvasRenderingContext2D.prototype;
const ERASER_RADIUS = 0.012; // fraction of page width
// Holding the highlighter still turns the stroke into a straight line from
// where it started to wherever the pointer goes next.
const HOLD_MS = 350;
const HOLD_SLOP = 6; // CSS px a held finger may wobble
const LEVEL_SLOPE = Math.tan((6 * Math.PI) / 180); // nearly flat lines snap level

/** Points along a straight line, dense enough to render and erase like ink. */
function straightLine(a: InkPoint, b: InkPoint): InkPoint[] {
  const x = b[0];
  const y = Math.abs(b[1] - a[1]) <= Math.abs(b[0] - a[0]) * LEVEL_SLOPE ? a[1] : b[1];
  const steps = Math.max(1, Math.ceil(Math.hypot(x - a[0], y - a[1]) / 0.004));
  const line: InkPoint[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    line.push([a[0] + (x - a[0]) * t, a[1] + (y - a[1]) * t, a[2]]);
  }
  return line;
}

function PageViewImpl(props: Props) {
  const {
    index, pdf, width, height, renderWidth, visible, strokes, tool, color,
    brush, dark, hub, onCommit, register,
  } = props;

  const pdfCanvas = useRef<HTMLCanvasElement>(null);
  const inkCanvas = useRef<HTMLCanvasElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [baked, setBaked] = useState(false);
  const erased = useRef(new Set<string>());
  const strokesRef = useRef(strokes);
  strokesRef.current = strokes;
  const darkRef = useRef(dark);
  darkRef.current = dark;

  const aspect = height / width;
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const inkScale = Math.min(dpr, Math.sqrt(MAX_INK_PIXELS / (renderWidth * renderWidth * aspect)));
  const inkW = Math.max(1, Math.round(renderWidth * inkScale));
  const inkH = Math.max(1, Math.round(renderWidth * aspect * inkScale));

  // ---- PDF bitmap -------------------------------------------------------
  useEffect(() => {
    const canvas = pdfCanvas.current;
    if (!canvas) return;
    if (!visible) {
      canvas.width = 0; // releases the backing store
      canvas.height = 0;
      setReady(false);
      return;
    }
    let cancelled = false;
    let task: ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']> | null = null;
    const job = queueRender(index, () => (async () => {
      if (cancelled) return;
      const page = await pdf.getPage(index + 1);
      if (cancelled) return;
      const base = page.getViewport({ scale: 1 });
      let scale = (renderWidth / base.width) * dpr;
      const pixels = base.width * base.height * scale * scale;
      if (pixels > MAX_PIXELS) scale *= Math.sqrt(MAX_PIXELS / pixels);
      const viewport = page.getViewport({ scale });
      const w = Math.floor(viewport.width);
      const h = Math.floor(viewport.height);
      const bake = dark && CAN_BAKE_FILTER;
      const tintPaper = (c: HTMLCanvasElement) => {
        // Tint the white of the page once here, rather than blending every frame.
        const tint = dark ? null : c.getContext('2d');
        if (!tint) return;
        tint.globalCompositeOperation = 'multiply';
        tint.fillStyle = PAPER;
        tint.fillRect(0, 0, c.width, c.height);
      };
      // On sharp screens a page first appears from a quick, plain-resolution
      // drawing (a fraction of the pixels), then the sharp one replaces it.
      if (canvas.width === 0 && dpr > 1.5) {
        const quick = page.getViewport({ scale: scale / dpr });
        canvas.width = Math.floor(quick.width);
        canvas.height = Math.floor(quick.height);
        task = page.render({ canvas, viewport: quick });
        await task.promise;
        if (cancelled) return;
        tintPaper(canvas);
        setBaked(false); // night paper comes from the CSS filter until then
        setReady(true);
      }
      // A page appearing for the first time is invisible until it is ready, so
      // it can be drawn straight in. Re-renders (zoom, theme) go off-screen and
      // are swapped in whole, so the page never flashes blank.
      const direct = canvas.width === 0 && !bake;
      const target = direct ? canvas : document.createElement('canvas');
      target.width = w;
      target.height = h;
      task = page.render({ canvas: target, viewport });
      await task.promise;
      if (cancelled) return;
      tintPaper(target);
      if (!direct) {
        canvas.width = w;
        canvas.height = h;
        const out = canvas.getContext('2d');
        if (bake && out) out.filter = NIGHT_FILTER;
        out?.drawImage(target, 0, 0);
      }
      setBaked(dark && CAN_BAKE_FILTER);
      setReady(true);
    })().catch((err) => {
      if (err?.name !== 'RenderingCancelledException') console.error(err);
    }));
    return () => {
      cancelled = true;
      job.cancel();
      task?.cancel();
    };
  }, [visible, renderWidth, pdf, index, dpr, dark]);

  // Leaving the document: release the bitmaps at once. Left to the garbage
  // collector, a few documents' worth piled up and stalled the next opening.
  useEffect(() => () => {
    for (const c of [pdfCanvas.current, inkCanvas.current]) {
      if (c) {
        c.width = 0;
        c.height = 0;
      }
    }
  }, []);

  // ---- committed ink ----------------------------------------------------
  const paintInk = useCallback(() => {
    const canvas = inkCanvas.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawStrokes(ctx, strokesRef.current, canvas.width, darkRef.current, erased.current);
  }, []);

  // Resizing clears a canvas, so only touch the size when it really changes.
  useEffect(() => {
    const ink = inkCanvas.current;
    if (ink) {
      ink.width = visible ? inkW : 0;
      ink.height = visible ? inkH : 0;
    }
    if (visible) paintInk();
  }, [visible, inkW, inkH, paintInk]);

  useEffect(() => {
    if (visible) paintInk();
  }, [visible, strokes, dark, paintInk]);

  // ---- drawing ----------------------------------------------------------
  const drawing = useRef<{
    id: number;
    kind: 'ink' | 'erase';
    points: InkPoint[];
    raf: number;
    /** Highlighter only: the hold timer and where the pointer last settled. */
    hold: number;
    anchor: InkPoint;
    /** Set once held: the stroke is a straight line from here. */
    from: InkPoint | null;
  } | null>(null);

  const toPoint = (e: PointerEvent | React.PointerEvent, rect: DOMRect): InkPoint => [
    (e.clientX - rect.left) / rect.width,
    (e.clientY - rect.top) / rect.width,
    e.pointerType === 'mouse' ? 0.5 : e.pressure || 0.5,
  ];

  const clearLive = () => {
    const ov = hub.overlay;
    ov?.getContext('2d')?.clearRect(0, 0, ov.width, ov.height);
  };

  const paintLive = () => {
    const d = drawing.current;
    const ov = hub.overlay;
    const ctx = ov?.getContext('2d');
    const el = surface.current;
    if (!d || !ov || !ctx || !el) return;
    d.raf = 0;
    const s = ov.width / (ov.clientWidth || 1); // canvas pixels per CSS pixel
    const page = el.getBoundingClientRect();
    const origin = ov.getBoundingClientRect();
    const w = page.width * s;
    ctx.clearRect(0, 0, ov.width, ov.height);
    ctx.save();
    ctx.translate((page.left - origin.left) * s, (page.top - origin.top) * s);
    ctx.beginPath();
    ctx.rect(0, 0, w, page.height * s);
    ctx.clip();
    if (d.kind === 'ink') {
      drawStroke(ctx, { tool: tool as InkTool, color, size: brush, points: d.points }, w, darkRef.current);
    } else {
      const [x, y] = d.points[d.points.length - 1];
      ctx.beginPath();
      ctx.arc(x * w, y * w, ERASER_RADIUS * w, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(60,45,25,.55)';
      ctx.fillStyle = 'rgba(255,250,235,.35)';
      ctx.lineWidth = Math.max(1, s * 1.2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  };

  const eraseAt = (x: number, y: number) => {
    let changed = false;
    for (const s of strokesRef.current) {
      if (erased.current.has(s.id)) continue;
      if (strokeHit(s, x, y, ERASER_RADIUS)) {
        erased.current.add(s.id);
        changed = true;
      }
    }
    if (changed) paintInk();
  };

  /** (Re)starts the wait for the pointer to stay put at `p`. */
  const armHold = (p: InkPoint) => {
    const d = drawing.current;
    if (!d) return;
    clearTimeout(d.hold);
    d.anchor = p;
    d.hold = window.setTimeout(() => {
      if (drawing.current !== d || d.from) return;
      d.from = d.points[0];
      d.points = straightLine(d.from, d.points[d.points.length - 1]);
      navigator.vibrate?.(8);
      if (!d.raf) d.raf = requestAnimationFrame(paintLive);
    }, HOLD_MS);
  };

  /** Drops the stroke in progress without saving it. */
  const abortStroke = () => {
    const d = drawing.current;
    if (!d) return;
    drawing.current = null;
    clearTimeout(d.hold);
    cancelAnimationFrame(d.raf);
    clearLive();
    erased.current = new Set();
    paintInk();
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (tool === 'hand' || drawing.current || hub.gesture) return;
    if (e.pointerType !== 'touch') hub.lastPenAt = e.timeStamp;
    // Palm rejection: a hand resting beside a pen shouldn't leave marks.
    if (e.pointerType === 'touch' && e.timeStamp - hub.lastPenAt < PALM_WINDOW_MS) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = e.currentTarget.getBoundingClientRect();
    const first = toPoint(e, rect);
    const kind = tool === 'eraser' ? 'erase' : 'ink';
    drawing.current = { id: e.pointerId, kind, points: [first], raf: 0, hold: 0, anchor: first, from: null };
    if (tool === 'highlighter') armHold(first);
    erased.current = new Set();
    // A second finger landing turns this into a scroll; the viewer calls this.
    hub.cancelStroke = abortStroke;
    if (kind === 'erase') eraseAt(first[0], first[1]);
    drawing.current.raf = requestAnimationFrame(paintLive);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drawing.current;
    if (!d || d.id !== e.pointerId) return;
    if (e.pointerType !== 'touch') hub.lastPenAt = e.timeStamp;
    const rect = e.currentTarget.getBoundingClientRect();
    if (d.from) {
      d.points = straightLine(d.from, toPoint(e, rect));
      if (!d.raf) d.raf = requestAnimationFrame(paintLive);
      return;
    }
    const samples = e.nativeEvent.getCoalescedEvents?.() ?? [];
    for (const s of samples.length ? samples : [e.nativeEvent]) {
      const p = toPoint(s, rect);
      d.points.push(p);
      if (d.kind === 'erase') eraseAt(p[0], p[1]);
    }
    const last = d.points[d.points.length - 1];
    if (tool === 'highlighter' && Math.hypot(last[0] - d.anchor[0], last[1] - d.anchor[1]) * rect.width > HOLD_SLOP) {
      armHold(last);
    }
    if (!d.raf) d.raf = requestAnimationFrame(paintLive);
  };

  const finish = (e: React.PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const d = drawing.current;
    if (!d || d.id !== e.pointerId) return;
    if (hub.cancelStroke === abortStroke) hub.cancelStroke = null;
    if (cancelled) {
      abortStroke();
      return;
    }
    drawing.current = null;
    clearTimeout(d.hold);
    cancelAnimationFrame(d.raf);
    clearLive();
    const prev = strokesRef.current;
    if (d.kind === 'ink') {
      const stroke: Stroke = {
        id: newId(),
        tool: tool as InkTool,
        color,
        size: brush,
        points: d.points,
      };
      onCommit(index, prev, [...prev, stroke]);
    } else if (erased.current.size) {
      const gone = erased.current;
      onCommit(index, prev, prev.filter((s) => !gone.has(s.id)));
    }
    erased.current = new Set();
  };

  const interactive = tool !== 'hand';

  return (
    <div
      ref={(el) => register(index, el)}
      className={`page${ready ? ' ready' : ''}`}
      data-page={index}
      style={{ width, height }}
    >
      <canvas ref={pdfCanvas} className={`page-pdf${baked ? ' baked' : ''}`} />
      <canvas ref={inkCanvas} className="page-ink" />
      {/* Catches pen and finger input; the stroke itself is drawn on hub.overlay. */}
      <div
        ref={surface}
        className={`page-live${interactive ? ' on' : ''} tool-${tool}`}
        onPointerDown={interactive ? onPointerDown : undefined}
        onPointerMove={interactive ? onPointerMove : undefined}
        onPointerUp={interactive ? (e) => finish(e, false) : undefined}
        onPointerCancel={interactive ? (e) => finish(e, true) : undefined}
        onContextMenu={(e) => e.preventDefault()}
      />
      <span className="page-number">{index + 1}</span>
    </div>
  );
}

export const PageView = memo(PageViewImpl);
