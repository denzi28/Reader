// A small picture for a book on the shelf: its own cover, or one drawn from its title.

const W = 360;
const H = 480;

function toJpeg(canvas: HTMLCanvasElement) {
  return new Promise<Blob | undefined>((resolve) => canvas.toBlob((b) => resolve(b ?? undefined), 'image/jpeg', 0.84));
}

const PALETTES = [
  ['#9a5a38', '#5d2f1a'], ['#3d6b5c', '#1f3d34'], ['#5a5f8a', '#2c2f52'], ['#8a3f4a', '#4a1d26'],
  ['#7a6a3a', '#40351a'], ['#4a6f8a', '#233a4a'], ['#6b4a7a', '#37213f'],
];

function wrap(ctx: CanvasRenderingContext2D, text: string, width: number) {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > width && line) { lines.push(line); line = word; } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

export async function coverThumbnail(cover: Blob | undefined, title: string, author?: string): Promise<Blob | undefined> {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return undefined;
  if (cover) {
    try {
      const bmp = await createImageBitmap(cover);
      // Fit the whole picture on a plain ground, so odd shapes are not cut off.
      const scale = Math.min(W / bmp.width, H / bmp.height);
      const w = bmp.width * scale;
      const h = bmp.height * scale;
      ctx.fillStyle = '#efe6d2';
      ctx.fillRect(0, 0, W, H);
      ctx.drawImage(bmp, (W - w) / 2, (H - h) / 2, w, h);
      bmp.close();
      return await toJpeg(canvas);
    } catch { /* drawn below */ }
  }
  let hash = 0;
  for (const ch of title) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const [a, b] = PALETTES[hash % PALETTES.length];
  const grad = ctx.createLinearGradient(0, 0, W * 0.4, H);
  grad.addColorStop(0, a);
  grad.addColorStop(1, b);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(255,240,215,.35)';
  ctx.lineWidth = 2;
  ctx.strokeRect(18, 18, W - 36, H - 36);
  ctx.fillStyle = '#fbeed3';
  ctx.textAlign = 'center';
  ctx.font = '700 34px Georgia, "Iowan Old Style", serif';
  const lines = wrap(ctx, title, W - 90).slice(0, 5);
  const top = H * 0.4 - (lines.length * 42) / 2;
  lines.forEach((l, i) => ctx.fillText(l, W / 2, top + i * 42));
  if (author) {
    ctx.font = '400 17px system-ui, sans-serif';
    ctx.globalAlpha = 0.8;
    ctx.fillText(wrap(ctx, author, W - 90)[0], W / 2, H - 56);
  }
  return toJpeg(canvas);
}
