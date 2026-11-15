/**
 * V21 · C03 —— Agent 运行**编排阶段事件**（服务层）
 *
 * ⚠️ 明确语义：这是**编排阶段事件**（QUOTA_CHECK / MODEL_CALL /
 *    SCHEMA_VALIDATE / PERSISTED / DEGRADED），**不是模型 token 流**。
 *    它记录的是"服务端编排走到哪一步、当时的事实是什么"，
 *    不伪造任何逐 token 输出，也不宣称模型生成过程被实时转发。
 *    这条边界同时写进代码注释、SSE 帧的 note 与响应头。
 */

import { db } from '@/lib/db'
import { NotFoundError } from '@/lib/errors'
import type { TenantContext } from '@/lib/tenancy'

export const STAGE_NOTE = '编排阶段事件，不是模型 token 流'

export interface OrchestrationFacts {
  /** 额度是否已查（读账本 + 方案派生完成）。 */
  quotaChecked: boolean
  /** 额度是否把本次运行拦下。 */
  quotaBlocked: boolean
  providerKind: string
  callCount: number
  /** runSkill 产出是否通过契约校验。 */
  schemaValid: boolean
  status: string
  degradeCode: string | null
  persistedRunId: string
}

export interface PlannedStage {
  seq: number
  stage: string
  detail: Record<string, unknown>
}

export interface StageEventRow {
  id: string
  organizationId: string
  runId: string
  seq: number
  stage: string
  at: Date
  detail: string | null
}

/** 由编排事实生成阶段计划（纯函数，便于断言"至少 4 个关键点"）。 */
export function buildOrchestrationStages(facts: OrchestrationFacts): PlannedStage[] {
  const stages: PlannedStage[] = [
    {
      seq: 1,
      stage: 'QUOTA_CHECK',
      detail: { checked: facts.quotaChecked, blocked: facts.quotaBlocked },
    },
    {
      seq: 2,
      stage: 'MODEL_CALL',
      detail: { providerKind: facts.providerKind, callCount: facts.callCount },
    },
    {
      seq: 3,
      stage: 'SCHEMA_VALIDATE',
      detail: { schemaValid: facts.schemaValid },
    },
    {
      seq: 4,
      stage: 'PERSISTED',
      detail: { runId: facts.persistedRunId, status: facts.status },
    },
  ]

  // 失败 / 降级 / 契约拒绝路径额外留一个 DEGRADED 阶段（**不是**成功）。
  const degraded =
    facts.status === 'DEGRADED' ||
    facts.status === 'BLOCKED_QUOTA' ||
    facts.status === 'FAILED' ||
    !facts.schemaValid
  if (degraded) {
    stages.push({
      seq: stages.length + 1,
      stage: 'DEGRADED',
      detail: { status: facts.status, degradeCode: facts.degradeCode },
    })
  }
  return stages
}

/** SSE 帧格式化（纯函数）：只回 seq > lastId，末尾追加 event: done。 */
export function formatStageEventStream(events: StageEventRow[], lastId: number): string {
  const safeLastId = Number.isFinite(lastId) && lastId > 0 ? Math.floor(lastId) : 0
  const chunks: string[] = [
    `: V21 C03 编排阶段事件（${STAGE_NOTE}）；Last-Event-ID=${safeLastId}\n\n`,
  ]

  for (const e of events) {
    if (e.seq <= safeLastId) continue
    const data = JSON.stringify({
      id: e.id,
      seq: e.seq,
      stage: e.stage,
      at: e.at instanceof Date ? e.at.toISOString() : new Date(e.at).toISOString(),
      detail: e.detail ? JSON.parse(e.detail) : null,
      note: STAGE_NOTE,
    })
    chunks.push(`id: ${e.seq}\nevent: stage\ndata: ${data}\n\n`)
  }

  const lastSeq = events
    .filter((e) => e.seq > safeLastId)
    .reduce((max, e) => Math.max(max, e.seq), safeLastId)
  chunks.push(
    `event: done\ndata: ${JSON.stringify({ note: STAGE_NOTE, lastEventId: lastSeq })}\n\n`
  )
  return chunks.join('')
}

/** SSE 取数：先按 (id, organizationId) 确认运行存在，再取 seq > lastId 的事件。 */
export async function getStageEvents(
  ctx: TenantContext,
  runId: string,
  lastId: number = 0
): Promise<StageEventRow[]> {
  const run = await db.agentRun.findFirst({
    where: { id: runId, organizationId: ctx.organizationId },
    select: { id: true },
  })
  if (!run) throw new NotFoundError('AgentRun not found')

  const safeLastId = Number.isFinite(lastId) && lastId > 0 ? Math.floor(lastId) : 0
  return (await db.agentRunStageEvent.findMany({
    where: {
      organizationId: ctx.organizationId,
      runId,
      seq: { gt: safeLastId },
    },
    orderBy: { seq: 'asc' },
  })) as unknown as StageEventRow[]
}

/** 一次性写入阶段事件（seq 由 buildOrchestrationStages 保证递增）。 */
export async function emitStageEvents(
  organizationId: string,
  runId: string,
  stages: PlannedStage[],
  at: Date
): Promise<void> {
  if (stages.length === 0) return
  await db.agentRunStageEvent.createMany({
    data: stages.map((s) => ({
      organizationId,
      runId,
      seq: s.seq,
      stage: s.stage,
      at,
      detail: JSON.stringify(s.detail),
    })),
  })
}
