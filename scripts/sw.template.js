// The Reader's service worker: the app opens with no connection. The built files
// are kept when it is installed; pdf.js data files are kept as they are used.
// Sign-in (/api) and Google are never touched. The build fills in the lists below.
const VERSION = '__VERSION__';
const SHELL = `reader-shell-${VERSION}`;
const RUNTIME = 'reader-runtime-v1';
const PRECACHE = __PRECACHE__;
// A server's "Vary: Origin" must not make a kept file look like a different one.
const MATCH = { ignoreVary: true };

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL).then((cache) => cache.addAll(PRECACHE.map((url) => new Request(url, { cache: 'reload' })))),
  );
  // No skipWaiting here: a new version waits until the reader says "reload".
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Keep this version and the one before it, so a tab still on the old build can finish loading.
    const shells = (await caches.keys()).filter((k) => k.startsWith('reader-shell-')).sort();
    await Promise.all(shells.slice(0, -2).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

async function networkFirst(request, fallbackUrl) {
  try {
    const res = await fetch(request);
    if (res.ok && request.url.startsWith(self.location.origin)) {
      const cache = await caches.open(RUNTIME);
      void cache.put(request, res.clone());
    }
    return res;
  } catch {
    return (await caches.match(request, MATCH)) || (fallbackUrl && (await caches.match(fallbackUrl, MATCH))) || Response.error();
  }
}

async function cacheFirst(request) {
  const hit = await caches.match(request, MATCH);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) void caches.open(RUNTIME).then((cache) => cache.put(request, res.clone()));
  return res;
}

async function staleWhileRevalidate(request) {
  const hit = await caches.match(request, MATCH);
  const fresh = fetch(request).then((res) => {
    if (res.ok) void caches.open(RUNTIME).then((cache) => cache.put(request, res.clone()));
    return res;
  }).catch(() => undefined);
  return hit || (await fresh) || Response.error();
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // Google, fonts: left alone
  if (url.pathname.startsWith('/api/')) return; // sign-in always goes to the network
  if (request.mode === 'navigate') {
    // The app itself: fresh when there is a connection, the kept copy when there is not.
    event.respondWith(networkFirst(request, url.pathname === '/privacy.html' || url.pathname === '/terms.html' ? undefined : '/'));
  } else if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request)); // hashed names: a file never changes
  } else {
    event.respondWith(staleWhileRevalidate(request));
  }
});
