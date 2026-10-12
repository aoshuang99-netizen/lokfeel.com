/**
 * T05 · `POST /api/v1/connections/{connectionId}/revoke` —— 撤销
 *
 *   能力 `proposal.decide`（自助）
 *
 * 撤销 = 以本人身份表态 `REVOKE`：立刻进入终态、写 `closedAt`，
 * 并**阻止后续动作**（AC-05）—— 之后的 `introduce` 会在
 * `evaluateIntroducibility()` 里被 `revoked` 挡住。
 *
 * 与 consent 分开成一个端点（而不是复用 `{decision:'revoke'}`）是因为
 * **契约就是这么定义的**，而且撤销在界面上是独立动作（一个"撤回"按钮），
 * 不跟接受/拒绝并列成三选一。
 *
 * 请求体可选：`{ "note"?: string }`。空 body / 无 body 都合法。
 */

import type { NextRequest } from 'next/server'
import { errorResponse, success } from '@/lib/api-response'
import { withTenant } from '@/lib/tenancy'
import { onConsentDecided } from '@/lib/workflow'
import { parseRevokeNote, revokeProposal } from '@/lib/connection'
import { proposalIdOf } from '../../_shared/params'

export const POST = withTenant('proposal.decide')(async (req: NextRequest, tenant, params) => {
  try {
    const proposalId = proposalIdOf(params)

    // 撤销没有必填字段，因此"没有 body"是合法输入 —— 不能因为解析失败就 400。
    let body: unknown
    try {
      body = await req.json()
    } catch {
      body = undefined
    }

    const note = parseRevokeNote(body)
    const result = await revokeProposal(tenant, proposalId, note)

    // T06：撤销 = 以本人身份表态 REVOKE → 取消该提案的待发任务（AC-05）。
    await onConsentDecided(
      { id: proposalId, organizationId: tenant.organizationId },
      { actorId: tenant.userId, decision: 'REVOKE' }
    ).catch(() => {})

    return success(result)
  } catch (error) {
    return errorResponse(error)
  }
})
