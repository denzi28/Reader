// Turns a document's ink into notes: the text under each highlight, and a
// count of the pen marks on each page.
import type { TextBox } from './pdf';
import type { DocInk, Stroke } from './types';

export interface PageNotes {
  page: number;
  /** Highlighted passages, in reading order, with the highlighter colour. */
  highlights: { text: string; color: string }[];
  /** Highlights where no text could be found (a scan, say). */
  untextedHighlights: number;
  pens: number;
}

/** The text a highlighter stroke passes over, read left to right, top to bottom. */
export function textUnder(stroke: Stroke, boxes: TextBox[]): string {
  const half = stroke.size / 2;
  const parts: { top: number; x: number; text: string }[] = [];
  for (const box of boxes) {
    const pad = (box.bottom - box.top) * 0.15;
    // The stroke's points that lie on this line of text.
    let min = Infinity;
    let max = -Infinity;
    for (const [x, y] of stroke.points) {
      if (y + half < box.top + pad || y - half > box.bottom - pad) continue;
      min = Math.min(min, x);
      max = Math.max(max, x);
    }
    if (min > max) continue;
    const from = Math.max(min - half * 0.3, box.x);
    const to = Math.min(max + half * 0.3, box.right);
    if (to <= from) continue;
    const span = box.right - box.x || 1;
    const n = box.str.length;
    let a = Math.floor(((from - box.x) / span) * n);
    let b = Math.ceil(((to - box.x) / span) * n);
    // Widen to whole words.
    while (a > 0 && /\S/.test(box.str[a - 1])) a--;
    while (b < n && /\S/.test(box.str[b])) b++;
    const text = box.str.slice(a, b).trim();
    if (text) parts.push({ top: box.top, x: box.x, text });
  }
  parts.sort((p, q) => (Math.abs(p.top - q.top) < 0.004 ? p.x - q.x : p.top - q.top));
  return parts.map((p) => p.text).join(' ').replace(/\s+/g, ' ').replace(/(\w)- (\w)/g, '$1$2')
    .replace(/^[^\p{L}\p{N}“"(]+/u, '') // no stray punctuation from the word before
    .trim();
}

/** Notes for every page with ink. `textOf` reads a page's text boxes (or null when unavailable). */
export async function collectNotes(
  ink: DocInk,
  textOf: ((page: number) => Promise<TextBox[]>) | null,
): Promise<PageNotes[]> {
  const pages = Object.keys(ink).map(Number).filter((p) => ink[p]?.length).sort((a, b) => a - b);
  const out: PageNotes[] = [];
  for (const page of pages) {
    const strokes = ink[page];
    const marks = strokes.filter((s) => s.tool === 'highlighter');
    const notes: PageNotes = { page, highlights: [], untextedHighlights: 0, pens: strokes.length - marks.length };
    if (marks.length) {
      const boxes = textOf ? await textOf(page).catch(() => []) : [];
      // Top to bottom, as the highlights appear on the page.
      const ordered = [...marks].sort((a, b) => a.points[0][1] - b.points[0][1] || a.points[0][0] - b.points[0][0]);
      for (const s of ordered) {
        const text = boxes.length ? textUnder(s, boxes) : '';
        if (text) notes.highlights.push({ text, color: s.color });
        else notes.untextedHighlights++;
      }
    }
    out.push(notes);
  }
  return out;
}
