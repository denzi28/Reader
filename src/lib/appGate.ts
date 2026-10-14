// Once the app is on Google Play, people who open the site in an ordinary browser are sent to the store instead.
// The site itself stays up (the Android app is this site, run without browser bars), so the gate looks for the app.
//
//   VITE_APP_GATE=android  only Android browsers are asked to install the app (nothing else has an app yet)
//   VITE_APP_GATE=all      every browser is (leaves iPhone and computers with nothing: only once they have an app)
//   unset                  no gate
//
// Build-time, with VITE_PLAY_URL (the store address).
const MODE = (import.meta.env.VITE_APP_GATE as string | undefined) || '';
export const PLAY_URL = (import.meta.env.VITE_PLAY_URL as string | undefined) || '';
const APP_ID = 'app.leafpage.reader';
const KEY = 'reader.inApp';

/** True when this page runs inside the installed app (or any installed copy of the site). */
export function inApp(): boolean {
  try {
    // A Trusted Web Activity starts with the app as the referrer; it is remembered for the rest of the visit and after.
    if (document.referrer.startsWith(`android-app://${APP_ID}`)) localStorage.setItem(KEY, '1');
    if (localStorage.getItem(KEY) === '1') return true;
  } catch { /* storage unavailable */ }
  return window.matchMedia('(display-mode: standalone)').matches
    || window.matchMedia('(display-mode: minimal-ui)').matches
    || (navigator as unknown as { standalone?: boolean }).standalone === true;
}

/** Should this visit be asked to get the app? */
export function needsApp(): boolean {
  if (!MODE || !PLAY_URL || inApp()) return false;
  // Sign-in returns and the like are never blocked half way, and a way in is kept for testing: /?web=1
  try {
    if (new URLSearchParams(location.search).get('web') === '1') { sessionStorage.setItem('reader.web', '1'); }
    if (sessionStorage.getItem('reader.web') === '1') return false;
  } catch { /* ignore */ }
  if (MODE === 'all') return true;
  return /Android/i.test(navigator.userAgent);
}
