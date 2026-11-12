/// <reference lib="webworker" />

const CACHE_NAME = 'geek-ledger-shell-v1';
const CORE_SHELL_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icon.svg',
];

// Install: pre-cache static shell assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(CORE_SHELL_ASSETS))
      .then(() => self.skipWaiting())
      .catch((err) => {
        console.warn('[SW] Core asset pre-caching failed:', err);
      })
  );
});

// Activate: purge obsolete cache versions and take control immediately
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames.map((name) => {
            if (name !== CACHE_NAME) {
              return caches.delete(name);
            }
            return Promise.resolve(false);
          })
        )
      )
      .then(() => self.clients.claim())
  );
});

// Fetch routing strategy
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Only handle GET requests and http/https schemes
  if (request.method !== 'GET' || !url.protocol.startsWith('http')) {
    return;
  }

  // Strategy 1: Network-First for API routes (/api/*) without blocking offline operation
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
          }
          return networkResponse;
        })
        .catch(async () => {
          // Check cached response first
          const cachedResponse = await caches.match(request);
          if (cachedResponse) {
            return cachedResponse;
          }
          // Non-blocking offline JSON response
          return new Response(
            JSON.stringify({
              offline: true,
              status: 'offline',
              message: 'Local-first offline replica active. Node operating in offline mode.',
              timestamp: Date.now(),
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }
          );
        })
    );
    return;
  }

  // Strategy 2: Navigation requests (HTML documents) -> Stale-While-Revalidate with /index.html fallback
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
          return networkResponse;
        })
        .catch(async () => {
          const cachedPage = await caches.match(request);
          if (cachedPage) return cachedPage;
          const fallbackShell = await caches.match('/index.html');
          if (fallbackShell) return fallbackShell;
          return new Response('<h1>GeekLedger Offline</h1><p>Application shell is loading...</p>', {
            headers: { 'Content-Type': 'text/html' },
          });
        })
    );
    return;
  }

  // Strategy 3: Stale-While-Revalidate / Cache-First for static assets (JS, CSS, SVGs, Fonts)
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      const fetchPromise = fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
          }
          return networkResponse;
        })
        .catch(() => {
          // If network fails and no cached response exists, swallow error safely
          return null;
        });

      return cachedResponse || fetchPromise.then((res) => res || new Response('', { status: 404 }));
    })
  );
});
