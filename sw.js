const CACHE        = 'r1999-tracker-v15';
const STATIC_CACHE = 'r1999-static-v1';
const NET_WAIT_MS  = 3500;

const CORE = [
  './',
  'index.html',
  'styles.css',
  'lang-init.js',
  'database.js',
  'net.js',
  'gdrive.js',
  'icons.js',
  'scripts.js',
  'guide.html',
  'localization/en.js',
  'localization/ru.js',
  'https://cdn.jsdelivr.net/npm/chart.js@4'
];

const STATIC_CORE = [
  'static/fonts/playfair-latin.woff2',
  'static/fonts/playfair-cyrillic.woff2',
  'static/ui/flourish.svg',
  'static/ui/logo-r.svg',
  'static/ui/favicon-r.svg',
  'static/ui/favicon.ico',
  'static/ui/flag_ru.png',
  'static/ui/flag_en.png',
  'static/ui/ClearDrop.webp',
  'static/ui/gdrive.png',
  'static/banners/noimage.webp'
];

const NETWORK_ONLY = /accounts\.google\.com|googleapis\.com|workers\.dev/;
const STATIC_ASSET = /\/static\/.+\.(webp|png|svg|ico|woff2)$/;

function precache(name, urls) {
  return caches.open(name).then(cache => Promise.allSettled(
    urls.map(u => cache.add(new Request(u, { cache: 'reload' })))
  ));
}

async function cacheFirst(req) {
  const cache  = await caches.open(STATIC_CACHE);
  const cached = await cache.match(req, { ignoreSearch: true });
  if (cached) return cached;
  const res = await fetch(req);
  if (res && res.ok) cache.put(req, res.clone());
  return res;
}

async function networkFirst(req) {
  const cache      = await caches.open(CACHE);
  const sameOrigin = new URL(req.url).origin === self.location.origin;
  const netReq = !sameOrigin ? req
    : req.mode === 'navigate' ? new Request(req.url, { cache: 'no-cache', credentials: 'same-origin' })
    : new Request(req, { cache: 'no-cache' });

  const fallback = async () => {
    const cached = await cache.match(req);
    if (cached) return cached;
    if (req.mode === 'navigate') {
      return (await cache.match('index.html')) || (await cache.match('./')) || null;
    }
    return null;
  };

  const network = fetch(netReq).then(res => {
    if (res && res.ok && sameOrigin) cache.put(req, res.clone());
    return res;
  });
  network.catch(() => {});

  const timedOut = new Promise(resolve => setTimeout(() => resolve('timeout'), NET_WAIT_MS));
  try {
    const first = await Promise.race([network, timedOut]);
    if (first !== 'timeout') return first;
    const cached = await fallback();
    if (cached) return cached;
    return await network;
  } catch (err) {
    const cached = await fallback();
    if (cached) return cached;
    throw err;
  }
}

self.addEventListener('install', event => {
  event.waitUntil(
    Promise.all([precache(CACHE, CORE), precache(STATIC_CACHE, STATIC_CORE)])
      .catch(() => {})
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== STATIC_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  const urls = event.data && event.data.type === 'cache-static' && Array.isArray(event.data.urls) ? event.data.urls : null;
  if (!urls) return;
  event.waitUntil(caches.open(STATIC_CACHE).then(async cache => {
    for (const u of urls) {
      if (await cache.match(u)) continue;
      try {
        const res = await fetch(u);
        if (res && res.ok) await cache.put(u, res);
      } catch (_) {}
    }
  }));
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
  event.respondWith(networkFirst(req));
});
