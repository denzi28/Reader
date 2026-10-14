/**
 * Pictures put into a typed note are made smaller first and kept inside the note itself (as a data address),
 * so the note stays one file that syncs and exports like any other.
 */
const MAX_SIDE = 1600;
const MAX_KEEP_AS_IS = 400_000; // small gifs and drawings are kept exactly as they are

const read = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

export const isPicture = (f: File) => /^image\/(png|jpe?g|gif|webp|avif|bmp|heic|heif)$/i.test(f.type);

/** A picture ready to put in a note: at most 1600 px on its longest side, as a JPEG (or PNG when it has see-through parts). */
export async function pictureForNote(file: File): Promise<{ src: string; width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    if (file.type === 'image/gif' && file.size <= MAX_KEEP_AS_IS) return { src: await read(file), width: bitmap.width, height: bitmap.height };
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const c = canvas.getContext('2d')!;
    const keepAlpha = file.type === 'image/png' || file.type === 'image/webp';
    if (!keepAlpha) { c.fillStyle = '#fff'; c.fillRect(0, 0, width, height); }
    c.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, keepAlpha ? 'image/png' : 'image/jpeg', 0.82));
    if (!blob) throw new Error('no picture');
    // A PNG that came out larger than a JPEG would be is sent as a JPEG instead.
    if (keepAlpha && blob.size > 600_000) {
      const flat = document.createElement('canvas');
      flat.width = width;
      flat.height = height;
      const f = flat.getContext('2d')!;
      f.fillStyle = '#fff';
      f.fillRect(0, 0, width, height);
      f.drawImage(canvas, 0, 0);
      const jpeg = await new Promise<Blob | null>((res) => flat.toBlob(res, 'image/jpeg', 0.82));
      if (jpeg) return { src: await read(jpeg), width, height };
    }
    return { src: await read(blob), width, height };
  } finally {
    bitmap.close();
  }
}
