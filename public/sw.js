const CACHE_NAME = 'vortex-v1';
const STATIC_ASSETS = [
  '/',
  '/css/style.css',
  '/js/renderer.js',
  '/js/game.js',
  '/js/network.js',
  '/js/main.js',
  '/manifest.json'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  // Network first for API calls & socket.io, cache first for static assets
  if (e.request.url.includes('/api/') || e.request.url.includes('/socket.io/')) {
    return;
  }
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
