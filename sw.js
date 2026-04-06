const CACHE_NAME = 'ppl-static-v2';
const ALLOWED_EXTERNAL_HOSTS = new Set([
  'unpkg.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'basemaps.cartocdn.com',
  'tile.openstreetmap.org'
]);

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== 'GET') {
    return;
  }

  const isSameOrigin = url.origin === self.location.origin;
  const isAllowedExternal = ALLOWED_EXTERNAL_HOSTS.has(url.hostname);

  if (!isSameOrigin && !isAllowedExternal) {
    return;
  }

  const canCacheRequest =
    request.mode === 'navigate' ||
    ['document', 'iframe', 'script', 'style', 'image', 'font'].includes(request.destination);

  if (!canCacheRequest) {
    return;
  }

  event.respondWith(
    caches.open(CACHE_NAME).then((cache) =>
      cache.match(request).then((cachedResponse) => {
        const networkFetch = fetch(request)
          .then((networkResponse) => {
            if (networkResponse.ok || networkResponse.type === 'opaque') {
              cache.put(request, networkResponse.clone());
            }
            return networkResponse;
          })
          .catch(() => cachedResponse);

        return cachedResponse || networkFetch;
      })
    )
  );
});
