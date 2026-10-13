// The legacy build bundles polyfills, so it runs on older phones and browsers too.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import type { PDFDocumentProxy } from 'pdfjs-dist';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const assets = `${import.meta.env.BASE_URL}pdfjs/`;

// One worker for the whole visit: starting one means loading and compiling
// 1.3 MB of script, which used to happen on every document opened.
let worker: pdfjs.PDFWorker | null = null;
function sharedWorker() {
  worker ??= new pdfjs.PDFWorker();
  return worker;
}

/** Starts the PDF engine ahead of time, so the first document opens sooner. */
export function warmUp() {
  sharedWorker();
}

const common = () => ({
  cMapUrl: `${assets}cmaps/`,
  cMapPacked: true,
  standardFontDataUrl: `${assets}standard_fonts/`,
  wasmUrl: `${assets}wasm/`,
  iccUrl: `${assets}iccs/`,
  worker: sharedWorker(),
});

const CHUNK = 256 * 1024;

/** Hands pdf.js the parts of a stored file it asks for, as it asks. */
class BlobRange extends pdfjs.PDFDataRangeTransport {
  constructor(private blob: Blob, head: Uint8Array) {
    super(blob.size, head);
  }
  requestDataRange(begin: number, end: number) {
    void this.blob.slice(begin, end).arrayBuffer().then(
      (buf) => this.onDataRange(begin, new Uint8Array(buf)),
      () => this.abort(),
    );
  }
}

/**
 * Opens a stored PDF without reading all of it first: pdf.js fetches only the
 * pieces it needs, so a 50 MB book shows its first page as quickly as a small
 * one, and never sits in memory twice.
 */
export async function openPdfFile(file: Blob): Promise<PDFDocumentProxy> {
  const head = new Uint8Array(await file.slice(0, Math.min(file.size, CHUNK)).arrayBuffer());
  return pdfjs.getDocument({
    range: new BlobRange(file, head),
    rangeChunkSize: CHUNK,
    disableAutoFetch: true,
    disableStream: true,
    ...common(),
  }).promise;
}

export type PageSize = { w: number; h: number };

/** One page's size in PDF points, turned the way it is shown. */
export async function pageSize(pdf: PDFDocumentProxy, index: number): Promise<PageSize> {
  const page = await pdf.getPage(index + 1);
  const [x0, y0, x1, y1] = page.view;
  const w = Math.abs(x1 - x0);
  const h = Math.abs(y1 - y0);
  return page.rotate % 180 !== 0 ? { w: h, h: w } : { w, h };
}

/** Every page's size, fetched in chunks so huge files stay responsive. */
export async function readPageSizes(pdf: PDFDocumentProxy) {
  const sizes: PageSize[] = [];
  const chunk = 40;
  for (let start = 0; start < pdf.numPages; start += chunk) {
    const end = Math.min(pdf.numPages, start + chunk);
    sizes.push(...(await Promise.all(
      Array.from({ length: end - start }, (_, i) => pageSize(pdf, start + i)),
    )));
  }
  return sizes;
}

export async function makeThumbnail(pdf: PDFDocumentProxy, width = 360) {
  const page = await pdf.getPage(1);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: width / base.width });
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  await page.render({ canvas, viewport }).promise;
  return new Promise<Blob | undefined>((resolve) =>
    canvas.toBlob((b) => resolve(b ?? undefined), 'image/jpeg', 0.82),
  );
}

/** A run of text and its box, in the same units as ink (fractions of page width). */
export interface TextBox {
  str: string;
  x: number;
  right: number;
  top: number;
  bottom: number;
}

/** Where each run of text sits on a page, for finding what a highlight covers. */
export async function pageTextBoxes(pdf: PDFDocumentProxy, index: number): Promise<TextBox[]> {
  const page = await pdf.getPage(index + 1);
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const w = viewport.width;
  const boxes: TextBox[] = [];
  for (const item of content.items) {
    if (!('str' in item) || !item.str.trim()) continue;
    const [a, b, c, d, e, f] = pdfjs.Util.transform(viewport.transform, item.transform) as number[];
    if (Math.abs(b) > 0.01 || Math.abs(c) > 0.01) continue; // turned text: leave it out
    const height = Math.hypot(c, d) || item.height;
    const width = item.width * (a >= 0 ? 1 : -1) * viewport.scale;
    boxes.push({ str: item.str, x: e / w, right: (e + width) / w, top: (f - height) / w, bottom: f / w });
  }
  return boxes;
}

/** A small picture of a page, `width` pixels wide. */
export async function renderPagePreview(pdf: PDFDocumentProxy, index: number, canvas: HTMLCanvasElement, width: number) {
  const page = await pdf.getPage(index + 1);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: width / base.width });
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  await page.render({ canvas, viewport }).promise;
}

// ---- documents shared between views ---------------------------------------
// The reader and the notes page open the same stored documents. Sharing them
// means a page already read for one (a note's page, say) is ready in the other,
// and going back and forth to a document doesn't read it again. A couple of
// documents nobody is using are kept for a minute, then closed.
interface Held {
  pdf: Promise<PDFDocumentProxy | null>;
  users: number;
  idleSince: number;
}
const held = new Map<string, Held>();
const KEEP_IDLE = 2;
const IDLE_MS = 60_000;

function trim() {
  const idle = [...held.entries()].filter(([, h]) => h.users === 0).sort((a, b) => a[1].idleSince - b[1].idleSince);
  const now = Date.now();
  idle.forEach(([id, h], i) => {
    if (i < idle.length - KEEP_IDLE || now - h.idleSince >= IDLE_MS) {
      held.delete(id);
      void h.pdf.then((d) => d?.loadingTask.destroy());
    }
  });
}

/** Opens (or reuses) the stored document `id`; give it back with `releasePdf`. */
export function acquirePdf(id: string, file: () => Promise<Blob | undefined>): Promise<PDFDocumentProxy | null> {
  let h = held.get(id);
  if (!h) {
    const pdf = file().then((f) => (f ? openPdfFile(f) : null)).catch(() => null);
    h = { pdf, users: 0, idleSince: 0 };
    held.set(id, h);
    void pdf.then((d) => { if (!d && held.get(id) === h) held.delete(id); });
  }
  h.users++;
  return h.pdf;
}

export function releasePdf(id: string) {
  const h = held.get(id);
  if (!h) return;
  h.users = Math.max(0, h.users - 1);
  if (h.users === 0) {
    h.idleSince = Date.now();
    trim();
    setTimeout(trim, IDLE_MS + 100);
  }
}
