# Backlog

Not yet done. Nothing here is being worked on until asked.

## Bugs

### Typed notes (Docs) exported as PDF look wrong: fixed, not pushed yet
Reported 27 Oct 2026. Fixed in `src/lib/office/text.ts`, `src/components/DownloadDialog.tsx` and
`src/components/NoteEditor.tsx`:
- empty paragraphs and the space after lists are kept (they were dropped);
- a line break inside a paragraph (Shift+Enter) stays a line break (it was joined to the line before);
- to-dos show as a box (□, and ▪ with struck-through words when done) instead of "•  ?";
- pictures in the note are in the PDF, at the width they have in the note (they were left out);
- the note's name is not repeated when the note starts with that same heading;
- adding a second picture no longer replaces the first one (it did when one picture was still selected).
Still open: a block quote has no bar at its left in the PDF; tables are not exported.

## Android / release

- Closed test needs 12 testers for 14 days before Production. 6 had joined by 27 Oct.
- After Production: set `VITE_PLAY_URL` and `VITE_APP_GATE=android` in Vercel so the Android
  web visitors are sent to Google Play; web stays open on desktop and iOS.
- A new version of the site only reaches the installed app after the "A new version is ready"
  bar is used or the app is fully closed and reopened (service worker waits by design).
  Option: apply it silently when the app comes back from the background and nothing is being typed.
- Landscape phone, book mode: the top bar and the progress bar leave only a few lines of text.

## Later

- Premium: announcement screen, Play Billing, `reader_plans` migration (needs approval before it
  touches the production database), `PAYWALL_ENFORCED=1`. Update the Play content rating
  ("digital goods") and the Data safety form when it opens.
- Drive upload of very large files is one request (no resume): chunked upload.
- OCR stress test on large scanned files.
- Optional: Vercel Web Analytics for visitor counts (needs the privacy page and the Play Data
  safety form to be updated together).
- Google OAuth consent screen: app name "Leafpage" and redirect URIs for www and the apex.
