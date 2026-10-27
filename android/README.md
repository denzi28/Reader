# Leafpage for Android

The Android app is a **Trusted Web Activity**: it runs https://www.leafpage.app in Chrome with no browser bars, so Google
sign-in, the service worker (offline), the home-screen shortcuts and every update of the site work exactly as on the web.
(A WebView wrapper such as Capacitor would not do: Google refuses to sign in inside a WebView.)

Package name: `app.leafpage.reader` (permanent once published). The app opens `https://www.leafpage.app` (the address `leafpage.app` redirects to), so `assetlinks.json` must be served there.

## One-time setup

1. **Make an upload key** (on any computer with Java; keep the file and passwords safe, and never commit them):
   ```
   keytool -genkeypair -v -keystore upload.keystore -alias upload -keyalg RSA -keysize 2048 -validity 10000
   base64 -w0 upload.keystore        # macOS: base64 -i upload.keystore
   ```
2. In the GitHub repository: **Settings > Secrets and variables > Actions**, add
   `ANDROID_KEYSTORE_B64` (the base64 text), `ANDROID_KEYSTORE_PASSWORD` and `ANDROID_KEY_PASSWORD`.
3. **Actions > Android app > Run workflow.** The `leafpage-android` artifact holds `app-release-bundle.aab`.
4. In **Play Console**: create the app (package `app.leafpage.reader`), keep *Play App Signing* on, and upload the `.aab`
   to *Internal testing*.
5. In Play Console, **Test and release > App integrity > App signing**: copy the **SHA-256 certificate fingerprint** of the
   *app signing key* and put it in `public/.well-known/assetlinks.json` (see below). Until then the app opens with a
   browser bar on top.

## assetlinks.json

`public/.well-known/assetlinks.json` proves to Chrome that the site belongs to the app:

```json
[{ "relation": ["delegate_permission/common.handle_all_urls"],
   "target": { "namespace": "android_app", "package_name": "app.leafpage.reader",
               "sha256_cert_fingerprints": ["AA:BB:...:FF"] } }]
```

## Files sent to Leafpage

A PDF or ePub sent to Leafpage is kept in an inbox by the page (the service worker for **Share**, `launchQueue` for
**Open with**), and once the library is open it asks "Save this file to your library?" (`src/components/IncomingFiles.tsx`).
The web part is tested in a browser, and on a computer an installed Leafpage takes part through `file_handlers`.

On Android there are two ways in, both needing a build made with this folder (not PWABuilder):

- **Share sheet:** `shareTarget` in `twa-manifest.json` (and `share_target` in the web manifest).
- **Open with:** `add-file-intents.mjs` adds the `ACTION_VIEW` filter for PDF and ePub to the generated
  `AndroidManifest.xml` (the workflow runs it between `bubblewrap update` and `bubblewrap build`). The Trusted Web Activity
  library (androidbrowserhelper 2.7.4) passes the opened file to Chrome, which gives it to the page through `launchQueue`
  because the web manifest has `file_handlers`. After the first "Open with", Android itself asks "Just once" or "Always".

**None of this has been built or tried on a phone.** To try it: run the workflow (needs the upload key secrets), put the
`.aab` in a Play test track, install it, open a PDF from a file manager and from Chrome's downloads, and share one.
If "Open with" does not list Leafpage, or the file does not reach the page, the cause is most likely the Chrome version
on the phone (file handling in a Trusted Web Activity is recent) or the filter, so start with the `adb logcat` lines tagged
`LauncherActivity`.

## Play Billing (later)

Premium is bought only in Google Play. In a TWA this uses the Digital Goods API from the page, and the manifest needs
`"features": { "playBilling": { "enabled": true } }`. Do it when the subscription product exists in Play Console.
