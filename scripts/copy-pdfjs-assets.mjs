// Copies the pdf.js data files (fonts, cmaps, wasm decoders) next to the app
// so documents with non-embedded fonts or JPEG2000 images render correctly.
import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', 'pdfjs-dist');
const dest = join(root, 'public', 'pdfjs');

await rm(dest, { recursive: true, force: true });
await mkdir(dest, { recursive: true });
for (const dir of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  await cp(join(src, dir), join(dest, dir), { recursive: true });
}
