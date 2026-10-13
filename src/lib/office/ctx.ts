// What a conversion works with: the PDF being built, its fonts, and a way to bring pictures in.
import { PDFDocument, type PDFImage } from 'pdf-lib';
import { FontBook } from './fonts';

export interface Embedded {
  image: PDFImage;
  /** Size in points at the picture's own pixel size (72 dpi), for when nothing else says. */
  w: number;
  h: number;
}

export interface Crop {
  l: number;
  t: number;
  r: number;
  b: number;
}

export interface Ctx {
  doc: PDFDocument;
  fonts: FontBook;
  image(bytes: Uint8Array, crop?: Crop): Promise<Embedded | null>;
}

const isPng = (b: Uint8Array) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
const isJpg = (b: Uint8Array) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

/** Draws any picture the browser can read onto a canvas and keeps it as PNG (cropped if asked). */
async function viaCanvas(bytes: Uint8Array, crop?: Crop): Promise<Uint8Array | null> {
  try {
    const bmp = await createImageBitmap(new Blob([bytes as BlobPart]));
    const c = crop ?? { l: 0, t: 0, r: 0, b: 0 };
    const sx = Math.round(bmp.width * c.l);
    const sy = Math.round(bmp.height * c.t);
    const sw = Math.max(1, Math.round(bmp.width * (1 - c.l - c.r)));
    const sh = Math.max(1, Math.round(bmp.height * (1 - c.t - c.b)));
    const k = Math.min(1, 3000 / Math.max(sw, sh));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(sw * k));
    canvas.height = Math.max(1, Math.round(sh * k));
    canvas.getContext('2d')!.drawImage(bmp, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    bmp.close();
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

export async function makeCtx(title: string): Promise<Ctx> {
  const doc = await PDFDocument.create();
  // Fixed details, so converting the same file twice gives the very same PDF.
  const epoch = new Date(0);
  doc.setTitle(title);
  doc.setProducer('The Reader');
  doc.setCreator('The Reader');
  doc.setCreationDate(epoch);
  doc.setModificationDate(epoch);
  const fonts = new FontBook(doc);
  const cache = new Map<string, Embedded | null>();
  const seen = new WeakMap<Uint8Array, number>();
  let next = 1;
  return {
    doc,
    fonts,
    async image(bytes, crop) {
      if (!seen.has(bytes)) seen.set(bytes, next++);
      const key = `${seen.get(bytes)}:${crop ? `${crop.l},${crop.t},${crop.r},${crop.b}` : ''}`;
      if (cache.has(key)) return cache.get(key)!;
      let img: PDFImage | null = null;
      if (!crop) {
        try {
          if (isPng(bytes)) img = await doc.embedPng(bytes);
          else if (isJpg(bytes)) img = await doc.embedJpg(bytes);
        } catch { img = null; }
      }
      if (!img) {
        const png = await viaCanvas(bytes, crop);
        if (png) {
          try { img = await doc.embedPng(png); } catch { img = null; }
        }
      }
      const out = img ? { image: img, w: img.width * 0.75, h: img.height * 0.75 } : null;
      cache.set(key, out);
      return out;
    },
  };
}
