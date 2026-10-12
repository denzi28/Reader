// Google sign-in that lasts. The browser alone only ever gets hour-long access
// tokens; this function runs the OAuth code flow instead, so Google issues a
// refresh token. It is kept encrypted in an HttpOnly cookie and traded for a
// fresh access token whenever the app needs one.
//
// Google hands out a refresh token only when it shows its consent screen. So
// that someone who allowed access once is not asked again (after signing out,
// or on another device), the token is also kept sealed in a small database
// (Supabase, table reader_grants), under a key derived from their Google id.
//
//   GET  /api/auth/start     → Google's sign-in page
//   GET  /api/auth/callback  ← Google returns here; sets the session cookie
//   GET  /api/auth/status    → { configured, user }
//   POST /api/auth/token     → { access_token, expires_in, user }
//   POST /api/auth/logout    → signs out on this device (access stays granted)
//
// Environment: VITE_GOOGLE_CLIENT_ID (shared with the app) and
// GOOGLE_CLIENT_SECRET. SESSION_SECRET (32 random bytes, base64) is optional;
// without it the cookie key is derived from the client secret. Changing either
// signs everyone out. SUPABASE_URL and SUPABASE_KEY (the publishable key)
// enable remembering consent; without them each new session asks once.
// /api/auth/:action is rewritten to this file in vercel.json.

declare const process: { env: Record<string, string | undefined> };

const CLIENT_ID = process.env.VITE_GOOGLE_CLIENT_ID ?? process.env.GOOGLE_CLIENT_ID ?? '';
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? '';
const SESSION_SECRET = process.env.SESSION_SECRET ?? '';
const SUPABASE_URL = (process.env.SUPABASE_URL ?? '').replace(/\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_KEY ?? '';
// Only the app's own Drive folder. Asking for nothing else keeps Google's
// consent to a single "Allow": combined with sign-in scopes (openid, email,
// profile) it becomes a list of checkboxes the user must tick. The name, email
// and photo come from Drive's "about" instead.
const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const SESSION = 'tr_session';
const STATE = 'tr_oauth_state';
const COOKIE_PATH = '/api/auth';
const YEAR = 400 * 24 * 3600; // browsers cap cookie lifetimes at 400 days

interface User {
  email?: string;
  name?: string;
  picture?: string;
}
interface Session extends User {
  rt: string;
  /** Google's stable id for the person (Drive's permissionId). */
  uid?: string;
}
const publicUser = (s: Session): User => ({ email: s.email, name: s.name, picture: s.picture });

const configured = () => Boolean(CLIENT_ID && CLIENT_SECRET);

// ---- small helpers ------------------------------------------------------
const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

function json(body: unknown, status = 200, headers: Headers = new Headers()) {
  headers.set('Content-Type', 'application/json');
  headers.set('Cache-Control', 'no-store');
  return new Response(JSON.stringify(body), { status, headers });
}

function redirect(location: string, headers: Headers = new Headers()) {
  headers.set('Location', location);
  headers.set('Cache-Control', 'no-store');
  return new Response(null, { status: 302, headers });
}

function cookies(request: Request) {
  const out: Record<string, string> = {};
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function origin(request: Request) {
  const url = new URL(request.url);
  const proto = request.headers.get('x-forwarded-proto') ?? url.protocol.replace(':', '');
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? url.host;
  return `${proto}://${host}`;
}

function cookie(request: Request, name: string, value: string, maxAge: number) {
  const secure = origin(request).startsWith('https:') ? '; Secure' : '';
  return `${name}=${encodeURIComponent(value)}; Path=${COOKIE_PATH}; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`;
}

// ---- the encrypted session cookie (AES-256-GCM) ------------------------
let keyPromise: Promise<CryptoKey> | null = null;
const key = () =>
  (keyPromise ??= (async () => {
    const raw = SESSION_SECRET
      ? fromB64url(SESSION_SECRET)
      : new Uint8Array(
          await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`reader-session:${CLIENT_SECRET}`)),
        );
    return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  })());

async function seal(session: Session) {
  return sealText(JSON.stringify(session));
}

async function sealText(text: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(text);
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(), data));
  const out = new Uint8Array(iv.length + sealed.length);
  out.set(iv);
  out.set(sealed, iv.length);
  return b64url(out);
}

