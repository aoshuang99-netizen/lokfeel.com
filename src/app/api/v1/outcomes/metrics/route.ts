/**
 * T08 · `GET /api/v1/outcomes/metrics` —— 本租户的商业指标（AC-16）
 *
 *   能力 `outcome.read`（**全员**）—— 与 `plan.md` §6 一致：指标与成果列表同权限。
 *
 * 下发的每个数字都必须能被 `scripts/qa/outcome-reconcile.mjs` 用**原始表 SQL**
 * 独立算出同一个值（对账脚本 exit 0 = 一致）。因此响应是**自描述**的：
 *   - `basis.verifiedLevels` —— 判定"已验证"用的级别集合（对账脚本据此拼 SQL 的 IN 子句，
 *     不必硬编码，从而杜绝"脚本与代码各写一份"的漂移）；
 *   - `basis.assumptions` —— 工时/成本的**假设**（单价、每次介入分钟数），
 *     对账脚本据此复算总额："假设"本身也是响应的一部分，不藏在代码里。
 *
 * 🔴 这里**不接**任何来自请求体的计数或金额 —— 全部由服务端聚合产生。
 *
 * ⚠️ `withTenant` 对能力数组是 `some()`（任一满足）：这里只 gate **单个**能力。
 */

import type { NextRequest } from 'next/server'
import { errorResponse, success } from '@/lib/api-response'
import { withTenant } from '@/lib/tenancy'
import { getOutcomeMetrics } from '@/lib/outcome'

export const GET = withTenant('outcome.read')(async (req: NextRequest, tenant) => {
  try {
    // 空串视同缺省（`?missionId=` 常见于前端拼参），不报 400 —— 它不是"筛选没生效"，
    // 而是"没有筛选"。与 `?level=` 的取向一致：**未知非空值**才 400。
    const rawMission = req.nextUrl.searchParams.get('missionId')
    const missionId = rawMission && rawMission.trim() !== '' ? rawMission.trim() : null

    const metrics = await getOutcomeMetrics(tenant, { missionId })
    return success(metrics)
  } catch (error) {
    return errorResponse(error)
  }
})
