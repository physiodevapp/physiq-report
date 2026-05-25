const CACHE = 'physiq-report-v1';

const APP_SHELL = [
  './',
  './index.html',
  './app.js',
  './manifest.json',
  './favicon.svg',
  './apple-touch-icon.png',
];

const NETWORK_ONLY_HOSTS = [
  'workers.dev',
];

const CDN_HOSTS = [
  'cdn.jsdelivr.net',
  'unpkg.com',
  'cdnjs.cloudflare.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  if (NETWORK_ONLY_HOSTS.some(h => url.hostname.includes(h))) return;

  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) {
        // For CDN resources, revalidate in background after serving from cache
        if (CDN_HOSTS.includes(url.hostname)) return cached;
        return cached;
      }
      return fetch(request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE).then(cache => cache.put(request, clone));
        }
        return response;
      });
    })
  );
});
