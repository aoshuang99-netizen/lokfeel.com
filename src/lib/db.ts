import { PrismaClient } from "@/generated/client";

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

function createPrismaClient(): PrismaClient {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl || databaseUrl.startsWith("mysql://")) {
    // No valid PostgreSQL URL — return a no-op stub for build time
    // This prevents Prisma from throwing adapter mismatch errors during static analysis
    return new Proxy({} as PrismaClient, {
      get() {
        return () => {
          throw new Error("DATABASE_URL is not configured for PostgreSQL");
        };
      },
    });
  }

  // Use PostgreSQL adapter (Neon / Supabase / any pg-compatible DB)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PrismaPg } = require("@prisma/adapter-pg");
  const adapter = new PrismaPg({ connectionString: databaseUrl });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new (PrismaClient as any)({ adapter }) as PrismaClient;
}

export const db: PrismaClient = globalThis.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalThis.prisma = db;
