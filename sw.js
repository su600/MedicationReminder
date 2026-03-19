/* Service Worker for 用药助手 PWA */
const CACHE_NAME = 'medication-reminder-v11';

/* Build absolute URLs relative to the SW scope so the app works
   from any subpath (e.g. GitHub Pages /repo-name/). */
function scopeUrl(rel) {
  return new URL(rel, self.registration.scope).href;
}

const ASSET_PATHS = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/db.js',
  './js/ai.js',
  './js/app.js',
  './icons/icon-16.png',
  './icons/icon-32.png',
  './icons/icon-48.png',
  './icons/icon-72.png',
  './icons/icon-96.png',
  './icons/icon-144.png',
  './icons/icon-192.png',
  './icons/icon-512.png'
];
const ASSETS_TO_CACHE = ASSET_PATHS.map((p) => scopeUrl(p));

/* Install: cache all app shell assets */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE))
  );
  self.skipWaiting();
});

/* Activate: clean up old caches */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

/* Fetch: serve from cache, fallback to network */
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          if (response && response.status === 200 && response.type === 'basic') {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(scopeUrl('./index.html')));
    })
  );
});

/* Push: show notification */
self.addEventListener('push', (event) => {
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch (_) {
      data = { body: event.data.text() };
    }
  }
  const title = data.title || '用药提醒 💊';
  const options = {
    body: data.body || '该服药了！',
    icon: scopeUrl('./icons/icon-192.png'),
    badge: scopeUrl('./icons/icon-192.png'),
    tag: data.tag || 'medication',
    renotify: true,
    requireInteraction: true,
    data: data,
    actions: [
      { action: 'taken', title: '已服药 ✓' },
      { action: 'snooze', title: '15分钟后提醒' }
    ]
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

/* Notification click */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const action = event.action;
  const data = event.notification.data || {};

  if (action === 'taken') {
    event.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
        clients.forEach((c) => c.postMessage({ type: 'MARK_TAKEN', data }));
        if (clients.length === 0) return self.clients.openWindow(self.registration.scope);
      })
    );
  } else if (action === 'snooze') {
    /* Service workers can be terminated at any time, so setTimeout is unreliable.
       Delegate the snooze timer to the page. If a page client is open, send it a
       SNOOZE message so it can schedule a reliable local notification. If no page
       is open we open one so it can handle the request. */
    event.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
        const snoozeMsg = {
          type: 'SNOOZE',
          data: {
            ...data,
            snoozeMs: 15 * 60 * 1000,
            title: event.notification.title,
            body: event.notification.body
          }
        };
        if (clients.length > 0) {
          clients.forEach((c) => c.postMessage(snoozeMsg));
        } else {
          // Open the app so it can handle the snooze on load
          const snoozeUrl = new URL('./', self.registration.scope);
          snoozeUrl.searchParams.set('snooze', JSON.stringify(snoozeMsg.data));
          self.clients.openWindow(snoozeUrl.href);
        }
      })
    );
  } else {
    event.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
        if (clients.length > 0) {
          clients[0].focus();
        } else {
          self.clients.openWindow(self.registration.scope);
        }
      })
    );
  }
});

/* Message from page */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
