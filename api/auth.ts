// Google sign-in that lasts. The browser alone only ever gets hour-long access
// tokens; this function runs the OAuth code flow instead, so Google issues a
// refresh token. It is kept encrypted in an HttpOnly cookie (no database) and
// traded for a fresh access token whenever the app needs one.
//
//   GET  /api/auth/start     → Google's sign-in page
//   GET  /api/auth/callback  ← Google returns here; sets the session cookie
//   GET  /api/auth/status    → { configured, user }
//   POST /api/auth/token     → { access_token, expires_in, user }
//   POST /api/auth/logout    → revokes access and clears the cookie
//
// Environment: VITE_GOOGLE_CLIENT_ID (shared with the app), GOOGLE_CLIENT_SECRET,
// SESSION_SECRET (32 random bytes, base64). /api/auth/:action is rewritten to
// this file in vercel.json.

declare const process: { env: Record<string, string | undefined> };

const CLIENT_ID = process.env.VITE_GOOGLE_CLIENT_ID ?? process.env.GOOGLE_CLIENT_ID ?? '';
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? '';
const SESSION_SECRET = process.env.SESSION_SECRET ?? '';
const SCOPES = 'openid email profile https://www.googleapis.com/auth/drive.appdata';
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
}

const configured = () => Boolean(CLIENT_ID && CLIENT_SECRET && SESSION_SECRET);

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
  (keyPromise ??= crypto.subtle.importKey('raw', fromB64url(SESSION_SECRET), 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ]));

async function seal(session: Session) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(session));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(), data));
  const out = new Uint8Array(iv.length + sealed.length);
  out.set(iv);
  out.set(sealed, iv.length);
  return b64url(out);
}

async function unseal(value: string | undefined): Promise<Session | null> {
  if (!value) return null;
  try {
    const bytes = fromB64url(value);
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bytes.slice(0, 12) },
      await key(),
      bytes.slice(12),
    );
    return JSON.parse(new TextDecoder().decode(plain)) as Session;
  } catch {
    return null; // tampered with, or sealed with an older secret
  }
}

function userFromIdToken(idToken: string | undefined): User {
  if (!idToken) return {};
  try {
    const claims = JSON.parse(new TextDecoder().decode(fromB64url(idToken.split('.')[1])));
    return { email: claims.email, name: claims.name, picture: claims.picture };
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
    scope: SCOPES,
    access_type: 'offline',
    include_granted_scopes: 'true',
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

  let rt = body.refresh_token as string | undefined;
  rt ??= (await unseal(cookies(request)[SESSION]))?.rt;
  if (!rt) {
    // Signed in before without keeping the refresh token: ask once more.
    if (!state.endsWith('.c')) return redirect(`${origin(request)}/api/auth/start?consent=1`, headers);
    return redirect(`${home}?auth_error=no_refresh`, headers);
  }
  const session: Session = { rt, ...userFromIdToken(body.id_token as string | undefined) };
  headers.append('Set-Cookie', cookie(request, SESSION, await seal(session), YEAR));
  return redirect(`${home}?signed_in=1`, headers);
}

async function status(request: Request) {
  if (!configured()) return json({ configured: false, user: null });
  const s = await unseal(cookies(request)[SESSION]);
  return json({ configured: true, user: s ? { email: s.email, name: s.name, picture: s.picture } : null });
}

async function token(request: Request) {
  const s = await unseal(cookies(request)[SESSION]);
  if (!s) return json({ error: 'signed_out' }, 401);
  const { ok, body } = await googleToken({ refresh_token: s.rt, grant_type: 'refresh_token' });
  if (!ok) {
    if (body.error === 'invalid_grant') {
      // Access was revoked or expired: the session is no longer any good.
      const headers = new Headers();
      headers.append('Set-Cookie', cookie(request, SESSION, '', 0));
      return json({ error: 'signed_out' }, 401, headers);
    }
    return json({ error: 'google_unavailable' }, 502);
  }
  return json({
    access_token: body.access_token,
    expires_in: body.expires_in,
    user: { email: s.email, name: s.name, picture: s.picture },
  });
}

async function logout(request: Request) {
  const s = await unseal(cookies(request)[SESSION]);
  if (s) {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(s.rt)}`, {
      method: 'POST',
    }).catch(() => undefined);
  }
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
