// A small client for the Drive REST API, limited to the app's hidden folder
// ("appDataFolder"), which only this app can see and which counts against the
// user's own Drive storage.

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FIELDS = 'id,name,modifiedTime,size';
const MULTIPART_LIMIT = 5 * 1024 * 1024;

export interface RemoteFile {
  id: string;
  name: string;
  modifiedTime: string;
  size?: string;
}

/** The token was rejected; the user has to grant access again. */
export class AuthError extends Error {}
/** Google did not answer in time. */
export class TimeoutError extends Error {}
/** The request was stopped on purpose (e.g. signing out). */
export class CancelledError extends Error {}

// Every request can be stopped at once, so signing out never waits on a
// request that is stuck.
let cancel = new AbortController();
export function cancelAll() {
  cancel.abort();
  cancel = new AbortController();
}

/** Time allowed for a request: generous for big uploads, short otherwise. */
function allowance(init: RequestInit) {
  const size = init.body instanceof Blob ? init.body.size : 0;
  return 30_000 + size / 50; // plus 1 s per 50 KB sent
}

/** How long a download may go without receiving anything before giving up. */
const STALL_MS = 30_000;

/**
 * One Drive request, read to the end with `read`, within a time limit.
 * `read` may call `alive()` as data arrives: the limit then counts from the
 * last data received, so big downloads on any connection can finish.
 * Rate limits and server errors are retried with backoff.
 */
async function request<T>(
  token: string,
  url: string,
  init: RequestInit,
  read: (res: Response, alive: () => void) => Promise<T>,
  attempt = 0,
): Promise<T> {
  const ctl = new AbortController();
  const outer = cancel.signal;
  const stop = () => ctl.abort();
  if (outer.aborted) throw new CancelledError('Cancelled');
  outer.addEventListener('abort', stop, { once: true });
  let timedOut = false;
  let timer = 0;
  const arm = (ms: number) => {
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      timedOut = true;
      ctl.abort();
    }, ms);
  };
  arm(allowance(init));
  try {
    const res = await fetch(url, {
      ...init,
      signal: ctl.signal,
      headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) throw new AuthError('Google access expired.');
    if ((res.status === 429 || res.status >= 500 || res.status === 403) && attempt < 3) {
      const body = res.status === 403 ? await res.clone().text() : '';
      if (res.status !== 403 || /rate|quota/i.test(body)) {
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt + Math.random() * 300));
        return request(token, url, init, read, attempt + 1);
      }
    }
    if (!res.ok) throw new Error(await explain(res));
    return await read(res, () => arm(STALL_MS));
  } catch (err) {
    if (ctl.signal.aborted) {
      throw timedOut
        ? new TimeoutError('Google Drive is not responding. Sync will try again shortly.')
        : new CancelledError('Cancelled');
    }
    throw err;
  } finally {
    clearTimeout(timer);
    outer.removeEventListener('abort', stop);
  }
}

/** Google's own reason for a failed request, in words a person can act on. */
async function explain(res: Response) {
  const text = await res.text().catch(() => '');
  if (/storageQuotaExceeded/.test(text)) return 'Your Google Drive is full.';
  try {
    const message = (JSON.parse(text) as { error?: { message?: string } }).error?.message;
    if (message) return `Google Drive: ${message}`;
  } catch { /* not JSON */ }
  return `Google Drive error ${res.status}`;
}

const asJson = <T>(res: Response) => res.json() as Promise<T>;

export async function listFiles(token: string, nameContains?: string): Promise<RemoteFile[]> {
  const files: RemoteFile[] = [];
  let pageToken = '';
  do {
    const params = new URLSearchParams({
      spaces: 'appDataFolder',
      fields: `nextPageToken,files(${FIELDS})`,
      pageSize: '1000',
    });
    if (nameContains) params.set('q', `name contains '${nameContains.replace(/'/g, '')}'`);
    if (pageToken) params.set('pageToken', pageToken);
    const body = await request(token, `${API}/files?${params}`, {}, asJson<{ files: RemoteFile[]; nextPageToken?: string }>);
    files.push(...body.files);
    pageToken = body.nextPageToken ?? '';
  } while (pageToken);
  return files;
}

export function downloadBlob(token: string, id: string) {
  return request(token, `${API}/files/${id}?alt=media`, {}, (res) => res.blob());
}

/** Downloads a file as it streams in, reporting progress (0 to 1). */
export function downloadWithProgress(
  token: string,
  file: RemoteFile,
  onProgress: (fraction: number) => void,
): Promise<Blob> {
  return request(token, `${API}/files/${file.id}?alt=media`, {}, async (res, alive) => {
    const total = Number(res.headers.get('content-length')) || Number(file.size) || 0;
    if (!res.body) return res.blob();
    const reader = res.body.getReader();
    const parts: Uint8Array<ArrayBuffer>[] = [];
    let received = 0;
    alive();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      parts.push(value);
      received += value.length;
      alive();
      if (total) onProgress(Math.min(1, received / total));
    }
    return new Blob(parts, { type: res.headers.get('content-type') ?? 'application/octet-stream' });
  });
}

export function downloadJson<T>(token: string, id: string): Promise<T> {
  return request(token, `${API}/files/${id}?alt=media`, {}, asJson<T>);
}

export async function createFile(token: string, name: string, body: Blob): Promise<RemoteFile> {
  const metadata = { name, parents: ['appDataFolder'], mimeType: body.type || 'application/octet-stream' };
  if (body.size > MULTIPART_LIMIT) return createResumable(token, metadata, body);
  const boundary = `reader${Math.random().toString(36).slice(2)}`;
  const multipart = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
    JSON.stringify(metadata),
    `\r\n--${boundary}\r\nContent-Type: ${metadata.mimeType}\r\n\r\n`,
    body,
    `\r\n--${boundary}--`,
  ]);
  return request(
    token,
    `${UPLOAD}/files?uploadType=multipart&fields=${FIELDS}`,
    { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body: multipart },
    asJson<RemoteFile>,
  );
}

/** Large files go up in a resumable session (Drive's advice above 5 MB). */
async function createResumable(token: string, metadata: object, body: Blob): Promise<RemoteFile> {
  const session = await request(
    token,
    `${UPLOAD}/files?uploadType=resumable&fields=${FIELDS}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': body.type || 'application/octet-stream',
        'X-Upload-Content-Length': String(body.size),
      },
      body: JSON.stringify(metadata),
    },
    async (res) => res.headers.get('Location'),
  );
  if (!session) throw new Error('Google Drive did not accept the upload.');
  return request(token, session, { method: 'PUT', body }, asJson<RemoteFile>);
}

export async function updateFile(token: string, id: string, body: Blob): Promise<RemoteFile> {
  return request(
    token,
    `${UPLOAD}/files/${id}?uploadType=media&fields=${FIELDS}`,
    { method: 'PATCH', headers: { 'Content-Type': body.type || 'application/octet-stream' }, body },
    asJson<RemoteFile>,
  );
}

export async function deleteFile(token: string, id: string) {
  try {
    await request(token, `${API}/files/${id}`, { method: 'DELETE' }, async () => undefined);
  } catch (err) {
    if (!(err instanceof Error && /404|not found/i.test(err.message))) throw err;
  }
}

export async function whoAmI(token: string): Promise<{ email?: string; name?: string }> {
  const body = await request(
    token,
    `${API}/about?fields=user(displayName,emailAddress)`,
    {},
    asJson<{ user?: { displayName?: string; emailAddress?: string } }>,
  );
  return { email: body.user?.emailAddress, name: body.user?.displayName };
}
