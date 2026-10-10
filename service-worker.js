/* Cache D7's own app shell only. Google Maps, tiles, Places, Directions,
   navigation, and route/report data are never stored in this cache. */
const SCOPE = self.registration.scope;
const CACHE_PREFIX = `d7-shell-${encodeURIComponent(new URL(SCOPE).pathname)}-`;
// Bump this version whenever any shell file changes in a release.
const CACHE_NAME = `${CACHE_PREFIX}v16`;
const SHELL_FILES = [
  './', 'index.html', 'styles.css', 'map-theme.js', 'app.js', 'manifest.webmanifest',
  'favicon.svg', 'favicon-32.png', 'favicon.ico',
  'icons/mark.svg', 'icons/mark-maskable.svg',
  'icons/icon-192.png', 'icons/icon-512.png',
  'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png',
];
const SHELL_URLS = SHELL_FILES.map(file => new URL(file, SCOPE).href);

self.addEventListener('install', event => {
  // All-or-nothing installation. Leave the previous shell usable if this fails.
  event.waitUntil(caches.open(CACHE_NAME).then(cache =>
    cache.addAll(SHELL_URLS.map(url => new Request(url, { cache: 'reload' })))));
  // Do not skipWaiting: an open app must keep one consistent shell version.
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  url.search = '';
  url.hash = '';
  if (!SHELL_URLS.includes(url.href)) return;
  // Cache-first keeps HTML, CSS and JS from the same installed release together.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    return await cache.match(url.href) || fetch(event.request);
  })());
});
