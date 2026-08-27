/* Online-first service worker for the modular hosted app.

   Same-origin GETs prefer the network and fall back to the current build's
   cache. The generated Pages artifact injects its asset list below. The large
   extrusion image library is intentionally absent from that warm-up list: it
   is cached by networkFirst only after somebody opens an individual drawing.

   Cross-origin requests are Supabase sync traffic and are never intercepted.
   Caching one of those responses could make this device quietly disagree with
   the shared state. */

const VERSION = '__BUILD__';
const CACHE = `cutting-${VERSION}`;
const PRECACHE = /* __PRECACHE_START__ */ [
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
] /* __PRECACHE_END__ */;

const NETWORK_TIMEOUT = 4000;
let networkAvailable = true;

async function reportNetwork(online) {
  if (networkAvailable === online) return;
  networkAvailable = online;
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of windows) client.postMessage({ type: 'bv-network', online });
}

self.addEventListener('install', (event) => {
  /* Installation is atomic: either this build's complete operational shell is
     ready offline, or the older worker remains in charge. */
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith('cutting-') && name !== CACHE) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
  if (event.data === 'connection-status') {
    event.source?.postMessage({ type: 'bv-network', online: networkAvailable });
  }
});

function timeout(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error('slow')), ms));
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await Promise.race([fetch(request), timeout(NETWORK_TIMEOUT)]);
    reportNetwork(true);
    if (response?.ok && response.type === 'basic') {
      const url = new URL(request.url);
      if (!url.searchParams.has('connection-check')) await cache.put(request, response.clone());
    }
    return response;
  } catch {
    reportNetwork(false);
    const hit = await cache.match(request, { ignoreSearch: true });
    if (hit) return hit;
    if (request.mode === 'navigate') {
      const shell = await cache.match('./index.html');
      if (shell) return shell;
    }
    return new Response(
      '<!doctype html><meta charset=utf-8><title>Offline</title>'
      + '<body style="font:16px/1.5 system-ui;padding:40px;max-width:34em">'
      + '<h1>Not cached yet</h1><p>This feature has not been opened on this '
      + 'device while online. Reconnect once to download it; the daily '
      + 'production pages and saved work remain available.</p>',
      { status: 503, headers: { 'content-type': 'text/html; charset=utf-8' } });
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(networkFirst(request));
});
