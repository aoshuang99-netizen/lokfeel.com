/**
 * Custom hooks for API data fetching with session integration.
 * Handles loading states, errors, authentication, and SWR-style caching.
 *
 * CACHE STRATEGY:
 * - In-memory LRU-like cache (module-level Map) deduplicates same-URL requests
 * - Stale-while-revalidate: returns cached data instantly, refetches in background
 * - 5-minute TTL on cache entries
 * - Auto-invalidated on refetch()
 */
"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSession } from "next-auth/react";

// ─── Global Cache (SWR Pattern) ───

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const cache = new Map<string, CacheEntry<any>>();

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL) {
    cache.delete(key);
    return null;
  }
  return entry.data as T;
}

function setCache<T>(key: string, data: T): void {
  cache.set(key, { data, timestamp: Date.now() });
  // Keep cache size reasonable (max 50 entries)
  if (cache.size > 50) {
    const oldest = [...cache.entries()].sort(
      (a, b) => a[1].timestamp - b[1].timestamp
    )[0];
    if (oldest) cache.delete(oldest[0]);
  }
}

export function invalidateCache(urlPattern?: string): void {
  if (urlPattern) {
    for (const key of cache.keys()) {
      if (key.includes(urlPattern)) cache.delete(key);
    }
  } else {
    cache.clear();
  }
}

// ─── Types ───

interface FetchState<T> {
  data: T | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

// ─── useApiGet (with SWR cache) ───

export function useApiGet<T>(url: string | null, options?: { enabled?: boolean }): FetchState<T> {
  const { data: session, status: authStatus } = useSession();
  const [data, setData] = useState<T | null>(() => {
    // Initialize from cache if available
    if (!url) return null;
    return getCached<T>(url);
  });
  const [isLoading, setIsLoading] = useState(() => {
    // Only show loading if no cached data
    if (!url) return false;
    return !getCached<T>(url);
  });
  const [error, setError] = useState<string | null>(null);
  const [trigger, setTrigger] = useState(0);
  const mountedRef = useRef(true);

  const enabled = options?.enabled !== false;

  const refetch = useCallback(() => {
    setTrigger((prev) => prev + 1);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!url || !enabled) return;
    if (authStatus === "loading") return;

    // SWR: If we have cached data already, serve it and skip loading state
    const cached = getCached<T>(url);
    if (cached && data === null) {
      setData(cached);
    }

    const fetchData = async () => {
      // Don't show loading if we have cached data (SWR pattern)
      if (!cached) {
        setIsLoading(true);
      }
      setError(null);

      try {
        const res = await fetch(url);

        if (!res.ok) {
          if (res.status === 401) {
            setError("Please sign in to continue");
            return;
          }
          const err = await res.json().catch(() => ({ message: "Request failed" }));
          setError(err.message || `Error ${res.status}`);
          return;
        }

        const json = await res.json();
        if (mountedRef.current) {
          setData(json);
          setCache(url, json);
        }
      } catch (err) {
        console.warn(`API fetch failed for ${url}:`, err);
        setError("Service unavailable — API not connected yet");
      } finally {
        if (mountedRef.current) {
          setIsLoading(false);
        }
      }
    };

    fetchData();
  }, [url, authStatus, enabled, trigger]);

  return { data, isLoading, error, refetch };
}

export function useApiPost() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const post = useCallback(async (url: string, body?: unknown): Promise<any> => {
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Request failed" }));
        setError(err.message || `Error ${res.status}`);
        return null;
      }

      const json = await res.json();
      // Invalidate related cache entries on mutation
      invalidateCache(url.split("?")[0]);
      return json;
    } catch (err) {
      console.warn(`API post failed for ${url}:`, err);
      setError("Service unavailable");
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { post, isLoading, error };
}

export function useApiDelete() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const deleteRequest = useCallback(async (url: string): Promise<any> => {
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch(url, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Request failed" }));
        setError(err.message || `Error ${res.status}`);
        return null;
      }

      const json = await res.json();
      invalidateCache(url.split("?")[0]);
      return json;
    } catch (err) {
      console.warn(`API delete failed for ${url}:`, err);
      setError("Service unavailable");
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { delete: deleteRequest, isLoading, error };
}
