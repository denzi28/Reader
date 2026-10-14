// Rebuilding a PDF as a book: the words on each page (or read from a scan) are
// put back into lines, then paragraphs, headings and chapters. It works well on
// text-heavy PDFs (novels, articles, notes); tables, formulas and figures stay
// in the original, which one tap brings back.
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { pageText } from '../ocr';
import { pageSize, type TextBox } from '../pdf';
import type { Block, Book, Chapter, TocEntry } from './model';
import { t } from '../i18n';

export const PDF_BOOK_VERSION = 9;

export class NoTextError extends Error {
  constructor() {
    super('This PDF has no text to read (it may be scanned).');
  }
}

interface Line {
  text: string;
  x: number;
  right: number;
  top: number;
  bottom: number;
  /** Letter height: about the font size. */
  h: number;
  pg: number;
  /** The edges of the column it sits in. */
  left?: number;
  edge?: number;
}

// ---- boxes → lines -----------------------------------------------------------
function median(xs: number[]) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}
const percentile = (xs: number[], p: number) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
};

function toLines(boxes: TextBox[], pg: number): Line[] {
  const sorted = boxes.filter((b) => b.str.trim()).sort((a, b) => a.bottom - b.bottom || a.x - b.x);
  const rows: TextBox[][] = [];
  for (const b of sorted) {
    const h = Math.max(b.bottom - b.top, 0.004);
    const row = rows.length ? rows[rows.length - 1] : null;
    const last = row?.[0];
    if (row && last && Math.abs(b.bottom - last.bottom) < 0.45 * Math.max(h, last.bottom - last.top)) row.push(b);
    else rows.push([b]);
  }
  const lines: Line[] = [];
  for (const wide of rows) {
    wide.sort((a, b) => a.x - b.x);
    // A wide gap inside a row is the space between columns (or a table's cells): they are separate lines.
    const parts: TextBox[][] = [];
    for (const b of wide) {
      const part = parts[parts.length - 1];
      const prev = part?.[part.length - 1];
      const fs = Math.max(b.bottom - b.top, prev ? prev.bottom - prev.top : 0, 0.004);
      if (part && prev && b.x - prev.right <= Math.max(2.2 * fs, 0.025)) part.push(b); else parts.push([b]);
    }
    for (const row of parts) {
      let text = '';
      let prev: TextBox | null = null;
      for (const b of row) {
        const fs = Math.max(b.bottom - b.top, 0.004);
        if (prev) {
          const gap = b.x - prev.right;
          if (gap > 0.14 * fs && !/\s$/.test(text) && !/^\s/.test(b.str)) text += ' ';
        }
        text += b.str;
        prev = b;
      }
      text = text.replace(/\s+/g, ' ').trim();
      if (!text) continue;
      lines.push({
        text,
        x: row[0].x,
        right: Math.max(...row.map((b) => b.right)),
        top: Math.min(...row.map((b) => b.top)),
        bottom: median(row.map((b) => b.bottom)),
        h: median(row.map((b) => b.bottom - b.top)),
        pg,
      });
    }
  }
  return lines;
}

/** Puts a page's lines in reading order: one column, or two side by side. */
function inReadingOrder(lines: Line[]): Line[] {
  const body = lines.filter((l) => l.text.length > 12);
  const narrow = body.filter((l) => l.right - l.x < 0.55);
  const L = narrow.filter((l) => (l.x + l.right) / 2 < 0.5);
  const R = narrow.filter((l) => (l.x + l.right) / 2 >= 0.5);
  const crossing = body.filter((l) => l.x < 0.46 && l.right > 0.54);
  if (L.length >= 6 && R.length >= 6 && crossing.length <= Math.max(2, body.length * 0.2)) {
    const colsTop = Math.min(...narrow.map((l) => l.top));
    const lefts = lines.filter((l) => (l.x + l.right) / 2 < 0.5 && l.right < 0.56 && l.top >= colsTop - 0.001);
    const rights = lines.filter((l) => (l.x + l.right) / 2 >= 0.5 && l.x > 0.44 && l.top >= colsTop - 0.001);
    const taken = new Set([...lefts, ...rights]);
    const above = lines.filter((l) => !taken.has(l) && l.top < colsTop);
    const rest = lines.filter((l) => !taken.has(l) && l.top >= colsTop);
    const byTop = (a: Line, b: Line) => a.bottom - b.bottom;
    return [...above.sort(byTop), ...lefts.sort(byTop), ...rights.sort(byTop), ...rest.sort(byTop)];
  }
  return [...lines].sort((a, b) => a.bottom - b.bottom);
}

