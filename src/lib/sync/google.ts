// Google sign-in for Drive. Two ways, picked at start-up:
//
//  - "server": when /api/auth is set up, the user signs in once on Google's
//    page and stays signed in; fresh access tokens come from /api/auth/token
//    with no popup (see api/auth.ts).
//  - "browser": otherwise, Google Identity Services' token model in a popup.
//    Its tokens last an hour and can only be renewed from a tap.

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const TOKEN_KEY = 'reader.drive.token';

/** False when the build has no Google client ID, so sync is hidden. */
export const syncConfigured = Boolean(CLIENT_ID);

export type AuthMode = 'server' | 'browser';
export interface Account {
  email?: string;
  name?: string;
  picture?: string;
}

let mode: AuthMode = 'browser';
export const authMode = () => mode;

/** Finds out which sign-in is available and, for "server", who is signed in. */
export async function initAuth(): Promise<{ mode: AuthMode; account: Account | null }> {
  if (CLIENT_ID) {
    try {
      const res = await fetch('/api/auth/status', { credentials: 'same-origin' });
      if (res.ok) {
        const body = (await res.json()) as { configured: boolean; user: Account | null };
        if (body.configured) {
          mode = 'server';
          return { mode, account: body.user };
        }
      }
    } catch { /* offline, or no server: fall back to the popup */ }
  }
  mode = 'browser';
  return { mode, account: null };
}

/** Server mode: go to Google's sign-in page; it comes back to the app. */
export function startSignIn(hint?: string) {
  location.assign(`/api/auth/start${hint ? `?hint=${encodeURIComponent(hint)}` : ''}`);
}

export async function signOutEverywhere() {
  writeToken(null);
  await fetch('/api/auth/logout', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'X-Reader': '1' },
  }).catch(() => undefined);
}

/**
 * A usable access token, or null when the user has to sign in (again).
 * In server mode an expired token is replaced silently.
 */
export async function getAccessToken(): Promise<string | null> {
  const t = currentToken();
  if (t || mode === 'browser') return t;
  const res = await fetch('/api/auth/token', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'X-Reader': '1' },
  });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error('Google is not responding. Sync will try again.');
  const body = (await res.json()) as { access_token: string; expires_in: number };
  writeToken({ access: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 });
  return body.access_token;
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}
interface TokenClient {
  requestAccessToken(overrides?: { prompt?: string; login_hint?: string }): void;
}
interface GoogleOAuth2 {
  initTokenClient(config: {
    client_id: string;
    scope: string;
    callback: (r: TokenResponse) => void;
    error_callback?: (e: { type: string; message?: string }) => void;
  }): TokenClient;
  hasGrantedAllScopes(r: TokenResponse, scope: string): boolean;
  revoke(token: string, done?: () => void): void;
}
declare global {
  interface Window {
    google?: { accounts: { oauth2: GoogleOAuth2 } };
  }
}

interface StoredToken {
  access: string;
  expiresAt: number;
}

let gisLoading: Promise<void> | null = null;
let client: TokenClient | null = null;
let pending: { resolve: (t: string) => void; reject: (e: Error) => void } | null = null;

function loadGis() {
  gisLoading ??= new Promise<void>((resolve, reject) => {
    if (window.google?.accounts?.oauth2) return resolve();
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      gisLoading = null;
      reject(new Error('Could not reach Google. Check your connection.'));
    };
    document.head.appendChild(script);
  });
  return gisLoading;
}

/** Loads Google's script ahead of time, so a tap can open its window at once. */
export function preloadGoogle() {
  if (CLIENT_ID) loadGis().catch(() => undefined);
}

function readToken(): StoredToken | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    return raw ? (JSON.parse(raw) as StoredToken) : null;
  } catch {
    return null;
  }
}

function writeToken(t: StoredToken | null) {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, JSON.stringify(t));
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* storage unavailable */ }
}

/** A token still good for at least a minute, or null. */
export function currentToken(): string | null {
  const t = readToken();
  return t && t.expiresAt - 60_000 > Date.now() ? t.access : null;
}

/**
 * Opens Google's permission popup (it closes by itself once the user has
 * agreed before). Must be called from a tap or click, or browsers block it.
 */
export async function requestToken(hint?: string): Promise<string> {
  if (!CLIENT_ID) throw new Error('Google Drive sync is not set up in this build.');
  await loadGis();
  const oauth = window.google!.accounts.oauth2;
  client ??= oauth.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPE,
    callback: (r) => {
      const p = pending;
      pending = null;
      if (!p) return;
      if (r.error || !r.access_token) {
        p.reject(new Error(r.error_description || r.error || 'Google sign-in failed.'));
      } else if (!oauth.hasGrantedAllScopes(r, SCOPE)) {
        p.reject(new Error('Drive access was not allowed, so notes cannot sync.'));
      } else {
        writeToken({ access: r.access_token, expiresAt: Date.now() + (r.expires_in ?? 3600) * 1000 });
        p.resolve(r.access_token);
      }
    },
    error_callback: (e) => {
      const p = pending;
      pending = null;
      p?.reject(
        new Error(
          e.type === 'popup_failed_to_open'
            ? 'The Google window was blocked. Allow pop-ups for this site and try again.'
            : 'Google sign-in was closed before it finished.',
        ),
      );
    },
  });
  return new Promise<string>((resolve, reject) => {
    pending?.reject(new Error('Superseded'));
    pending = { resolve, reject };
    client!.requestAccessToken({ prompt: '', login_hint: hint });
  });
}

export function forgetToken(revoke: boolean) {
  const t = readToken();
  writeToken(null);
  if (revoke && t) window.google?.accounts.oauth2.revoke(t.access);
}
