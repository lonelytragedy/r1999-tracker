const CACHE = 'r1999-tracker-v10';

const CORE = [
  './',
  'index.html',
  'styles.css',
  'lang-init.js',
  'database.js',
  'gdrive.js',
  'scripts.js',
  'localization/en.js',
  'localization/ru.js',
  'static/fonts/playfair-latin.woff2',
  'static/fonts/playfair-cyrillic.woff2',
  'static/ui/flourish.svg',
  'https://cdn.jsdelivr.net/npm/chart.js@4'
];

const NETWORK_ONLY = /accounts\.google\.com|googleapis\.com|workers\.dev/;
const STATIC_ASSET = /\/static\/.+\.(webp|png|svg|ico|woff2)$/;

async function cacheFirst(req) {
  const cache  = await caches.open(CACHE);
  const cached = await cache.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  if (res && res.ok) cache.put(req, res.clone());
  return res;
}

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => Promise.allSettled(
        CORE.map(u => cache.add(new Request(u, { cache: 'reload' })))
      ))
      .catch(() => {})
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  if (NETWORK_ONLY.test(req.url)) return;

  const url = new URL(req.url);
  if (url.origin === self.location.origin && STATIC_ASSET.test(url.pathname)) {
    event.respondWith(cacheFirst(req));
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await fetch(req);
      if (res && res.ok && new URL(req.url).origin === self.location.origin) {
        cache.put(req, res.clone());
      }
      return res;
    } catch (err) {
      const cached = await cache.match(req);
      if (cached) return cached;
      if (req.mode === 'navigate') {
        const shell = (await cache.match('index.html')) || (await cache.match('./'));
        if (shell) return shell;
      }
      throw err;
    }
  })());
});
