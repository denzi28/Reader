// Reading scanned pages. A page that is only a picture has no text to search or to
// pick up with a highlighter; this looks at the picture and writes the words down
// (on the device, nothing is sent anywhere), and keeps them with the document.
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { getOcrPages, putOcrPage, type OcrPages } from './storage';
import { pageTextBoxes, type TextBox } from './pdf';
import { t } from './i18n';

const saved = new Map<string, Promise<OcrPages>>();
const savedFor = (id: string) => {
  let p = saved.get(id);
  if (!p) {
    p = getOcrPages(id).then((r) => r ?? {}).catch(() => ({}));
    saved.set(id, p);
  }
  return p;
};

export interface PageText {
  boxes: TextBox[];
  /** The words were read from a picture of the page, not taken from the file. */
  recognised: boolean;
}

/** A page's text: what the file holds, or else what was read from its picture. */
export async function pageText(pdf: PDFDocumentProxy, id: string, index: number): Promise<PageText> {
  const boxes = await pageTextBoxes(pdf, index).catch(() => [] as TextBox[]);
  if (boxes.length) return { boxes, recognised: false };
  const read = (await savedFor(id))[index];
  return { boxes: read ?? [], recognised: Boolean(read) };
}

/** Pages whose picture has been read (even if nothing was on them). */
export async function recognisedPages(id: string) {
  return new Set(Object.keys(await savedFor(id)).map(Number));
}

/** About this wide, in pixels, is sharp enough to read without being slow. */
const TARGET_WIDTH = (() => {
  try { return Number(localStorage.getItem('reader.ocrwidth')) || 1500; } catch { return 1500; }
})();
const MAX_HEIGHT = 2800;

async function pictureOf(pdf: PDFDocumentProxy, index: number): Promise<{ blob: Blob; width: number; inked: boolean }> {
  const page = await pdf.getPage(index + 1);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(TARGET_WIDTH / base.width, MAX_HEIGHT / base.height, 4);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  await page.render({ canvas, viewport }).promise;
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('no picture'))), 'image/png'),
  );
  const width = canvas.width;
  // Is there anything on it at all? (A blank sheet may be left empty; a page with marks should give words.)
  let inked = true;
  try {
    const small = document.createElement('canvas');
    small.width = 120;
    small.height = Math.max(1, Math.round(120 * (canvas.height / canvas.width)));
    const ctx = small.getContext('2d', { willReadFrequently: true });
    if (ctx) {
      ctx.drawImage(canvas, 0, 0, small.width, small.height);
      const px = ctx.getImageData(0, 0, small.width, small.height).data;
      let dark = 0;
      for (let i = 0; i < px.length; i += 4) if (px[i] + px[i + 1] + px[i + 2] < 540) dark++;
      inked = dark / (px.length / 4) > 0.004;
    }
  } catch { /* assume it has marks */ }
  canvas.width = canvas.height = 0;
  return { blob, width, inked };
}

interface Word { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }
interface Result { data: { text?: string; blocks?: { paragraphs: { lines: { words: Word[] }[] }[] }[] | null } }

/** The words found on a picture, boxed in the same units as ink (fractions of page width). */
function boxesFrom(result: Result, width: number): TextBox[] {
  const out: TextBox[] = [];
  for (const block of result.data.blocks ?? [])
    for (const para of block.paragraphs)
      for (const line of para.lines)
        for (const w of line.words) {
          const str = w.text.trim();
          if (!str || w.confidence < 25) continue; // specks and smudges
          out.push({ str, x: w.bbox.x0 / width, right: w.bbox.x1 / width, top: w.bbox.y0 / width, bottom: w.bbox.y1 / width });
        }
  return out;
}

export type OcrLanguages = 'eng' | 'tur' | 'eng+tur';

/** Which of the two languages a sample of text is in (or both, when it cannot tell). */
export function guessLanguages(sample: string): OcrLanguages {
  const words = sample.toLowerCase().match(/\p{L}+/gu) ?? [];
  if (words.length < 25) return 'eng+tur';
  const tr = new Set(['ve', 'bir', 'bu', 'için', 'ile', 'da', 'de', 'olarak', 'çok', 'daha', 'gibi', 'kadar', 'ama', 'her', 'olan', 'ne', 'ki', 'mi']);
  const en = new Set(['the', 'and', 'of', 'to', 'in', 'is', 'that', 'for', 'with', 'as', 'was', 'it', 'on', 'are', 'he', 'she', 'his', 'her']);
  let a = 0;
  let b = 0;
  for (const w of words) { if (tr.has(w)) a++; if (en.has(w)) b++; }
  const accents = (sample.match(/[çğışöüÇĞİŞÖÜ]/g) ?? []).length / Math.max(1, sample.length);
  if (a > b * 2 + 2 || (accents > 0.02 && a >= b)) return 'tur';
  if (b > a * 2 + 2 && accents < 0.005) return 'eng';
  return 'eng+tur';
}

/** How many pages to read at once: more is faster, but each reader holds a language model in memory. */
function readers(): number {
  const cores = navigator.hardwareConcurrency || 2;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  let n = Math.min(4, Math.max(1, cores - 1));
  if (memory !== undefined && memory <= 2) n = 1;
  else if (memory !== undefined && memory <= 4) n = Math.min(n, 2);
  return n;
}

