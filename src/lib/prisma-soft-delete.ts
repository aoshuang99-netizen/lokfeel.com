/* eslint-disable @typescript-eslint/no-explicit-any */
import { Prisma } from "@/generated";

/**
 * Soft Delete Prisma Extension
 *
 * Automatically filters out soft-deleted records (deletedAt IS NOT NULL)
 * from all queries on models that have a deletedAt field.
 *
 * Models with soft delete: User, Match, Subscription, Payment, UserReport, ChatRoom, Conversation
 *
 * FIX: Uses correct defineExtension pattern (plain object, not callback)
 * The previous callback pattern caused a double $extends which silently
 * broke all queries on soft-delete models, causing 500 errors.
 */

/**
 * Models that support soft delete (have deletedAt field)
 */
const SOFT_DELETE_MODELS = [
  "User",
  "Match",
  "Subscription",
  "Payment",
  "UserReport",
  "ChatRoom",
  "Conversation",
] as const;

/**
 * Add deletedAt: null filter to where clause
 */
function withSoftDelete(args: Record<string, unknown>): Record<string, unknown> {
  return {
    deletedAt: null,
    ...(args.where as Record<string, unknown> || {}),
  };
}

/**
 * Create a Prisma client extension that adds soft delete filtering
 * Uses the correct Prisma 7 defineExtension pattern with a plain object
 */
export function createSoftDeleteExtension() {
  return Prisma.defineExtension({
    name: "soft-delete",
    query: SOFT_DELETE_MODELS.reduce((acc, model) => {
      const modelKey = model.charAt(0).toLowerCase() + model.slice(1);
      (acc as any)[modelKey] = {
        findMany({ args, query }: { args: Record<string, unknown>; query: (args: Record<string, unknown>) => Promise<unknown> }) {
          args.where = withSoftDelete(args);
          return query(args);
        },
        findFirst({ args, query }: { args: Record<string, unknown>; query: (args: Record<string, unknown>) => Promise<unknown> }) {
          args.where = withSoftDelete(args);
          return query(args);
        },
        findFirstOrThrow({ args, query }: { args: Record<string, unknown>; query: (args: Record<string, unknown>) => Promise<unknown> }) {
          args.where = withSoftDelete(args);
          return query(args);
        },
        findUnique({ args, query }: { args: Record<string, unknown>; query: (args: Record<string, unknown>) => Promise<unknown> }) {
          // findUnique uses { where: { id } } format - merge deletedAt into existing where
          if (args.where) {
            args.where = {
              ...args.where,
              deletedAt: null,
            };
          } else {
            args.where = { deletedAt: null };
          }
          return query(args);
        },
        count({ args, query }: { args: Record<string, unknown>; query: (args: Record<string, unknown>) => Promise<unknown> }) {
          args.where = withSoftDelete(args);
          return query(args);
        },
      };
      return acc;
    }, {} as any),
  });
}

/**
 * Helper: Soft delete a record (set deletedAt to now)
 */
export async function softDelete(
  prisma: any,
  modelName: string,
  id: string,
  deletedBy?: string
): Promise<void> {
  const data: Record<string, unknown> = {
    deletedAt: new Date(),
  };
  if (deletedBy) {
    data.deletedBy = deletedBy;
  }

  await prisma[`${modelName.charAt(0).toLowerCase()}${modelName.slice(1)}`].update({
    where: { id },
    data,
  });
}

/**
 * Helper: Restore a soft-deleted record (set deletedAt to null)
 */
export async function restoreRecord(
  prisma: any,
  modelName: string,
  id: string
): Promise<void> {
  await prisma[`${modelName.charAt(0).toLowerCase()}${modelName.slice(1)}`].update({
    where: { id },
    data: { deletedAt: null },
  });
}

/**
 * Helper: Permanently delete (physical delete)
 */
export async function permanentDelete(
  prisma: any,
  modelName: string,
  id: string
): Promise<void> {
  await prisma[`${modelName.charAt(0).toLowerCase()}${modelName.slice(1)}`].delete({
    where: { id },
  });
}
