# Reader

A fast, paper-feeling document reader that runs in the browser. Open a PDF,
read it, and mark it up with a pen, highlighter or eraser. Everything stays on
your device.

## What works today

- **PDF reading** with continuous scrolling, zoom (buttons, `Ctrl`+wheel) and
  jump-to-page. Only the pages near the screen are drawn, so large files stay
  light on memory.
- **Ink and notes** on any page. A bar of six tools: read (scroll and zoom),
  pen, highlighter, eraser, select and typed notes. Tapping the chosen tool
  again opens or closes its menu: colour and a thickness slider for the pen and
  highlighter; for the eraser, a stroke or an area eraser (an area eraser cuts a
  stroke where it passes), its size, "erase only highlighter" and "erase
  everything on this page"; for typed notes, a colour and a letter size.
  Choices are remembered. Strokes are stored relative to the page, so they stay
  put at every zoom level. Hold the highlighter still (at the start or
  mid-stroke) and it draws a straight line from where the stroke began to
  wherever you drag; nearly flat lines snap level.
- **Select** (lasso): draw a loop around notes, or tap one, to select it. Drag it
  to move it, drag a corner to resize it, drag the top handle to turn it, and use
  the buttons over it to cut, copy, paste, delete or change its colour and
  thickness. Everything is undoable. Typed notes (tap the page with the note
  tool, tap a note to edit it) move and resize like ink, stay upright, and show
  up under *Notes* with the highlights. Edits keep a stroke's id, so moving or
  restyling merges between devices like any other change (newer wins).
