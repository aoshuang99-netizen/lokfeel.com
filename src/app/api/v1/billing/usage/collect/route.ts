/**
 * T08 · `POST /api/v1/billing/usage/collect` —— 归集用量（AC-21）
 *
 *   能力 `billing.manage`（**ADMIN+**）。
 *
 * 幂等补齐：扫描原始表（提案/介绍/成果/核验），把**缺失**的用量行写入账本。
 * 只增不减 —— 既不改也不删（见 `service.ts` 文件头）。
 *
 * 为什么要有这个端点（而不是在业务路径里内联写账）：
 *   · 任何时刻重跑都收敛到同一状态 ⇒ **可回填、可修复**，业务代码一行不动；
 *   · 与对账脚本形成**两条独立路径**（这里走 Prisma + 纯内核，那边走原始 SQL），
 *     两条都算出同一个数才算数 —— 这正是 AC-21「可复算」的判据形态。
 *
 * ⚠️ 无副作用风险：重复调用不会重复入账（`dedupeKey` 唯一约束兜底），
 *    故不需要 `Idempotency-Key`。
 */

import type { NextRequest } from 'next/server'
import { errorResponse, success } from '@/lib/api-response'
import { withTenant } from '@/lib/tenancy'
import { collectUsage } from '@/lib/billing'

export const POST = withTenant('billing.manage')(async (_req: NextRequest, tenant) => {
  try {
    const result = await collectUsage(tenant)
    return success(result)
  } catch (error) {
    return errorResponse(error)
  }
})
