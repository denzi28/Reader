// Turns paragraphs, pictures and tables into placed lines on PDF pages.
// Everything is first measured into "atoms" (a line, a picture) that know their height and
// how to draw themselves; a Pager then fills pages with them, starting a new page when needed.
import { type PDFImage, type PDFPage, rgb } from 'pdf-lib';
import { BLACK, type RGB } from './color';
import type { Face, Family, FontBook } from './fonts';

export interface Run {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  color?: RGB;
  size?: number;
  family?: Family;
  script?: 'sup' | 'sub';
  bg?: RGB;
}

export interface Para {
  kind: 'p';
  runs: Run[];
  size: number;
  family: Family;
  color: RGB;
  align: 'l' | 'c' | 'r' | 'j';
  before: number;
  after: number;
  /** Indent of the text from the left edge, and extra indent (or hang, if negative) of the first line. */
  left: number;
  first: number;
  right: number;
  lineMult: number;
  bullet?: string;
  keepNext?: boolean;
  pageBreakBefore?: boolean;
  /** A page break right after this paragraph. */
  breakAfter?: boolean;
  /** Style name and "no space between paragraphs of the same style": for the builder only. */
  styleKey?: string;
  contextual?: boolean;
}

export interface Pic {
  kind: 'img';
  image: PDFImage;
  w: number;
  h: number;
  align: 'l' | 'c' | 'r';
  before: number;
  after: number;
}

export interface TCell {
  blocks: Block[];
  span: number;
  bg?: RGB;
  /** Which sides carry a rule (when the cell says so itself), with their colour and thickness. */
  edges?: { t: boolean; r: boolean; b: boolean; l: boolean; color: RGB; w: number };
  vAlign?: 't' | 'c' | 'b';
}
export interface TRow {
  cells: TCell[];
  header?: boolean;
  minH?: number;
}
export interface Table {
  kind: 'table';
  cols: number[];
  rows: TRow[];
  border: boolean;
  padX: number;
  padY: number;
  before: number;
  after: number;
}
export interface Break {
  kind: 'break';
}
export type Block = Para | Pic | Table | Break;

export interface DrawCtx {
  page: PDFPage;
  pageH: number;
}

export interface Atom {
  pre: number;
  h: number;
  post: number;
  keepNext?: boolean;
  draw: (ctx: DrawCtx, x: number, top: number) => void;
}

const NATURAL = 1.22; // line height of the fonts used, in font sizes

interface Item {
  text: string;
  face: Face;
  size: number;
  color: RGB;
  underline?: boolean;
  strike?: boolean;
  bg?: RGB;
  rise: number;
  x: number;
  w: number;
  space: boolean;
}

interface Piece {
  kind: 'word' | 'space' | 'tab' | 'nl';
  text: string;
  face: Face;
  run: Run;
  size: number;
  w: number;
  rise: number;
}

function pieces(p: Para, fonts: FontBook): Piece[] {
  const out: Piece[] = [];
  for (const run of p.runs) {
    const base = run.size ?? p.size;
    const size = run.script ? base * 0.65 : base;
    const rise = run.script === 'sup' ? base * 0.35 : run.script === 'sub' ? -base * 0.12 : 0;
    const face = fonts.get(run.family ?? p.family, run.bold, run.italic);
    const text = fonts.clean(run.text, face);
    for (const m of text.matchAll(/\n|\t| +|[^ \t\n]+/g)) {
      const t = m[0];
      const kind = t === '\n' ? 'nl' : t === '\t' ? 'tab' : t[0] === ' ' ? 'space' : 'word';
      out.push({ kind, text: t, face, run, size, rise, w: kind === 'word' || kind === 'space' ? face.font.widthOfTextAtSize(t, size) : 0 });
    }
  }
  return out;
}


