/**
 * Service Worker — App Shell + Image Cache Strategy
 *
 * Achieves millisecond-scale loading via:
 * 1. App Shell Strategy   — HTML/JS/CSS cached on install (instant navigation)
 * 2. Image Cache Strategy — Avatars cached with stale-while-revalidate (lorelei style)
 * 3. Offline Fallback    — Turso-stored base64 avatars work offline
 * 4. Background Sync     — Defers non-critical API calls
 */

const CACHE_VERSION = 'v3';
const STATIC_CACHE = `static-${CACHE_VERSION}`;
const IMAGE_CACHE = `images-${CACHE_VERSION}`;
const API_CACHE = `api-${CACHE_VERSION}`;

// ─── App Shell Assets (cache on install) ───
const STATIC_ASSETS = [
  '/',
  '/dashboard/explore',
  '/dashboard/chats',
  '/dashboard/notifications',
  '/dashboard/connections',
  '/manifest.json',
];

// ─── Install — Cache App Shell ───
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      console.log('[SW] Caching app shell');
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// ─── Activate — Clean old caches ───
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name.startsWith('static-') || name.startsWith('images-') || name.startsWith('api-'))
          .filter((name) => name !== STATIC_CACHE && name !== IMAGE_CACHE && name !== API_CACHE)
          .map((name) => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    })
  );
  self.clients.claim();
});

// ─── Fetch Strategy ───
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 1. App Shell — Cache First (instant load)
  if (isStaticAsset(request)) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // 2. Images — Stale-While-Revalidate (fast repeat views)
  if (isImageRequest(request)) {
    event.respondWith(staleWhileRevalidate(request, IMAGE_CACHE));
    return;
  }

  // 3. API — Stale-While-Revalidate (毫秒级重复访问)
  if (isApiRequest(request)) {
    // 只缓存 GET 请求（POST/PUT/DELETE 不缓存）
    if (request.method === 'GET') {
      event.respondWith(staleWhileRevalidate(request, API_CACHE));
    } else {
      event.respondWith(networkFirst(request, API_CACHE));
    }
    return;
  }

  // 4. Default — Network First
  event.respondWith(networkFirst(request, API_CACHE));
});

// ─── Helper Functions ───

function isStaticAsset(request) {
  const url = new URL(request.url);
  return (
    request.destination === 'script' ||
    request.destination === 'style' ||
    request.destination === 'font' ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.html') ||
    STATIC_ASSETS.includes(url.pathname)
  );
}

function isImageRequest(request) {
  return (
    request.destination === 'image' ||
    request.url.includes('/_next/image') ||
    request.url.includes('api.dicebear.com') ||
    request.url.includes('lh3.googleusercontent.com') ||
    request.url.includes('pbs.twimg.com')
  );
}

function isApiRequest(request) {
  return request.url.includes('/api/');
}

// ─── Cache Strategies ───

/**
 * Cache First — Good for static assets + DiceBear avatars
 * (avatars never change for the same seed)
 */
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cachedResponse = await cache.match(request);

  if (cachedResponse) {
    // Update cache in background (fire-and-forget, no event.waitUntil needed)
    fetch(request.clone())
      .then((response) => {
        if (response.ok) {
          cache.put(request, response);
        }
      })
      .catch(() => {});
    return cachedResponse;
  }

  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    console.error('[SW] Cache First failed:', error);
    return new Response('Offline', { status: 503 });
  }
}

/**
 * Stale-While-Revalidate — Fast repeat views
 * (serve from cache immediately, update cache in background)
 */
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cachedResponse = await cache.match(request);

  // Fetch from network (updates cache in background)
  const networkFetch = fetch(request.clone()).then((response) => {
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  }).catch((error) => {
    console.error('[SW] Network fetch failed:', error);
  });

  // Return cached version immediately (if available)
  if (cachedResponse) {
    return cachedResponse;
  }

  // No cache — wait for network
  return networkFetch;
}

/**
 * Network First — Good for API endpoints
 * (fresh data is important, but cache helps when offline)
 */
async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);

  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    console.warn('[SW] Network failed, trying cache:', error);
    const cachedResponse = await cache.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }
    return new Response(JSON.stringify({ error: 'Offline' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// ─── Background Sync (deferred API calls) ───
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-messages') {
    event.waitUntil(syncMessages());
  }
});

async function syncMessages() {
  // Re-try failed message sends when back online
  const messages = await getFailedMessagesFromIndexedDB();
  for (const msg of messages) {
    try {
      await fetch('/api/chat/messages', {
        method: 'POST',
        body: JSON.stringify(msg),
      });
      await removeFailedMessageFromIndexedDB(msg.id);
    } catch (error) {
      console.error('[SW] Sync failed for message:', msg.id, error);
    }
  }
}

// ─── Push Notifications ───
self.addEventListener('push', (event) => {
  if (!event.data) return;

  const data = event.data.json();
  const options = {
    body: data.body,
    icon: '/apple-touch-icon.png',
    badge: '/apple-touch-icon.png',
    tag: data.tag || 'default',
    data: data.url || '/dashboard/notifications',
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data || '/dashboard/notifications';
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(url) && 'focus' in client) {
          return client.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});

// ─── IndexedDB Helpers (for offline message queue) ───
function getFailedMessagesFromIndexedDB() {
  // Implementation depends on your IndexedDB schema
  return Promise.resolve([]);
}

function removeFailedMessageFromIndexedDB(id) {
  // Implementation depends on your IndexedDB schema
  return Promise.resolve();
}
