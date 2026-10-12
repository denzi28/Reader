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

async function call(token: string, url: string, init: RequestInit = {}, attempt = 0): Promise<Response> {
  const res = await fetch(url, {
    ...init,
    headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) throw new AuthError('Google access expired.');
  if ((res.status === 429 || res.status >= 500 || res.status === 403) && attempt < 3) {
    const body = res.status === 403 ? await res.clone().text() : '';
    if (res.status !== 403 || /rate|quota/i.test(body)) {
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt + Math.random() * 300));
      return call(token, url, init, attempt + 1);
    }
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    if (/storageQuotaExceeded/.test(text)) throw new Error('Your Google Drive is full.');
    throw new Error(`Google Drive error ${res.status}`);
  }
  return res;
}

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
    const res = await call(token, `${API}/files?${params}`);
    const body = (await res.json()) as { files: RemoteFile[]; nextPageToken?: string };
    files.push(...body.files);
    pageToken = body.nextPageToken ?? '';
  } while (pageToken);
  return files;
}

export async function downloadBlob(token: string, id: string) {
  return (await call(token, `${API}/files/${id}?alt=media`)).blob();
}

export async function downloadJson<T>(token: string, id: string): Promise<T> {
  return (await call(token, `${API}/files/${id}?alt=media`)).json() as Promise<T>;
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
  const res = await call(token, `${UPLOAD}/files?uploadType=multipart&fields=${FIELDS}`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body: multipart,
  });
  return res.json() as Promise<RemoteFile>;
}

/** Large files go up in a resumable session (Drive's advice above 5 MB). */
async function createResumable(token: string, metadata: object, body: Blob): Promise<RemoteFile> {
  const start = await call(token, `${UPLOAD}/files?uploadType=resumable&fields=${FIELDS}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': body.type || 'application/octet-stream',
      'X-Upload-Content-Length': String(body.size),
    },
    body: JSON.stringify(metadata),
  });
  const session = start.headers.get('Location');
  if (!session) throw new Error('Google Drive did not accept the upload.');
  const res = await call(token, session, { method: 'PUT', body });
  return res.json() as Promise<RemoteFile>;
}

export async function updateFile(token: string, id: string, body: Blob): Promise<RemoteFile> {
  const res = await call(token, `${UPLOAD}/files/${id}?uploadType=media&fields=${FIELDS}`, {
    method: 'PATCH',
    headers: { 'Content-Type': body.type || 'application/octet-stream' },
    body,
  });
  return res.json() as Promise<RemoteFile>;
}

export async function deleteFile(token: string, id: string) {
  try {
    await call(token, `${API}/files/${id}`, { method: 'DELETE' });
  } catch (err) {
    if (!(err instanceof Error && /error 404/.test(err.message))) throw err;
  }
}

export async function whoAmI(token: string): Promise<{ email?: string; name?: string }> {
  const res = await call(token, `${API}/about?fields=user(displayName,emailAddress)`);
  const body = (await res.json()) as { user?: { displayName?: string; emailAddress?: string } };
  return { email: body.user?.emailAddress, name: body.user?.displayName };
}
