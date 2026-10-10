/**
 * Service Worker — App Shell + Image Cache Strategy
 *
 * Achieves millisecond-scale loading via:
 * 1. App Shell Strategy   — HTML/JS/CSS cached on install (instant navigation)
 * 2. Image Cache Strategy — Avatars cached with stale-while-revalidate (lorelei style)
 * 3. Offline Fallback     — Turso-stored base64 avatars work offline
 *
 * ⚠️ `/api/*` 一律**不拦截**（详见下方 fetch 事件里的注释）：
 *    个人数据的响应不做任何持久化缓存，"写完读到的必须是刚写的值"。 */

const CACHE_VERSION = 'v4';
const STATIC_CACHE = `static-${CACHE_VERSION}`;
const IMAGE_CACHE = `images-${CACHE_VERSION}`;
/**
 * 页面导航缓存（**不含任何 API 响应**）。
 * v4 之前这里是 `API_CACHE` —— 名字与用途都不对：它缓存的是页面，却因为也被
 * API 分支复用而给"API 不缓存"留下了后门。改名后语义唯一。
 */
const PAGE_CACHE = `page-${CACHE_VERSION}`;

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
          // ⚠️ `api-` 前缀是**历史遗留**：v4 起不再写 API 缓存，但必须继续清理它 ——
          //    否则旧版本存在设备上的那份 API 缓存（里面是意图正文、披露配置这类个人数据）
          //    会一直留着，"不再缓存"只对新请求生效而已。
          .filter((name) =>
            ['static-', 'images-', 'page-', 'api-'].some((prefix) => name.startsWith(prefix))
          )
          .filter((name) => name !== STATIC_CACHE && name !== IMAGE_CACHE && name !== PAGE_CACHE)
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

  // 3. API — **完全不拦截**，交给浏览器按 HTTP 语义处理。
  //
  //    这里此前是 `staleWhileRevalidate`（GET）—— 已移除，理由是它同时制造了一个
  //    功能缺陷和一个隐私缺陷：
  //      · 功能：SW 会**先返回缓存副本**，于是"刚写完立刻读"必然拿到上一次的数据。
  //        用户把某字段从「组织者」收紧为「仅自己」后，界面上的披露预览仍显示旧范围，
  //        看起来像"没保存成功"；反向（放开）时则相反 —— 用户以为已经授权了。
  //      · 隐私：意图正文、披露配置、组织者视角的成员资料、会话响应全部是**带身份的个人数据**，
  //        放进 Cache Storage 就等于在设备上留了一份可被后续会话/其他账号读到的副本。
  //        撤销披露后，缓存里的旧内容依然可读。
  //
  //    放行后，服务端响应头里的 `Cache-Control: no-store` 才真正生效
  //    （SW 在浏览器缓存之上又加了一层，它不退让的话响应头只是装饰）。
  //    取舍：API 请求失去离线兜底 —— 但个人数据本就不该有离线副本，这是有意为之。
  if (isApiRequest(request)) {
    return;
  }

  // 4. Default — 页面导航等：Network First（在线优先，离线时回退到已缓存副本）
  event.respondWith(networkFirst(request, PAGE_CACHE));
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
