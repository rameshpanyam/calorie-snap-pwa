// Calorie Snap — Service Worker
// Strategy: network-first for navigation + HTML (always pick up latest shell),
// cache-first for static immutable assets (versioned via ?v= query string),
// passthrough for external APIs.
const CACHE_NAME = 'calorie-snap-v1.0.3';
const BASE = self.registration.scope;
const SHELL = [
  BASE,
  BASE + 'index.html',
  BASE + 'style.css?v=1.0.3',
  BASE + 'app.js?v=1.0.3',
  BASE + 'features.js?v=1.0.3',
  BASE + 'foods-db.json?v=1.0.3',
  BASE + 'manifest.json',
];

self.addEventListener('install', e => {
  // Don't fail install if one asset can't be cached (e.g., 404 during deploy).
  e.waitUntil(
    caches.open(CACHE_NAME).then(c =>
      Promise.all(SHELL.map(url =>
        fetch(url, { cache: 'no-cache' }).then(r => r.ok && c.put(url, r)).catch(() => null)
      ))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Message channel — let pages force-refresh the SW from the app.
self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = event.request.url;
  // Passthrough for external APIs
  if (url.includes('generativelanguage.googleapis.com') ||
      url.includes('openfoodfacts.org') ||
      url.includes('sheets.googleapis.com') ||
      url.includes('accounts.google.com') ||
      url.includes('cdn.jsdelivr.net')) return;

  const isNavigate = event.request.mode === 'navigate' || event.request.destination === 'document';

  // Network-first for HTML / navigation so a deploy lands immediately.
  if (isNavigate) {
    event.respondWith(
      fetch(event.request).then(res => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
        return res;
      }).catch(() => caches.match(event.request).then(c => c || caches.match(BASE + 'index.html')))
    );
    return;
  }

  // Cache-first for everything else (versioned assets, fonts, JSON, etc).
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(res => {
        if (res.ok && url.startsWith(self.location.origin)) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
        }
        return res;
      }).catch(() => null);
    })
  );
});
