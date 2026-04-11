import { PrismaClient } from "@/generated";

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

function createPrismaClient(): PrismaClient {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PrismaPg } = require("@prisma/adapter-pg");
  // Trim DATABASE_URL in case Vercel injected trailing newline
  const connectionString = (process.env.DATABASE_URL || "").trim();

  // Neon optimized: pooled connections + prepared statements for lower latency
  const adapter = new PrismaPg({
    connectionString,
    schema: process.env.DATABASE_SCHEMA || "public",
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
