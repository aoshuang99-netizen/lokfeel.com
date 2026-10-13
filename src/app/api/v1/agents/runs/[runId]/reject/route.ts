/**
 * T09 · `POST /api/v1/agents/runs/{runId}/reject` —— 人工驳回
 *
 *   能力 `agent.approve`（**ADMIN+** —— 驳回同属"对高风险产出做裁决"，与批准同一门槛）。
 *
 * ⚠️ **驳回理由（`note`）落库但不进审计**（见服务层）：它是人写的自由文本，
 *    可能含档案信息。审计只记 `hasNote: boolean`。
 *
 * 与 approve 分开成两条路径（而不是 `POST /decision {decision}`）的理由：
 * 路径本身就是动作语义，权限/审计/前端按钮都能一一对应，不需要再解析 body 决定含义。
 */

import type { NextRequest } from 'next/server'
import { errorResponse, success } from '@/lib/api-response'
import { withTenant } from '@/lib/tenancy'
import { decideAgentRun } from '@/lib/agents'
import { runIdOf } from '../../../_shared/params'

export const POST = withTenant('agent.approve')(async (req: NextRequest, tenant, params) => {
  try {
    const runId = runIdOf(params)
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const run = await decideAgentRun(tenant, runId, 'REJECTED', body.note)
    return success(run)
  } catch (error) {
    return errorResponse(error)
  }
})
