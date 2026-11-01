/* eslint-disable @typescript-eslint/no-explicit-any */
import { Prisma } from "@/generated";
import {
  SOFT_DELETE_MODELS,
  SOFT_DELETE_OPERATIONS,
  applySoftDeleteFilter,
  type SoftDeleteOperation,
} from "./soft-delete-filter";

/**
 * Soft Delete Prisma Extension
 *
 * Automatically filters out soft-deleted records (deletedAt IS NOT NULL)
 * from all queries on models that have a deletedAt field.
 *
 * Models with soft delete: User, Match, Subscription, Payment, UserReport, Conversation
 *
 * BUGFIX (P3 / B-5c): 该清单原含 "ChatRoom"，但 `ChatRoom` 模型已从 schema 移除
 * （聊天室统一由 `Conversation` 承载）。`model.charAt(0).toLowerCase()+slice(1)`
 * 会把死条目注册成 `chatRoom` 查询钩子 —— 现在没有调用方，属 dead config，
 * 但任何人搜 "ChatRoom" 都会被误导以为该表仍存在，故显式删除。
 *
 * BUGFIX（P2 / B-20）：此前只包 `find*` / `count`，**漏了 `aggregate` / `groupBy`**。
 * 这两个恰是「报表与统计专用」的读入口，落在最不该算错数的地方：
 *   · `admin/dashboard/summary`、`admin/analytics` 用 `payment.aggregate({_sum:{amount}})`
 *     ⇒ 软删的支付仍计入营收（收入虚高、与明细对不上）；
 *   · `im/stats.countUnreadForUser` 用 `conversation.aggregate({_sum:{unreadCountA/B}})`
 *     ⇒ 软删会话的未读仍进徽章（列表说 5 条未读，点进去 0 条）；
 *   · `admin/analytics` 用 `match.aggregate({_avg:{matchScore}})`
 *     ⇒ 均值被已删样本污染。
 * 同时补 `findUniqueOrThrow`（与 findUnique 同语义，漏包则能读到已删记录）。
 *
 * 模型/操作清单与过滤逻辑在 `./soft-delete-filter`（纯逻辑、可单测）；
 * 本文件只负责把它接到 Prisma 扩展上。
 *
 * FIX: Uses correct defineExtension pattern (plain object, not callback)
 * The previous callback pattern caused a double $extends which silently
 * broke all queries on soft-delete models, causing 500 errors.
 */

export {
  SOFT_DELETE_MODELS,
  SOFT_DELETE_OPERATIONS,
  SOFT_DELETE_EXEMPT_MODELS,
  applySoftDeleteFilter,
  withSoftDelete,
  type SoftDeleteOperation,
} from "./soft-delete-filter";

/**
 * Create a Prisma client extension that adds soft delete filtering
 * Uses the correct Prisma 7 defineExtension pattern with a plain object
 */
export function createSoftDeleteExtension() {
  return Prisma.defineExtension({
    name: "soft-delete",
    query: SOFT_DELETE_MODELS.reduce((acc, model) => {
      const modelKey = model.charAt(0).toLowerCase() + model.slice(1);
      const operations: Record<string, unknown> = {};

      for (const operation of SOFT_DELETE_OPERATIONS) {
        operations[operation] = ({
          args,
          query,
        }: {
          args: Record<string, unknown>;
          query: (args: Record<string, unknown>) => Promise<unknown>;
        }) => query(applySoftDeleteFilter(operation as SoftDeleteOperation, args));
      }

      (acc as any)[modelKey] = operations;
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
