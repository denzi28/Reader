import react from '@vitejs/plugin-react';
import { readdirSync, readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';

/** Writes the service worker, filled in with every file the build made, so the app opens with no connection. */
function serviceWorker(): Plugin {
  return {
    name: 'reader-service-worker',
    apply: 'build',
    generateBundle(_, bundle) {
      const built = Object.keys(bundle).filter((f) => !f.endsWith('.map') && f !== 'index.html').map((f) => `/${f}`);
      const fonts = readdirSync('public/pdfjs/standard_fonts').map((f) => `/pdfjs/standard_fonts/${f}`);
      const precache = [
        '/',
        ...built,
        '/manifest.webmanifest',
        '/icons/icon-192.png',
        '/icons/icon-512.png',
        '/icons/apple-touch-icon.png',
        '/privacy.html',
        '/terms.html',
        '/legal.css',
        ...fonts,
      ];
      // Sorts by time, so older versions can be told from the newest.
      const version = `${Date.now().toString(36).padStart(10, '0')}-${built.length}`;
      const source = readFileSync('scripts/sw.template.js', 'utf8')
        .replace('__VERSION__', version)
        .replace('__PRECACHE__', JSON.stringify(precache));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig({
  plugins: [react(), serviceWorker()],
});
