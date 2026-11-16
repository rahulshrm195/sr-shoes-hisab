// SR Shoes Hisab — Service Worker v20
// Keeps a copy of the app and its libraries on the device so the app
// still opens when the internet is down. Register data itself (Firestore)
// is never cached here — it always comes live from the server.

const VERSION = 'v20';
const SHELL   = 'hisab-shell-' + VERSION;   // the app's own files
const CDN     = 'hisab-cdn-v1';             // third-party libraries and fonts

const SHELL_FILES = ['/', '/manifest.json', '/icon-192.png', '/icon-512.png'];

const CDN_FILES = [
  'https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://cdn.jsdelivr.net/npm/firebase@10.12.0/firebase-app-compat.min.js',
  'https://cdn.jsdelivr.net/npm/firebase@10.12.0/firebase-auth-compat.min.js',
  'https://cdn.jsdelivr.net/npm/firebase@10.12.0/firebase-firestore-compat.min.js',
  'https://cdn.jsdelivr.net/npm/firebase@10.12.0/firebase-messaging-compat.min.js',
];

const CDN_HOSTS = ['cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

// Store one file; a failure must never stop the worker from installing
function precache(cacheName, url, skipIfPresent) {
  return caches.open(cacheName).then(cache =>
    (skipIfPresent ? cache.match(url) : Promise.resolve(null)).then(hit => {
      if (hit) return;
      return fetch(url, { cache: 'no-cache' }).then(res => {
        if (res && res.ok) return cache.put(url, res);
      });
    })
  ).catch(() => {});
}

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(Promise.all([
    ...SHELL_FILES.map(u => precache(SHELL, u, false)),
    ...CDN_FILES.map(u => precache(CDN, u, true)),
  ]));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== SHELL && k !== CDN).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function storeCopy(cacheName, request, res) {
  if (res && (res.ok || res.type === 'opaque')) {
    const clone = res.clone();
    caches.open(cacheName).then(c => c.put(request, clone)).catch(() => {});
  }
  return res;
}

// App's own files: always try the internet first so updates show at once;
// fall back to the saved copy when offline or when the network is too slow.
function networkFirst(request) {
  const isPage = request.mode === 'navigate';
  const cached = () => caches.match(request, { ignoreSearch: isPage })
    .then(hit => hit || (isPage ? caches.match('/') : undefined));

  const fromNetwork = fetch(request).then(res => storeCopy(SHELL, request, res));

  // If the network has not answered in 5 seconds and we have a copy, use it
  const slowFallback = new Promise(resolve => setTimeout(resolve, 5000))
    .then(cached)
    .then(hit => hit || fromNetwork);

  return Promise.race([fromNetwork, slowFallback])
    .catch(() => cached().then(hit => hit || Response.error()));
}

// Libraries and fonts: use the saved copy, download only if we don't have one
function cacheFirst(request, refresh) {
  return caches.match(request).then(hit => {
    const fromNetwork = () => fetch(request).then(res => storeCopy(CDN, request, res));
    if (hit) {
      if (refresh) fromNetwork().catch(() => {});
      return hit;
    }
    return fromNetwork();
  });
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    e.respondWith(networkFirst(req));
    return;
  }
  if (CDN_HOSTS.includes(url.hostname)) {
    // The font stylesheet can change, so refresh it in the background
    e.respondWith(cacheFirst(req, url.hostname === 'fonts.googleapis.com'));
    return;
  }
  // Everything else (Firestore, sign-in, email) goes straight to the network
});

self.addEventListener('push', e => {
  const data = e.data ? e.data.json() : {};
  e.waitUntil(
    self.registration.showNotification(data.title || 'SR Shoes Hisab', {
      body: data.body || 'Time to close the register!',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: 'sr-shoes',
      vibrate: [200, 100, 200]
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if (c.url.includes(self.location.origin)) { c.focus(); return; }
      }
      return clients.openWindow('/');
    })
  );
});
