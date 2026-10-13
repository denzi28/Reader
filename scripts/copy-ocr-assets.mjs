// Copies the text-recognition engine (worker, wasm cores, English and Turkish
// language data) next to the app, so scanned pages can be read on the device
// without fetching anything from a third party.
import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const nm = join(root, 'node_modules');
const dest = join(root, 'public', 'ocr');

await rm(dest, { recursive: true, force: true });
await mkdir(join(dest, 'core'), { recursive: true });
await mkdir(join(dest, 'lang'), { recursive: true });
await cp(join(nm, 'tesseract.js', 'dist', 'worker.min.js'), join(dest, 'worker.min.js'));
// Only the recognition-only builds are used; the device picks the fastest it can run.
for (const core of ['lstm', 'simd-lstm', 'relaxedsimd-lstm']) {
  await cp(join(nm, 'tesseract.js-core', `tesseract-core-${core}.wasm.js`), join(dest, 'core', `tesseract-core-${core}.wasm.js`));
}
for (const lang of ['eng', 'tur']) {
  await cp(
    join(nm, '@tesseract.js-data', lang, '4.0.0_best_int', `${lang}.traineddata.gz`),
    join(dest, 'lang', `${lang}.traineddata.gz`),
  );
}
