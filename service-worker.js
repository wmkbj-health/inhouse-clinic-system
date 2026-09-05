const CACHE_NAME = 'ics-clinic-v4';
const STATIC_ASSETS = [
  './manifest.json',
  './css/style.css',
  './assets/app-icon.png',
  './assets/app-icon-192.png',
  './assets/favicon-32.png',
  './assets/logos/wsl.png',
  './assets/logos/mti.png',
  './assets/logos/kmf.png',
  './assets/logos/bios.png',
  './assets/logos/jla.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

// Network-first for navigations and app code (HTML/JS/JSON) so a deploy is
// picked up on the very next load; cache-first for static images/CSS only.
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return;

  const isAppCode = event.request.mode === 'navigate' ||
    /\.(js|json|html)$/.test(url.pathname) ||
    url.pathname === '/' || url.pathname.endsWith('/');

  if (isAppCode) {
    event.respondWith(
      fetch(event.request).then(res => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return res;
      }).catch(() => caches.match(event.request))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(res => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return res;
      }).catch(() => cached);
    })
  );
});