async function unsealText(value: string | null | undefined): Promise<string | null> {
  if (!value) return null;
  try {
    const bytes = fromB64url(value);
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bytes.slice(0, 12) },
      await key(),
      bytes.slice(12),
    );
    return new TextDecoder().decode(plain);
  } catch {
    return null; // tampered with, or sealed with an older secret
  }
}

async function unseal(value: string | undefined): Promise<Session | null> {
  const text = await unsealText(value);
  try {
    return text ? (JSON.parse(text) as Session) : null;
  } catch {
    return null;
  }
}

// ---- remembered consent (refresh tokens kept between sessions) ----------
const grantsOn = () => Boolean(SUPABASE_URL && SUPABASE_KEY);

let grantKeyPromise: Promise<CryptoKey> | null = null;
/** The row key: an HMAC of the Google id, so the table never holds the id. */
async function grantKey(uid: string) {
  grantKeyPromise ??= (async () => {
    const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`reader-grant:${CLIENT_SECRET}`));
    return crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  })();
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', await grantKeyPromise, new TextEncoder().encode(uid)));
  return Array.from(mac, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function rpc(fn: string, args: Record<string, string>) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 5000);
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', apikey: SUPABASE_KEY };
    if (!SUPABASE_KEY.startsWith('sb_')) headers.Authorization = `Bearer ${SUPABASE_KEY}`;
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(args),
      signal: ctl.signal,
    });
    if (!res.ok) throw new Error(`grants ${fn}: ${res.status}`);
    const text = await res.text();
    return text ? (JSON.parse(text) as unknown) : null;
  } finally {
    clearTimeout(timer);
  }
}

// The database only ever helps: if it is down, sign-in still works and Google
// simply asks for consent once.
async function saveGrant(uid: string, rt: string) {
  if (!grantsOn()) return;
  await rpc('reader_put_grant', { p_k: await grantKey(uid), p_v: await sealText(rt) }).catch(() => undefined);
}

async function loadGrant(uid: string): Promise<string | null> {
  if (!grantsOn()) return null;
  try {
    return await unsealText((await rpc('reader_get_grant', { p_k: await grantKey(uid) })) as string | null);
  } catch {
    return null;
  }
}

async function dropGrant(uid: string) {
  if (!grantsOn()) return;
  await rpc('reader_drop_grant', { p_k: await grantKey(uid) }).catch(() => undefined);
}

/** Who signed in, from Drive (the only thing we have access to). */
async function driveUser(accessToken: string): Promise<User & { uid?: string }> {
  try {
    const res = await fetch(
      'https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress,photoLink,permissionId)',
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) return {};
    const { user } = (await res.json()) as {
      user?: { displayName?: string; emailAddress?: string; photoLink?: string; permissionId?: string };
    };
    return {
      email: user?.emailAddress,
      name: user?.displayName,
      picture: user?.photoLink,
      uid: user?.permissionId,
    };
  } catch {
    return {};
  }
}

async function googleToken(params: Record<string, string>) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, ...params }),
  });
  return { ok: res.ok, body: (await res.json()) as Record<string, string | number | undefined> };
}

/** Only accept POSTs made by the app itself. */
function sameOrigin(request: Request) {
  const from = request.headers.get('origin');
  return request.headers.get('x-reader') === '1' && (!from || from === origin(request));
}

