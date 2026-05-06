/**
 * Lightweight in-memory cache for Vercel Serverless functions.
 *
 * Since each serverless function invocation may share or not share memory,
 * this cache works as a request-scoped LRU with TTL.
 * For cross-request caching, use Upstash Redis (TODO: Sprint 2b).
 *
 * Usage:
 *   import { cache } from '@/lib/cache';
 *   const data = await cache.get('user:123', () => db.user.findUnique(...), 60);
 */

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

const store = new Map<string, CacheEntry<unknown>>();
const DEFAULT_TTL = 30; // seconds
const MAX_SIZE = 500;

function evictExpired(): void {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.expiresAt < now) {
      store.delete(key);
    }
  }
}

function evictOldest(): void {
  if (store.size < MAX_SIZE) return;
  let oldestKey: string | null = null;
  let oldestExpiry = Infinity;
  for (const [key, entry] of store) {
    if (entry.expiresAt < oldestExpiry) {
      oldestExpiry = entry.expiresAt;
      oldestKey = key;
    }
  }
  if (oldestKey) store.delete(oldestKey);
}

export const cache = {
  /**
   * Get a value from cache, or compute and cache it.
   * @param key Cache key
   * @param fn Factory function to compute the value
   * @param ttl Time-to-live in seconds (default: 30)
   */
  async get<T>(key: string, fn: () => Promise<T>, ttl: number = DEFAULT_TTL): Promise<T> {
    const now = Date.now();
    const entry = store.get(key);

    if (entry && entry.expiresAt > now) {
      return entry.value as T;
    }

    // Compute value
    const value = await fn();

    // Store in cache
    evictExpired();
    evictOldest();
    store.set(key, { value, expiresAt: now + ttl * 1000 });

    return value;
  },

  /**
   * Invalidate a specific cache key.
   */
  invalidate(key: string): void {
    store.delete(key);
  },

  /**
   * Invalidate all cache entries matching a prefix.
   */
  invalidateByPrefix(prefix: string): void {
    for (const key of store.keys()) {
      if (key.startsWith(prefix)) {
        store.delete(key);
      }
    }
  },

  /**
   * Clear all cache entries.
   */
  clear(): void {
    store.clear();
  },

  /**
   * Get cache stats.
   */
  get stats() {
    return {
      size: store.size,
      maxSize: MAX_SIZE,
    };
  },
};
