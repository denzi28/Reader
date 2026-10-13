import { getStroke } from 'perfect-freehand';
import type { InkPoint, InkTool, Stroke } from './types';

export const PEN_COLORS = ['#1f1a14', '#25489b', '#b3261e', '#2e6b3a', '#c2650a', '#7b3fa0'];
/** Strokes are saved with the day-paper colour; night paper shows a lighter twin. */
const NIGHT_INK: Record<string, string> = {
  '#1f1a14': '#efe5d0',
  '#25489b': '#7aa2ff',
  '#b3261e': '#ff7a70',
  '#2e6b3a': '#6fce86',
  '#c2650a': '#ffa65c',
  '#7b3fa0': '#cf9bf0',
};
export const displayColor = (color: string, dark: boolean) =>
  (dark && NIGHT_INK[color]) || color;

export const HIGHLIGHT_COLORS = ['#ffd84d', '#ff8fab', '#7ddc9a', '#7cbcff'];

/** Brush widths (S, M, L) as a fraction of the page width. */
export const BRUSH_SIZES: Record<InkTool, [number, number, number]> = {
  pen: [0.0016, 0.003, 0.0055],
  highlighter: [0.012, 0.02, 0.032],
};
/** The slider's reach for each brush, as a fraction of the page width. */
export const BRUSH_RANGE: Record<InkTool, [number, number]> = {
  pen: [0.001, 0.012],
  highlighter: [0.008, 0.05],
};
/** Letter sizes of a typed note (S, M, L) and their slider reach. */
export const TEXT_SIZES: [number, number, number] = [0.016, 0.024, 0.036];
export const TEXT_RANGE: [number, number] = [0.01, 0.07];
export const TEXT_BOX = 0.42; // default width of a new typed note
const TEXT_LINE = 1.3;
export const SELECT_COLOR = '#0f8a96';

export const newId = () =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

function outlineToPath(outline: number[][]): Path2D {
  const path = new Path2D();
  const n = outline.length;
  if (n < 2) return path;
  const mid = (a: number[], b: number[]) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const start = mid(outline[n - 1], outline[0]);
  path.moveTo(start[0], start[1]);
  for (let i = 0; i < n; i++) {
    const a = outline[i];
    const m = mid(a, outline[(i + 1) % n]);
    path.quadraticCurveTo(a[0], a[1], m[0], m[1]);
  }
  path.closePath();
  return path;
}

// ---- typed notes ---------------------------------------------------------
const FONT = '"Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const REF = 1000; // layout is worked out at this width, so it is the same at every zoom
let measurer: CanvasRenderingContext2D | null = null;
const wrapped = new Map<string, string[]>();

/** The lines a typed note breaks into at its box width. */
export function textLines(text: string, size: number, w: number): string[] {
  const key = `${size}|${w}|${text}`;
  const known = wrapped.get(key);
  if (known) return known;
  measurer ??= document.createElement('canvas').getContext('2d');
  const ctx = measurer;
  const out: string[] = [];
  if (ctx) {
    ctx.font = `${size * REF}px ${FONT}`;
    const max = w * REF;
    for (const para of text.split('\n')) {
      let line = '';
      for (const word of para.split(/(\s+)/)) {
        if (!word) continue;
        const tryLine = line + word;
        if (!line || ctx.measureText(tryLine.trimEnd()).width <= max) {
          line = tryLine;
          continue;
        }
        out.push(line.trimEnd());
        line = word.trimStart();
        // A word wider than the box is broken by letters.
        while (ctx.measureText(line).width > max && line.length > 1) {
          let n = line.length - 1;
          while (n > 1 && ctx.measureText(line.slice(0, n)).width > max) n--;
          out.push(line.slice(0, n));
          line = line.slice(n);
        }
      }
      out.push(line.trimEnd());
    }
  } else {
    out.push(...text.split('\n'));
  }
  if (wrapped.size > 400) wrapped.clear();
  wrapped.set(key, out);
  return out;
}

/** Where a typed note sits on its page, in the page's units. */
export function textRect(s: Pick<Stroke, 'points' | 'size' | 'text' | 'w'>) {
  const [x, y] = s.points[0];
  const w = s.w ?? TEXT_BOX;
  const lines = textLines(s.text ?? '', s.size, w);
  return { x, y, w, h: Math.max(1, lines.length) * s.size * TEXT_LINE };
}

