/**
 * T09 · `POST /api/v1/agents/runs/{runId}/approve` —— 人工批准
 *
 *   能力 `agent.approve`（**ADMIN+**，与触发权 `agent.run` 刻意分离 —— 见
 *   capabilities.ts：若同一人既能触发又能批准，"人工审批"就退化成自我盖章，
 *   AC-08「注入不得绕过审批」在**制度层**被绕过）。
 *
 * 🔴 本路由**不执行任何副作用**：批准 = 状态迁移到 `APPROVED`。
 *    真正的"把消息发出去 / 把资料披露出去"要有 T05 披露出口 + T06 投递出口
 *    —— 那属后续切片。因此这里**没有**、也**不该有**任何"发送"逻辑。
 *
 * 语义（与服务层 `decideAgentRun` 一致）：
 *   - 已有裁决 → 409（不可改判；要推翻请重新发起一次运行 —— 历史裁决是审计证据）
 *   - 状态不允许（例如已 REJECTED / 已 DEGRADED）→ 409
 *   - 运行不存在或跨租户 → 404（复合 where，租户谓词不可省）
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
    const run = await decideAgentRun(tenant, runId, 'APPROVED', body.note)
    return success(run)
  } catch (error) {
    return errorResponse(error)
  }
})
