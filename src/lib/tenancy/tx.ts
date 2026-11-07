/**
 * 租户写路径的交互事务参数 —— 全仓一处定义，不许各写各的。
 *
 * 为什么需要显式给：Prisma 的交互事务默认 `timeout = 5s`。这个默认值在
 * 本机 SQLite 上几乎不可能触发，看起来像"永不超时"；但在 Turso 上，
 * 一条 SQL 的网络往返就是 100ms~1s 量级（国内到 us-east-1 抖动时更高），
 * 一个"先读目标行、再数管理员、再写入"的事务很容易越过 5s。
 *
 * 越界之后的失败形态**极具误导性**：不是超时错误，而是
 *
 *   TRANSACTION_CLOSED: Cannot execute statements because the transaction is closed
 *
 * 落在最后一个写语句上，最终变成一个 500。用户看到的是"服务器错误"，
 * 实际发生的却是"移出成员"这种普通操作 —— 2026-11-07 T07 生产路径 E2E
 * 就在 `DELETE /api/v1/members/[id]` 上复现了这个形态。
 *
 * 值怎么定的：
 *   - `timeout = 20s`：3~4 条语句 × 最坏 3s 往返，留足余量；
 *   - `maxWait = 10s`：等连接池的排队时间（并发高峰时不要瞬间放弃）。
 * 这两个数是**可用性预算**，不是验收阈值 —— 任何断言都没有因为它们被放宽。
 */
export const TENANT_TX = { maxWait: 10_000, timeout: 20_000 } as const
