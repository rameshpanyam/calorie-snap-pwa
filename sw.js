// Calorie Snap — Service Worker
// Cache-first for shell, network-first for everything else.
const CACHE_NAME = 'calorie-snap-v1.0.1';
const BASE = self.registration.scope;
const SHELL = [
  BASE,
  BASE + 'index.html',
  BASE + 'style.css?v=1.0.1',
  BASE + 'app.js?v=1.0.1',
  BASE + 'features.js?v=1.0.1',
  BASE + 'foods-db.json?v=1.0.1',
  BASE + 'manifest.json',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  // Don't intercept Gemini or Open Food Facts API calls — let them pass through.
  const url = event.request.url;
  if (url.includes('generativelanguage.googleapis.com') ||
      url.includes('openfoodfacts.org') ||
      url.includes('sheets.googleapis.com') ||
      url.includes('accounts.google.com')) return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(res => {
        if (res.ok && url.startsWith(self.location.origin)) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
        }
        return res;
      }).catch(() => {
        if (event.request.mode === 'navigate') {
          return caches.match(self.registration.scope + 'index.html');
        }
      });
    })
  );
});
