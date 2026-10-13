// Moves a document's notes (highlights and pen marks) onto a PDF made from it
// by merging, splitting, cropping or editing pages, in the right place.
import type { InkPoint, Stroke } from './types';

/** Where a page's notes go: page `from` of the source ends up as page `to` of the new file. */
export interface PageMove {
  from: number;
  to: number;
  /** Changes a stroke for the new page (cropping, turning). Without it, strokes are copied as they are. */
  change?: (s: Stroke) => Stroke;
}

// Same shape as the ids of strokes drawn by hand.
const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

const mapStroke = (s: Stroke, point: (p: InkPoint) => InkPoint, size: number): Stroke => ({
  ...s,
  size: s.size * size,
  ...(s.w === undefined ? {} : { w: s.w * size }),
  points: s.points.map(point),
});

/**
 * Notes are stored as fractions of the page width (x and y alike), so a page
 * of shown shape `aspect` (height / width) cut by `m` has to shift and
 * stretch them to the smaller page.
 */
export function cropChange(m: { l: number; t: number; r: number; b: number }, aspect: number) {
  const keep = 1 - m.l - m.r;
  return (s: Stroke) =>
    mapStroke(s, ([x, y, p]) => [(x - m.l) / keep, (y - m.t * aspect) / keep, p], 1 / keep);
}

/** The strokes of a page turned clockwise by `turn` degrees (0, 90, 180 or 270). */
export function turnChange(turn: number, aspect: number) {
  const t = ((turn % 360) + 360) % 360;
  if (t === 0) return (s: Stroke) => s;
  if (t === 90) return (s: Stroke) => mapStroke(s, ([x, y, p]) => [1 - y / aspect, x / aspect, p], 1 / aspect);
  if (t === 180) return (s: Stroke) => mapStroke(s, ([x, y, p]) => [1 - x, aspect - y, p], 1);
  return (s: Stroke) => mapStroke(s, ([x, y, p]) => [y / aspect, (1 - x) / aspect, p], 1 / aspect);
}

/** The strokes for each move, as fresh copies ready to be added to the new document. */
export function movedStrokes(ink: Record<number, Stroke[]>, moves: PageMove[]) {
  const out: { page: number; strokes: Stroke[] }[] = [];
  for (const m of moves) {
    const strokes = ink[m.from];
    if (!strokes?.length) continue;
    out.push({ page: m.to, strokes: strokes.map((s) => ({ ...(m.change ? m.change(s) : s), id: newId() })) });
  }
  return out;
}
