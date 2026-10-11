/**
 * T05 · `POST /api/v1/connections/{connectionId}/introduce` —— **介绍执行点**
 *
 *   能力 `proposal.create`（OPERATOR+）—— "发送正式介绍"是运营动作
 *
 * 这是 **AC-06 的唯一落点**。请求必须**在执行的那一刻**满足：
 *   ① 提案为 `MUTUALLY_ACCEPTED`、未过期、未撤销、未介绍过；
 *   ② 双方意图此刻仍 `ACTIVE` 且未过期。
 * 任一不满足 → 409 + `details.blockers`（列出**全部**不满足项，而不只是第一条 ——
 * 运营看到"三方原因"才能一次修对，只报第一条会导致反复重试)。
 *
 * 幂等性说明：本端点**刻意不带 `Idempotency-Key`**。重复调用第二次会拿到
 * 409（`already_introduced`），这是**正确**结果 —— 介绍是"事件"，
 * 第二次调用不是"重放同一个请求"，而是"又要求介绍一次"。用幂等键把它变成
 * "静默返回上次结果"反而会掩盖运营的重复点击。
 */

import type { NextRequest } from 'next/server'
import { errorResponse, success } from '@/lib/api-response'
import { withTenant } from '@/lib/tenancy'
import { introduceConnection } from '@/lib/connection'
import { proposalIdOf } from '../../_shared/params'

export const POST = withTenant('proposal.create')(async (req: NextRequest, tenant, params) => {
  try {
    const proposalId = proposalIdOf(params)
    const result = await introduceConnection(tenant, proposalId)
    return success(result)
  } catch (error) {
    return errorResponse(error)
  }
})
