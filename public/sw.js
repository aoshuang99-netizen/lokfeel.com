/**
 * Service Worker — LokFeel PWA Offline Cache
 * 
 * 缓存策略：
 * 1. Static assets (CSS/JS/Fonts) → Cache First
 * 2. Images → Cache First with expiration
 * 3. API requests → Network First with cache fallback
 * 4. Navigation requests → Network First with offline fallback
 */

const CACHE_VERSION = "v2";
const STATIC_CACHE = `lokfeel-static-${CACHE_VERSION}`;
const IMAGE_CACHE = `lokfeel-images-${CACHE_VERSION}`;
const API_CACHE = `lokfeel-api-${CACHE_VERSION}`;

// 需要缓存的静态资源
const STATIC_ASSETS = [
  "/",
  "/dashboard/explore",
  "/dashboard/chats",
  "/dashboard/connections",
  "/dashboard/profile",
  "/dashboard/settings",
  "/manifest.json",
];

// 安装事件 — 预缓存静态资源
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      console.log("[SW] Pre-caching static assets");
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// 激活事件 — 清理旧缓存
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (
            cacheName.startsWith("lokfeel-") &&
            !cacheName.includes(CACHE_VERSION)
          ) {
            console.log("[SW] Deleting old cache:", cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      console.log("[SW] Claiming clients");
      return self.clients.claim();
    })
  );
});

// Fetch事件 — 拦截请求并应用缓存策略
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 只处理 GET 请求
  if (request.method !== "GET") return;

  // 跳过非同源请求（除了图片CDN）
  if (
    url.origin !== self.location.origin &&
    !url.hostname.includes("images.unsplash.com") &&
    !url.hostname.includes("randomuser.me") &&
    !url.hostname.includes("picsum.photos") &&
    !url.hostname.includes("lh3.googleusercontent.com") &&
    !url.hostname.includes("pbs.twimg.com")
  ) {
    return;
  }

  // 策略1: 静态资源 → Cache First
  if (
    request.destination === "script" ||
    request.destination === "style" ||
    request.destination === "font" ||
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/")
  ) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // 策略2: 图片 → Cache First with expiration
  if (
    request.destination === "image" ||
    url.pathname.startsWith("/_next/image") ||
    url.hostname.includes("images.unsplash.com") ||
    url.hostname.includes("randomuser.me") ||
    url.hostname.includes("picsum.photos") ||
    url.hostname.includes("lh3.googleusercontent.com") ||
    url.hostname.includes("pbs.twimg.com")
  ) {
    event.respondWith(cacheFirstWithExpiration(request, IMAGE_CACHE, 7 * 24 * 60 * 60 * 1000)); // 7天
    return;
  }

  // 策略3: API请求 → Network First with cache fallback
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(networkFirstWithCache(request, API_CACHE));
    return;
  }

  // 策略4: HTML导航 → Network First with offline fallback
  if (request.mode === "navigate") {
    event.respondWith(
      networkFirstWithCache(request, STATIC_CACHE).catch(() => {
        return caches.match("/dashboard/explore") || offlineFallback();
      })
    );
    return;
  }

  // 默认：Network First
  event.respondWith(networkFirstWithCache(request, STATIC_CACHE));
});

// ═══════════════════════════════════════════════════════════
// 缓存策略实现
// ═══════════════════════════════════════════════════════════

/**
 * Cache First — 优先从缓存返回，失败则从网络请求并缓存
 */
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cachedResponse = await cache.match(request);
  
  if (cachedResponse) {
    // 后台更新缓存（stale-while-revalidate）
    fetchAndCache(request, cache);
    return cachedResponse;
  }

  return fetchAndCache(request, cache);
}

/**
 * Cache First with Expiration — 带过期时间的缓存优先策略
 */
async function cacheFirstWithExpiration(request, cacheName, maxAge) {
  const cache = await caches.open(cacheName);
  const cachedResponse = await cache.match(request);
  
  if (cachedResponse) {
    // 检查是否过期
    const cachedDate = new Date(cachedResponse.headers.get("date") || 0);
    const isExpired = Date.now() - cachedDate.getTime() > maxAge;
    
    if (!isExpired) {
      // 后台更新缓存
      fetchAndCache(request, cache);
      return cachedResponse;
    }
  }

  return fetchAndCache(request, cache);
}

/**
 * Network First with Cache Fallback — 优先从网络请求，失败则从缓存返回
 */
async function networkFirstWithCache(request, cacheName) {
  const cache = await caches.open(cacheName);
  
  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cachedResponse = await cache.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }
    throw error;
  }
}

/**
 * 从网络请求并缓存
 */
async function fetchAndCache(request, cache) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    console.warn("[SW] Fetch failed:", request.url, error);
    throw error;
  }
}

/**
 * Offline Fallback — 离线时的回退页面
 */
async function offlineFallback() {
  return new Response(
    `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>LokFeel — Offline</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      background: #050a18;
      color: #ffffff;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    .container {
      text-align: center;
      padding: 2rem;
    }
    .icon {
      font-size: 4rem;
      margin-bottom: 1rem;
    }
    h1 {
      font-size: 1.5rem;
      margin-bottom: 0.5rem;
    }
    p {
      color: #aaaaaa;
      margin-bottom: 2rem;
    }
    button {
      background: linear-gradient(135deg, #4c1d95, #7c3aed);
      color: white;
      border: none;
      padding: 0.75rem 2rem;
      border-radius: 0.5rem;
      font-size: 1rem;
      cursor: pointer;
    }
    button:hover {
      opacity: 0.9;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">📡</div>
    <h1>You're Offline</h1>
    <p>Please check your internet connection and try again.</p>
    <button onclick="window.location.reload()">Retry</button>
  </div>
</body>
</html>`,
    {
      headers: { "Content-Type": "text/html" },
      status: 503,
      statusText: "Service Unavailable",
    }
  );
}

// 监听消息 — 用于从客户端手动更新缓存
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
  
  if (event.data?.type === "CLEAR_CACHE") {
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => caches.delete(cacheName))
      );
    }).then(() => {
      event.ports[0].postMessage({ success: true });
    });
  }
});
