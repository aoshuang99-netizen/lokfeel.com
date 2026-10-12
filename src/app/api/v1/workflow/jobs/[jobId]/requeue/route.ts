/**
 * T06 · `POST /api/v1/workflow/jobs/{jobId}/requeue` —— 手动重试
 *
 *   能力 `workflow.manage`（ADMIN+）
 *
 * 语义：**人明确要求再试一次**。把 `DEAD` / `FAILED` / `TAKEN_OVER` 的任务重置为
 * `PENDING` 且 `attempts = 0`。
 *
 * ⚠️ 只有人能调用它。自动流程**永远不该**重置 `attempts` ——
 *   那会让"重试耗尽 → 死信 → 等人"这条保护失去意义，退化成无限重试。
 *
 * 响应码：
 *   200  已重新入队
 *   404  任务不存在或不在本租户
 *   409  任务处于不可重置的状态（如已成功、已取消、正在跑）
 */

import type { NextRequest } from 'next/server'
import { errorResponse, success } from '@/lib/api-response'
import { withTenant } from '@/lib/tenancy'
import { requeueJobManually } from '@/lib/workflow'
import { jobIdOf } from '../../../_shared/params'

export const POST = withTenant('workflow.manage')(async (_req: NextRequest, tenant, params) => {
  try {
    const jobId = jobIdOf(params)
    await requeueJobManually(tenant, jobId)
    return success({ jobId, status: 'PENDING' })
  } catch (error) {
    return errorResponse(error)
  }
})
