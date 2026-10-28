/*
 * Sellytics service worker.
 *
 * Only the app shell (HTML/CSS/JS/icons) is cached. API responses, auth
 * headers and cross-origin requests are always network-only, so a stale
 * cache can never show another user's data.
 */
const CACHE_NAME = 'sellytics-shell-v2';

const APP_SHELL = [
  '/',
  '/index.html',
  '/register.html',
  '/dashboard.html',
  '/privacy.html',
  '/terms.html',
  '/impressum.html',
  '/style.css',
  '/app.js',
  '/dashboard.js',
  '/support.js',
  '/pwa.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/img/logo.jpg',
  '/img/pin-1.jpg',
  '/img/pin-2.jpg',
  '/img/pin-3.jpg',
  '/img/pin-4.jpg',
  '/img/pin-5.jpg',
];

const APP_SHELL_PATHS = new Set(
  APP_SHELL.map((path) => (path === '/' ? '/index.html' : path)),
);

// Every API route lives under these prefixes. They must never be cached.
const API_PREFIXES = [
  '/api/',
  '/login',
  '/register',
  '/connect-printify',
  '/shop-stats',
  '/send-digest',
  '/daily-tips',
  '/delete-account',
  '/run-digest',
  '/contact',
  '/public-config',
  '/orders',
  '/alerts',
  '/push/',
  '/webhooks/',
];

function isApiRequest(url, request) {
  if (request.headers.has('authorization')) return true;
  return API_PREFIXES.some(
    (prefix) => url.pathname === prefix || url.pathname.startsWith(prefix),
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Only GET requests can be cached. POST /webhooks/printify, /contact, etc.
  // go straight to the network.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (isApiRequest(url, request)) return;

  // Navigations: try network, fall back to the cached page, then the shell.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const path = url.pathname === '/' ? '/index.html' : url.pathname;
          if (response.ok && APP_SHELL_PATHS.has(path)) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(path, copy));
          }
          return response;
        })
        .catch(async () => {
          const path = url.pathname === '/' ? '/index.html' : url.pathname;
          return (
            (await caches.match(path)) ||
            (await caches.match('/index.html')) ||
            (await caches.match('/dashboard.html'))
          );
        }),
    );
    return;
  }

  // Static app-shell assets only: cache-first.
  if (!APP_SHELL_PATHS.has(url.pathname)) return;

  event.respondWith(
    caches.match(url.pathname).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(url.pathname, copy));
        }
        return response;
      });
    }),
  );
});

// ---------- Web push notifications ----------
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (err) {
    payload = { body: event.data ? event.data.text() : '' };
  }

  const title = payload.title || 'Sellytics alert';
  const options = {
    body: payload.body || 'An order needs your attention.',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { url: payload.url || '/dashboard.html' },
    tag: payload.tag || 'sellytics-order-alert',
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/dashboard.html';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          if ('navigate' in client) {
            await client.navigate(target);
          }
          return client.focus();
        }
      }
      return self.clients.openWindow ? self.clients.openWindow(target) : undefined;
    }),
  );
});
