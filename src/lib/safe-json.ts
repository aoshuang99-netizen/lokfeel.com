/**
 * Safe JSON Fetch Utilities for Client Components
 *
 * WHY: Middleware geo-block can return non-JSON responses (307 redirects to /blocked HTML page),
 * and network issues can return empty bodies. Direct `await res.json()` throws
 * "Unexpected end of JSON input" in these cases.
 *
 * These utilities wrap fetch + JSON parsing with proper error handling.
 */

/** Error thrown when the response is a region block (HTTP 451) */
export class RegionBlockedError extends Error {
  constructor() {
    super("Service not available in your region")
    this.name = "RegionBlockedError"
  }
}

/** Error thrown when the response couldn't be parsed as JSON */
export class JsonParseError extends Error {
  public readonly status: number
  constructor(status: number, originalMessage: string) {
    super(`Failed to parse response (HTTP ${status}): ${originalMessage}`)
    this.name = "JsonParseError"
    this.status = status
  }
}

/**
 * Safely parse a Response as JSON.
 *
 * Handles:
 * - Empty response body → returns fallback
 * - Region block (451) → throws RegionBlockedError
 * - Non-JSON content type → returns fallback
 * - Redirect responses (3xx) → throws with clear message
 */
export async function safeJsonParse<T = Record<string, unknown>>(
  res: Response,
  fallback: T = {} as T
): Promise<T> {
  // Region block from middleware
  if (res.status === 451) {
    throw new RegionBlockedError()
  }

  // Redirect — typically middleware geo-block redirecting to /blocked
  if (res.status >= 300 && res.status < 400) {
    const location = res.headers.get("location") || "unknown"
    throw new JsonParseError(
      res.status,
      `Request was redirected to ${location}. Service may not be available in your region.`
    )
  }

  // Check content type — skip parsing if not JSON
  const contentType = res.headers.get("content-type") || ""
  if (!contentType.includes("application/json") && !contentType.includes("text/plain")) {
    return fallback
  }

  // Try to parse JSON
  try {
    const text = await res.text()
    if (!text || text.trim().length === 0) {
      return fallback
    }
    return JSON.parse(text) as T
  } catch (err) {
    throw new JsonParseError(
      res.status,
      err instanceof Error ? err.message : "Unknown parse error"
    )
  }
}

/**
 * Safe fetch + JSON parse combo.
 *
 * Usage:
 * ```ts
 * const data = await safeFetch<{ success: boolean; redirectUrl?: string }>(
 *   "/api/auth/login",
 *   {
 *     method: "POST",
 *     headers: { "Content-Type": "application/json" },
 *     body: JSON.stringify({ email, password }),
 *   }
 * )
 * ```
 */
export async function safeFetch<T = Record<string, unknown>>(
  url: string,
  options?: RequestInit,
  fallback: T = {} as T
): Promise<{ data: T; response: Response }> {
  const res = await fetch(url, options)
  const data = await safeJsonParse<T>(res, fallback)
  return { data, response: res }
}

/**
 * Get a user-friendly error message from caught errors in auth flows.
 */
export function getAuthErrorMessage(err: unknown): string {
  if (err instanceof RegionBlockedError) {
    return "Service not available in your region."
  }
  if (err instanceof JsonParseError) {
    if (err.status === 451 || err.message.includes("redirected")) {
      return "Service not available in your region."
    }
    return "Network error. Please check your connection and try again."
  }
  if (err instanceof Error) {
    return "Network error. Please check your connection and try again."
  }
  return "An unexpected error occurred. Please try again."
}