// ---- how long it takes -----------------------------------------------------------
const PACE_KEY = 'reader.ocrpace';

/** Seconds per page for the whole team of readers: what the last run measured, else a guess from the device. */
export function ocrPace(): number {
  try {
    const kept = Number(localStorage.getItem(PACE_KEY));
    if (kept > 0.2 && kept < 120) return kept;
  } catch { /* storage unavailable */ }
  return 5.2 / Math.max(1, readers() * 0.8);
}

function keepPace(seconds: number) {
  try {
    const old = Number(localStorage.getItem(PACE_KEY));
    localStorage.setItem(PACE_KEY, String(old > 0 ? old * 0.5 + seconds * 0.5 : seconds));
  } catch { /* ignore */ }
}

/** About how long reading this many pages takes, in seconds (the readers take a few seconds to start). */
export const ocrSeconds = (pages: number) => (pages > 0 ? 6 + pages * ocrPace() : 0);

/** "about 3 min", for showing before anything is started. */
export function ocrEstimate(pages: number): string {
  const s = ocrSeconds(pages);
  if (s < 45) return t('under a minute');
  if (s < 95) return t('about a minute');
  const m = Math.round(s / 60);
  if (m < 10) return t('about {m} min', { m });
  if (m < 60) return t('about {m} min', { m: Math.round(m / 5) * 5 });
  const h = Math.floor(m / 60);
  const rest = Math.round((m % 60) / 5) * 5;
  return rest ? t('about {h} h {m} min', { h, m: rest }) : t('about {h} h', { h });
}

/**
 * Reads these pages, several at a time. `progress` is told how many are done;
 * `stop` is asked between pages. What was read is kept as it goes, so stopping
 * (or closing the app) loses nothing. The language is worked out from the first
 * pages (reading in one language is faster than in two).
 */
export async function recognisePages(
  pdf: PDFDocumentProxy,
  id: string,
  pages: number[],
  progress: (done: number, total: number) => void,
  stop: () => boolean,
): Promise<void> {
  if (!pages.length) return;
  progress(0, pages.length);
  const { createWorker } = await import('tesseract.js');
  const make = (langs: OcrLanguages) => createWorker(langs, 1, {
    workerPath: '/ocr/worker.min.js',
    corePath: '/ocr/core',
    langPath: '/ocr/lang',
    workerBlobURL: false,
    gzip: true,
  });
  type Reader = Awaited<ReturnType<typeof make>> & { langs?: OcrLanguages };
  // Every reader starts at once (in both languages); the first pages say which language the book is in.
  const count = Math.min(readers(), pages.length);
  const team: Reader[] = await Promise.all(Array.from({ length: count }, () => make('eng+tur')));
  let langs: OcrLanguages = 'eng+tur';
  let decided = false;
  let done = 0;
  let next = 0;
  const sample: string[] = [];
  let firstAt = 0;

  /** One page, on its own: a page that cannot be read is left alone (it stays "not read") rather than ending the whole run. */
  const readPage = async (worker: Reader, page: number): Promise<TextBox[] | null> => {
    const { blob, width, inked } = await pictureOf(pdf, page);
    let boxes = boxesFrom((await worker.recognize(blob, {}, { blocks: true })) as unknown as Result, width);
    if (!boxes.length && inked) {
      // Marks but no words: look again, treating the page as scattered text rather than a column.
      await worker.setParameters({ tessedit_pageseg_mode: '11' as never });
      try { boxes = boxesFrom((await worker.recognize(blob, {}, { blocks: true })) as unknown as Result, width); }
      finally { await worker.setParameters({ tessedit_pageseg_mode: '3' as never }); }
    }
    return boxes;
  };

  const lane = async (start: Reader) => {
    let worker = start;
    worker.langs = 'eng+tur';
    while (!stop()) {
      const k = next++;
      if (k >= pages.length) return;
      if (worker.langs !== langs) { await worker.reinitialize(langs); worker.langs = langs; }
      let boxes: TextBox[] | null = null;
      for (let attempt = 0; attempt < 2 && boxes === null && !stop(); attempt++) {
        try { boxes = await readPage(worker, pages[k]); } catch (err) {
          console.warn('Could not read page', pages[k] + 1, err);
          // The reader itself may have given up (a phone short of memory): start a fresh one.
          try { await worker.terminate(); } catch { /* already gone */ }
          try { worker = await make(langs); worker.langs = langs; team.push(worker); } catch { return; }
        }
      }
      if (boxes === null) { progress(++done, pages.length); continue; }
      await putOcrPage(id, pages[k], boxes);
      (await savedFor(id))[pages[k]] = boxes;
      if (!decided) {
        sample.push(boxes.map((b) => b.str).join(' '));
        if (sample.join(' ').length > 600 || done + 1 >= 3) { langs = guessLanguages(sample.join(' ')); decided = true; }
      }
      if (!firstAt) firstAt = performance.now();
      progress(++done, pages.length);
    }
  };

  try {
    await Promise.all(team.map(lane));
    // What this run measured (not counting the start-up), for the next estimate.
    if (done >= 6 && firstAt) keepPace((performance.now() - firstAt) / 1000 / (done - 1));
  } finally {
    await Promise.all(team.map((w) => w.terminate().catch(() => undefined)));
  }
}
