// What can be done to ink that is already on a page: measure it, pick it with a
// lasso, move, scale and turn it, restyle it and rub part of it out.
import { newId, textRect } from './ink';
import type { InkPoint, Stroke } from './types';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The smallest box around a stroke (a typed note's box), in the page's units. */
export function strokeBox(s: Stroke): Box {
  if (s.tool === 'text') return textRect(s);
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of s.points) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  const half = s.size / 2;
  return { x: x0 - half, y: y0 - half, w: x1 - x0 + s.size, h: y1 - y0 + s.size };
}

/** The box around several strokes, or null for none. */
export function boxOf(strokes: Stroke[]): Box | null {
  if (!strokes.length) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const s of strokes) {
    const b = strokeBox(s);
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w);
    y1 = Math.max(y1, b.y + b.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function pointInPoly(x: number, y: number, poly: [number, number][]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** The strokes a lasso loop encloses: most of a stroke's points (or a note's box) inside it. */
export function lassoPick(strokes: Stroke[], loop: [number, number][]): string[] {
  if (loop.length < 3) return [];
  const picked: string[] = [];
  for (const s of strokes) {
    let sample: [number, number][];
    if (s.tool === 'text') {
      const b = textRect(s);
      sample = [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h], [b.x + b.w / 2, b.y + b.h / 2]];
    } else {
      const step = Math.max(1, Math.floor(s.points.length / 40));
      sample = s.points.filter((_, i) => i % step === 0).map(([x, y]) => [x, y]);
    }
    if (!sample.length) continue;
    const inside = sample.filter(([x, y]) => pointInPoly(x, y, loop)).length;
    if (inside / sample.length >= 0.55) picked.push(s.id);
  }
  return picked;
}

/** A scale and turn about a pivot, then a shift: how a selection is moved about. */
export interface Sim {
  scale: number;
  /** Radians, clockwise on screen. */
  turn: number;
  px: number;
  py: number;
  dx: number;
  dy: number;
}

export const IDENTITY: Sim = { scale: 1, turn: 0, px: 0, py: 0, dx: 0, dy: 0 };

export function simPoint(m: Sim, x: number, y: number): [number, number] {
  const c = Math.cos(m.turn);
  const s = Math.sin(m.turn);
  const ux = (x - m.px) * m.scale;
  const uy = (y - m.py) * m.scale;
  return [m.px + ux * c - uy * s + m.dx, m.py + ux * s + uy * c + m.dy];
}

/** A stroke moved, scaled and turned. A typed note stays upright: only its corner moves, and its size changes. */
export function simStroke(s: Stroke, m: Sim): Stroke {
  if (s.tool === 'text') {
    const [x, y] = simPoint(m, s.points[0][0], s.points[0][1]);
    return { ...s, size: s.size * m.scale, w: (s.w ?? 0) * m.scale || s.w, points: [[x, y, s.points[0][2]]] };
  }
  return {
    ...s,
    size: s.size * m.scale,
    points: s.points.map(([x, y, p]): InkPoint => {
      const [nx, ny] = simPoint(m, x, y);
      return [nx, ny, p];
    }),
  };
}

export function restyle(s: Stroke, change: { color?: string; size?: number }): Stroke {
  return { ...s, color: change.color ?? s.color, size: change.size ?? s.size };
}

/** Copies for pasting: new ids, shifted by (dx, dy). */
export function copies(strokes: Stroke[], dx: number, dy: number): Stroke[] {
  const m: Sim = { ...IDENTITY, dx, dy };
  return strokes.map((s) => ({ ...simStroke(s, m), id: newId() }));
}

/** Adds points along long segments so that rubbing out a stretch cannot skip between samples. */
function densify(points: InkPoint[], step: number): InkPoint[] {
  const out: InkPoint[] = [];
  for (let i = 0; i < points.length; i++) {
    if (i > 0) {
      const a = points[i - 1];
      const b = points[i];
      const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step);
      for (let k = 1; k < n; k++) {
        const t = k / n;
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
      }
    }
    out.push(points[i]);
  }
  return out;
}

/**
 * Rubs out whatever lies within `radius` of (x, y): a stroke is cut where the
 * eraser passes and what is left on either side stays as separate strokes. A
 * typed note goes whole. `only` limits the eraser to one kind of ink. Strokes
 * it did not touch are returned as the very same objects.
 */
export function eraseArea(strokes: Stroke[], x: number, y: number, radius: number, only?: Stroke['tool']): Stroke[] {
  let changed = false;
  const out: Stroke[] = [];
  for (const s of strokes) {
    if (only && s.tool !== only) {
      out.push(s);
      continue;
    }
    if (s.tool === 'text') {
      const r = textRect(s);
      const hit = x >= r.x - radius && x <= r.x + r.w + radius && y >= r.y - radius && y <= r.y + r.h + radius;
      if (hit) changed = true;
      else out.push(s);
      continue;
    }
    const reach = radius + s.size / 2;
    const b = strokeBox(s);
    if (x < b.x - radius || x > b.x + b.w + radius || y < b.y - radius || y > b.y + b.h + radius) {
      out.push(s);
      continue;
    }
    const pts = densify(s.points, Math.max(reach / 2, 0.0015));
    const keep = pts.map(([px, py]) => (px - x) ** 2 + (py - y) ** 2 > reach * reach);
    if (keep.every(Boolean)) {
      out.push(s);
      continue;
    }
    changed = true;
    let run: InkPoint[] = [];
    const flush = () => {
      if (run.length >= 2) out.push({ ...s, id: newId(), points: run });
      run = [];
    };
    pts.forEach((p, i) => {
      if (keep[i]) run.push(p);
      else flush();
    });
    flush();
  }
  return changed ? out : strokes;
}