/** A paragraph measured for a box `width` wide. */
export function paraAtoms(p: Para, width: number, fonts: FontBook): Atom[] {
  const all = pieces(p, fonts);
  const limit = Math.max(width - p.right, 20);
  const start0 = p.left + p.first;
  const start1 = p.left;
  interface Ln { items: Item[]; start: number; x: number; forced: boolean; maxSize: number }
  const lines: Ln[] = [];
  const open = (start: number): Ln => {
    const l: Ln = { items: [], start, x: start, forced: false, maxSize: 0 };
    lines.push(l);
    return l;
  };
  let line = open(start0);
  // The bullet itself (the first item of a bulleted paragraph) is not text on the line.
  const hasInk = (items: Item[]) => items.some((i, k) => !i.space && !(p.bullet && lines.length === 1 && k === 0));
  const plainFace = fonts.get(p.family, false, false);

  if (p.bullet) {
    const text = fonts.clean(p.bullet, plainFace);
    const w = plainFace.font.widthOfTextAtSize(text, p.size);
    line.items.push({ text, face: plainFace, size: p.size, color: p.color, rise: 0, x: line.x, w, space: false });
    line.x = Math.max(start1, line.x + w + 4);
    line.maxSize = p.size;
    line.items.push({ text: '', face: plainFace, size: p.size, color: p.color, rise: 0, x: 0, w: 0, space: true }); // marks where text starts
  }

  const push = (pc: Piece, x: number, w: number, text = pc.text) => {
    line.items.push({
      text, face: pc.face, size: pc.size, color: pc.run.color ?? p.color, underline: pc.run.underline, strike: pc.run.strike,
      bg: pc.run.bg, rise: pc.rise, x, w, space: pc.kind !== 'word',
    });
    line.x = x + w;
    line.maxSize = Math.max(line.maxSize, pc.size);
  };
  const trim = () => {
    while (line.items.length && line.items[line.items.length - 1].space && line.items[line.items.length - 1].text.trim() === line.items[line.items.length - 1].text && line.items[line.items.length - 1].w > 0) {
      const last = line.items.pop()!;
      line.x -= last.w;
    }
  };

  for (const pc of all) {
    if (pc.kind === 'nl') {
      line.forced = true;
      line = open(start1);
      continue;
    }
    if (pc.kind === 'tab') {
      const rel = line.x;
      const next = (Math.floor(rel / 36) + 1) * 36;
      if (next > limit) { trim(); line = open(start1); continue; }
      push(pc, line.x, next - line.x);
      continue;
    }
    if (pc.kind === 'space') {
      if (!hasInk(line.items) && line.start === start1 && lines.length > 1) continue; // wrapped: no space at the start
      push(pc, line.x, pc.w);
      continue;
    }
    if (line.x + pc.w > limit + 0.01 && hasInk(line.items)) {
      trim();
      line = open(start1);
    }
    if (pc.w > limit - line.x) {
      // A word wider than the line: broken where it has to be.
      let chunk = '';
      for (const ch of pc.text) {
        const w = pc.face.font.widthOfTextAtSize(chunk + ch, pc.size);
        if (chunk && line.x + w > limit) {
          push(pc, line.x, pc.face.font.widthOfTextAtSize(chunk, pc.size), chunk);
          line = open(start1);
          chunk = ch;
        } else chunk += ch;
      }
      if (chunk) push(pc, line.x, pc.face.font.widthOfTextAtSize(chunk, pc.size), chunk);
      continue;
    }
    push(pc, line.x, pc.w);
  }
  trim();

  const atoms: Atom[] = [];
  lines.forEach((ln, idx) => {
    const size = ln.maxSize || p.size;
    const lineH = size * NATURAL * p.lineMult;
    const baseline = size * 0.95 + (p.lineMult - 1) * size * NATURAL * 0.5;
    const last = idx === lines.length - 1;
    const textStart = p.bullet && idx === 0 ? Math.max(ln.items.length > 1 ? ln.items[0].x + ln.items[0].w + 4 : 0, start1) : ln.start;
    const body = p.bullet && idx === 0 ? ln.items.slice(2) : ln.items;
    const contentEnd = body.length ? body[body.length - 1].x + body[body.length - 1].w : textStart;
    const from = body.length ? body[0].x : textStart;
    const used = contentEnd - from;
    const avail = limit - (p.bullet && idx === 0 ? textStart : ln.start);
    let shift = 0;
    let extra = 0;
    const justify = p.align === 'j' && !ln.forced && !last;
    if (p.align === 'c') shift = (avail - used) / 2;
    else if (p.align === 'r') shift = avail - used;
    else if (justify) {
      const gaps = body.filter((i) => i.space && i.text.startsWith(' ')).length;
      if (gaps) extra = (avail - used) / gaps;
    }
    // Final positions.
    let x = (p.bullet && idx === 0 ? textStart : ln.start) + shift;
    const placed: Item[] = [];
    if (p.bullet && idx === 0 && ln.items.length) placed.push({ ...ln.items[0], x: ln.items[0].x });
    for (const it of body) {
      const w = it.w + (extra && it.space && it.text.startsWith(' ') ? extra : 0);
      placed.push({ ...it, x, w });
      x += w;
    }
    // Neighbours in one style are drawn as one piece of text.
    const runs: Item[] = [];
    for (const it of placed) {
      const prev = runs[runs.length - 1];
      const same = prev && !justify && prev.face === it.face && prev.size === it.size && prev.color === it.color
        && prev.underline === it.underline && prev.strike === it.strike && prev.bg === it.bg && prev.rise === it.rise
        && !prev.text.includes('\t') && Math.abs(prev.x + prev.w - it.x) < 0.01 && it.text !== '' && prev.text !== '';
      if (same) { prev.text += it.text; prev.w += it.w; prev.space = prev.space && it.space; } else runs.push({ ...it });
    }
    atoms.push({
      pre: idx === 0 ? p.before : 0,
      h: lineH,
      post: last ? p.after : 0,
      keepNext: idx === lines.length - 1 && p.keepNext,
      draw: ({ page, pageH }, ox, top) => {
        const y = pageH - top - baseline;
        for (const it of runs) {
          const px = ox + it.x;
          if (it.bg && it.w > 0) page.drawRectangle({ x: px, y: y - it.size * 0.22, width: it.w, height: it.size * 1.15, color: rgb(...it.bg) });
          const text = it.text.replace(/\t/g, '');
          if (text.trim() && !(it.space && !it.text.trim())) {
            page.drawText(text, { x: px, y: y + it.rise, size: it.size, font: it.face.font, color: rgb(...it.color) });
          }
          if (it.underline && it.w > 0) page.drawLine({ start: { x: px, y: y + it.rise - it.size * 0.12 }, end: { x: px + it.w, y: y + it.rise - it.size * 0.12 }, thickness: Math.max(0.4, it.size / 18), color: rgb(...it.color) });
          if (it.strike && it.w > 0) page.drawLine({ start: { x: px, y: y + it.rise + it.size * 0.28 }, end: { x: px + it.w, y: y + it.rise + it.size * 0.28 }, thickness: Math.max(0.4, it.size / 18), color: rgb(...it.color) });
        }
      },
    });
  });
  return atoms;
}

