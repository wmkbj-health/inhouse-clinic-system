// This service worker exists only so the app qualifies as an installable
// PWA (Add to Home Screen / Install on desktop). It intentionally does NOT
// cache anything: an in-house clinic app needs every deploy to be visible
// immediately, and a caching layer here previously meant CSS/logo/JS
// updates only showed up after a manual hard refresh. Any Cache Storage
// left behind by older versions of this file is wiped on activation.
// No self.skipWaiting() here: an updated worker should sit in "waiting"
// until the page's own update-toast asks it to take over (see app.js),
// not force itself onto an active session the instant it finishes
// installing.
self.addEventListener('install', () => {});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return;
  // GitHub Pages serves same-origin assets with a several-minute
  // Cache-Control max-age. A plain fetch(event.request) still honors that
  // HTTP cache, so for up to that window a "network-first" SW can still
  // hand back a stale response without ever touching the network. Forcing
  // cache: 'reload' bypasses the browser's HTTP cache for this request
  // specifically (while still letting it store the fresh response), so a
  // deploy is visible on the very next load, not several minutes later.
  event.respondWith(fetch(event.request, { cache: 'reload' }).catch(() => fetch(event.request)));
});
