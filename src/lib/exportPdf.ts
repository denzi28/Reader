// Draws a document's notes onto its pages and returns the PDF, so it can be saved
// to the device with everything written on it. Runs on the device (pdf-lib).
import { drawStroke, strokeOutline, textRect } from './ink';
import type { DocInk, Stroke } from './types';

const hex = (c: string): [number, number, number] => {
  const m = /^#?([0-9a-f]{6})$/i.exec(c);
  const n = m ? parseInt(m[1], 16) : 0;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

/** A typed note as a picture (so any alphabet comes out right). */
async function noteImage(s: Stroke, width: number): Promise<{ bytes: Uint8Array; w: number; h: number } | null> {
  const rect = textRect(s);
  const px = 3; // pixels per point
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(rect.w * width * px));
  canvas.height = Math.max(1, Math.ceil(rect.h * width * px));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  drawStroke(ctx, { ...s, points: [[0, 0, 0.5]] }, width * px, false);
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
  if (!blob) return null;
  return { bytes: new Uint8Array(await blob.arrayBuffer()), w: rect.w * width, h: rect.h * width };
}

/** The PDF with every stroke and typed note drawn onto its page. */
export async function pdfWithNotes(file: Blob, ink: DocInk): Promise<Uint8Array> {
  const { PDFDocument, rgb, degrees } = await import('pdf-lib');
  const doc = await PDFDocument.load(await file.arrayBuffer(), { updateMetadata: false });
  const pages = doc.getPages();
  for (const [key, strokes] of Object.entries(ink)) {
    const page = pages[Number(key)];
    if (!page || !strokes.length) continue;
    const rot = ((page.getRotation().angle % 360) + 360) % 360;
    const crop = page.getCropBox();
    const width = rot % 180 ? crop.height : crop.width; // the page as shown: the unit notes are measured in
    // From a point of the page as shown (u across, v down, in points) to the page's own coordinates.
    const place = (u: number, v: number): [number, number] => {
      if (rot === 90) return [crop.x + v, crop.y + u];
      if (rot === 180) return [crop.x + crop.width - u, crop.y + v];
      if (rot === 270) return [crop.x + crop.width - v, crop.y + crop.height - u];
      return [crop.x + u, crop.y + crop.height - v];
    };
    for (const s of strokes) {
      if (s.tool === 'text') {
        const img = await noteImage(s, width).catch(() => null);
        if (!img) continue;
        const rect = textRect(s);
        const [x, y] = place(rect.x * width, (rect.y + rect.h) * width); // its bottom left corner
        page.drawImage(await doc.embedPng(img.bytes), { x, y, width: img.w, height: img.h, rotate: degrees(rot) });
        continue;
      }
      const outline = strokeOutline(s, width);
      if (outline.length < 3) continue;
      const pts = outline.map(([u, v]) => place(u, v));
      // Smooth through the middles of the outline's edges, as on screen. SVG y points down: the page's y is negated.
      const at = (p: [number, number]) => `${p[0].toFixed(2)} ${(-p[1]).toFixed(2)}`;
      const mid = (a: [number, number], b: [number, number]): [number, number] => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const n = pts.length;
      let d = `M ${at(mid(pts[n - 1], pts[0]))}`;
      for (let i = 0; i < n; i++) d += ` Q ${at(pts[i])} ${at(mid(pts[i], pts[(i + 1) % n]))}`;
      const [r, g, b] = hex(s.color);
      page.drawSvgPath(`${d} Z`, { x: 0, y: 0, color: rgb(r, g, b), opacity: s.tool === 'highlighter' ? 0.38 : 1, borderWidth: 0 });
    }
  }
  return doc.save({ useObjectStreams: true });
}
