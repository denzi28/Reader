# Backlog

Not yet done. Nothing here is being worked on until asked.

## Bugs

### Typed notes (Docs) exported as PDF look wrong
Reported 27 Oct 2026. When a typed note (the "Doc" kind, written with the keyboard) is
downloaded as PDF, the text comes out blurry and spaces are missing or collapse.
There may be more problems in the PDF export; go through it end to end when this is picked up:
headings, lists, to-dos, quotes, pictures, long lines, page breaks, Turkish letters.
Where to look: `src/components/DownloadDialog.tsx` (the md / pdf choice) and the typed-note code
in `src/lib/typedNote.ts`. Check whether the PDF is built from a screenshot of the page (which
would explain the blur) instead of real text.
Status: waiting, do not start yet.

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
