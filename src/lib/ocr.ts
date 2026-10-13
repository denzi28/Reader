// Reading scanned pages. A page that is only a picture has no text to search or to
// pick up with a highlighter; this looks at the picture and writes the words down
// (on the device, nothing is sent anywhere), and keeps them with the document.
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { getOcrPages, putOcrPage, type OcrPages } from './storage';
import { pageTextBoxes, type TextBox } from './pdf';

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

/** About this wide, in pixels, is sharp enough for print without being slow. */
const TARGET_WIDTH = 1700;
const MAX_HEIGHT = 3200;

async function pictureOf(pdf: PDFDocumentProxy, index: number): Promise<{ blob: Blob; width: number }> {
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
  canvas.width = canvas.height = 0;
  return { blob, width };
}

interface Word { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }
interface Result { data: { blocks?: { paragraphs: { lines: { words: Word[] }[] }[] }[] | null } }

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

/**
 * Reads these pages one after another. `progress` is told how many are done;
 * `stop` is asked between pages. What was read is kept as it goes, so stopping
 * (or closing the app) loses nothing.
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
  const worker = await createWorker('eng+tur', 1, {
    workerPath: '/ocr/worker.min.js',
    corePath: '/ocr/core',
    langPath: '/ocr/lang',
    workerBlobURL: false,
    gzip: true,
  });
  try {
    for (let n = 0; n < pages.length; n++) {
      if (stop()) return;
      const i = pages[n];
      const { blob, width } = await pictureOf(pdf, i);
      const result = (await worker.recognize(blob, {}, { blocks: true })) as unknown as Result;
      const boxes = boxesFrom(result, width);
      await putOcrPage(id, i, boxes);
      (await savedFor(id))[i] = boxes;
      progress(n + 1, pages.length);
    }
  } finally {
    await worker.terminate();
  }
}
