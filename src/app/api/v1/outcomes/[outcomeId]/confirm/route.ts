/**
 * T08 · `POST /api/v1/outcomes/{outcomeId}/confirm` —— **对手方确认**
 *
 *   能力 `outcome.report`（全员）—— 但服务层另判两条（AC-15 的核心）：
 *     ① **上报人不能确认自己的成果** → 400（语义不成立，不是权限问题）；
 *     ② 只有**对手方**能确认，第三方 → 403。
 *
 * 幂等：重复提交**不报错**，回放当前状态（`created: false`）。
 * 与 T05 §3.6 对照：那里"再介绍一次"是错误请求（409）；这里"再点一次确认"
 * 是**无害的重放** —— 两者的语义不同，处理方式也就不同。
 */

import type { NextRequest } from 'next/server'
import { errorResponse, success } from '@/lib/api-response'
import { withTenant } from '@/lib/tenancy'
import { confirmOutcome } from '@/lib/outcome'
import { outcomeIdOf } from '../../_shared/params'

export const POST = withTenant('outcome.report')(async (req: NextRequest, tenant, params) => {
  try {
    const outcomeId = outcomeIdOf(params)
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const result = await confirmOutcome(tenant, outcomeId, {
      note: typeof body.note === 'string' ? body.note : null,
    })
    return success(result)
  } catch (error) {
    return errorResponse(error)
  }
})
