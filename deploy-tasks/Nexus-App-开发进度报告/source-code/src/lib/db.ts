import { PrismaClient } from "@/generated";
import path from "path";

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

function createPrismaClient(): PrismaClient {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PrismaLibSql } = require("@prisma/adapter-libsql");

  // Trim DATABASE_URL in case Vercel injected trailing newline
  const rawUrl = (process.env.DATABASE_URL || "").trim();
  const authToken = (process.env.DATABASE_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN || "").trim();

  // Clean URL for libSQL compatibility
  const url = cleanLibsqlUrl(rawUrl);

  // PrismaLibSql accepts the same config as @libsql/client createClient()
  const adapter = new PrismaLibSql({
    url,
    authToken: authToken || undefined,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new (PrismaClient as any)({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  }) as PrismaClient;
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
