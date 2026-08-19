// NovaBalance Service Worker - enables PWA install
const CACHE_NAME = 'novabalance-v1';
const ASSETS = [
  '/',
  '/verify.html',
  '/logo.png',
  '/manifest.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  // Network first for API calls, cache fallback for assets
  if (event.request.url.includes('/api/') || event.request.url.includes('/.netlify/')) {
    event.respondWith(fetch(event.request).catch(() => new Response('offline', { status: 503 })));
  } else {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
  }
});
