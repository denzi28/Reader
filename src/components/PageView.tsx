import type { PDFDocumentProxy } from 'pdfjs-dist';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { t } from '../lib/i18n';
import { displayColor, drawStroke, drawStrokes, newId, SELECT_COLOR, strokeHit, TEXT_BOX } from '../lib/ink';
import { boxOf, eraseArea, lassoPick, simStroke, type Sim } from '../lib/inkOps';
import { PALM_WINDOW_MS, type PointerHub } from '../lib/pointerHub';
import { queueRender } from '../lib/renderQueue';
import type { InkPoint, InkTool, Stroke, Tool } from '../lib/types';
import { SelectionLayer, type SelectionApi } from './SelectionLayer';

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
  /** The eraser, and the letter size of a new typed note. */
  eraser: { mode: 'stroke' | 'area'; size: number; onlyHighlighter: boolean };
  textSize: number;
  /** Words found on this page, to mark. */
  finds?: { x: number; y: number; w: number; h: number; active: boolean }[];
  /** Ids of the strokes selected on this page, if any. */
  selection: readonly string[] | null;
  onSelect: (page: number, ids: string[] | null) => void;
  selectionApi: SelectionApi;
  /** Night paper recolours the bitmap with a CSS filter instead of a tint. */
  dark: boolean;
  hub: PointerHub;
  onCommit: (page: number, prev: Stroke[], next: Stroke[]) => void;
  register: (index: number, el: HTMLDivElement | null) => void;
}

