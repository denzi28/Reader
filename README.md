# Reader

A fast, paper-feeling document reader that runs in the browser. Open a PDF,
read it, and mark it up with a pen, highlighter or eraser. Everything stays on
your device.

## What works today

- **PDF reading** with continuous scrolling, zoom (buttons, `Ctrl`+wheel) and
  jump-to-page. Only the pages near the screen are drawn, so large files stay
  light on memory.
- **Ink** on any page: pen (pressure-sensitive with a stylus), highlighter,
  stroke eraser, undo and redo. Strokes are stored relative to the page, so
  they stay put at every zoom level.
- **Library** of the PDFs you have opened, with covers. Your place in each
  document and all your ink are remembered across visits.
- **Day paper and night paper** themes. Ink colours adapt to the theme.
- Works with mouse, touch and stylus. Tap a tool to start drawing with it and
  tap it again to stop. While drawing, one finger draws and two fingers scroll
  (with a fling) or pinch to zoom; with no tool selected, a finger scrolls.

Keyboard: `P` pen, `L` highlighter, `E` eraser (press again to switch off), `Ctrl/Cmd+Z` undo,
`Ctrl/Cmd+Shift+Z` redo, `+` / `-` zoom, `Esc` back to the library.

- **Google Drive sync** (when the build has a Google client ID): documents,
  ink and the page you were on follow you between devices. Everything is kept
  in a hidden app folder in the user's own Drive, so there is no server and no
  storage cost. Ink merges stroke by stroke, so drawing on two devices at once
  loses nothing; erasing and undo carry over too. Documents added elsewhere
  show on the shelf marked "In Drive" and download when opened.

## Not built yet

- Word, Excel and PowerPoint files (only PDF opens today).
- Paid unlock, installable app-store builds.

## Google Drive sync

Sync uses Google Identity Services in the browser and the `drive.appdata`
scope, which only reaches the app's own hidden folder (Google lists it as a
recommended, non-sensitive scope). To turn it on:

1. In [Google Cloud Console](https://console.cloud.google.com/), create a
   project and enable the **Google Drive API**.
2. Under **Google Auth Platform**, set up the consent screen (External) and add
   the `.../auth/drive.appdata` scope. While the app is in Testing, add the
   Google accounts that may use it as test users.
3. Create an **OAuth client ID** of type **Web application** and list every
   address the app runs on under **Authorized JavaScript origins**, for example
   `https://reader-app-delta.vercel.app` and `http://localhost:5173`.
4. Put the client ID in `VITE_GOOGLE_CLIENT_ID` (see `.env.example`), or set it
   as an environment variable in Vercel and redeploy.

The client ID is public by design (it ships in the page); there is no secret.
Access tokens last about an hour; when one runs out, the next tap in the app
renews it.

How it is stored, per document (`<id>` is a hash of the PDF):

| File | Holds | Merging |
| --- | --- | --- |
| `meta-<id>.json` | name, pages, last page read, deletion marker | newest wins |
| `ink-<id>.json` | the ink log: latest state of every stroke | per stroke, newest wins |
| `pdf-<id>.pdf` | the document | uploaded once |
| `thumb-<id>.jpg` | the shelf cover | uploaded once |

## Develop

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-checks, then builds to dist/
npm run preview    # serves the production build
```

Stack: React 19, TypeScript, Vite, pdf.js (legacy build, for older phones),
`perfect-freehand` for ink, IndexedDB (`idb-keyval`) for local storage.
Documents and notes are keyed by a hash of the file contents, which is what
will let the same PDF match its notes on another device later.

## Notes

- `scripts/copy-pdfjs-assets.mjs` copies pdf.js fonts, cmaps and decoders into
  `public/pdfjs/` (git-ignored); `dev` and `build` run it automatically.
- Ink is saved on the device only. Clearing site data removes it.
