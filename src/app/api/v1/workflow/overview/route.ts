/**
 * T06 · `GET /api/v1/workflow/overview` —— 工作流总览
 *
 *   能力 `workflow.read`（OPERATOR+）
 *
 * 一次拿到运营真正需要的四件事：
 *   1. 各状态任务计数（队列健康度）；
 *   2. **需人处置**的列表（死信 / 已接管 / 永久失败）—— 运营的待办；
 *   3. **停滞**的连接（阶段超时未推进）—— 流程卡住，而不是任务失败；
 *   4. 投递计数（`sent` / `captured` / `failed` / `pending`）。
 *
 * `captured` 单列出来是 AC-09 的诚实要求：它表示"沙箱捕获了投递意图"，
 * 而**不是**"已送达"。把它并进 `sent` 会是虚报外部服务已接通。
 */

import type { NextRequest } from 'next/server'
import { errorResponse, success } from '@/lib/api-response'
import { withTenant } from '@/lib/tenancy'
import { getWorkflowOverview } from '@/lib/workflow'

export const GET = withTenant('workflow.read')(async (_req: NextRequest, tenant) => {
  try {
    const overview = await getWorkflowOverview(tenant.organizationId)
    return success(overview)
  } catch (error) {
    return errorResponse(error)
  }
})