// Phones have far less memory for canvases than desktops; past these sizes a
// zoomed-in page would freeze the browser rather than look any sharper.
const TOUCH_DEVICE = typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0;
const MAX_PIXELS = TOUCH_DEVICE ? 5_000_000 : 16_000_000;
const MAX_INK_PIXELS = TOUCH_DEVICE ? 2_500_000 : 8_000_000;
const PAPER = '#fffaf0';
const NIGHT_FILTER = 'invert(0.88) hue-rotate(180deg) sepia(0.28) brightness(0.96)';
// Where canvases can filter their own pixels, night paper is baked in once;
// elsewhere a CSS filter on the bitmap does the job.
const CAN_BAKE_FILTER =
  typeof CanvasRenderingContext2D !== 'undefined' && 'filter' in CanvasRenderingContext2D.prototype;
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
    brush, dark, hub, onCommit, register, eraser, textSize, selection, onSelect, selectionApi, finds,
  } = props;

  // A steady callback: a new one on every render would detach and re-attach the page each
  // time (a theme switch, a sync tick), and the page would be dropped from the visible set.
  const attach = useCallback((el: HTMLDivElement | null) => register(index, el), [register, index]);
  const pdfCanvas = useRef<HTMLCanvasElement>(null);
  const inkCanvas = useRef<HTMLCanvasElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [baked, setBaked] = useState(false);
  const erased = useRef(new Set<string>());
  /** The page as the area eraser has left it so far in this stroke. */
  const work = useRef<Stroke[] | null>(null);
  /** Set while the selection is being dragged: the strokes are drawn moved, over the page. */
  const sim = useRef<Sim | null>(null);
  const editingId = useRef<string | null>(null);
  const strokesRef = useRef(strokes);
  strokesRef.current = strokes;
  const darkRef = useRef(dark);
  darkRef.current = dark;
  const selected = useMemo(() => new Set(selection ?? []), [selection]);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const eraserRef = useRef(eraser);
  eraserRef.current = eraser;

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
    let sharpJob: { cancel: () => void } | null = null;
    const report = (err: { name?: string }) => {
      if (err?.name !== 'RenderingCancelledException') console.error(err);
    };
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
      const drawSharp = async () => {
        if (cancelled) return;
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
      };
      // On sharp screens a page first appears from a quick, plain-resolution
      // drawing (a fraction of the pixels). The sharp one is drawn after every
      // page on screen has its quick one, so neighbours don't wait.
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
        sharpJob = queueRender(index, () => drawSharp().catch(report), true);
        return;
      }
      await drawSharp();
    })().catch(report));
    return () => {
      cancelled = true;
      job.cancel();
      sharpJob?.cancel();
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
    let skip = erased.current;
    if (sim.current || editingId.current) {
      skip = new Set(erased.current);
      if (sim.current) selectedRef.current.forEach((id) => skip.add(id));
      if (editingId.current) skip.add(editingId.current);
    }
    drawStrokes(ctx, work.current ?? strokesRef.current, canvas.width, darkRef.current, skip, selectedRef.current);
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
  }, [visible, strokes, dark, selected, paintInk]);

  // A phone short of memory may throw away a canvas's pixels while the app is in
  // the background or busy with a big zoom. The ink is only ever a drawing of the
  // strokes, so it is simply drawn again when the page comes back into view.
  useEffect(() => {
    if (!visible) return;
    const again = () => { if (document.visibilityState === 'visible') paintInk(); };
    document.addEventListener('visibilitychange', again);
    window.addEventListener('pageshow', again);
    window.addEventListener('focus', again);
    return () => {
      document.removeEventListener('visibilitychange', again);
      window.removeEventListener('pageshow', again);
      window.removeEventListener('focus', again);
    };
  }, [visible, paintInk]);

  // ---- drawing ----------------------------------------------------------
  const drawing = useRef<{
    id: number;
    kind: 'ink' | 'erase' | 'lasso';
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

  /** Runs `draw` on the screen-sized overlay, set up so that page units are `w` pixels wide and clipped to the page. */
  const onOverlay = (draw: (ctx: CanvasRenderingContext2D, w: number, s: number) => void) => {
    const ov = hub.overlay;
    const ctx = ov?.getContext('2d');
    const el = surface.current;
    if (!ov || !ctx || !el) return;
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
    draw(ctx, w, s);
    ctx.restore();
  };

  const paintLive = () => {
    const d = drawing.current;
    if (!d) return;
    d.raf = 0;
    onOverlay((ctx, w, s) => {
      if (d.kind === 'ink') {
        drawStroke(ctx, { tool: tool as InkTool, color, size: brush, points: d.points }, w, darkRef.current);
      } else if (d.kind === 'lasso') {
        ctx.beginPath();
        d.points.forEach(([x, y], i) => (i ? ctx.lineTo(x * w, y * w) : ctx.moveTo(x * w, y * w)));
        ctx.closePath();
        ctx.fillStyle = 'rgba(15,138,150,.08)';
        ctx.fill();
        ctx.setLineDash([6 * s, 5 * s]);
        ctx.lineWidth = Math.max(1, s * 1.6);
        ctx.strokeStyle = SELECT_COLOR;
        ctx.stroke();
      } else {
        const [x, y] = d.points[d.points.length - 1];
        ctx.beginPath();
        ctx.arc(x * w, y * w, eraserRef.current.size * w, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(60,45,25,.55)';
        ctx.fillStyle = 'rgba(255,250,235,.35)';
        ctx.lineWidth = Math.max(1, s * 1.2);
        ctx.fill();
        ctx.stroke();
      }
    });
  };

  // The selection being dragged is drawn over the page, moved, in the selection colour.
  const liveRaf = useRef(0);
  const onSelectionLive = (next: Sim | null) => {
    const was = sim.current !== null;
    sim.current = next;
    if (was !== (next !== null)) paintInk();
    if (!next) {
      cancelAnimationFrame(liveRaf.current);
      liveRaf.current = 0;
      clearLive();
      return;
    }
    if (liveRaf.current) return;
    liveRaf.current = requestAnimationFrame(() => {
      liveRaf.current = 0;
      const m = sim.current;
      if (!m) return;
      onOverlay((ctx, w) => {
        for (const s of strokesRef.current) {
          if (selectedRef.current.has(s.id)) drawStroke(ctx, simStroke(s, m), w, darkRef.current, SELECT_COLOR);
        }
      });
    });
  };
  const onSelectionDone = (m: Sim) => {
    const prev = strokesRef.current;
    onCommit(index, prev, prev.map((s) => (selectedRef.current.has(s.id) ? simStroke(s, m) : s)));
  };

  const eraseAt = (x: number, y: number) => {
    const { mode, size, onlyHighlighter } = eraserRef.current;
    if (mode === 'area') {
      const now = work.current ?? strokesRef.current;
      const next = eraseArea(now, x, y, size, onlyHighlighter ? 'highlighter' : undefined);
      if (next !== now) {
        work.current = next;
        paintInk();
      }
      return;
    }
    let changed = false;
    for (const s of strokesRef.current) {
      if (erased.current.has(s.id)) continue;
      if (onlyHighlighter && s.tool !== 'highlighter') continue;
      if (strokeHit(s, x, y, size)) {
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
    work.current = null;
    paintInk();
  };

  // ---- typed notes ------------------------------------------------------
  interface Editor { id: string | null; x: number; y: number; w: number; size: number; color: string; text: string }
  const [editor, setEditor] = useState<Editor | null>(null);
  const editorRef = useRef<Editor | null>(null);
  editorRef.current = editor;
  const field = useRef<HTMLTextAreaElement>(null);

  const startEditor = (next: Editor) => {
    editingId.current = next.id;
    editorRef.current = next;
    setEditor(next);
    paintInk();
  };
  const editNote = (s: Stroke) =>
    startEditor({ id: s.id, x: s.points[0][0], y: s.points[0][1], w: s.w ?? TEXT_BOX, size: s.size, color: s.color, text: s.text ?? '' });

  /** Closes the editor, keeping what was typed unless `keep` is false. */
  const finishEditor = (keep: boolean) => {
    const ed = editorRef.current;
    if (!ed) return;
    editorRef.current = null;
    editingId.current = null;
    setEditor(null);
    const prev = strokesRef.current;
    const text = ed.text.replace(/\s+$/g, '');
    if (!keep) {
      paintInk();
    } else if (ed.id) {
      const old = prev.find((s) => s.id === ed.id);
      if (!text.trim()) onCommit(index, prev, prev.filter((s) => s.id !== ed.id));
      else if (old && old.text !== text) onCommit(index, prev, prev.map((s) => (s.id === ed.id ? { ...s, text } : s)));
      else paintInk();
    } else if (text.trim()) {
      const note: Stroke = { id: newId(), tool: 'text', color: ed.color, size: ed.size, w: ed.w, text, points: [[ed.x, ed.y, 0.5]] };
      onCommit(index, prev, [...prev, note]);
    } else {
      paintInk();
    }
  };
  useEffect(() => () => { if (editorRef.current) finishEditor(true); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Grow the box with what is typed.
  useLayoutEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [editor?.text, editor?.size, width]);
  useEffect(() => {
    if (editor) field.current?.focus();
  }, [editor?.id, editor !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  const tap = useRef<{ id: number; p: InkPoint; x: number; y: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (tool === 'hand' || drawing.current || hub.gesture) return;
    if (e.pointerType !== 'touch') hub.lastPenAt = e.timeStamp;
    // Palm rejection: a hand resting beside a pen shouldn't leave marks.
    if (e.pointerType === 'touch' && e.timeStamp - hub.lastPenAt < PALM_WINDOW_MS) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const first = toPoint(e, rect);

    if (tool === 'text') {
      // A tap types a note there (or edits the note tapped). It starts on release, once
      // the browser has finished moving focus away from a note being typed.
      tap.current = { id: e.pointerId, p: first, x: e.clientX, y: e.clientY };
      return;
    }

    e.currentTarget.setPointerCapture(e.pointerId);
    if (tool === 'select') onSelect(index, null);
    const kind = tool === 'eraser' ? 'erase' : tool === 'select' ? 'lasso' : 'ink';
    drawing.current = { id: e.pointerId, kind, points: [first], raf: 0, hold: 0, anchor: first, from: null };
    if (tool === 'highlighter') armHold(first);
    erased.current = new Set();
    work.current = null;
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
    const t = tap.current;
    if (t && t.id === e.pointerId) {
      tap.current = null;
      if (!cancelled && Math.hypot(e.clientX - t.x, e.clientY - t.y) < 10) {
        if (editorRef.current) finishEditor(true);
        const [x, y] = t.p;
        const hit = [...strokesRef.current].reverse().find((s) => s.tool === 'text' && strokeHit(s, x, y, 0.004));
        if (hit) editNote(hit);
        else startEditor({ id: null, x, y, w: Math.max(0.15, Math.min(TEXT_BOX, 0.98 - x)), size: textSize, color, text: '' });
      }
      return;
    }
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
    if (d.kind === 'lasso') {
      const rect = e.currentTarget.getBoundingClientRect();
      const xs = d.points.map((q) => q[0]);
      const ys = d.points.map((q) => q[1]);
      const reach = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * rect.width;
      let ids: string[] = [];
      if (reach < 8) {
        // A tap: the note on top under it.
        const [x, y] = d.points[0];
        const hit = [...prev].reverse().find((s) => strokeHit(s, x, y, 0.01));
        if (hit) ids = [hit.id];
      } else {
        ids = lassoPick(prev, d.points.map(([x, y]) => [x, y] as [number, number]));
      }
      onSelect(index, ids.length ? ids : null);
    } else if (d.kind === 'ink') {
      const stroke: Stroke = {
        id: newId(),
        tool: tool as InkTool,
        color,
        size: brush,
        points: d.points,
      };
      onCommit(index, prev, [...prev, stroke]);
    } else if (work.current) {
      const next = work.current;
      work.current = null;
      onCommit(index, prev, next);
    } else if (erased.current.size) {
      const gone = erased.current;
      onCommit(index, prev, prev.filter((s) => !gone.has(s.id)));
    }
    erased.current = new Set();
  };

  const interactive = tool !== 'hand';
  const picked = useMemo(() => strokes.filter((s) => selected.has(s.id)), [strokes, selected]);
  const selBox = picked.length ? boxOf(picked) : null;
  const onlyText = picked.length === 1 && picked[0].tool === 'text';

  return (
    <div
      ref={attach}
      className={`page${ready ? ' ready' : ''}`}
      data-page={index}
      style={{ width, height }}
    >
      <canvas ref={pdfCanvas} className={`page-pdf${baked ? ' baked' : ''}`} />
      <canvas ref={inkCanvas} className="page-ink" />
      {finds?.map((r, i) => (
        <span key={i} className={`find-rect${r.active ? ' on' : ''}`} style={{ left: r.x * width, top: r.y * width, width: r.w * width, height: r.h * width }} />
      ))}
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
      {editor && (
        <textarea
          ref={field}
          className="note-editor"
          aria-label={t('Note text')}
          rows={1}
          value={editor.text}
          placeholder={t('Type a note')}
          style={{ left: editor.x * width, top: editor.y * width, width: editor.w * width, fontSize: editor.size * width, lineHeight: 1.3, color: displayColor(editor.color, dark) }}
          onChange={(e) => setEditor({ ...editor, text: e.target.value })}
          onBlur={() => finishEditor(true)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Escape') finishEditor(false);
            else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) finishEditor(true);
          }}
        />
      )}
      {tool === 'select' && selBox && selection && (
        <SelectionLayer
          page={index}
          ids={picked.map((s) => s.id)}
          box={selBox}
          width={width}
          canTurn={!picked.some((s) => s.tool === 'text')}
          onEdit={onlyText ? () => { onSelect(index, null); editNote(picked[0]); } : undefined}
          highlighter={picked.length > 0 && picked.every((s) => s.tool === 'highlighter')}
          dark={dark}
          hub={hub}
          api={selectionApi}
          onLive={onSelectionLive}
          onDone={onSelectionDone}
        />
      )}
      <span className="page-number">{index + 1}</span>
    </div>
  );
}

export const PageView = memo(PageViewImpl);
