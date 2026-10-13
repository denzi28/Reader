// A book as the book reader sees it: chapters of paragraphs. An ePub gives this
// directly; a PDF is rebuilt into it from the words on its pages (see fromPdf.ts).

/** Formatting inside a paragraph: text runs, flagged italic (1) and/or bold (2). */
export type Run = [text: string, flags: number];

export interface TextBlock {
  t: 'p';
  /** The paragraph's plain text; marks point into it by character. */
  x: string;
  /** The same text cut into formatted runs (left out when it has no formatting). */
  r?: Run[];
  /** Set for a quotation. */
  q?: 1;
  /** Set for centred text. */
  c?: 1;
  /** A line that is part of a list or poem keeps its own line (no first-line indent). */
  n?: 1;
  /** PDF page (zero-based) the paragraph starts on. */
  pg?: number;
}

export interface HeadingBlock { t: 'h'; x: string; l: 1 | 2 | 3; pg?: number }
export interface ImageBlock { t: 'i'; src: string; alt?: string; pg?: number }
export interface BreakBlock { t: 'r'; pg?: number }
export type Block = TextBlock | HeadingBlock | ImageBlock | BreakBlock;

export interface Chapter {
  title: string;
  blocks: Block[];
}

/** An entry in the table of contents: a place in a chapter. */
export interface TocEntry {
  title: string;
  level: number;
  /** Chapter index and block index inside that chapter. */
  c: number;
  b: number;
}

export interface Book {
  /** Bump when the way a PDF is rebuilt changes, so saved copies are made again. */
  v: number;
  title: string;
  author?: string;
  lang?: string;
  chapters: Chapter[];
  toc: TocEntry[];
  /** Rebuilt from a PDF (so it can say so, and map places back to pages). */
  fromPdf?: boolean;
  /** PDF pages (zero-based) that had no text, read or not: pictures, blanks, or scans not yet read. */
  blank?: number[];
}

/** A place in the book: block number (counted over the whole book) and a character in it. */
export interface Pos { b: number; o: number }

/** What the reader needs to find its way about a book quickly. */
export interface BookIndex {
  blocks: Block[];
  /** Global block index → chapter index. */
  chapterOf: Uint32Array;
  /** Global index of each chapter's first block (plus one past the end). */
  first: Uint32Array;
  /** Words before each block (and the total at the end). */
  words: Float64Array;
  total: number;
  /**
   * What is kept for a place instead of the block number: for a PDF, the page the block starts
   * on and its number among that page's blocks, so a place (and a mark) stays put when pages
   * are added to the book later (scanned ones, read afterwards).
   */
  stable: Float64Array;
}

/** Stable places from a PDF are at least this; smaller numbers are plain block numbers. */
export const STABLE_BASE = 1_000_000;

export const blockText = (b: Block) => (b.t === 'p' || b.t === 'h' ? b.x : '');
export const countWords = (s: string) => (s.match(/\S+/g) ?? []).length;

export function indexBook(book: Book): BookIndex {
  const blocks: Block[] = [];
  const first = new Uint32Array(book.chapters.length + 1);
  book.chapters.forEach((ch, i) => {
    first[i] = blocks.length;
    for (const b of ch.blocks) blocks.push(b);
  });
  first[book.chapters.length] = blocks.length;
  const chapterOf = new Uint32Array(blocks.length);
  book.chapters.forEach((_, i) => chapterOf.fill(i, first[i], first[i + 1]));
  const stable = new Float64Array(blocks.length);
  let page = -1;
  let k = 0;
  blocks.forEach((b, i) => {
    if (!book.fromPdf) { stable[i] = i; return; }
    const pg = b.pg ?? 0;
    k = pg === page ? k + 1 : 0;
    page = pg;
    stable[i] = STABLE_BASE + pg * 4096 + Math.min(k, 4095);
  });
  const words = new Float64Array(blocks.length + 1);
  for (let i = 0; i < blocks.length; i++) {
    // A picture counts as a little reading, so a book of pictures still moves.
    words[i + 1] = words[i] + (blocks[i].t === 'i' ? 40 : countWords(blockText(blocks[i])));
  }
  return { blocks, chapterOf, first, words, total: words[blocks.length], stable };
}

/** How far through the book (0–1) a place is. */
export function fractionAt(ix: BookIndex, pos: Pos): number {
  if (!ix.total) return 0;
  const b = Math.min(Math.max(pos.b, 0), ix.blocks.length - 1);
  const block = ix.blocks[b];
  const len = block ? blockText(block).length : 0;
  const within = len ? Math.min(1, pos.o / len) : 0;
  const here = ix.words[b] + (ix.words[b + 1] - ix.words[b]) * within;
  return Math.min(1, here / ix.total);
}

/** The place a fraction of the way through the book (the start of the block it falls in). */
export function posAtFraction(ix: BookIndex, f: number): Pos {
  const target = Math.min(Math.max(f, 0), 1) * ix.total;
  let lo = 0;
  let hi = ix.blocks.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ix.words[mid] <= target) lo = mid; else hi = mid - 1;
  }
  return { b: Math.max(0, lo), o: 0 };
}

/** Minutes of reading left from a place, at an easy pace. */
export const WORDS_PER_MINUTE = 230;
export function minutesLeft(ix: BookIndex, pos: Pos) {
  return Math.max(0, ix.total * (1 - fractionAt(ix, pos))) / WORDS_PER_MINUTE;
}

export function formatLeft(minutes: number) {
  if (minutes < 1) return 'Less than a minute left';
  const m = Math.round(minutes);
  if (m < 60) return `${m} min left`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} h ${rest} min left` : `${h} h left`;
}

/** The text of a block from one character to another, for quotes and search. */
export function sliceText(ix: BookIndex, from: Pos, to: Pos, limit = 280): string {
  let out = '';
  for (let b = from.b; b <= to.b && b < ix.blocks.length; b++) {
    const t = blockText(ix.blocks[b]);
    if (!t) continue;
    const part = t.slice(b === from.b ? from.o : 0, b === to.b ? to.o : t.length);
    out += (out ? ' ' : '') + part;
    if (out.length > limit) return out.slice(0, limit).trimEnd() + '…';
  }
  return out;
}

/** The chapter title in force at a block. */
export function chapterTitle(book: Book, ix: BookIndex, b: number) {
  return book.chapters[ix.chapterOf[Math.min(b, ix.chapterOf.length - 1)] ?? 0]?.title ?? '';
}

/** The block number a kept place refers to now (or the next block, if that one is gone). */
export function fromStable(ix: BookIndex, id: number): number {
  const last = ix.blocks.length - 1;
  if (last < 0) return 0;
  if (id < STABLE_BASE) return Math.min(Math.max(0, id), last);
  let lo = 0;
  let hi = last;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ix.stable[mid] >= id) hi = mid; else lo = mid + 1;
  }
  return lo;
}

export const toStable = (ix: BookIndex, b: number) => ix.stable[Math.min(Math.max(0, b), ix.stable.length - 1)] ?? b;
