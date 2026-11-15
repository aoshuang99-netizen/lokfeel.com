/**
 * V21 · C03 `GET /api/v1/agents/runs/[runId]/events`
 *
 * 返回 `text/event-stream`，按 seq 顺序输出
 *   `id: <seq>` + `event: stage` + `data: JSON`，
 * 支持 `Last-Event-ID` 头从断点续传（只回 seq > lastId），流结束前发 `event: done`。
 *
 * ⚠️ **这是编排阶段事件，不是模型 token 流**：
 *    帧里的 note 与 SSE 注释行（中文）写明这一点，响应头用 ASCII 标识
 *    （`X-Stage-Semantics: orchestration-stages-not-token-stream`）。
 *    它记录服务端编排走到哪一步（QUOTA_CHECK / MODEL_CALL / SCHEMA_VALIDATE /
 *    PERSISTED / DEGRADED），不伪造逐 token 输出，也不声称实时转发模型生成过程。
 *
 * 权限 `withTenant('agent.run')`；取数谓词必带 organizationId，跨租户 404。
 */

import { NextResponse, type NextRequest } from 'next/server'
import { errorResponse } from '@/lib/api-response'
import { NotFoundError } from '@/lib/errors'
import { withTenant } from '@/lib/tenancy'
import {
  formatStageEventStream,
  getStageEvents,
} from '@/lib/agents/stage-events'

function runIdOf(params: unknown): string {
  const id = (params as { runId?: string } | undefined)?.runId
  if (!id || typeof id !== 'string') throw new NotFoundError('AgentRun not found')
  return id
}

function lastEventIdOf(req: NextRequest): number {
  const raw = req.headers.get('Last-Event-ID')
  if (raw === null) return 0
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

export const GET = withTenant('agent.run')(async (req: NextRequest, tenant, params) => {
  try {
    const runId = runIdOf(params)
    const lastId = lastEventIdOf(req)
    const events = await getStageEvents(tenant, runId, lastId)
    const payload = formatStageEventStream(events, lastId)

    return new NextResponse(payload, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        // ⚠️ 头值必须 ASCII：中文说明写在 SSE 注释行 / data.note / 代码注释里。
        'X-Event-Stream': 'orchestration-stages',
        'X-Stage-Semantics': 'orchestration-stages-not-token-stream',
      },
    })
  } catch (error) {
    return errorResponse(error)
  }
})