const key = (t: string) => t.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
const PAGE_NUMBER = /^(page\s+)?[\divxlcdm]{1,7}([\s/]+(of\s+)?\d+)?$|^[-–—\s]*\d{1,5}[-–—\s]*$/i;
const TERMINAL = /[.!?…:;”"')\]»]$/;
const BULLET = /^([•·▪‣◦●○■□–—-]\s+|\(?\d{1,3}[.)]\s+|\(?[a-z][.)]\s+)/;

// ---- the whole document --------------------------------------------------------
export async function bookFromPdf(
  pdf: PDFDocumentProxy,
  id: string,
  name: string,
  progress: (done: number, total: number) => void,
  stop: () => boolean = () => false,
): Promise<Book> {
  const n = pdf.numPages;
  const pages: { lines: Line[]; height: number }[] = new Array(n);
  const blank: number[] = [];
  let done = 0;
  let next = 0;
  const worker = async () => {
    while (next < n) {
      if (stop()) return;
      const i = next++;
      const [t, size] = await Promise.all([pageText(pdf, id, i), pageSize(pdf, i).catch(() => ({ w: 1, h: 1.4 }))]);
      pages[i] = { lines: toLines(t.boxes, i), height: size.h / size.w };
      if (!t.boxes.length && !t.recognised) blank.push(i); // (a page read from its picture with nothing on it is not blank for this)
      progress(++done, n);
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, n) }, worker));
  if (stop()) throw new Error('stopped');

  // Letter size of the body text: the most common, counted by characters.
  const bins = new Map<number, number>();
  let chars = 0;
  for (const p of pages) for (const l of p.lines) {
    const bin = Math.round(l.h / 0.0008);
    bins.set(bin, (bins.get(bin) ?? 0) + l.text.length);
    chars += l.text.length;
  }
  if (chars < 120) throw new NoTextError();
  const body = [...bins.entries()].sort((a, b) => b[1] - a[1])[0][0] * 0.0008;

  // Running heads and page numbers: short lines at the top or bottom that come back page after page.
  const counts = new Map<string, number>();
  const edge = (l: Line, h: number) => l.bottom < 0.1 * h || l.top > 0.9 * h;
  for (const p of pages) {
    const seen = new Set<string>();
    for (const l of p.lines) if (edge(l, p.height) && l.text.length < 90) seen.add(key(l.text));
    seen.forEach((k) => counts.set(k, (counts.get(k) ?? 0) + 1));
  }
  const repeated = new Set([...counts.entries()].filter(([, c]) => c >= Math.max(3, n * 0.25)).map(([k]) => k));

  const ordered: Line[] = [];
  for (const p of pages) {
    const kept = p.lines.filter((l) => !(edge(l, p.height) && (repeated.has(key(l.text)) || PAGE_NUMBER.test(l.text))));
    const lines = inReadingOrder(kept);
    // The edges of each column, for telling an indented line from a flush one.
    const bodyLines = lines.filter((l) => l.text.length > 25);
    const spans = new Map<Line, { left: number; edge: number }>();
    const group = (set: Line[]) => {
      const left = percentile(set.map((l) => l.x), 0.15);
      const right = percentile(set.map((l) => l.right), 0.85);
      set.forEach((l) => spans.set(l, { left, edge: right }));
    };
    const twoCols = bodyLines.some((l) => l.right - l.x < 0.55) && bodyLines.filter((l) => l.right - l.x < 0.55).length > bodyLines.length * 0.6;
    if (twoCols) {
      group(lines.filter((l) => (l.x + l.right) / 2 < 0.5));
      group(lines.filter((l) => (l.x + l.right) / 2 >= 0.5));
    } else group(lines);
    for (const l of lines) { const s = spans.get(l); l.left = s?.left ?? l.x; l.edge = s?.edge ?? l.right; ordered.push(l); }
  }
  if (!ordered.length) throw new NoTextError();

  // Spacing between lines of body text, to tell a paragraph gap from a normal line break.
  const pitches: number[] = [];
  for (let i = 1; i < ordered.length; i++) {
    const a = ordered[i - 1];
    const b = ordered[i];
    if (a.pg === b.pg && b.bottom > a.bottom && b.bottom - a.bottom < body * 3.2 && b.x < a.right + 0.01) pitches.push(b.bottom - a.bottom);
  }
  const pitch = median(pitches) || body * 1.3;

  // Heading sizes, biggest first.
  const headSizes = [...new Set(ordered.filter((l) => l.h >= body * 1.2 && l.text.length < 140).map((l) => Math.round(l.h / 0.0015)))].sort((a, b) => b - a);
  const levelOf = (l: Line): 1 | 2 | 3 => {
    const r = headSizes.indexOf(Math.round(l.h / 0.0015));
    return (r < 0 ? 3 : r === 0 ? 1 : r === 1 ? 2 : 3) as 1 | 2 | 3;
  };

  const blocks: Block[] = [];
  let para: { text: string; pg: number; n: boolean } | null = null;
  let heading: { text: string; pg: number; h: number; level: 1 | 2 | 3; bottom: number } | null = null;
  const endPara = () => {
    if (para && para.text.trim()) blocks.push({ t: 'p', x: para.text.trim(), pg: para.pg, ...(para.n ? { n: 1 as const } : {}) });
    para = null;
  };
  const endHeading = () => {
    if (heading) blocks.push({ t: 'h', x: heading.text.trim(), l: heading.level, pg: heading.pg });
    heading = null;
  };
  let prev: Line | null = null;
  // A line a little bigger than the rest is a heading only when it stands apart (a read scan's lines vary in height).
  const apart = (i: number) => {
    const l = ordered[i];
    const a = ordered[i - 1];
    const z = ordered[i + 1];
    const above = !a || a.pg !== l.pg || l.bottom - a.bottom > pitch * 1.3;
    const below = !z || z.pg !== l.pg || z.bottom - l.bottom > pitch * 1.3;
    return above && below;
  };
  for (let i = 0; i < ordered.length; i++) {
    const l = ordered[i];
    const isHead = l.text.length < 140 && !/[,;]$/.test(l.text) && (l.h >= body * 1.35 || (l.h >= body * 1.12 && l.text.length < 90 && !/[.!?:]$/.test(l.text) && apart(i)) || (l.h >= body * 1.2 && (apart(i) || (heading !== null && l.bottom - heading.bottom < l.h * 2.2 && Math.abs(heading.h - l.h) < body * 0.12))));
    if (isHead) {
      endPara();
      if (heading && Math.abs(heading.h - l.h) < body * 0.12 && l.bottom - heading.bottom < l.h * 2.2 && heading.level === levelOf(l)) {
        heading.text += ' ' + l.text;
        heading.bottom = l.bottom;
      } else {
        endHeading();
        heading = { text: l.text, pg: l.pg, h: l.h, level: levelOf(l), bottom: l.bottom };
      }
      prev = l;
      continue;
    }
    endHeading();
    let fresh = !para;
    if (para && prev) {
      const sameColumn = prev.pg === l.pg && l.bottom > prev.bottom && l.x < prev.right + 0.02;
      const indent = l.x - (l.left ?? l.x) > body * 0.9;
      const prevEnds = TERMINAL.test(para.text);
      const prevShort = prev.right < (prev.edge ?? 1) - body * 3.5;
      if (BULLET.test(l.text) && (sameColumn || prevEnds)) fresh = true;
      else if (sameColumn) {
        if (l.bottom - prev.bottom > pitch * 1.38) fresh = true;
        else if (indent && (prevEnds || prevShort)) fresh = true;
        else if (prevShort && prevEnds) fresh = true;
      } else if (prevEnds && (indent || prevShort)) fresh = true;
    }
    if (fresh) {
      endPara();
      para = { text: l.text, pg: l.pg, n: BULLET.test(l.text) };
    } else if (para) {
      if (/[A-Za-zÀ-ÿ]-$/.test(para.text) && /^[a-zà-ÿ]/.test(l.text)) para.text = para.text.slice(0, -1) + l.text;
      else para.text += ' ' + l.text;
    }
    prev = l;
  }
  endPara();
  endHeading();
  if (!blocks.length) throw new NoTextError();

  const book = await assemble(pdf, name, blocks, n);
  book.blank = blank.sort((a, b) => a - b);
  return book;
}

