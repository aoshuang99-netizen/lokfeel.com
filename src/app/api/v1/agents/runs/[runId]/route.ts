/**
 * T09 · `GET /api/v1/agents/runs/{runId}` —— 单条运行详情（**带逐次调用**）
 *
 *   能力 `agent.run`（OPERATOR+）：与列表同一门槛（能看到列表就能看到详情）。
 *
 * ⚠️ 列表返回的是精简形状（不带 `calls`，只有 `callCount`）；详情才带逐次调用。
 *    这样"看板扫一眼"与"排障看明细"是两个显式动作，而不是让列表接口顺带把
 *    每条的调用明细都读出来（那是 N+1 且数据量不可控）。
 *
 * 🔴 DTO 投影边界：响应里**没有** `rawText`（模型原文），只有过 zod 契约的 `proposal`。
 *    见 `src/lib/agents/dto.ts` 的文件头。
 */

import type { NextRequest } from 'next/server'
import { errorResponse, success } from '@/lib/api-response'
import { withTenant } from '@/lib/tenancy'
import { getAgentRun } from '@/lib/agents'
import { runIdOf } from '../../_shared/params'

export const GET = withTenant('agent.run')(async (_req: NextRequest, tenant, params) => {
  try {
    const runId = runIdOf(params)
    const run = await getAgentRun(tenant, runId)
    return success(run)
  } catch (error) {
    return errorResponse(error)
  }
})
