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
  event.respondWith(fetch(event.request));
});
