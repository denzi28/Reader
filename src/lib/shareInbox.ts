// Files sent to Leafpage from outside (Android's Share sheet, or "Open with" on a computer) wait here until
// the reader says whether to keep them. The service worker puts them in this cache; the app lists them,
// asks, and then either takes them into the library or throws them away.
const CACHE = 'reader-share-inbox';
const PREFIX = '/__share/';
const KEEP_FOR = 24 * 60 * 60 * 1000; // a file nobody answered for a day is dropped

export interface Incoming {
  key: string;
  name: string;
  type: string;
  size: number;
}

const supported = () => typeof caches !== 'undefined';

/** The files waiting for an answer, oldest first. */
export async function listIncoming(): Promise<Incoming[]> {
  if (!supported()) return [];
  const cache = await caches.open(CACHE);
  const out: Incoming[] = [];
  for (const req of await cache.keys()) {
    const key = new URL(req.url).pathname;
    const at = Number(key.slice(PREFIX.length).split('-')[0]);
    if (!key.startsWith(PREFIX) || !at || Date.now() - at > KEEP_FOR) { await cache.delete(req); continue; }
    const res = await cache.match(req);
    if (!res) continue;
    let name = '';
    try { name = decodeURIComponent(res.headers.get('X-Name') ?? ''); } catch { /* keep it empty */ }
    out.push({ key, name: name || 'Document', type: res.headers.get('Content-Type') ?? '', size: Number(res.headers.get('Content-Length') ?? 0) });
  }
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

/** The waiting files as files; they leave the inbox. */
export async function takeIncoming(items: Incoming[]): Promise<File[]> {
  const cache = await caches.open(CACHE);
  const files: File[] = [];
  for (const item of items) {
    const res = await cache.match(item.key);
    if (!res) continue;
    files.push(new File([await res.blob()], item.name, { type: item.type }));
    await cache.delete(item.key);
  }
  return files;
}

export async function dropIncoming(items: Incoming[]): Promise<void> {
  if (!supported()) return;
  const cache = await caches.open(CACHE);
  await Promise.all(items.map((i) => cache.delete(i.key)));
}

/** Files that arrived by another way than the service worker (a computer's "Open with"). */
export async function addIncoming(files: File[]): Promise<void> {
  if (!supported() || !files.length) return;
  const cache = await caches.open(CACHE);
  const now = Date.now();
  await Promise.all(files.map((f, i) => cache.put(
    `${PREFIX}${now}-${i}`,
    new Response(f, { headers: { 'Content-Type': f.type || 'application/octet-stream', 'Content-Length': String(f.size), 'X-Name': encodeURIComponent(f.name) } }),
  )));
  window.dispatchEvent(new Event('leafpage:incoming'));
}
