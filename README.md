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
  they stay put at every zoom level. Hold the highlighter still (at the start
  or mid-stroke) and it draws a straight line from where the stroke began to
  wherever you drag; nearly flat lines snap level.
- **Library** of the PDFs you have opened, with covers. Your place in each
  document and all your ink are remembered across visits. Several PDFs can be
  added at once.
- **Folders** to sort documents by course, project or client. Move a document
  with the folder button on its cover (or drag it onto a folder on desktop);
  PDFs added while a folder is open go straight into it. Deleting a folder
  keeps its documents and puts them back on the shelf.
- **Shelf**: a "Continue reading" card, reading progress on every cover, the
  number of marks on each document, starred documents, folders shown with
  their covers in a colour of your choice, and sorting by recently opened,
  added, name or progress in a grid or a list.
- **PDF tools** (the *PDF tools* button on the shelf), all done on the device,
  nothing is uploaded: **merge** several PDFs, **split** one (page ranges,
  every N pages, or pick pages; several results come as one ZIP), **crop**
  margins with a draggable frame (or "trim to content"), and **edit pages**
  (reorder, rotate, delete, duplicate, add blank pages). A file picked from the
  device is worked on without being added to the library. The result is held
  until the reader decides: *Download* first asks "Save to your account?"
  (Yes, save and download / No, just download), and leaving with a result
  neither saved nor downloaded asks for confirmation. When saving, the reader
  can choose to bring the notes made on the original along (placed correctly on
  cropped, rotated and renumbered pages) and, when signed in, to keep the new
  file on this device only, off Google Drive (such files show a small badge and
  can be synced later from their folder menu).
- **Notes**: every highlight and pen mark in one place, page by page. For
  highlights, the text under them is read from the PDF and quoted. A note
  opens its page; "Copy all" gives the notes as text, and the page prints
  cleanly (or saves as PDF from the print dialog).
- **Search** across every document and folder name (`/` or `Ctrl/Cmd+K` to
  jump to it). Case, accents and the Turkish dotted/dotless i are ignored, so
  "ders notlari" finds "Ders notları".
- **Day paper and night paper** themes. Ink colours adapt to the theme.
- Works with mouse, touch and stylus. Tap a tool to start drawing with it and
  tap it again to stop. While drawing, one finger draws and two fingers scroll
  (with a fling) or pinch to zoom; with no tool selected, a finger scrolls.

Keyboard: `P` pen, `L` highlighter, `E` eraser (press again to switch off), `Ctrl/Cmd+Z` undo,
`Ctrl/Cmd+Shift+Z` redo, `+` / `-` zoom, `Esc` back to the library.

- **Sign in with Google**, once, from a welcome screen (or use the app without
  an account). The session lasts until the user signs out.
- **Google Drive sync** (when the build has a Google client ID): documents,
  ink and the page you were on follow you between devices. Everything is kept
  in a hidden app folder in the user's own Drive, so there is no server and no
  storage cost. Ink merges stroke by stroke, so drawing on two devices at once
  loses nothing; erasing and undo carry over too. Documents added elsewhere
  show on the shelf marked "In Drive" and download when opened.

## Not built yet

- Word, Excel and PowerPoint files (only PDF opens today).
- Paid unlock, installable app-store builds.
- Android and iOS apps. When they are built, bring over everything the web
  app does, including hold-to-straighten for the highlighter (hold ~350 ms,
  6 px wobble allowed, lines within 6° of flat snap level, short haptic tick
  when it engages; see `PageView.tsx`).

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

The client ID is public by design (it ships in the page).

### Staying signed in (recommended)

On its own, the browser only gets access tokens that last an hour, so the user
would be asked to reconnect. `api/auth.ts` (a Vercel Function, reached through
the rewrite in `vercel.json`) runs Google's code flow instead: the user signs
in once on Google's page, the function keeps the refresh token encrypted in an
HttpOnly cookie, and hands the app fresh access tokens silently.
To enable it:

1. In the OAuth client, add **Authorized redirect URIs**, one per address the
   app runs on, e.g. `https://reader-app-delta.vercel.app/api/auth/callback`.
2. Set `GOOGLE_CLIENT_SECRET` (the OAuth client's secret; keep it private) in
   Vercel and redeploy. Optionally set `SESSION_SECRET` (32 random bytes,
   base64) to encrypt the session cookie with its own key; otherwise the key is
   derived from the client secret. Changing either signs everyone out.

3. Optional, so Google asks for permission only once per account rather than
   once per device: set `SUPABASE_URL` and `SUPABASE_KEY` (the project's
   publishable key) for a Supabase project with the `reader_grants` table and
   its `reader_get_grant` / `reader_put_grant` / `reader_drop_grant`
   functions. The function stores each refresh token there, sealed with the
   session key and filed under a keyed hash of the Google account, and reuses
   it when Google returns none. If the database is unreachable, sign-in still
   works and simply asks for permission again.

Without them the app falls back to the hour-long popup tokens.

How it is stored, per document (`<id>` is a hash of the PDF):

| File | Holds | Merging |
| --- | --- | --- |
| `meta-<id>.json` | name, pages, last page read, deletion marker | newest wins |
| `ink-<id>.json` | the ink log: latest state of every stroke | per stroke, newest wins |
| `pdf-<id>.pdf` | the document | uploaded once |
| `thumb-<id>.jpg` | the shelf cover | uploaded once |
| `folders.json` | every folder's name (and removal marker) | per folder, newest wins |

Which folder a document is in is part of its `meta-<id>.json`.

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
