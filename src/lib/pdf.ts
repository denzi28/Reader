// The legacy build bundles polyfills, so it runs on older phones and browsers too.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import type { PDFDocumentProxy } from 'pdfjs-dist';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const assets = `${import.meta.env.BASE_URL}pdfjs/`;

export async function openPdf(data: ArrayBuffer): Promise<PDFDocumentProxy> {
  return pdfjs.getDocument({
    data: new Uint8Array(data),
    cMapUrl: `${assets}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${assets}standard_fonts/`,
    wasmUrl: `${assets}wasm/`,
    iccUrl: `${assets}iccs/`,
  }).promise;
}

/** Page sizes in PDF points, fetched in chunks so huge files stay responsive. */
export async function readPageSizes(pdf: PDFDocumentProxy) {
  const sizes: { w: number; h: number }[] = [];
  const chunk = 40;
  for (let start = 1; start <= pdf.numPages; start += chunk) {
    const end = Math.min(pdf.numPages, start + chunk - 1);
    const pages = await Promise.all(
      Array.from({ length: end - start + 1 }, (_, i) => pdf.getPage(start + i)),
    );
    for (const page of pages) {
      const [x0, y0, x1, y1] = page.view;
      const rotated = page.rotate % 180 !== 0;
      const w = Math.abs(x1 - x0);
      const h = Math.abs(y1 - y0);
      sizes.push(rotated ? { w: h, h: w } : { w, h });
    }
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
