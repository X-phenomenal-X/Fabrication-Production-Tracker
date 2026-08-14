/* Service worker: makes the tracker open with no signal.

   The published site is two files — the single self-contained
   Cutting-Tracker.html served as index.html, plus the manifest — so this is a
   much smaller problem than a service worker usually is. There is no asset
   graph to precache and no cache-busting to get right.

   Strategy is network-first for everything same-origin, with the cache as the
   offline fallback. That is the right way round for this site specifically:
   the whole app is one request, so "always fresh when online" costs a single
   round trip, and it removes the entire class of bug where somebody is looking
   at a stale build and cannot work out why their change is missing. The cache
   only ever answers when the network does not.

   Two things it deliberately does NOT touch:

   - anything cross-origin. Supabase is the sync transport, and a cached or
     delayed response there would mean the app quietly disagreeing with the
     cloud. Those requests are left entirely alone.
   - anything that is not a GET.

   VERSION is stamped by the Pages workflow at deploy time. Left as the literal
   placeholder when serving the repo directly, which is fine — the cache is
   still correct, it just is not renamed per deploy. */

const VERSION = '__BUILD__';
const CACHE = `cutting-${VERSION}`;

/* How long to wait for the network before falling back to the cache. Short
   enough that a phone with one bar in the far bay opens the app rather than
   hanging on a request that was never going to arrive. */
const NETWORK_TIMEOUT = 4000;

/* `navigator.onLine` only knows whether the device has a network interface.
   Shop Wi-Fi can be connected while the internet is unreachable, so remember
   whether the worker actually reached the server and tell every open tracker. */
let networkAvailable = true;

async function reportNetwork(online) {
  networkAvailable = online;
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of windows) client.postMessage({ type: 'bv-network', online });
}

self.addEventListener('install', (e) => {
  // Warm the cache with the app itself, so the very first time the signal
  // drops there is already something to serve.
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    try {
      await cache.addAll(['./', './index.html', './manifest.webmanifest']);
    } catch {
      // A missing manifest or a redirect on './' must not fail the install and
      // leave the app with no worker at all.
      try { await cache.add('./index.html'); } catch { /* nothing to warm */ }
    }
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith('cutting-') && name !== CACHE) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

/* The page asks for this when the user accepts an update, so the new worker
   takes over without waiting for every tab to close. */
self.addEventListener('message', (e) => {
  if (e.data === 'skip-waiting') self.skipWaiting();
  if (e.data === 'connection-status') {
    e.source?.postMessage({ type: 'bv-network', online: networkAvailable });
  }
});

function timeout(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error('slow')), ms));
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const res = await Promise.race([fetch(request), timeout(NETWORK_TIMEOUT)]);
    reportNetwork(true);
    // Opaque and error responses are not worth keeping; a 404 cached as the
    // app would be worse than no cache at all.
    if (res && res.ok && res.type === 'basic') cache.put(request, res.clone());
    return res;
  } catch {
    reportNetwork(false);
    const hit = await cache.match(request);
    if (hit) return hit;
    // A navigation to any route falls back to the app shell — the app is a
    // single page and reads its own hash, so index.html answers every URL.
    if (request.mode === 'navigate') {
      const shell = await cache.match('./index.html') || await cache.match('./');
      if (shell) return shell;
    }
    return new Response(
      '<!doctype html><meta charset=utf-8><title>Offline</title>'
      + '<body style="font:16px/1.5 system-ui;padding:40px;max-width:34em">'
      + '<h1>Not cached yet</h1><p>The tracker has not been opened on this '
      + 'device while online, so there is nothing stored to show. Open it once '
      + 'with a signal and it will work offline after that.</p>',
      { status: 503, headers: { 'content-type': 'text/html; charset=utf-8' } });
  }
}

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Cross-origin means Supabase: the sync transport, which must always be the
  // live network and never a cached answer.
  if (url.origin !== self.location.origin) return;

  e.respondWith(networkFirst(request));
});