- **New note**: a blank notebook to write on (blank, lined, squared or dotted
  paper, always upright so notes line up), made on the device as an ordinary
  PDF, so the pen, typed notes and syncing all work on it. It opens with the pen
  in hand and starts with one page. An *Add a page* button after the last page
  (and one in the top bar) adds the next. This works for notes made for a page
  too. A page is added in place: the file keeps its identity, notes and shelf
  place. Sync resends the longer PDF (`pdfDirty` on this device's sync record) and
  other devices replace their copy when Drive's `pdf-<id>.pdf` changes, so an open
  note on another device grows live.
- **A note for one page.** The note button in a PDF's top bar makes an empty
  notebook dedicated to the page being read. The note says at the top which
  document and page it is for. While you read that page the note waits as a small
  card in the top right corner; tapping it brings the note to the screen, with the
  PDF page now in the corner (tap that to swap back). Hide a card with its ×.
  Stored as `attached` on the note's record, so it syncs. The card can be dragged
  to any corner (it settles in the nearest and remembers it), and swapping between a
  note and its page replaces the history entry, so the back arrow always leads to the
  shelf. A note is filed in its document's folder and follows it when it is moved; in
  the *Notes* tab it appears as a section inside its document, even if that document
  has no marks of its own.
- **Smooth zoom.** Pinching, Ctrl+wheel, the buttons and the keys scale the pages
  with a CSS transform (soft while moving, no re-layout per frame); the real size
  is set once when you stop, and the sheets are then redrawn sharp, nearest first.
- **Download to the device**: a Download button on every cover and in the
  reader's top bar. *With my notes* draws the pen, highlights and typed notes
  onto the pages (correct on rotated and cropped pages, any alphabet) and saves
  `<name> (with notes).pdf`; *Original PDF* saves the file exactly as it was
  added. A note you made yourself downloads as a PDF with its writing. A document
  that is only in Drive is brought down first.
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
  opens its page. Highlights made while reading a book are listed too, with
  their notes.
- **Search** across every document and folder name (`/` or `Ctrl/Cmd+K` to
  jump to it). Case, accents and the Turkish dotted/dotless i are ignored, so
  "ders notlari" finds "Ders notları".
- **Day paper and night paper** themes. Ink colours adapt to the theme.
- Works with mouse, touch and stylus. Tap a tool to start drawing with it and
  tap it again to stop. While drawing, one finger draws and two fingers scroll
  (with a fling) or pinch to zoom; with no tool selected, a finger scrolls.

Keyboard: `P` pen, `L` highlighter, `E` eraser (press again to switch off), `Ctrl/Cmd+Z` undo,
`Ctrl/Cmd+Shift+Z` redo, `+` / `-` zoom, `Esc` back to the library.

- **Sign in with Google**, once, from a welcome screen. The library is only
  reachable when signed in. Without an account, the welcome page's PDF-tools
  strip (and "Try the PDF tools") opens a tools-only page: files come from the
  device and results can only be downloaded, nothing is kept. The session lasts
  until the user signs out. (When no Google client ID is configured at all, e.g.
  a local build, the library opens directly.)
- **Google Drive sync** (when the build has a Google client ID): documents,
  ink and the page you were on follow you between devices. Everything is kept
  in a hidden app folder in the user's own Drive, so there is no server and no
  storage cost. Ink merges stroke by stroke, so drawing on two devices at once
  loses nothing; erasing and undo carry over too. Documents added elsewhere
  show on the shelf marked "In Drive" and download when opened.

- **Find in a document** (magnifier in the top bar, or Ctrl/Cmd+F): matches
  ignore capitals and accents ("ceviri" finds "Çeviri"), are marked on the
  pages, can be stepped through (Enter / Shift+Enter) or picked from a list
  with the words around each one.
- **Scanned pages**: when pages have no text (a scan, a photo), the find bar
  offers "Recognise text". Words are read on the device (tesseract.js, English
  and Turkish, files served from `/ocr/`, nothing leaves the phone), kept with
  the document in IndexedDB, and then searchable. The same words let a
  highlighter pick up the text of a scanned page in the Notes tab.

- **Other kinds of files**: PDFs, and everything below, are added like any PDF (Add
  files, or drop them on the page) and converted on the device (`src/lib/office/`,
  nothing is uploaded) into a normal text PDF, so reading, ink, notes, find, download
  and sync all work on them. The same file always gives the same PDF (fixed dates and
  font names), so adding it twice finds the first copy. The list of extensions is
  `src/lib/fileTypes.ts`.
  - **Word** `.docx`: styles (headings, bold/italic/underline/colour/highlight, super- and
    subscript), alignment, indents, bullet and numbered lists, tables (spans, shading,
    rules, repeated header rows), pictures (cropped ones too), footnotes (after the
    text). Headers, footers and text boxes are left out.
  - **Excel** `.xlsx`: every visible sheet as a table with a light grid; numbers, dates
    and percentages as the sheet formats them; wide sheets go landscape, shrink a
    little, and are split by columns if still too wide. Charts and pictures are left out.
  - **PowerPoint** `.pptx`: one page per slide at the slide's size; text takes its size,
    colour and bullets from the layout and master, plus pictures, tables, simple
    shapes, lines, and the master/layout decoration. Charts and diagrams show as a
    labelled empty box; animations, notes and hidden slides are not included.
  - **OpenDocument** `.odt` `.ods` `.odp`, and **RTF**: text with its formatting, lists,
    tables, pictures and footnotes; sheets and slides as above.
  - **Old Office** `.doc` `.xls` `.ppt` (1997–2003, `src/lib/office/legacy.ts`): Excel
    keeps its numbers, dates and merged cells; Word and PowerPoint files give their
    text only (no fonts, colours or pictures). Password-protected ones are refused.
  - **Text** `.txt` `.log` and source-code extensions (monospace), **Markdown** `.md`
    (headings, lists, quotes, code, emphasis), **CSV/TSV** (as a table; `;` and `,`
    are told apart; UTF-8 or Windows Turkish text both read right).
  - **Pictures** `.jpg` `.png` `.webp` `.gif` `.bmp` `.avif`: one page the size of the
    picture (turned upright from the camera's orientation) to write on. HEIC is not
    readable by browsers and is refused with a hint.
  - Fonts: Reader Sans/Serif/Mono (`public/fonts/`, trimmed and renamed copies of
    Carlito and Liberation under the SIL OFL, made by `scripts/make-office-fonts.py`)
    are fetched on first use so Turkish letters and the like come out right. They are
    not precached.

- **Phone layout** (screens up to 640 px wide, also what an Android app wrapping the
  site will show): the library has a slim header (name and search), folder chips,
  a resume card and a clean shelf (each document's actions sit behind its three
  dots; a starred one shows a star). A bottom bar holds Library, Notes, a plus in
  the middle (Add files, New note, New folder), Tools (the four PDF tools as a
  plain list) and Me (account and sync, night paper, install, privacy and terms; a
  dot appears on Me when sync needs attention). The reading screen keeps only
  back, title with page, find and a three-dot menu on top (add a page or a note,
  download, night paper, sync), and hand, pen, highlighter, eraser, "more"
  (select, type a note, zoom), undo and redo below. Wider screens get the
  desktop layout (`src/lib/usePhone.ts` decides; `PhoneParts.tsx` has the pieces).

- **Desktop layout** (screens wider than 640 px): the library is a sidebar workspace
  (`Sidebar.tsx`): Library, Notes and PDF tools on top, folders with their counts
  beneath (drop a document on one to move it), and sync, night paper, install,
  privacy and terms at the foot; the main area holds search, a resume card and the
  shelf. The reading screen has a page strip on the left (thumbnails, drawn only
  near the view), a vertical tool dock whose options fly out beside it, a "this
  document" panel on the right listing every mark and note by page (`ReaderSide.tsx`),
  and a top bar with page jump, zoom, find, add page, download, night paper and
  toggles for the strip and the panel (both remembered). Notes and PDF tools stay
  plain lists.

- **Book mode** (the small book on every card, and in the reading screen's top bar): any
  PDF or ePub opens as a book to read: reflowed text you can resize, in four page colours
  (paper, sepia, mist, night) and four typefaces, with line spacing and margins. It turns
  pages (swipe or tap the edges on a phone; arrows, wheel or edge clicks on a computer,
  two pages side by side when the window is wide) or scrolls, and shows the page, how far
  through the book you are and how long is left (about 230 words a minute). Contents, search
  in the book, bookmarks, and highlights in four colours with notes are in the panels;
  selecting words offers them. An ePub is read directly (chapters, contents list, pictures
  and cover); a PDF is rebuilt from its text (`src/lib/book/fromPdf.ts`: lines, columns,
  paragraphs, headings, chapters from the outline; running heads and page numbers are
  dropped; a scanned PDF is read from its pictures with the OCR already described, several pages
  at a time and in the language the first pages turn out to be in: the book opens after the
  first three pages and grows as the rest are read, then is kept). A scanned PDF first opens in book mode as its own pages
  (`PageBook.tsx`: one or two at a time, the book's colours and eye comfort, contents and
  bookmarks), view only, with nothing read. Only asking to highlight or take notes shows a small
  question: what reading the pages is for, about how long it takes (from what the last run
  measured), and the whole book, just the next 20 pages, or not now. The pages can be zoomed
  as far as wanted (pinch, + and −, Ctrl and the wheel, the Aa panel's slider or "Page width");
  dragging moves about a zoomed page, and each document keeps its own zoom, also after closing it.
  Places and marks in a PDF book are kept as (page, number on that page), so they stay put when
  pages are added later, also while the book grows under the reader during a scan. One page that
  fails to read no longer ends a scan, and the page label of a book made from a PDF is the PDF's
  own page number.
  Tables, formulas and figures stay in the PDF, one tap away. The place (`bookPos`, kept in
  step with the PDF's page) and the marks (kept in the same log as ink, so they sync the same
  way) follow you between devices. A PDF last read as a book opens as one next time.
  An eye comfort filter (a warm tint over the screen while a book is open,
  on by default, strength adjustable in the Aa panel) cuts the blue light for night reading.
  ePub files are added like any other file and kept in the same Drive slot as PDFs; the
  record says which it is (`kind: 'epub'`).

## Not built yet

- Paid unlock, app-store builds (the PWA above is the first step: a Play listing can wrap it).
- Android and iOS apps. When they are built, bring over everything the web
  app does, including hold-to-straighten for the highlighter (hold ~350 ms,
  6 px wobble allowed, lines within 6° of flat snap level, short haptic tick
  when it engages; see `PageView.tsx`).

## Installing, and working with no connection

The app is a PWA: `public/manifest.webmanifest` and the icons in `public/icons`
(drawn from the two SVGs by `scripts/make-icons.mjs`) make it installable, and a
service worker keeps it available offline. `vite.config.ts` writes `sw.js` at
build time from `scripts/sw.template.js`, filled in with every file the build
made. The app files are kept when it is installed; pdf.js data files are kept as
they are used; `/api` (sign-in) and Google are never touched. The page itself is
fetched fresh when there is a connection. A new version downloads in the
background and waits behind a "A new version is ready. Reload" toast. Libraries,
ink and notes were already stored on the device, so reading and writing work
offline, and sync catches up later. Chrome, Edge and Android offer *Install app*
in the library header; on an iPhone it shows the Add to Home Screen steps.

## Why the web app comes first

The web app is where everything is built and tried first because it can be
updated instantly, while Google Play's review and update cycle is slow and
costly to iterate against. The plan: once the mobile app is ready, publish it
on Google Play and retire the web version, with the web address redirecting
to the Play listing. Until then, keep the web app as the single source of
truth for features, and keep it easy to port (no browser-only tricks that a
native/wrapped app could not reproduce).

## Premium

Premium is bought **only** through Google Play or the App Store (never on the web: the paywall
sends people to the app). Until the apps are listed nothing is limited: the limits below apply
only when the server has `PAYWALL_ENFORCED=1` (Vercel environment variable; `TRIAL_DAYS`, default 7).

- **Trial:** everything unlocked for 7 days from a person's first sign-in. The start is kept on
  the server per Google account (`reader_plans`, keyed by an HMAC of the Google id), so clearing
  the browser does not restart it.
- **Free plan** afterwards: up to 5 documents in the library (existing ones stay; notes made for
  a page are not counted; adding more opens the paywall), and Drive sync on **one device only**,
  by itself at most every 6 hours (`FREE_AUTO_SYNC_MS`), the rest by hand with "Sync now". Another
  device is told sync runs elsewhere and can take it over once a day. Reading, pen, highlights,
  book mode, PDF tools and reading scanned pages stay free.
- **Premium:** no document limit, sync on every device, automatically.

How it fits together: `api/auth.ts` answers `GET /api/auth/plan?device=...` (trial start, Premium
end, whether this device is the sync device) and `POST /api/auth/plan-move`; the database side is
`supabase/migrations/20261013000000_reader_plans.sql` (apply it before turning enforcement on).
`src/lib/plan.ts` holds the rules, `engine.ts` gates syncing, `importPdf.ts` the document limit,
`Paywall.tsx` the sheet and the plan card (Me page, desktop sidebar). Still to build, with the
apps: verifying Play Billing / App Store purchases on the server and writing `premium_until`;
the paywall then shows the store buttons (`VITE_PLAY_URL`, `VITE_APPSTORE_URL`).

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

- `scripts/copy-ocr-assets.mjs` copies the text-recognition worker, wasm cores
  and language data into `public/ocr/` (git-ignored, ~17 MB, not precached: it
  is fetched the first time pages are read and cached after that).
- `scripts/copy-pdfjs-assets.mjs` copies pdf.js fonts, cmaps and decoders into
  `public/pdfjs/` (git-ignored); `dev` and `build` run it automatically.
- Ink is saved on the device only. Clearing site data removes it.
