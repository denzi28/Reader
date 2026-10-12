import { getStroke } from 'perfect-freehand';
import type { InkPoint, InkTool, Stroke } from './types';

export const PEN_COLORS = ['#1f1a14', '#25489b', '#b3261e', '#2e6b3a'];
/** Strokes are saved with the day-paper colour; night paper shows a lighter twin. */
const NIGHT_INK: Record<string, string> = {
  '#1f1a14': '#efe5d0',
  '#25489b': '#7aa2ff',
  '#b3261e': '#ff7a70',
  '#2e6b3a': '#6fce86',
};
export const displayColor = (color: string, dark: boolean) =>
  (dark && NIGHT_INK[color]) || color;

export const HIGHLIGHT_COLORS = ['#ffd84d', '#ff8fab', '#7ddc9a', '#7cbcff'];

/** Brush widths (S, M, L) as a fraction of the page width. */
export const BRUSH_SIZES: Record<InkTool, [number, number, number]> = {
  pen: [0.0016, 0.003, 0.0055],
  highlighter: [0.012, 0.02, 0.032],
};

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

/** Draws one stroke; `scale` converts normalised units to canvas pixels. */
export function drawStroke(
  ctx: CanvasRenderingContext2D,
  stroke: Pick<Stroke, 'tool' | 'color' | 'size' | 'points'>,
  scale: number,
  dark = false,
) {
  const { points } = stroke;
  if (!points.length) return;
  const pixelPoints = points.map(([x, y, p]) => [x * scale, y * scale, p]);
  const simulatePressure = points.every((p) => p[2] === points[0][2]);
  const highlighter = stroke.tool === 'highlighter';
  const outline = getStroke(pixelPoints, {
    size: stroke.size * scale,
    thinning: highlighter ? 0 : 0.55,
    smoothing: 0.55,
    streamline: 0.45,
    simulatePressure,
    easing: (t) => t,
    start: { cap: true },
    end: { cap: true },
  });
  ctx.save();
  ctx.fillStyle = displayColor(stroke.color, dark);
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
) {
  for (const stroke of strokes) {
    if (!skip?.has(stroke.id)) drawStroke(ctx, stroke, scale, dark);
  }
}

/** Does the eraser, centred at (x, y) with `radius`, touch this stroke? */
export function strokeHit(stroke: Stroke, x: number, y: number, radius: number) {
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
