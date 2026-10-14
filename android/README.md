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

## Play Billing (later)

Premium is bought only in Google Play. In a TWA this uses the Digital Goods API from the page, and the manifest needs
`"features": { "playBilling": { "enabled": true } }`. Do it when the subscription product exists in Play Console.
