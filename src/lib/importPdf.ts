import { fileId } from './hash';
import { makeThumbnail, openPdfFile } from './pdf';
import { getMeta, patchMeta, putDocFile, putMeta, requestPersistence, saveDoc } from './storage';
import type { DocMeta } from './types';

export const UNSUPPORTED = 'This kind of file cannot be added yet. PDFs, Word, Excel, PowerPoint, OpenDocument, RTF, text, CSV and pictures work.';

function looksLikePdf(buf: ArrayBuffer) {
  const head = new TextDecoder('latin1').decode(buf.slice(0, 1024));
  return head.includes('%PDF-');
}

/** Adds a PDF (or a Word, Excel or PowerPoint file, made into one) to the library, filed in `folder` when one is given. */
export async function importPdf(original: File, folder?: string, options: { localOnly?: boolean } = {}): Promise<DocMeta> {
  let file = original;
  let buf = await file.arrayBuffer();
  if (!looksLikePdf(buf)) {
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
      await putDocFile(id, new Blob([buf], { type: 'application/pdf' }));
      await putMeta({ ...existing, cloudOnly: false });
    }
    // Adding it again from inside a folder files it there.
    await patchMeta(id, folder ? { openedAt: Date.now(), folder } : { openedAt: Date.now() });
    return existing;
  }

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
