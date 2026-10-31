/**
 * 软删除过滤 —— **纯逻辑**，不依赖 Prisma 运行时。
 *
 * 与 `prisma-soft-delete.ts` 拆开的原因：那份文件 `import { Prisma } from "@/generated"`，
 * 在单测里加载整个生成的 client 既慢又需要环境；而这里要断言的恰恰是
 * 「哪些模型、哪些操作被过滤」这种**纯数据 + 纯函数**性质，不该被运行时拖累。
 *
 * 约束（改动前先读）：
 *  1. 过滤条件 `{ deletedAt: null, ...args.where }` —— **显式 where 优先**。
 *     管理端回收站靠 `where: { deletedAt: { not: null } }` 反向取值，
 *     顺序反了会让回收站永远返回空列表，且不报错。
 *  2. `findUnique` 系走 Prisma 的 `extendedWhereUnique`（唯一键之外可附加非唯一过滤），
 *     故直接并入 `deletedAt: null`，不必降级成 `findFirst`。
 */

/**
 * 带 `deletedAt` 但**故意**不交给扩展自动过滤的模型 → 原因。
 *
 * 自动过滤会把「故意读已删行」的出口悄悄变成空集，比不过滤更危险，
 * 所以豁免必须显式登记，而不是靠"忘了加"。
 */
export const SOFT_DELETE_EXEMPT_MODELS: Readonly<Record<string, string>> = {
  IMMessage:
    "读路径已有显式 `isDeleted: false`；且 `listMessages({ includeDeleted: true })` " +
    "是故意读已删消息的出口，交给扩展自动过滤会让该出口静默返回空集。",
};

/**
 * 由扩展自动过滤的模型（须与 schema 中带 `deletedAt DateTime?` 的模型一致，减去豁免）。
 *
 * 曾经的 `ChatRoom` 是"清单与 schema 漂移"的样本：模型已删除，条目留着
 * 既不报错也不生效 —— 死配置比缺配置更难发现，因为它看起来"已经处理了"。
 */
export const SOFT_DELETE_MODELS = [
  "User",
  "Match",
  "Subscription",
  "Payment",
  "UserReport",
  "Conversation",
] as const;

/**
 * 需要注入 `deletedAt: null` 的操作全集。少一个 = 多一条绕过软删的读路径：
 * - `find*` / `count`：列表、详情、徽章数
 * - `aggregate` / `groupBy`：营收、均值、未读汇总（B-20 补）
 */
export const SOFT_DELETE_OPERATIONS = [
  "findMany",
  "findFirst",
  "findFirstOrThrow",
  "findUnique",
  "findUniqueOrThrow",
  "count",
  "aggregate",
  "groupBy",
] as const;

export type SoftDeleteOperation = (typeof SOFT_DELETE_OPERATIONS)[number];

/** `findUnique` 系：`where` 是唯一键，直接合并 */
const UNIQUE_OPERATIONS: ReadonlySet<SoftDeleteOperation> = new Set([
  "findUnique",
  "findUniqueOrThrow",
]);

/**
 * Add `deletedAt: null` filter to where clause（显式 where 优先）
 */
export function withSoftDelete(args: Record<string, unknown>): Record<string, unknown> {
  return {
    deletedAt: null,
    ...((args.where as Record<string, unknown>) || {}),
  };
}

/**
 * 按操作类型把软删过滤注入 args。
 *
 * 返回**新对象**，不改入参 —— Prisma 的 args 会被扩展链上多个扩展共享，
 * 原地改写会让下游扩展看到污染后的条件。
 */
export function applySoftDeleteFilter(
  operation: SoftDeleteOperation,
  args: Record<string, unknown> = {}
): Record<string, unknown> {
  const where = (args.where as Record<string, unknown>) || {};

  if (UNIQUE_OPERATIONS.has(operation)) {
    return { ...args, where: { ...where, deletedAt: null } };
  }

  return { ...args, where: withSoftDelete(args) };
}