export function picAtom(pic: Pic, width: number): Atom {
  const k = Math.min(1, width / pic.w);
  const w = pic.w * k;
  const h = pic.h * k;
  const dx = pic.align === 'c' ? (width - w) / 2 : pic.align === 'r' ? width - w : 0;
  return {
    pre: pic.before,
    h,
    post: pic.after,
    draw: ({ page, pageH }, x, top) => page.drawImage(pic.image, { x: x + dx, y: pageH - top - h, width: w, height: h }),
  };
}

/** Paragraphs and pictures stacked into a column of atoms (tables inside are flattened to their text). */
export function blockAtoms(blocks: Block[], width: number, fonts: FontBook): Atom[] {
  const out: Atom[] = [];
  for (const b of blocks) {
    if (b.kind === 'p') out.push(...paraAtoms(b, width, fonts));
    else if (b.kind === 'img') out.push(picAtom(b, width));
    else if (b.kind === 'table') for (const r of b.rows) for (const c of r.cells) out.push(...blockAtoms(c.blocks, width, fonts));
  }
  return out;
}

/** Fills pages one after another. */
export class Pager {
  page!: PDFPage;
  y = 0;
  private fresh = true;
  readonly left: number;
  readonly width: number;
  readonly bottom: number;
  readonly top: number;

