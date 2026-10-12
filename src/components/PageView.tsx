import type { PDFDocumentProxy } from 'pdfjs-dist';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { drawStroke, drawStrokes, newId, strokeHit } from '../lib/ink';
import { PALM_WINDOW_MS, type PointerHub } from '../lib/pointerHub';
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

const MAX_PIXELS = 16_000_000;
const PAPER = '#fffaf0';
const NIGHT_FILTER = 'invert(0.88) hue-rotate(180deg) sepia(0.28) brightness(0.96)';
// Where canvases can filter their own pixels, night paper is baked in once;
// elsewhere a CSS filter on the bitmap does the job.
const CAN_BAKE_FILTER =
  typeof CanvasRenderingContext2D !== 'undefined' && 'filter' in CanvasRenderingContext2D.prototype;
const ERASER_RADIUS = 0.012; // fraction of page width

function PageViewImpl(props: Props) {
  const {
    index, pdf, width, height, renderWidth, visible, strokes, tool, color,
    brush, dark, hub, onCommit, register,
  } = props;

  const pdfCanvas = useRef<HTMLCanvasElement>(null);
  const inkCanvas = useRef<HTMLCanvasElement>(null);
  const liveCanvas = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const [baked, setBaked] = useState(false);
  const erased = useRef(new Set<string>());
  const strokesRef = useRef(strokes);
  strokesRef.current = strokes;
  const darkRef = useRef(dark);
  darkRef.current = dark;

  const aspect = height / width;
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const inkW = Math.max(1, Math.round(renderWidth * dpr));
  const inkH = Math.max(1, Math.round(renderWidth * aspect * dpr));

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
    (async () => {
      const page = await pdf.getPage(index + 1);
      const base = page.getViewport({ scale: 1 });
      let scale = (renderWidth / base.width) * dpr;
      const pixels = base.width * base.height * scale * scale;
      if (pixels > MAX_PIXELS) scale *= Math.sqrt(MAX_PIXELS / pixels);
      const viewport = page.getViewport({ scale });
      const w = Math.floor(viewport.width);
      const h = Math.floor(viewport.height);
      const bake = dark && CAN_BAKE_FILTER;
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
      if (!dark) {
        // Tint the white of the page once here, rather than blending every frame.
        const tint = target.getContext('2d');
        if (tint) {
          tint.globalCompositeOperation = 'multiply';
          tint.fillStyle = PAPER;
          tint.fillRect(0, 0, w, h);
        }
      }
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
    });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [visible, renderWidth, pdf, index, dpr, dark]);

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
    const live = liveCanvas.current;
    const w = visible ? inkW : 0;
    const h = visible ? inkH : 0;
    if (ink) { ink.width = w; ink.height = h; }
    if (live) { live.width = w; live.height = h; }
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
  } | null>(null);

  const toPoint = (e: PointerEvent | React.PointerEvent, rect: DOMRect): InkPoint => [
    (e.clientX - rect.left) / rect.width,
    (e.clientY - rect.top) / rect.width,
    e.pointerType === 'mouse' ? 0.5 : e.pressure || 0.5,
  ];

  const paintLive = () => {
    const live = liveCanvas.current;
    const ctx = live?.getContext('2d');
    const d = drawing.current;
    if (!live || !ctx || !d) return;
    d.raf = 0;
    ctx.clearRect(0, 0, live.width, live.height);
    if (d.kind === 'ink') {
      drawStroke(ctx, { tool: tool as InkTool, color, size: brush, points: d.points }, live.width, darkRef.current);
    } else if (d.kind === 'erase') {
      const [x, y] = d.points[d.points.length - 1];
      ctx.save();
      ctx.beginPath();
      ctx.arc(x * live.width, y * live.width, ERASER_RADIUS * live.width, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(60,45,25,.55)';
      ctx.fillStyle = 'rgba(255,250,235,.35)';
      ctx.lineWidth = Math.max(1, live.width * 0.0015);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
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

  /** Drops the stroke in progress without saving it. */
  const abortStroke = () => {
    const d = drawing.current;
    if (!d) return;
    drawing.current = null;
    cancelAnimationFrame(d.raf);
    const live = liveCanvas.current;
    live?.getContext('2d')?.clearRect(0, 0, live.width, live.height);
    erased.current = new Set();
    paintInk();
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
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
    drawing.current = { id: e.pointerId, kind, points: [first], raf: 0 };
    erased.current = new Set();
    // A second finger landing turns this into a scroll; the viewer calls this.
    hub.cancelStroke = abortStroke;
    if (kind === 'erase') eraseAt(first[0], first[1]);
    drawing.current.raf = requestAnimationFrame(paintLive);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drawing.current;
    if (!d || d.id !== e.pointerId) return;
    if (e.pointerType !== 'touch') hub.lastPenAt = e.timeStamp;
    const rect = e.currentTarget.getBoundingClientRect();
    const samples = e.nativeEvent.getCoalescedEvents?.() ?? [];
    for (const s of samples.length ? samples : [e.nativeEvent]) {
      const p = toPoint(s, rect);
      d.points.push(p);
      if (d.kind === 'erase') eraseAt(p[0], p[1]);
    }
    if (!d.raf) d.raf = requestAnimationFrame(paintLive);
  };

  const finish = (e: React.PointerEvent<HTMLCanvasElement>, cancelled: boolean) => {
    const d = drawing.current;
    if (!d || d.id !== e.pointerId) return;
    if (hub.cancelStroke === abortStroke) hub.cancelStroke = null;
    if (cancelled) {
      abortStroke();
      return;
    }
    drawing.current = null;
    cancelAnimationFrame(d.raf);
    const live = liveCanvas.current;
    live?.getContext('2d')?.clearRect(0, 0, live.width, live.height);
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
      <canvas
        ref={liveCanvas}
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
