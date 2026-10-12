import { fileId } from './hash';
import { makeThumbnail, openPdf } from './pdf';
import { getMeta, patchMeta, putDocFile, putMeta, requestPersistence, saveDoc } from './storage';
import type { DocMeta } from './types';

export const UNSUPPORTED =
  'Only PDF files can be opened for now. Word, Excel and PowerPoint are on the way.';

function looksLikePdf(buf: ArrayBuffer) {
  const head = new TextDecoder('latin1').decode(buf.slice(0, 1024));
  return head.includes('%PDF-');
}

export async function importPdf(file: File): Promise<DocMeta> {
  const buf = await file.arrayBuffer();
  if (!looksLikePdf(buf)) throw new Error(UNSUPPORTED);

  const id = await fileId(buf);
  const existing = await getMeta(id);
  if (existing && !existing.deleted) {
    if (existing.cloudOnly) {
      // Already in Drive; this device now has the file too.
      await putDocFile(id, new Blob([buf], { type: 'application/pdf' }));
      await putMeta({ ...existing, cloudOnly: false });
    }
    await patchMeta(id, { openedAt: Date.now() });
    return existing;
  }

  let pdf;
  try {
    pdf = await openPdf(buf.slice(0));
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
