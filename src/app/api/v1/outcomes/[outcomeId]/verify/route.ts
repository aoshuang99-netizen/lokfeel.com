/**
 * T08 · `POST /api/v1/outcomes/{outcomeId}/verify` —— **外部核验**（抬到 `EXTERNALLY_VERIFIED`）
 *
 *   能力 `outcome.verify`（**仅 ADMIN+**）—— 它决定"这条成果算不算数"，
 *   是管理动作，取严（与 `workflow.manage` 同一取向）。
 *
 * ⚠️ 与"确认"不同：这里**不要求**是当事方，运营可对任意成果核验。
 * 仍**不接受**任何来自请求体的 `level` 入参 —— 级别永远由记录集派生。
 * `evidence` 落库前脱敏截断，且**不外发**（DTO 只给级别与时间）。
 *
 * 幂等：同一人对同一成果的同一级别只落一条记录，重复提交 `created: false`。
 */

import type { NextRequest } from 'next/server'
import { errorResponse, success } from '@/lib/api-response'
import { withTenant } from '@/lib/tenancy'
import { verifyOutcome } from '@/lib/outcome'
import { outcomeIdOf } from '../../_shared/params'

export const POST = withTenant('outcome.verify')(async (req: NextRequest, tenant, params) => {
  try {
    const outcomeId = outcomeIdOf(params)
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const result = await verifyOutcome(tenant, outcomeId, {
      evidence: typeof body.evidence === 'string' ? body.evidence : null,
      note: typeof body.note === 'string' ? body.note : null,
    })
    return success(result)
  } catch (error) {
    return errorResponse(error)
  }
})