  constructor(
    private newPdfPage: () => PDFPage,
    readonly pageW: number,
    readonly pageH: number,
    margins: { top: number; right: number; bottom: number; left: number },
    private fonts: FontBook,
  ) {
    this.left = margins.left;
    this.width = pageW - margins.left - margins.right;
    this.top = margins.top;
    this.bottom = pageH - margins.bottom;
    this.y = this.top;
  }

  start() {
    this.page = this.newPdfPage();
    this.y = this.top;
    this.fresh = true;
  }

  newPage() {
    this.start();
  }

  get atTop() {
    return this.fresh;
  }

  private ctx(): DrawCtx {
    return { page: this.page, pageH: this.pageH };
  }

  place(atoms: Atom[], x = this.left) {
    for (let i = 0; i < atoms.length; i++) {
      const a = atoms[i];
      const pre = this.fresh ? 0 : a.pre;
      let need = pre + a.h;
      // A heading stays with what follows it.
      if (a.keepNext && atoms[i + 1]) need += atoms[i + 1].pre + atoms[i + 1].h;
      if (!this.fresh && this.y + need > this.bottom) {
        this.newPage();
        a.draw(this.ctx(), x, this.y);
        this.y += a.h + a.post;
      } else {
        a.draw(this.ctx(), x, this.y + pre);
        this.y += pre + a.h + a.post;
      }
      this.fresh = false;
    }
  }

  placeBlocks(blocks: Block[]) {
    for (let bi = 0; bi < blocks.length; bi++) {
      const b = blocks[bi];
      if (b.kind === 'break') this.newPage();
      else if (b.kind === 'table') this.placeTable(b);
      else {
        if (b.kind === 'p' && b.pageBreakBefore && !this.fresh) this.newPage();
        const atoms = b.kind === 'p' ? paraAtoms(b, this.width, this.fonts) : [picAtom(b, this.width)];
        // A heading right above a table or picture brings some room along with it.
        const next = blocks[bi + 1];
        if (b.kind === 'p' && b.keepNext && next && next.kind !== 'p' && !this.fresh) {
          const own = atoms.reduce((s, a) => s + a.pre + a.h + a.post, 0);
          if (this.y + own + 60 > this.bottom) this.newPage();
        }
        // A picture taller than a page is shrunk to fit.
        if (b.kind === 'img') {
          const room = this.bottom - this.top;
          if (atoms[0].h > room) {
            const k = room / atoms[0].h;
            atoms.splice(0, 1, picAtom({ ...b, w: b.w * k, h: b.h * k }, this.width));
          }
        }
        this.place(atoms);
        if (b.kind === 'p' && b.breakAfter) this.newPage();
      }
    }
  }

