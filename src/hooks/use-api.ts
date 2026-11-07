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

/** 服务端错误信封（只声明本 hook 用到的路径，避免把整个响应形状复制一遍）。 */
interface ErrorEnvelope {
  error?: { code?: string; message?: string; details?: { code?: string } };
}

/** `PATCH` 的结果。与 `useApiPost()` 不同：**把结果作为返回值**，而不是只放进 `error` state。 */
export interface PatchResult<T = unknown> {
  ok: boolean;
  data?: T;
  /** 服务端 `error.message`（人类可读，可直接展示）。 */
  message?: string;
  /** 服务端 `error.code`（`ValidationError.details.code` 之类，便于分支）。 */
  code?: string;
  status?: number;
}

/**
 * PATCH hook。
 *
 * 🔴 为什么不直接复用 `useApiPost()`：`useApiPost()` 把失败原因写进 `error` state，
 *    调用方在 `await` 之后读到的仍是**上一次**渲染的 state（React 批处理），
 *    于是"改角色失败"会错误地显示成"成功"或上一次的错误。这里把结果**返回**，
 *    调用方拿到的一定是这次请求的结论。
 */
export function useApiPatch() {
  const [isLoading, setIsLoading] = useState(false);

  const patch = useCallback(
    async <T = unknown>(url: string, body?: unknown): Promise<PatchResult<T>> => {
      setIsLoading(true);
      try {
        const res = await fetch(url, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        });

        const json: unknown = await res.json().catch(() => null);
        const envelope = (json ?? {}) as ErrorEnvelope & { data?: unknown };

        if (!res.ok) {
          return {
            ok: false,
            status: res.status,
            message: envelope.error?.message ?? `请求失败（${res.status}）`,
            code: envelope.error?.details?.code ?? envelope.error?.code,
          };
        }

        // 变更成功后让同路径的缓存失效（列表下一次读取能拿到新角色）。
        invalidateCache(url.split("?")[0]);
        return { ok: true, status: res.status, data: (envelope.data ?? json) as T };
      } catch (err) {
        console.warn(`API patch failed for ${url}:`, err);
        return { ok: false, message: "服务暂时不可用，请稍后重试" };
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  return { patch, isLoading };
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

/**
 * 通用「结果即返回值」的变更 hook（POST / DELETE / 其它方法）。
 *
 * 为什么再写一个：`useApiPost()` 与 `useApiDelete()` 把失败原因放进 `error` state，
 * 而 `await` 之后读到的 state 仍是**上一次**渲染的值。于是"删除失败"会被界面显示成
 * "删除成功"，或显示上一次的错误 —— 这不是细节，是**谎报业务结果**。
 * `useApiPatch()` 已经踩过这个坑并改为返回结果；这里把同一口径补齐给 POST/DELETE。
 *
 * 服务端错误结构：`{ error: { message, details: { code } } }`。
 */
export interface MutationResult<T = unknown> {
  ok: boolean;
  data?: T;
  message?: string;
  code?: string;
  status?: number;
}

export function useApiResult() {
  const [isLoading, setIsLoading] = useState(false);

  const send = useCallback(
    async <T = unknown>(
      url: string,
      method: "POST" | "DELETE" | "PUT",
      body?: unknown
    ): Promise<MutationResult<T>> => {
      setIsLoading(true);
      try {
        const res = await fetch(url, {
          method,
          headers: { "Content-Type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok) {
          return {
            ok: false,
            status: res.status,
            message: json?.error?.message ?? `请求失败（${res.status}）`,
            code: json?.error?.details?.code ?? json?.error?.code,
          };
        }
        invalidateCache(url.split("?")[0]);
        return { ok: true, status: res.status, data: (json?.data ?? json) as T };
      } catch (err) {
        console.warn(`API ${method} failed for ${url}:`, err);
        return { ok: false, message: "服务暂时不可用，请稍后重试" };
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  return { send, isLoading };
}
