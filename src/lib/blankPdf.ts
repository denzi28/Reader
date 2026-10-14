// A new, empty notebook: a PDF of blank, lined, squared or dotted pages to write on.
// It is an ordinary PDF, so everything else (ink, typed notes, sync) works on it as it is.
import { MAX_NOTEBOOK_PAGES, type NotebookSpec } from './notebookSpec';
const A4 = [595.28, 841.89] as const;

/** Builds the notebook as a PDF file. Each one is unique, so two blank notebooks are never mistaken for one. */
export async function makeNotebook(spec: NotebookSpec): Promise<File> {
  // pdf-lib is a big download; it is only fetched when a notebook is really made.
  const { PDFDocument, rgb } = await import('pdf-lib');
  const [w, h] = spec.landscape ? [A4[1], A4[0]] : A4;
  const pages = Math.max(1, Math.min(MAX_NOTEBOOK_PAGES, Math.round(spec.pages)));
  const doc = await PDFDocument.create();
  doc.setTitle(spec.name);
  doc.setProducer('Leafpage');
  doc.setSubject(`note-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
  doc.setCreationDate(new Date());
  const rule = rgb(0.72, 0.78, 0.88);
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([w, h]);
    if (spec.paper === 'lined') {
      for (let y = h - 96; y > 44; y -= 28) {
        page.drawLine({ start: { x: 0, y }, end: { x: w, y }, thickness: 0.6, color: rule });
      }
      page.drawLine({ start: { x: 72, y: 0 }, end: { x: 72, y: h }, thickness: 0.7, color: rgb(0.9, 0.58, 0.58) });
    } else if (spec.paper === 'grid') {
      const step = 20;
      for (let x = step; x < w; x += step) page.drawLine({ start: { x, y: 0 }, end: { x, y: h }, thickness: 0.45, color: rule });
      for (let y = step; y < h; y += step) page.drawLine({ start: { x: 0, y }, end: { x: w, y }, thickness: 0.45, color: rule });
    } else if (spec.paper === 'dotted') {
      const step = 20;
      for (let x = step; x < w - step / 2; x += step) {
        for (let y = step; y < h - step / 2; y += step) page.drawCircle({ x, y, size: 0.9, color: rgb(0.55, 0.6, 0.7) });
      }
    }
  }
  const bytes = await doc.save({ useObjectStreams: true });
  return new File([bytes as BlobPart], `${spec.name.trim() || 'Untitled note'}.pdf`, { type: 'application/pdf' });
}
