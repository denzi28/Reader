// Finding words inside a document: its text read page by page (once), matched
// without regard to capitals or accents ("ceviri" finds "Çeviri").
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { pageText, recognisePages } from './ocr';
import type { TextBox } from './pdf';

export interface FindRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FindMatch {
  page: number;
  rects: FindRect[];
  /** A little of the text around it, with the match in the middle. */
  before: string;
  hit: string;
  after: string;
}

/** Lower case, accents off, Turkish dotted and dotless i the same: how words are compared. */
export const fold = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/ı/g, 'i');

interface PageText {
  /** Read from a picture of the page rather than taken from the file. */
  recognised: boolean;
  text: string;
  folded: string;
  /** Where each run of text starts in `text`. */
  parts: { start: number; end: number; box: TextBox }[];
}

/** The page's runs of text as one string, with spaces where there are gaps. */
function assemble(boxes: TextBox[], recognised: boolean): PageText {
  let text = '';
  const parts: PageText['parts'] = [];
  boxes.forEach((box, i) => {
    if (i > 0) {
      const prev = boxes[i - 1];
      const height = Math.max(box.bottom - box.top, 0.001);
      const sameLine = Math.abs(box.bottom - prev.bottom) < height * 0.5;
      const joined = sameLine && box.x - prev.right < height * 0.12 && box.x - prev.right > -height;
      if (!joined) text += ' ';
    }
    parts.push({ start: text.length, end: text.length + box.str.length, box });
    text += box.str;
  });
  return { recognised, text, folded: fold(text), parts };
}

const caches = new Map<string, Map<number, PageText>>();

/** Reads a document's text, a page at a time, and finds words in it. */
export class Finder {
  private pages: Map<number, PageText>;

  constructor(private pdf: PDFDocumentProxy, private id: string) {
    // The same document's text is kept, so searching again (or in another visit) is instant.
    const key = `${id}:${pdf.numPages}`;
    this.pages = caches.get(key) ?? new Map();
    caches.set(key, this.pages);
    if (caches.size > 4) caches.delete(caches.keys().next().value!);
  }

  get pageCount() {
    return this.pdf.numPages;
  }

  /** Pages known (so far) to have no text at all: a scan, or empty paper. */
  emptyPages() {
    return [...this.pages.entries()].filter(([, p]) => !p.text.trim() && !p.recognised).map(([i]) => i).sort((a, b) => a - b);
  }

  /** Some pages have just been read from their pictures: look at them again. */
  forget(pages: number[]) {
    pages.forEach((i) => this.pages.delete(i));
  }

  /** Reads these pages from their pictures, so they can be searched too. */
  async recognise(pages: number[], progress: (done: number, total: number) => void, stop: () => boolean) {
    try {
      await recognisePages(this.pdf, this.id, pages, progress, stop);
    } finally {
      this.forget(pages);
    }
  }

  private async page(i: number): Promise<PageText> {
    let p = this.pages.get(i);
    if (!p) {
      const t = await pageText(this.pdf, this.id, i);
      p = assemble(t.boxes, t.recognised);
      this.pages.set(i, p);
    }
    return p;
  }

  /**
   * Looks through the pages (from `from` round to the start), reporting matches as
   * they are found. Stops when `stop()` says so.
   */
  async search(
    query: string,
    from: number,
    report: (matches: FindMatch[], done: number) => void,
    stop: () => boolean,
  ): Promise<void> {
    const q = fold(query.trim());
    const found: FindMatch[] = [];
    if (!q) return report(found, this.pdf.numPages);
    for (let n = 0; n < this.pdf.numPages; n++) {
      if (stop()) return;
      const i = (from + n) % this.pdf.numPages;
      const page = await this.page(i);
      let at = page.folded.indexOf(q);
      let changed = false;
      while (at >= 0 && found.length < 5000) {
        found.push(this.match(page, i, at, at + q.length));
        changed = true;
        at = page.folded.indexOf(q, at + q.length);
      }
      // Reports at once for a hit, and now and then while only reading.
      if (changed || n % 10 === 9 || n === this.pdf.numPages - 1) {
        report([...found].sort((a, b) => a.page - b.page || a.rects[0].y - b.rects[0].y || a.rects[0].x - b.rects[0].x), n + 1);
        await new Promise((r) => setTimeout(r, 0)); // lets the screen breathe
      }
    }
  }

  private match(page: PageText, index: number, a: number, b: number): FindMatch {
    const rects: FindRect[] = [];
    for (const part of page.parts) {
      if (part.end <= a || part.start >= b) continue;
      const len = part.end - part.start || 1;
      const x0 = part.box.x + ((Math.max(a, part.start) - part.start) / len) * (part.box.right - part.box.x);
      const x1 = part.box.x + ((Math.min(b, part.end) - part.start) / len) * (part.box.right - part.box.x);
      rects.push({ x: x0, y: part.box.top, w: Math.max(x1 - x0, 0.004), h: part.box.bottom - part.box.top });
    }
    const clean = (s: string) => s.replace(/\s+/g, ' ');
    return {
      page: index,
      rects: rects.length ? rects : [{ x: 0, y: 0, w: 0.01, h: 0.01 }],
      before: clean(page.text.slice(Math.max(0, a - 22), a)).trimStart(),
      hit: clean(page.text.slice(a, b)),
      after: clean(page.text.slice(b, b + 46)).trimEnd(),
    };
  }
}
