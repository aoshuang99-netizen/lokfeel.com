/**
 * T09 Slice 6 · `GET /api/v1/agents/diagnostics/connectivity` —— **生产出口自检**
 *
 *   能力 `agent.execute`（OPERATOR+）：与执行同权。
 *
 * ═══════════════════════════════════════════════════════════════
 * 为什么这个端点必须存在
 * ═══════════════════════════════════════════════════════════════
 * `scripts/qa/verify-agent-connectivity.mts` 只能证"跑它的那台机器能出去"。
 * 生产是**另一个出口**（Netlify 函数直连），本机验绿推不出生产能到 ——
 * 本仓 2026-10-15 的实跑已把这两件事的差异钉成事实（本机直连超时、走本机代理 401）。
 * 要让"生产侧连通性"可复验，探针就必须跑在**应用自己**的运行时里。
 *
 * ═══════════════════════════════════════════════════════════════
 * 边界（写在这里，因为它是一个**生产可达**的端点）
 * ═══════════════════════════════════════════════════════════════
 *   · **只读**：不写任何表、不改任何状态（`connectivity.ts` 连 `db` 都不 import）。
 *   · **不计费**：只 `GET {baseUrl}/models`，不是 chat/completions。
 *   · **不泄漏 key**：报告里只有 key 的长度，没有任何明文片段。
 *   · **要能力**：`withTenant('agent.execute')` —— 匿名与 MEMBER 都拿不到。
 *   · **不缓存**：诊断结果一旦被缓存就不再是"当时"的结论（`no-store`）。
 */

import type { NextRequest } from 'next/server'
import { errorResponse, success } from '@/lib/api-response'
import { withTenant } from '@/lib/tenancy'
import { probeAgentConnectivity, summarizeConnectivity } from '@/lib/agents'

export const dynamic = 'force-dynamic'

export const GET = withTenant('agent.execute')(async (_req: NextRequest) => {
  try {
    const report = await probeAgentConnectivity(process.env)
    return success({ ...report, summary: summarizeConnectivity(report) })
  } catch (error) {
    return errorResponse(error)
  }
})
