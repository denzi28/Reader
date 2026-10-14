// Getting a book ready to read: an ePub is opened, a PDF is rebuilt (once; the result is kept).
import { acquirePdf, releasePdf } from '../pdf';
import { recognisedPages } from '../ocr';
import { t } from '../i18n';
import { getBookCache, getDocFile, getMeta, putBookCache } from '../storage';
import { downloadPdf } from '../sync/engine';
import type { DocMeta } from '../types';
import { readEpub } from './epub';
import { bookFromPdf, NoTextError, PDF_BOOK_VERSION } from './fromPdf';
import { indexBook, type Book, type BookIndex } from './model';

export interface Loaded {
  meta: DocMeta;
  book: Book;
  ix: BookIndex;
  /** The address to show a picture from (ePub books). */
  image: (src: string) => string | undefined;
  dispose: () => void;
}

export { NoTextError };

/**
 * Gets a book ready. `partial` makes it from whatever pages have been read so far
 * (while a scan is still being read): nothing is kept, and it is made fresh.
 */
export async function loadBook(
  id: string,
  progress: (done: number, total: number) => void,
  stop: () => boolean,
  options: { partial?: boolean } = {},
): Promise<Loaded> {
  const meta = await getMeta(id);
  let file = await getDocFile(id);
  if (!file && meta?.cloudOnly) {
    await downloadPdf(id);
    file = await getDocFile(id);
  }
  if (!meta || !file || meta.deleted) throw new Error(t('This document is no longer on this device.'));

  if (meta.kind === 'epub') {
    const epub = await readEpub(file);
    const book = { ...epub.book, title: meta.name || epub.book.title };
    return { meta, book, ix: indexBook(book), image: epub.image, dispose: epub.dispose };
  }

  const read = (await recognisedPages(id)).size;
  const cached = options.partial ? undefined : await getBookCache(id);
  if (cached && cached.book.v === PDF_BOOK_VERSION && cached.ocr === read) {
    return { meta, book: cached.book, ix: indexBook(cached.book), image: () => undefined, dispose: () => undefined };
  }
  const stored = file;
  const pdf = await acquirePdf(id, async () => stored);
  if (!pdf) throw new Error(t('This PDF could not be opened.'));
  try {
    const book = await bookFromPdf(pdf, id, meta.name, progress, stop);
    if (!options.partial) await putBookCache(id, { book, ocr: read }).catch(() => undefined);
    return { meta, book, ix: indexBook(book), image: () => undefined, dispose: () => undefined };
  } finally {
    releasePdf(id);
  }
}
