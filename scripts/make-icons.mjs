// Draws the app icons (PNG) from public/icons/*.svg with a headless Chromium.
// Needs `playwright-core` and a Chromium: node scripts/make-icons.mjs [path-to-chromium]
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
const browser = await chromium.launch({ executablePath: process.argv[2], args: ['--no-sandbox'] });
const page = await browser.newPage();
const jobs = [
  ['icon.svg', 'icon-192.png', 192],
  ['icon.svg', 'icon-512.png', 512],
  ['icon-maskable.svg', 'icon-maskable-512.png', 512],
  ['icon-maskable.svg', 'apple-touch-icon.png', 180],
  ['icon.svg', 'favicon-32.png', 32],
];
for (const [src, out, size] of jobs) {
  const svg = await readFile(join(dir, src), 'utf8');
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await writeFile(join(dir, out), await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } }));
}
await browser.close();
