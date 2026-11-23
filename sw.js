// Line Games service worker: cache-first, versioned. Keep APP_VERSION literal equal to js/version.js (a test asserts this).
const APP_VERSION = '1.1.0';
const CACHE = 'lg-v' + APP_VERSION;
const PRECACHE = [
  './',
  'index.html',
  'rules.html',
  'manifest.webmanifest',
  'css/app.css',
  'css/quiz.css',
  'css/fonts/fredoka-latin-wght.woff2',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
  'js/version.js',
  'js/seed.js',
  'js/engine.js',
  'js/selftest.js',
  'js/store.js',
  'js/app.js',
  'js/ui-imposter.js',
  'js/ui-spyfall.js',
  'js/ui-bingo.js',
  'js/ui-wavelength.js',
  'js/ui-missions.js',
  'js/ui-quiz.js',
  'js/ui-trivia.js',
  'js/ui-ridetrivia.js',
  'js/ui-twotruths.js',
  'js/ui-overunder.js',
  'data/imposter.json',
  'data/spyfall.json',
  'data/bingo.json',
  'data/spectra.json',
  'data/missions.json',
  'data/trivia.json',
  'data/ridetrivia.json',
  'data/twotruths.json',
  'data/overunder.json',
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Atomic: any failed fetch rejects install, so a half-populated cache never activates.
    await Promise.all(PRECACHE.map(async url => {
      const res = await fetch(new Request(url, { cache: 'reload' }));
      if (!res.ok) throw new Error('precache ' + url + ' HTTP ' + res.status);
      // Browsers refuse redirected responses for navigations; store a clean copy.
      const clean = res.redirected ? new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers: res.headers }) : res;
      await cache.put(url, clean);
    }));
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('lg-v') && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      return await fetch(req);
    } catch (e) {
      if (req.mode === 'navigate') {
        const shell = await cache.match('index.html');
        if (shell) return shell;
      }
      throw e;
    }
  })());
});
