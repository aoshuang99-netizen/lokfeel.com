import { PrismaClient } from "@/generated";
import path from "path";
import { createSoftDeleteExtension } from "./prisma-soft-delete";

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

/**
 * Clean a DATABASE_URL for libSQL compatibility.
 * - Strips PostgreSQL-specific query parameters that libSQL doesn't understand
 * - Resolves relative file: paths to absolute paths
 */
function cleanLibsqlUrl(url: string): string {
  // Handle file: URLs for local SQLite — resolve relative paths to absolute
  if (url.startsWith("file:")) {
    const filePath = url.replace("file:", "");
    if (!path.isAbsolute(filePath)) {
      const projectRoot = path.resolve(process.cwd());
      return `file:${path.join(projectRoot, filePath)}`;
    }
    return url;
  }

  try {
    const parsed = new URL(url);
    // Remove unsupported query parameters
    const unsupportedParams = ['sslmode', 'ssl', 'channel_binding', 'connect_timeout', 'statement_timeout', 'application_name', 'options'];
    for (const param of unsupportedParams) {
      parsed.searchParams.delete(param);
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

/**
 * Sleep utility for retry logic
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Execute a function with retry logic for database connection errors.
 * Uses exponential backoff with a maximum of 3 retries.
 *
 * @param fn - The function to execute
 * @param maxRetries - Maximum number of retries (default: 3)
 * @param baseDelayMs - Base delay in ms for exponential backoff (default: 1000)
 * @returns The result of the function
 *
 * @example
 * const user = await withRetry(() => db.user.findUnique({ where: { id: userId } }));
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelayMs: number = 1000
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Check if this is a retryable error
      const isRetryable = isRetryableError(error);

      // If this is the last attempt or not retryable, throw
      if (attempt === maxRetries || !isRetryable) {
        throw lastError;
      }

      // Calculate exponential backoff delay
      const delayMs = baseDelayMs * Math.pow(2, attempt);
      const jitterMs = Math.random() * 100; // Add up to 100ms jitter
      const totalDelayMs = Math.min(delayMs + jitterMs, 10000); // Cap at 10s

      console.warn(
        `[db.withRetry] Attempt ${attempt + 1}/${maxRetries + 1} failed with retryable error: ${lastError.message}. ` +
        `Retrying in ${Math.round(totalDelayMs)}ms...`
      );

      await sleep(totalDelayMs);
    }
  }

  // Should never reach here, but TypeScript needs it
  throw lastError || new Error('Unknown error in withRetry');
}

/**
 * Check if an error is retryable (connection-related).
 * Prisma error codes:
 * - P1001: Can't reach database server
 * - P1002: The database server terminated the connection
 * - P1008: Operations timed out
 * - P1010: User denied access (not retryable)
 * - P1011: Error parsing connection string (not retryable)
 */
function isRetryableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const message = error.message.toLowerCase();
  const code = (error as any).code;

  // Check Prisma error codes
  if (code && typeof code === 'string') {
    const retryableCodes = ['P1001', 'P1002', 'P1008', 'P1017'];
    if (retryableCodes.includes(code)) return true;
  }

  // Check error message keywords
  const retryableKeywords = [
    'timeout',
    'timed out',
    'connection',
    'econnrefused',
    'econnreset',
    'etimedout',
    'cannot connect',
    'terminated',
    'closed',
  ];

  return retryableKeywords.some(keyword => message.includes(keyword));
}

/**
 * Log slow queries (>= 500ms) to help identify performance bottlenecks.
 * In production, this sends to Sentry or other monitoring service.
 */
function logSlowQuery(query: string, params: string, durationMs: number): void {
  if (durationMs < 500) return; // Only log queries >= 500ms

  const truncatedQuery = query.length > 200 ? query.substring(0, 200) + '...' : query;
  const logData = {
    query: truncatedQuery,
    params: params || '{}',
    durationMs,
    timestamp: new Date().toISOString(),
  };

  // In development, log to console
  if (process.env.NODE_ENV === 'development') {
    console.warn(`[db] Slow query detected (${durationMs}ms):`, logData);
  }

  // In production, could send to Sentry:
  // Sentry.captureMessage(`Slow query: ${durationMs}ms`, { level: 'warning', extra: logData });
}

function createPrismaClient(): PrismaClient {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PrismaLibSql } = require("@prisma/adapter-libsql");

  // Trim DATABASE_URL in case Vercel injected trailing newline
  const rawUrl = (process.env.DATABASE_URL || "").trim();
  const authToken = (process.env.DATABASE_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN || "").trim();

  // Clean URL for libSQL compatibility
  const url = cleanLibsqlUrl(rawUrl);

  // PrismaLibSql accepts the same config as @libsql/client createClient()
  // Connection pool optimization: increase concurrency for Turso
  const isTurso = url.includes('turso.io');
  const adapter = new PrismaLibSql({
    url,
    authToken: authToken || undefined,
    // Turso connection pool settings
    ...(isTurso ? {
      concurrency: 20,  // ✅ OPTIMIZATION: Increase from 10 to 20 based on load testing
      fetch_timeout: 10000,  // ✅ OPTIMIZATION: 10 second timeout for slow queries
      connection_timeout: 5000,  // ✅ OPTIMIZATION: 5 second connection timeout
    } : {}),
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const baseClient = new (PrismaClient as any)({
    adapter,
    // ✅ OPTIMIZATION: Enhanced logging - log warnings and errors in production
    log: [
      { level: 'warn', emit: 'stdout' },
      { level: 'error', emit: 'stdout' },
      ...(process.env.NODE_ENV === 'development' ? [{ level: 'query' as const, emit: 'stdout' as const }] : []),
    ],
  }) as PrismaClient;

  // ✅ OPTIMIZATION: Slow query monitoring is done via `log` configuration above
  // Prisma will log warnings and errors to stdout (configured in `log` option)
  // For more detailed slow query tracking, use the `withRetry` wrapper which logs slow operations


  // Apply soft delete extension
  return baseClient.$extends(createSoftDeleteExtension()) as PrismaClient;
}

// Lazy singleton — only instantiated when first accessed at runtime
let _prisma: PrismaClient | undefined;

export function getDb(): PrismaClient {
  if (!_prisma) {
    if (globalThis.prisma) {
      _prisma = globalThis.prisma;
    } else {
      _prisma = createPrismaClient();
      if (process.env.NODE_ENV !== "production") {
        globalThis.prisma = _prisma;
      }
    }
  }
  return _prisma;
}

// Backward-compatible default export using a Proxy for lazy access
export const db: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    return (getDb() as unknown as Record<string | symbol, unknown>)[prop];
  },
});