  placeTable(t: Table) {
    const total = t.cols.reduce((a, b) => a + b, 0) || 1;
    const k = total > this.width ? this.width / total : 1;
    const cols = t.cols.map((c) => c * k);
    const xs: number[] = [];
    cols.reduce((acc, c) => { xs.push(acc); return acc + c; }, 0);
    const bodyH = this.bottom - this.top;
    if (!this.fresh) this.y += t.before;
    const headers = t.rows.filter((r, i) => r.header && t.rows.slice(0, i).every((q) => q.header));

    const placeRow = (row: TRow, repeating = false) => {
      let col = 0;
      const cells = row.cells.map((c) => {
        const span = Math.max(1, c.span);
        const w = cols.slice(col, col + span).reduce((a, b) => a + b, 0);
        const x = xs[col] ?? 0;
        col += span;
        return { c, x, w, atoms: blockAtoms(c.blocks, Math.max(w - 2 * t.padX, 10), this.fonts), i: 0 };
      });
      const rest = (cell: (typeof cells)[number]) => cell.atoms.slice(cell.i).reduce((s, a, n) => s + (n ? a.pre : 0) + a.h + (n < cell.atoms.length - cell.i - 1 ? a.post : 0), 0);
      for (let guard = 0; guard < 400; guard++) {
        const avail = this.bottom - this.y;
        const need = Math.max(row.minH ?? 0, ...cells.map(rest)) + 2 * t.padY;
        if (guard === 0 && !this.fresh && need > avail && need <= bodyH) {
          this.newPage();
          if (!repeating) headers.forEach((h) => { if (h !== row) placeRow(h, true); });
          continue;
        }
        const take = cells.map((cell) => {
          let used = 0;
          let n = 0;
          for (let j = cell.i; j < cell.atoms.length; j++) {
            const a = cell.atoms[j];
            const h = (n ? a.pre : 0) + a.h;
            if (used + h > avail - 2 * t.padY) break;
            used += h + (j < cell.atoms.length - 1 ? a.post : 0);
            n++;
          }
          return { n, used };
        });
        const pending = cells.some((cell) => cell.i < cell.atoms.length);
        if (pending && take.every((q) => q.n === 0)) {
          if (!this.fresh) { this.newPage(); if (!repeating) headers.forEach((h) => { if (h !== row) placeRow(h, true); }); continue; }
          // Taller than a page: one piece is put down anyway.
          cells.forEach((cell, ci) => { if (cell.i < cell.atoms.length) take[ci] = { n: 1, used: cell.atoms[cell.i].h }; });
        }
        const rowH = Math.max(row.minH ?? 0, ...take.map((q) => q.used)) + 2 * t.padY;
        cells.forEach((cell, ci) => {
          const x = this.left + cell.x;
          if (cell.c.bg) this.page.drawRectangle({ x, y: this.pageH - this.y - rowH, width: cell.w, height: rowH, color: rgb(...cell.c.bg) });
          const e = cell.c.edges;
          if (e) {
            const top = this.pageH - this.y;
            const rule = (x1: number, y1: number, x2: number, y2: number) => this.page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: e.w, color: rgb(...e.color) });
            if (e.t) rule(x, top, x + cell.w, top);
            if (e.b) rule(x, top - rowH, x + cell.w, top - rowH);
            if (e.l) rule(x, top, x, top - rowH);
            if (e.r) rule(x + cell.w, top, x + cell.w, top - rowH);
          } else if (t.border) this.page.drawRectangle({ x, y: this.pageH - this.y - rowH, width: cell.w, height: rowH, borderColor: rgb(0.55, 0.55, 0.55), borderWidth: 0.5 });
          let yy = this.y + t.padY;
          if (cell.c.vAlign === 'c') yy += (rowH - 2 * t.padY - take[ci].used) / 2;
          else if (cell.c.vAlign === 'b') yy += rowH - 2 * t.padY - take[ci].used;
          for (let n = 0; n < take[ci].n; n++) {
            const a = cell.atoms[cell.i + n];
            if (n) yy += a.pre;
            a.draw(this.ctx(), x + t.padX, yy);
            yy += a.h + a.post;
          }
          cell.i += take[ci].n;
        });
        this.y += rowH;
        this.fresh = false;
        if (cells.every((cell) => cell.i >= cell.atoms.length)) return;
        this.newPage();
        if (!repeating) headers.forEach((h) => { if (h !== row) placeRow(h, true); });
      }
    };
    t.rows.forEach((r) => placeRow(r));
    this.y += t.after;
  }
}

export const defaultPara = (over: Partial<Para> = {}): Para => ({
  kind: 'p', runs: [], size: 11, family: 'sans', color: BLACK, align: 'l', before: 0, after: 0, left: 0, first: 0, right: 0, lineMult: 1, ...over,
});
