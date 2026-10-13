/**
 * T08 · `GET /api/v1/billing/subscription` —— 本租户订阅状态（AC-21）
 *
 *   能力 `billing.read`（**OPERATOR+**）。
 *
 * 🔴 状态是**派生值**：本端点不含任何 `status` 列，全部由 `reduceBillingEvents`
 *    从 `BillingEvent` 事件集折叠得出 —— 所以它**不可能**与事件集不一致。
 *
 * 🔴 响应里的 `gateway` 块是**诚实开关**（AC-21 的真实扣款部分）：
 *    `mode = 'sandbox'` + `realChargesEnabled = false` 明确告诉调用方
 *    "当前没有真实收款能力"。没有它，沙箱态与真实态在响应里长得一模一样。
 */

import type { NextRequest } from 'next/server'
import { errorResponse, success } from '@/lib/api-response'
import { withTenant } from '@/lib/tenancy'
import { getSubscription } from '@/lib/billing'

export const GET = withTenant('billing.read')(async (_req: NextRequest, tenant) => {
  try {
    const subscription = await getSubscription(tenant)
    return success(subscription)
  } catch (error) {
    return errorResponse(error)
  }
})
