const CACHE_NAME = 'ics-clinic-v3';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/app.js',
  './js/auth.js',
  './js/api.js',
  './js/state.js',
  './js/print.js',
  './js/realtime.js',
  './js/util.js',
  './js/supabaseClient.js',
  './js/supabase-config.js',
  './js/views/login.js',
  './js/views/akun.js',
  './js/views/dashboard.js',
  './js/views/apotek.js',
  './js/views/pasien.js',
  './js/views/rujukan.js',
  './js/views/kecelakaan.js',
  './js/views/suratsakit.js',
  './assets/icon.svg'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
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
