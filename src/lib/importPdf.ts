import { fileId } from './hash';
import { assertRoom } from './plan';
import { makeThumbnail, openPdfFile } from './pdf';
import { getMeta, patchMeta, putDocFile, putMeta, requestPersistence, saveDoc } from './storage';
import type { DocMeta } from './types';

export const UNSUPPORTED = 'This kind of file cannot be added yet. PDFs, ePub books, Word, Excel, PowerPoint, OpenDocument, RTF, text, CSV and pictures work.';

function looksLikePdf(buf: ArrayBuffer) {
  const head = new TextDecoder('latin1').decode(buf.slice(0, 1024));
  return head.includes('%PDF-');
}

/** Adds a PDF (or a Word, Excel or PowerPoint file, made into one) to the library, filed in `folder` when one is given. */
export async function importPdf(original: File, folder?: string, options: { localOnly?: boolean; /** Not counted against the free plan (a note made for a page). */ unmetered?: boolean } = {}): Promise<DocMeta> {
  let file = original;
  let buf = await file.arrayBuffer();
  const { looksLikeEpub } = await import('./book/epub');
  const book = looksLikeEpub(new Uint8Array(buf, 0, Math.min(buf.byteLength, 200)));
  if (!book && !looksLikePdf(buf)) {
    const { officeKind, unsupportedReason, convertOffice } = await import('./office');
    if (!officeKind(file)) throw new Error(unsupportedReason(file) ?? UNSUPPORTED);
    file = await convertOffice(file);
    buf = await file.arrayBuffer();
  }

  const id = await fileId(buf);
  const existing = await getMeta(id);
  if (existing && !existing.deleted) {
    if (existing.cloudOnly) {
      // Already in Drive; this device now has the file too.
      await putDocFile(id, new Blob([buf], { type: book ? 'application/epub+zip' : 'application/pdf' }));
      await putMeta({ ...existing, cloudOnly: false });
    }
    // Adding it again from inside a folder files it there.
    await patchMeta(id, folder ? { openedAt: Date.now(), folder } : { openedAt: Date.now() });
    return existing;
  }

  if (!options.unmetered) await assertRoom(); // the free plan keeps a few documents

  if (book) return importEpub(id, original, buf, folder, options);

  let pdf;
  try {
    // Read from the file as needed rather than handing pdf.js another copy.
    pdf = await openPdfFile(file);
  } catch {
    throw new Error('This PDF could not be read. It may be damaged or password-protected.');
  }
  try {
    const now = Date.now();
    const meta: DocMeta = {
      id,
      name: file.name.replace(/\.pdf$/i, ''),
      size: file.size,
      pages: pdf.numPages,
      addedAt: now,
      openedAt: now,
      lastPage: 0,
      folder,
      localOnly: options.localOnly || undefined,
      thumb: await makeThumbnail(pdf).catch(() => undefined),
    };
    await saveDoc(meta, new Blob([buf], { type: 'application/pdf' }));
    requestPersistence();
    return meta;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'QuotaExceededError') {
      throw new Error('Your device is out of storage space for this file.');
    }
    throw err;
  } finally {
    void pdf.loadingTask.destroy();
  }
}

/** Adds an ePub book: its title, author and cover come from the file. */
async function importEpub(id: string, file: File, buf: ArrayBuffer, folder: string | undefined, options: { localOnly?: boolean }): Promise<DocMeta> {
  const { readEpub } = await import('./book/epub');
  const { coverThumbnail } = await import('./book/cover');
  const blob = new Blob([buf], { type: 'application/epub+zip' });
  const epub = await readEpub(blob);
  try {
    const now = Date.now();
    const title = epub.book.title === 'Untitled book' ? file.name.replace(/\.epub$/i, '') : epub.book.title;
    const meta: DocMeta = {
      id,
      name: title,
      author: epub.book.author,
      kind: 'epub',
      size: file.size,
      // Pages are an estimate (about 250 words each); the reader numbers its own.
      pages: Math.max(1, Math.round(epub.words / 250)),
      addedAt: now,
      openedAt: now,
      lastPage: 0,
      folder,
      localOnly: options.localOnly || undefined,
      thumb: await coverThumbnail(epub.cover, title, epub.book.author).catch(() => undefined),
    };
    await saveDoc(meta, blob);
    requestPersistence();
    return meta;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'QuotaExceededError') {
      throw new Error('Your device is out of storage space for this file.');
    }
    throw err;
  } finally {
    epub.dispose();
  }
}
