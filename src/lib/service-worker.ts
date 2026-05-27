/**
 * Service Worker Registration
 *
 * Registers the Service Worker for:
 * 1. App Shell caching (instant navigtion)
 * 2. Image caching (DiceBear avatars, etc.)
 * 3. Offline fallback (local SVG avatars)
 * 4. Background Sync (defered API calls)
 */

export function registerServiceWorker(): void {
  if (typeof window === 'undefined') return;
  if (!('serviceWorker' in navigator)) {
    console.warn('[SW] Service Worker not supported');
    return;
  }

  window.addEventListener('load', () => {
    const swUrl = `${window.location.origin}/sw.js`;

    navigator.serviceWorker
      .register(swUrl, { scope: '/' })
      .then((registration) => {
        console.log('[SW] Registered:', registration);

        // Check for updates every 60 seconds
        setInterval(() => {
          registration.update();
        }, 6000);

        // Handle updates
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (!newWorker) return;

          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed') {
              if (navigator.serviceWorker.controller) {
                // New update available
                console.log('[SW] New update available');
                // Optionally: show "Update Available" notification
              } else {
                // First install
                console.log('[SW] App is now available offline');
              }
            }
          });
        });
      })
      .catch((error) => {
        console.error('[SW] Registration failed:', error);
      });
  });
}

/**
 * Unregister Service Worker (for development)
 */
export function unregisterServiceWorker(): void {
  if (typeof window === 'undefined') return;
  if (!('serviceWorker' in navigator)) return;

  navigator.serviceWorker.ready.then((registration) => {
    registration.unregister();
  });
}

/**
 * Check if Service Worker is active
 */
export function isServiceWorkerActive(): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false);
  if (!('serviceWorker' in navigator)) return Promise.resolve(false);

  return navigator.serviceWorker.ready.then(
    () => true,
    () => false
  );
}

/**
 * Send message to Service Worker
 */
export function sendMessageToSW(message: any): void {
  if (typeof window === 'undefined') return;
  if (!('serviceWorker' in navigator)) return;
  if (!navigator.serviceWorker.controller) return;

  navigator.serviceWorker.controller.postMessage(message);
}

/**
 * Clear all Service Worker caches
 */
export async function clearAllCaches(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();

  const cacheNames = await caches.keys();
  await Promise.all(
    cacheNames.map((name) => {
      console.log('[SW] Deleting cache:', name);
      return caches.delete(name);
    })
  );

  // Force reload to re-cache assets
  window.location.reload();
}

/**
 * Prefetch critical routes (for instant navigation)
 * Call this on hover or when navigation is likely
 */
export function prefetchRoute(route: string): void {
  if (typeof window === 'undefined') return;

  const link = document.createElement('link');
  link.rel = 'prefetch';
  link.href = route;
  link.as = 'document';
  document.head.appendChild(link);
}

/**
 * Prefetch critical images (for instant display)
 * Call this on hover or when image view is likely
 */
export function prefetchImage(url: string): void {
  if (typeof window === 'undefined') return;

  const link = document.createElement('link');
  link.rel = 'prefetch';
  link.href = url;
  link.as = 'image';
  document.head.appendChild(link);
}

// ─── Auto-register on import ───
if (typeof window !== 'undefined' && process.env.NODE_ENV === 'production') {
  registerServiceWorker();
}
