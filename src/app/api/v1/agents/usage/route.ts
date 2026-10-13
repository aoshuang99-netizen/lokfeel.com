/**
 * T09 · `GET /api/v1/agents/usage` —— 本期用量与限额（AC-20 的**可核对面**）
 *
 *   能力 `agent.run`（OPERATOR+）：与"发起运行"同一门槛 —— 能花钱的人，
 *   才需要看见"还剩多少"（这也正是 `billing.read` 归 OPERATOR+ 的同一取向）。
 *
 * 🔴 响应里带 `assumptions`（额度 / 单价 / 期次）—— 与 T08 用量接口同一口径：
 *    额度与单价当前是**占位假设**，不是财务事实。把假设跟数据一起下发，
 *    而不是藏在代码里，否则"额度用完了"这句提示就成了没有依据的断言。
 */

import type { NextRequest } from 'next/server'
import { errorResponse, success } from '@/lib/api-response'
import { withTenant } from '@/lib/tenancy'
import { agentUsage } from '@/lib/agents'

export const GET = withTenant('agent.run')(async (_req: NextRequest, tenant) => {
  try {
    const usage = await agentUsage(tenant)
    return success(usage)
  } catch (error) {
    return errorResponse(error)
  }
})