// ---- actions --------------------------------------------------------------
function start(request: Request) {
  const url = new URL(request.url);
  const consent = Boolean(url.searchParams.get('consent'));
  // A ".c" suffix marks the second, consent-asking round, so it isn't repeated.
  const state = b64url(crypto.getRandomValues(new Uint8Array(16))) + (consent ? '.c' : '');
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: `${origin(request)}/api/auth/callback`,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    // Google only hands out a refresh token with consent; ask for it again
    // when a previous sign-in left us without one.
    prompt: consent ? 'consent' : 'select_account',
    state,
  });
  const hint = url.searchParams.get('hint');
  if (hint) params.set('login_hint', hint);
  const headers = new Headers();
  headers.append('Set-Cookie', cookie(request, STATE, state, 600));
  return redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`, headers);
}

async function callback(request: Request) {
  const url = new URL(request.url);
  const home = `${origin(request)}/`;
  const headers = new Headers();
  headers.append('Set-Cookie', cookie(request, STATE, '', 0));
  const error = url.searchParams.get('error');
  if (error) return redirect(`${home}?auth_error=${encodeURIComponent(error)}`, headers);
  const state = url.searchParams.get('state');
  const code = url.searchParams.get('code');
  if (!code || !state || state !== cookies(request)[STATE]) {
    return redirect(`${home}?auth_error=state`, headers);
  }
  const { ok, body } = await googleToken({
    code,
    grant_type: 'authorization_code',
    redirect_uri: `${origin(request)}/api/auth/callback`,
  });
  if (!ok) return redirect(`${home}?auth_error=exchange`, headers);
  const scope = String(body.scope ?? '');
  if (!scope.includes('drive.appdata')) return redirect(`${home}?auth_error=drive_scope`, headers);

  const who = await driveUser(String(body.access_token));
  let rt = body.refresh_token as string | undefined;
  if (rt) {
    if (who.uid) await saveGrant(who.uid, rt); // remember the consent for next time
  } else {
    // Google gives no refresh token once access has been granted. Reuse this
    // device's session if it belongs to the same person, else the one kept
    // from their earlier consent, checking that it still works.
    const previous = await unseal(cookies(request)[SESSION]);
    if (previous && who.uid && previous.uid === who.uid) rt = previous.rt;
    if (!rt && who.uid) {
      const kept = await loadGrant(who.uid);
      if (kept && (await googleToken({ refresh_token: kept, grant_type: 'refresh_token' })).ok) rt = kept;
      else if (kept) await dropGrant(who.uid);
    }
  }
  if (!rt) {
    // Nothing to keep the session going with: ask for consent, once.
    if (!state.endsWith('.c')) return redirect(`${origin(request)}/api/auth/start?consent=1`, headers);
    return redirect(`${home}?auth_error=no_refresh`, headers);
  }
  const session: Session = { rt, ...who };
  headers.append('Set-Cookie', cookie(request, SESSION, await seal(session), YEAR));
  return redirect(`${home}?signed_in=1`, headers);
}

async function status(request: Request) {
  if (!configured()) return json({ configured: false, user: null });
  const s = await unseal(cookies(request)[SESSION]);
  return json({ configured: true, user: s ? publicUser(s) : null });
}

async function token(request: Request) {
  const s = await unseal(cookies(request)[SESSION]);
  if (!s) return json({ error: 'signed_out' }, 401);
  const { ok, body } = await googleToken({ refresh_token: s.rt, grant_type: 'refresh_token' });
  if (!ok) {
    if (body.error === 'invalid_grant') {
      // Access was revoked or expired: the session, and the kept copy, are no good.
      if (s.uid) await dropGrant(s.uid);
      const headers = new Headers();
      headers.append('Set-Cookie', cookie(request, SESSION, '', 0));
      return json({ error: 'signed_out' }, 401, headers);
    }
    return json({ error: 'google_unavailable' }, 502);
  }
  return json({
    access_token: body.access_token,
    expires_in: body.expires_in,
    user: publicUser(s),
  });
}

/**
 * Signs out on this device only. Access stays granted, so signing in again
 * needs no new consent; it can be withdrawn in the Google account settings.
 */
function logout(request: Request) {
  const headers = new Headers();
  headers.append('Set-Cookie', cookie(request, SESSION, '', 0));
  return json({ ok: true }, 200, headers);
}

const action = (request: Request) => new URL(request.url).searchParams.get('action');

export async function GET(request: Request): Promise<Response> {
  const a = action(request);
  if (a === 'status') return status(request);
  if (!configured()) return json({ error: 'not_configured' }, 501);
  if (a === 'start') return start(request);
  if (a === 'callback') return callback(request);
  return json({ error: 'not_found' }, 404);
}

export async function POST(request: Request): Promise<Response> {
  if (!configured()) return json({ error: 'not_configured' }, 501);
  if (!sameOrigin(request)) return json({ error: 'forbidden' }, 403);
  const a = action(request);
  if (a === 'token') return token(request);
  if (a === 'logout') return logout(request);
  return json({ error: 'not_found' }, 404);
}
