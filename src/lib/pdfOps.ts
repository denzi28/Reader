// PDF editing that runs entirely on the device (pdf-lib): merge, split, crop
// and page edits. Every function takes PDF bytes (or Blobs) and returns bytes.
import { degrees, PDFDocument } from 'pdf-lib';

export class PdfOpError extends Error {}

async function load(source: Blob | Uint8Array | ArrayBuffer, name = 'This PDF') {
  const bytes = source instanceof Blob ? new Uint8Array(await source.arrayBuffer()) : new Uint8Array(source);
  try {
    return await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (err) {
    const text = err instanceof Error ? `${err.name} ${err.message}` : '';
    if (/encrypt/i.test(text)) throw new PdfOpError(`${name} is password-protected. Remove the password first.`);
    throw new PdfOpError(`${name} could not be read. It may be damaged.`);
  }
}

const finish = (doc: PDFDocument) => doc.save({ useObjectStreams: true });

/** "1-3, 5, 8-" -> [[0,1,2],[4],[7..max-1]]; throws a readable error. */
export function parseRanges(text: string, pages: number): number[][] {
  const groups: number[][] = [];
  for (const raw of text.split(/[,;\n]+/)) {
    const part = raw.trim();
    if (!part) continue;
    const m = /^(\d*)\s*(?:[-–—]\s*(\d*))?$/.exec(part);
    if (!m || (m[1] === '' && m[2] === undefined) || (m[1] === '' && m[2] === '')) {
      throw new PdfOpError(`“${part}” is not a page or a range like 3-5.`);
    }
    const from = m[1] === '' ? 1 : Number(m[1]);
    const to = m[2] === undefined ? from : m[2] === '' ? pages : Number(m[2]);
    if (from < 1 || to < 1 || from > pages || to > pages) {
      throw new PdfOpError(`Page ${Math.max(from, to)} is outside this document (1–${pages}).`);
    }
    const list: number[] = [];
    if (from <= to) for (let p = from; p <= to; p++) list.push(p - 1);
    else for (let p = from; p >= to; p--) list.push(p - 1);
    groups.push(list);
  }
  if (!groups.length) throw new PdfOpError('Type the pages to use, like 1-3, 5, 8-10.');
  return groups;
}

/** Joins documents in the order given. */
export async function mergePdfs(
  sources: { blob: Blob; name: string }[],
  onProgress?: (done: number, total: number) => void,
): Promise<{ bytes: Uint8Array; counts: number[] }> {
  if (sources.length < 2) throw new PdfOpError('Choose at least two documents to merge.');
  const out = await PDFDocument.create();
  const counts: number[] = [];
  for (const [i, s] of sources.entries()) {
    const doc = await load(s.blob, `“${s.name}”`);
    const pages = await out.copyPages(doc, doc.getPageIndices());
    pages.forEach((p) => out.addPage(p));
    counts.push(pages.length);
    onProgress?.(i + 1, sources.length);
  }
  return { bytes: await finish(out), counts };
}

/** One new document per group of pages (each group is a list of page indexes). */
export async function splitPdf(
  blob: Blob,
  groups: number[][],
  onProgress?: (done: number, total: number) => void,
): Promise<Uint8Array[]> {
  const src = await load(blob);
  const results: Uint8Array[] = [];
  for (const [i, group] of groups.entries()) {
    const out = await PDFDocument.create();
    const pages = await out.copyPages(src, group);
    pages.forEach((p) => out.addPage(p));
    results.push(await finish(out));
    onProgress?.(i + 1, groups.length);
  }
  return results;
}

export interface Margins {
  /** Fractions (0–1) of the page as it is shown, cut from each side. */
  l: number;
  t: number;
  r: number;
  b: number;
}

/** Crops the chosen pages (all when `only` is empty), keeping the content in place. */
export async function cropPdf(blob: Blob, m: Margins, only?: Set<number>): Promise<Uint8Array> {
  const doc = await load(blob);
  doc.getPages().forEach((page, i) => {
    if (only && only.size && !only.has(i)) return;
    const box = page.getCropBox();
    const turn = ((page.getRotation().angle % 360) + 360) % 360;
    // Sizes as shown, then each shown edge mapped to the page's own edge.
    const shown = turn % 180 === 0 ? { w: box.width, h: box.height } : { w: box.height, h: box.width };
    const cut = { l: m.l * shown.w, r: m.r * shown.w, t: m.t * shown.h, b: m.b * shown.h };
    const own =
      turn === 0 ? { left: cut.l, right: cut.r, top: cut.t, bottom: cut.b }
      : turn === 90 ? { left: cut.t, right: cut.b, top: cut.r, bottom: cut.l }
      : turn === 180 ? { left: cut.r, right: cut.l, top: cut.b, bottom: cut.t }
      : { left: cut.b, right: cut.t, top: cut.l, bottom: cut.r };
    const w = box.width - own.left - own.right;
    const h = box.height - own.top - own.bottom;
    if (w < 20 || h < 20) throw new PdfOpError('That crop leaves almost nothing of the page.');
    page.setCropBox(box.x + own.left, box.y + own.bottom, w, h);
  });
  return finish(doc);
}

export interface PageStep {
  /** Page index in the source, or null for a blank page. */
  from: number | null;
  /** Extra turn in degrees (multiple of 90), added to the page's own. */
  turn: number;
}

/** Builds a document from the steps: reordered, rotated, repeated or blank pages. */
export async function arrangePdf(blob: Blob, steps: PageStep[]): Promise<Uint8Array> {
  if (!steps.length) throw new PdfOpError('A document needs at least one page.');
  const src = await load(blob);
  const out = await PDFDocument.create();
  const wanted = [...new Set(steps.flatMap((s) => (s.from === null ? [] : [s.from])))];
  const copied = new Map<number, Awaited<ReturnType<typeof out.copyPages>>[number][]>();
  for (const index of wanted) copied.set(index, []);
  // A page used twice has to be copied twice: a page can only sit in one place.
  const uses = new Map<number, number>();
  for (const s of steps) if (s.from !== null) uses.set(s.from, (uses.get(s.from) ?? 0) + 1);
  for (const [index, n] of uses) {
    const pages = await out.copyPages(src, Array(n).fill(index));
    copied.set(index, pages);
  }
  let last: { w: number; h: number } = { w: 595, h: 842 };
  for (const s of steps) {
    if (s.from === null) {
      const blank = out.addPage([last.w, last.h]);
      if (s.turn) blank.setRotation(degrees(((s.turn % 360) + 360) % 360));
      continue;
    }
    const page = copied.get(s.from)!.pop()!;
    out.addPage(page);
    const size = page.getSize();
    last = { w: size.width, h: size.height };
    if (s.turn) page.setRotation(degrees((((page.getRotation().angle + s.turn) % 360) + 360) % 360));
  }
  return finish(out);
}

/** Page count and first-page size of a PDF (cheap check before an operation). */
export async function pageCount(blob: Blob): Promise<number> {
  return (await load(blob)).getPageCount();
}