function drawText(ctx: CanvasRenderingContext2D, stroke: Pick<Stroke, 'color' | 'size' | 'points' | 'text' | 'w'>, scale: number, color: string) {
  if (!stroke.text || !stroke.points.length) return;
  const { x, y, w } = textRect(stroke);
  const lines = textLines(stroke.text, stroke.size, w);
  ctx.save();
  ctx.fillStyle = color;
  ctx.font = `${stroke.size * scale}px ${FONT}`;
  ctx.textBaseline = 'top';
  const lh = stroke.size * TEXT_LINE * scale;
  const pad = (lh - stroke.size * scale) / 2;
  lines.forEach((line, i) => ctx.fillText(line, x * scale, y * scale + i * lh + pad));
  ctx.restore();
}

/** The shape of a drawn stroke, as an outline in units of `scale` per page width. */
export function strokeOutline(stroke: Pick<Stroke, 'tool' | 'size' | 'points'>, scale: number): number[][] {
  const { points } = stroke;
  const pixelPoints = points.map(([x, y, p]) => [x * scale, y * scale, p]);
  const simulatePressure = points.every((p) => p[2] === points[0][2]);
  const highlighter = stroke.tool === 'highlighter';
  return getStroke(pixelPoints, {
    size: stroke.size * scale,
    thinning: highlighter ? 0 : 0.55,
    smoothing: 0.55,
    streamline: 0.45,
    simulatePressure,
    easing: (t) => t,
    start: { cap: true },
    end: { cap: true },
  });
}

/** Draws one stroke; `scale` converts normalised units to canvas pixels. A `tint` replaces its colour (a selection). */
export function drawStroke(
  ctx: CanvasRenderingContext2D,
  stroke: Pick<Stroke, 'tool' | 'color' | 'size' | 'points' | 'text' | 'w'>,
  scale: number,
  dark = false,
  tint?: string,
) {
  const { points } = stroke;
  if (!points.length) return;
  if (stroke.tool === 'text') {
    drawText(ctx, stroke, scale, tint ?? displayColor(stroke.color, dark));
    return;
  }
  const outline = strokeOutline(stroke, scale);
  const highlighter = stroke.tool === 'highlighter';
  ctx.save();
  ctx.fillStyle = tint ?? displayColor(stroke.color, dark);
  ctx.globalAlpha = highlighter ? 0.38 : 1;
  ctx.fill(outlineToPath(outline));
  ctx.restore();
}

export function drawStrokes(
  ctx: CanvasRenderingContext2D,
  strokes: Stroke[],
  scale: number,
  dark: boolean,
  skip?: ReadonlySet<string>,
  /** Strokes to draw in the selection colour. */
  selected?: ReadonlySet<string>,
) {
  for (const stroke of strokes) {
    if (!skip?.has(stroke.id)) drawStroke(ctx, stroke, scale, dark, selected?.has(stroke.id) ? SELECT_COLOR : undefined);
  }
}

/** Does the eraser, centred at (x, y) with `radius`, touch this stroke? */
export function strokeHit(stroke: Stroke, x: number, y: number, radius: number) {
  if (stroke.tool === 'text') {
    const r = textRect(stroke);
    return x >= r.x - radius && x <= r.x + r.w + radius && y >= r.y - radius && y <= r.y + r.h + radius;
  }
  const reach = radius + stroke.size / 2;
  const r2 = reach * reach;
  const pts: InkPoint[] = stroke.points;
  for (let i = 0; i < pts.length; i++) {
    const [px, py] = pts[i];
    if ((px - x) ** 2 + (py - y) ** 2 <= r2) return true;
    if (i > 0) {
      // Test the segment too, so fast strokes can't slip between samples.
      const [qx, qy] = pts[i - 1];
      const dx = px - qx;
      const dy = py - qy;
      const len2 = dx * dx + dy * dy;
      if (len2 > 0) {
        const t = Math.max(0, Math.min(1, ((x - qx) * dx + (y - qy) * dy) / len2));
        const cx = qx + t * dx;
        const cy = qy + t * dy;
        if ((cx - x) ** 2 + (cy - y) ** 2 <= r2) return true;
      }
    }
  }
  return false;
}
