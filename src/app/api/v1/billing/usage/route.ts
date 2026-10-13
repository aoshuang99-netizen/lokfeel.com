/**
 * T08 · `GET /api/v1/billing/usage` —— 本租户当期用量与限额（AC-21）
 *
 *   能力 `billing.read`（**OPERATOR+**）。用量是经营信息，但不该由普通成员看到。
 *
 * 响应是**自描述**的（与 `/outcomes/metrics` 同一手法），因为 AC-21 的"可复算"要求
 * 对账脚本能用**原始表 SQL** 独立算出同一个数：
 *   - `basis.periodKey` / `periodStart` / `periodEnd` —— 期次与**开区间上界**
 *     （对账脚本据此拼 WHERE，不必自己推断"这个月从哪到哪"）；
 *   - `basis.plan` / `basis.planLimits` —— 限额判定所依据的**方案与限额值**
 *     （限额是"假设"，必须随响应下发，不能藏在代码里）；
 *   - `basis.unitMapping` —— 单元口径 ↔ 数据库枚举的映射。
 *
 * 🔴 这里**不接**任何来自请求体的计数 —— 全部由服务端归集产生。
 */

import type { NextRequest } from 'next/server'
import { errorResponse, success } from '@/lib/api-response'
import { withTenant } from '@/lib/tenancy'
import { getUsageSummary } from '@/lib/billing'

export const GET = withTenant('billing.read')(async (req: NextRequest, tenant) => {
  try {
    // 空串视同缺省（前端拼参常见），不报 400 —— 它不是"筛选没生效"，而是"没有筛选"。
    const raw = req.nextUrl.searchParams.get('periodKey')
    const periodKey = raw && raw.trim() !== '' ? raw.trim() : null

    const summary = await getUsageSummary(tenant, { periodKey })
    return success(summary)
  } catch (error) {
    return errorResponse(error)
  }
})
