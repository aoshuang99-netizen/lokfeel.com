/**
 * Image Preloading Strategy
 *
 * Ensures critical avatar images load within 1 second.
 * Uses a multi-tier preloading approach:
 * 1. Critical (above-fold): Preload immediately
 * 2. Important (next 3-5): Prefetch on idle
 * 3. Deferred (rest): Lazy load with intersection observer
 */

import { preloadAvatar } from "./avatar-utils";

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

interface PreloadTarget {
  url: string;
  priority: "critical" | "important" | "deferred";
}

// ═══════════════════════════════════════════════════════════════
// CRITICAL PATH PRELOADING
// ═══════════════════════════════════════════════════════════════

/**
 * Preload critical avatar images for instant display.
 * Call this on page mount for above-fold content.
 */
export function preloadCriticalAvatars(urls: string[]): void {
  if (typeof window === "undefined") return;

  // Use requestIdleCallback for non-critical, or immediate for critical
  const preload = () => {
    urls.forEach((url) => {
      const link = document.createElement("link");
      link.rel = "preload";
      link.as = "image";
      link.href = url;
      link.crossOrigin = "anonymous";
      document.head.appendChild(link);
    });
  };

  if (document.readyState === "complete") {
    preload();
  } else {
    window.addEventListener("load", preload);
  }
}

/**
 * Prefetch images that will likely be needed soon.
 * Uses lower priority than preload.
 */
export function prefetchAvatars(urls: string[]): void {
  if (typeof window === "undefined") return;

  const prefetch = () => {
    urls.forEach((url) => {
      const link = document.createElement("link");
      link.rel = "prefetch";
      link.as = "image";
      link.href = url;
      link.crossOrigin = "anonymous";
      document.head.appendChild(link);
    });
  };

  // Use requestIdleCallback if available, otherwise setTimeout
  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(prefetch, { timeout: 2000 });
  } else {
    setTimeout(prefetch, 1000);
  }
}

// ═══════════════════════════════════════════════════════════════
// INTERSECTION OBSERVER LAZY LOADING
// ═══════════════════════════════════════════════════════════════

/**
 * Create an intersection observer for deferred image loading.
 * Images are loaded only when they enter the viewport.
 */
export function createLazyImageObserver(
  callback: (entries: IntersectionObserverEntry[]) => void,
  options?: IntersectionObserverInit
): IntersectionObserver {
  const defaultOptions: IntersectionObserverInit = {
    root: null,
    rootMargin: "200px", // Start loading 200px before entering viewport
    threshold: 0.01,
  };

  return new IntersectionObserver(callback, options || defaultOptions);
}

/**
 * Hook-compatible lazy load trigger.
 * Returns a ref callback to attach to image containers.
 */
export function useLazyImageLoad(
  onVisible: (url: string) => void
): (element: HTMLElement | null, url: string) => void {
  const observerRef = { current: null as IntersectionObserver | null };
  const urlMap = new WeakMap<Element, string>();

  return (element: HTMLElement | null, url: string) => {
    if (!element) return;

    if (!observerRef.current) {
      observerRef.current = createLazyImageObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const imgUrl = urlMap.get(entry.target);
            if (imgUrl) {
              onVisible(imgUrl);
              observerRef.current?.unobserve(entry.target);
            }
          }
        });
      });
    }

    urlMap.set(element, url);
    observerRef.current.observe(element);
  };
}

// ═══════════════════════════════════════════════════════════════
// PROGRESSIVE LOADING
// ═══════════════════════════════════════════════════════════════

/**
 * Load images progressively: thumbnail first, then full resolution.
 * Ensures something is visible immediately while full image loads.
 */
export function loadProgressiveImage(
  container: HTMLElement,
  thumbnailUrl: string,
  fullUrl: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    // Step 1: Load thumbnail immediately
    const thumbImg = new Image();
    thumbImg.crossOrigin = "anonymous";

    thumbImg.onload = () => {
      // Show thumbnail
      container.style.backgroundImage = `url(${thumbnailUrl})`;
      container.style.backgroundSize = "cover";
      container.style.backgroundPosition = "center";

      // Step 2: Load full resolution
      const fullImg = new Image();
      fullImg.crossOrigin = "anonymous";

      fullImg.onload = () => {
        // Replace with full resolution
        container.style.backgroundImage = `url(${fullUrl})`;
        resolve();
      };

      fullImg.onerror = reject;
      fullImg.src = fullUrl;
    };

    thumbImg.onerror = reject;
    thumbImg.src = thumbnailUrl;
  });
}