// ---- chapters --------------------------------------------------------------------
interface OutlineNode { title: string; dest: unknown; items: OutlineNode[] }

async function pageOfDest(pdf: PDFDocumentProxy, dest: unknown): Promise<number | null> {
  try {
    const d = typeof dest === 'string' ? await pdf.getDestination(dest) : (dest as unknown[] | null);
    const ref = d?.[0];
    if (ref === undefined || ref === null) return null;
    if (typeof ref === 'number') return ref;
    return await pdf.getPageIndex(ref as Parameters<PDFDocumentProxy['getPageIndex']>[0]);
  } catch {
    return null;
  }
}

export async function flattenOutline(pdf: PDFDocumentProxy) {
  let outline: OutlineNode[] | null = null;
  try { outline = (await pdf.getOutline()) as OutlineNode[] | null; } catch { /* no outline */ }
  const out: { title: string; level: number; page: number }[] = [];
  const visit = async (nodes: OutlineNode[], level: number) => {
    for (const node of nodes) {
      const page = await pageOfDest(pdf, node.dest);
      const title = (node.title ?? '').replace(/\s+/g, ' ').trim();
      if (page !== null && title) out.push({ title, level, page });
      if (node.items?.length && level < 2) await visit(node.items, level + 1);
    }
  };
  if (outline?.length) await visit(outline, 0);
  return out;
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

async function assemble(pdf: PDFDocumentProxy, name: string, blocks: Block[], n: number): Promise<Book> {
  let title = name;
  try {
    const meta = await pdf.getMetadata();
    const t = (meta.info as { Title?: string } | undefined)?.Title?.trim();
    if (t && t.length > 2 && !/^(untitled|microsoft word)/i.test(t)) title = t;
  } catch { /* keep the file name */ }

  const outline = await flattenOutline(pdf);
  // Where a place in the PDF falls among the blocks: the heading that matches, else the page's first block.
  const blockFor = (page: number, label: string) => {
    const wanted = norm(label);
    let firstOnPage = -1;
    for (let i = 0; i < blocks.length; i++) {
      const pg = blocks[i].pg ?? 0;
      if (pg < page) continue;
      if (pg > page) { if (firstOnPage < 0) firstOnPage = i; break; }
      if (firstOnPage < 0) firstOnPage = i;
      const b = blocks[i];
      if (b.t === 'h' && wanted && (norm(b.x).includes(wanted) || wanted.includes(norm(b.x)))) return i;
    }
    return firstOnPage < 0 ? blocks.length - 1 : firstOnPage;
  };

  // Chapter starts: the top level of the outline, else the biggest headings, else every few pages.
  let starts: { title: string; at: number }[] = [];
  const top = outline.filter((o) => o.level === 0);
  const level = top.length >= 2 ? 0 : outline.some((o) => o.level === 1) && top.length === 1 ? 1 : -1;
  if (level >= 0) {
    starts = outline.filter((o) => o.level === level).map((o) => ({ title: o.title, at: blockFor(o.page, o.title) }));
  } else {
    const heads = blocks.map((b, i) => ({ b, i })).filter((x): x is { b: Block & { t: 'h' }; i: number } => x.b.t === 'h' && x.b.l === 1);
    if (heads.length >= 3 && heads.length <= n) starts = heads.map((h) => ({ title: h.b.x, at: h.i }));
  }
  starts = starts.filter((s, i) => i === 0 || s.at > starts[i - 1].at);
  if (!starts.length) {
    const step = Math.max(8, Math.ceil(n / 60));
    for (let p = 0; p < n; p += step) {
      const at = blockFor(p, '');
      if (!starts.length || at > starts[starts.length - 1].at) starts.push({ title: t('Pages {a}–{b}', { a: p + 1, b: Math.min(n, p + step) }), at });
    }
  }
  if (starts[0].at > 0) starts.unshift({ title: starts.length > 1 || level >= 0 ? t('Beginning') : title, at: 0 });

  const chapters: Chapter[] = starts.map((s, i) => ({ title: s.title, blocks: blocks.slice(s.at, i + 1 < starts.length ? starts[i + 1].at : blocks.length) }));
  const chapterOf = (blockIndex: number) => {
    let c = 0;
    while (c + 1 < starts.length && starts[c + 1].at <= blockIndex) c++;
    return c;
  };
  const toc: TocEntry[] = [];
  if (outline.length) {
    for (const o of outline) {
      const at = blockFor(o.page, o.title);
      const c = chapterOf(at);
      toc.push({ title: o.title, level: Math.max(0, o.level - (level > 0 ? level : 0)), c, b: at - starts[c].at });
    }
  } else starts.forEach((s, c) => toc.push({ title: s.title, level: 0, c, b: 0 }));
  toc.sort((a, b) => a.c - b.c || a.b - b.b);
  return { v: PDF_BOOK_VERSION, title, chapters, toc, fromPdf: true };
}
