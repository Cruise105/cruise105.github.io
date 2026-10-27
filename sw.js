// Offline support for the launcher only. Its scope is the whole site, so it deliberately leaves every other
// address alone: each app has its own offline support, and a page this doesn't recognize goes straight to
// the network as if this weren't here.
const VERSION = 'launcher-v5';
const FILES = [
  '/', '/index.html', '/manifest.webmanifest', '/launcher/logo.webp', '/launcher/icon-192.png', '/launcher/icon-512.png',
  '/fonts/alegreya-latin-400-normal.woff2', '/fonts/alegreya-latin-800-normal.woff2',
  '/fonts/alegreya-sans-latin-400-normal.woff2', '/fonts/alegreya-sans-latin-500-normal.woff2',
  '/core/suite.js', '/core/live.js', '/core/views.js', '/core/effects.js',
];
const MINE = new Set(FILES);

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('launcher-') && k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || !MINE.has(url.pathname)) return;
  // newest copy when online (the launcher and core change), the saved one when offline
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
