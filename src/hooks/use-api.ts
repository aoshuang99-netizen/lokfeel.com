/**
 * Custom hooks for API data fetching with session integration.
 * Handles loading states, errors, and authentication.
 */
"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";

interface FetchState<T> {
  data: T | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useApiGet<T>(url: string | null, options?: { enabled?: boolean }): FetchState<T> {
  const { data: session, status: authStatus } = useSession();
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trigger, setTrigger] = useState(0);

  const enabled = options?.enabled !== false;

  const refetch = useCallback(() => {
    setTrigger((prev) => prev + 1);
  }, []);

  useEffect(() => {
    if (!url || !enabled) return;
    if (authStatus === "loading") return;

    const fetchData = async () => {
      setIsLoading(true);
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
        setData(json);
      } catch (err) {
        // Network error or API unavailable (no DATABASE_URL yet)
        console.warn(`API fetch failed for ${url}:`, err);
        setError("Service unavailable — API not connected yet");
      } finally {
        setIsLoading(false);
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

      return await res.json();
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
