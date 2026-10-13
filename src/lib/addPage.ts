// Adds a blank page to the end of a notebook (a note made here), in place: it keeps
// its identity, notes and place on the shelf, and sync sends the longer file again.
import { refreshPdf } from './pdf';
import { getDocFile, getMeta, markPdfChanged, patchMeta, putDocFile } from './storage';

/** Returns the new number of pages. */
export async function addPage(id: string): Promise<number> {
  const [meta, file] = await Promise.all([getMeta(id), getDocFile(id)]);
  if (!meta || !file) throw new Error('This note is not on this device.');
  const { PDFDocument } = await import('pdf-lib');
  const doc = await PDFDocument.load(await file.arrayBuffer(), { updateMetadata: false });
  // The new page is a copy of the last: the same paper, and no notes (those live apart from the file).
  const [copy] = await doc.copyPages(doc, [doc.getPageCount() - 1]);
  doc.addPage(copy);
  const bytes = await doc.save({ useObjectStreams: true });
  const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
  await markPdfChanged(id); // before the change is announced, so sync sends the file with it
  await putDocFile(id, blob);
  refreshPdf(id, () => getDocFile(id));
  const pages = doc.getPageCount();
  await patchMeta(id, { pages, size: blob.size });
  return pages;
}