// ═══════════════════════════════════════════════════════════════
// BATCH PRELOADING FOR USER LISTS
// ═══════════════════════════════════════════════════════════════

/**
 * Preload avatars for a list of users with smart prioritization.
 * First 3 are critical, next 5 are important, rest are deferred.
 */
export function preloadUserAvatars(
  avatarUrls: string[],
  options?: { criticalCount?: number; importantCount?: number }
): void {
  const { criticalCount = 3, importantCount = 5 } = options || {};

  const critical = avatarUrls.slice(0, criticalCount);
  const important = avatarUrls.slice(criticalCount, criticalCount + importantCount);
  const deferred = avatarUrls.slice(criticalCount + importantCount);

  // Critical: preload immediately
  preloadCriticalAvatars(critical);

  // Important: prefetch after a short delay
  if (important.length > 0) {
    setTimeout(() => prefetchAvatars(important), 500);
  }

  // Deferred: lazy load via intersection observer
  if (deferred.length > 0 && typeof window !== "undefined") {
    const observer = createLazyImageObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const url = (entry.target as HTMLElement).dataset.src;
          if (url) preloadAvatar(url);
          observer.unobserve(entry.target);
        }
      });
    });

    // Note: Caller needs to attach these elements to the observer
  }
}

// ═══════════════════════════════════════════════════════════════
// LIGHTBOX PRELOADING
// ═══════════════════════════════════════════════════════════════

/**
 * Preload full-resolution image for lightbox viewing.
 * Call on hover or when lightbox is likely to open.
 */
export function preloadLightboxImage(url: string): void {
  // Upgrade URL to full resolution
  const fullResUrl = url.replace(/w=\d+&h=\d+/, "w=1200&h=1600");
  preloadAvatar(fullResUrl);
}

/**
 * Preload adjacent images in a gallery/lightbox sequence.
 * Ensures smooth navigation between photos.
 */
export function preloadAdjacentImages(
  allUrls: string[],
  currentIndex: number
): void {
  const preloadIndices = [
    currentIndex - 1,
    currentIndex + 1,
    currentIndex - 2,
    currentIndex + 2,
  ].filter((i) => i >= 0 && i < allUrls.length);

  preloadIndices.forEach((i) => {
    const url = allUrls[i].replace(/w=\d+&h=\d+/, "w=800&h=1000");
    preloadAvatar(url);
  });
}

// ═══════════════════════════════════════════════════════════════
// PERFORMANCE MONITORING
// ═══════════════════════════════════════════════════════════════

/**
 * Monitor image load performance.
 * Reports timing metrics for optimization.
 */
export function monitorImageLoad(
  img: HTMLImageElement,
  label: string
): void {
  if (typeof window === "undefined" || !("performance" in window)) return;

  const startTime = performance.now();

  img.addEventListener("load", () => {
    const loadTime = performance.now() - startTime;
    console.log(`[Image Load] ${label}: ${loadTime.toFixed(1)}ms`);

    // Report slow loads (>1s)
    if (loadTime > 1000) {
      console.warn(`[Image Load] Slow load detected: ${label} took ${loadTime.toFixed(0)}ms`);
    }
  });

  img.addEventListener("error", () => {
    console.error(`[Image Load] Failed: ${label}`);
  });
}

// ═══════════════════════════════════════════════════════════════
// CONNECTION-AWARE LOADING
// ═══════════════════════════════════════════════════════════════

/**
 * Adjust image quality based on network conditions.
 * Returns appropriate size parameter for current connection.
 */
export function getConnectionAwareSize(): "thumb" | "preview" | "full" {
  if (typeof navigator === "undefined") return "preview";

  const conn = (navigator as any).connection;
  if (!conn) return "preview";

  // Slow connection: use thumbnails
  if (conn.saveData || conn.effectiveType === "2g" || conn.effectiveType === "slow-2g") {
    return "thumb";
  }

  // Fast connection: use full resolution
  if (conn.effectiveType === "4g" && !conn.saveData) {
    return "full";
  }

  // Default: preview
  return "preview";
}
