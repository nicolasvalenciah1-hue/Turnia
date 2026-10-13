// Network-first shell. Auth redirects, API responses and customer data are never cached.
const CACHE = 'turnia-shell-v18';
const ASSETS = ['app.js', 'weekly-excel.js', 'styles.css', 'manifest.webmanifest', 'icon.svg'];
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => /^(propina|turnia)-shell-/.test(k) && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())
));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || event.request.mode === 'navigate' || url.search) return;
  if (!ASSETS.includes(url.pathname.split('/').pop())) return;
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok && !response.redirected && !response.headers.get('content-type')?.includes('text/html')) {
      const copy = response.clone(); event.waitUntil(caches.open(CACHE).then(c => c.put(event.request, copy)));
    }
    return response;
  }).catch(async () => (await caches.match(event.request)) || Response.error()));
});
