/**
 * T05 · `POST /api/v1/connections/{connectionId}/consent` —— 对提案表态
 *
 *   能力 `proposal.decide`（**自助**：任何 ACTIVE 成员都能对"与自己有关"的提案表态）
 *
 * 响应码与契约逐条对齐：
 *   200  已更新（**单方 accept 也是 200**，只是状态仍为 `CONSENT_PENDING` ——
 *        这不是"部分成功"，而是这个状态下最正常的返回；把它做成 202 或别的码
 *        会诱导前端把"等待对方"当成异常）
 *   403  不是这条提案的参与方（服务层判定，不是"无权使用该能力"）
 *   404  提案不存在或不在本租户
 *   409  提案已关闭 / 已介绍 / 已过期而试图接受
 *
 * ⚠️ 回应体里的 `state` 与 `counterpartDecision` 是**给同一个人看的**，
 * 不包含对侧的 `note` —— 拒绝理由不回流（见 `proposals.ts` 的 DTO 注释）。
 */

import type { NextRequest } from 'next/server'
import { errorResponse, success } from '@/lib/api-response'
import { ValidationError } from '@/lib/errors'
import { withTenant } from '@/lib/tenancy'
import { onConsentDecided } from '@/lib/workflow'
import { decideProposal, parseConsentDecision } from '@/lib/connection'
import { proposalIdOf } from '../../_shared/params'

export const POST = withTenant('proposal.decide')(async (req: NextRequest, tenant, params) => {
  try {
    const proposalId = proposalIdOf(params)

    let body: unknown
    try {
      body = await req.json()
    } catch {
      throw new ValidationError('Request body must be valid JSON')
    }

    const decision = parseConsentDecision(body)
    const result = await decideProposal(tenant, proposalId, decision)

    // T06：表态落库后翻译成工作流任务（通知对方 / 取消待发 / 双方同意时排介绍）。
    // 阶段由钩子**重读**当前状态决定（此处 `result` 只给调用方看），
    // 因此单方 ACCEPT 仍会是 CONSENT_PENDING，不会误排介绍任务（AC-04）。
    await onConsentDecided(
      { id: proposalId, organizationId: tenant.organizationId },
      { actorId: tenant.userId, decision }
    ).catch(() => {})

    return success(result)
  } catch (error) {
    return errorResponse(error)
  }
})
