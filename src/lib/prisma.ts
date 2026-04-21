import { PrismaClient } from "@/generated";

// Re-export from db.ts for compatibility
export { getDb, db as prisma } from "./db";

// Default export for convenience
export { db as default } from "./db";
