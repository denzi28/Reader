// A picture (photo, scan, screenshot) becomes a one-page PDF the size of the picture, so it can be
// written on like any page.
import type { Ctx } from './ctx';

const MAX_SIDE = 4000;

export async function imageToPdf(file: File, ctx: Ctx): Promise<void> {
  let bmp: ImageBitmap;
  try {
    // The browser turns the photo the right way up (from its camera orientation) as it reads it.
    bmp = await createImageBitmap(file);
  } catch {
    throw new Error('This picture could not be read. Some formats (like HEIC) cannot be opened by the browser; save it as a JPEG or PNG first.');
  }
  const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bmp.width * k));
  canvas.height = Math.max(1, Math.round(bmp.height * k));
  const g = canvas.getContext('2d')!;
  const jpeg = /jpe?g/i.test(file.type) || /\.jpe?g$/i.test(file.name);
  if (jpeg) { g.fillStyle = '#fff'; g.fillRect(0, 0, canvas.width, canvas.height); }
  g.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, jpeg ? 'image/jpeg' : 'image/png', 0.92));
  if (!blob) throw new Error('This picture could not be read.');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const image = jpeg ? await ctx.doc.embedJpg(bytes) : await ctx.doc.embedPng(bytes);
  // A4-wide (or A4-long, for wide pictures), in the picture's own proportions.
  const wide = image.width > image.height * 1.15;
  const w = wide ? 841.89 : 595.28;
  const h = w * (image.height / image.width);
  const page = ctx.doc.addPage([w, h]);
  page.drawImage(image, { x: 0, y: 0, width: w, height: h });
}
