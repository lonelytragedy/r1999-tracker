const CACHE = 'r1999-tracker-v1';

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
  'https://cdn.jsdelivr.net/npm/chart.js@4'
];

const NETWORK_ONLY = /accounts\.google\.com|googleapis\.com|workers\.dev/;

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(CORE.map(u => new Request(u, { cache: 'reload' }))))
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

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await fetch(req);
      if (res && res.ok) cache.put(req, res.clone());
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
