/**
 * T06 · 介绍工作流实例（阶段状态机的**持久化层**）
 *
 * 与 `runtime.ts` 的分工：
 *   - `runtime.ts` 管"任务"（要执行什么副作用）；
 *   - 本文件管"流程"（这件事推进到哪一步了）。
 * 依赖方向是单向的：`runtime` 会调用本文件推进阶段，本文件**不**依赖 `runtime`
 * （否则钩子与引擎会互相 import，形成环）。
 *
 * 与 `ProposalDecision` 的取向对比（值得记）：
 *   - 表态表**刻意不留流水**（每人每提案一行，覆盖写）；
 *   - 本文件**刻意留流水**（`timeline` 追加式）。
 * 因为两者的用途不同：前者是"我现在的立场"，后者是"这个过程怎么走过来的"。
 * 复盘一条连接为什么卡住，靠的正是后者。
 */

import { db } from '@/lib/db'
import { decodeJson, encodeJson } from '@/lib/connection'
import {
  STAGE_ORDER,
  appendTimeline,
  applyEvent,
  isTerminalStage,
  stageIndex,
  type TimelineEntry,
  type WorkflowEvent,
  type WorkflowStage,
} from './stage-machine'
import { isStageTimedOut, type WorkflowJobStatus } from './job-core'

export interface EnsureWorkflowInput {
  organizationId: string
  proposalId: string
  missionId: string
  /** 触发者；系统触发为 null。 */
  by?: string | null
  now?: Date
}

/**
 * 幂等创建：一提案一条工作流。
 *
 * 用 `upsert` 而不是 `create`：钩子可能被重复触发（例如路由重试），
 * 而"已经存在"不是错误 —— 它正是幂等要吸收的情况。
 */
export async function ensureIntroductionWorkflow(
  input: EnsureWorkflowInput
): Promise<{ id: string; created: boolean }> {
  const now = input.now ?? new Date()
  const existing = await db.introductionWorkflow.findUnique({
    where: { proposalId: input.proposalId },
    select: { id: true },
  })
  if (existing) return { id: existing.id, created: false }

  try {
    const row = await db.introductionWorkflow.create({
      data: {
        organizationId: input.organizationId,
        proposalId: input.proposalId,
        missionId: input.missionId,
        stage: 'PROPOSED',
        stageEnteredAt: now,
        timeline: encodeJson([
          { stage: 'PROPOSED', at: now.toISOString(), by: input.by ?? null, reason: 'proposal_created' },
        ] satisfies TimelineEntry[]),
      },
      select: { id: true },
    })
    return { id: row.id, created: true }
  } catch {
    // 并发创建撞唯一键 → 读回胜者。
    const winner = await db.introductionWorkflow
      .findUnique({ where: { proposalId: input.proposalId }, select: { id: true } })
      .catch(() => null)
    if (winner) return { id: winner.id, created: false }
    throw new Error('Failed to ensure introduction workflow')
  }
}

export interface AdvanceWorkflowInput {
  organizationId: string
  proposalId: string
  event: WorkflowEvent
  reason: string
  by?: string | null
  now?: Date
}

export interface AdvanceWorkflowResult {
  stage: WorkflowStage
  /** true = 阶段真的变了；false = 已在该阶段（幂等，未追加时间线）。 */
  changed: boolean
}

/**
 * 推进阶段。
 *
 * 若工作流尚不存在（例如历史提案），**就地创建**再推进 ——
 * 让这一层对调用方是"总能用"的，而不是"必须先 ensure"。
 * 这避免了"某个调用点忘了 ensure，于是它的推进被静默丢弃"。
 */
export async function advanceIntroductionWorkflow(
  input: AdvanceWorkflowInput
): Promise<AdvanceWorkflowResult> {
  const now = input.now ?? new Date()

  let row = await db.introductionWorkflow.findUnique({
    where: { proposalId: input.proposalId },
  })

  if (!row) {
    const proposal = await db.connectionProposal.findFirst({
      where: { id: input.proposalId, organizationId: input.organizationId },
      select: { missionId: true },
    })
    if (!proposal) return { stage: 'PROPOSED', changed: false }
    await ensureIntroductionWorkflow({
      organizationId: input.organizationId,
      proposalId: input.proposalId,
      missionId: proposal.missionId,
      by: input.by ?? null,
      now,
    })
    row = await db.introductionWorkflow.findUnique({ where: { proposalId: input.proposalId } })
    if (!row) return { stage: 'PROPOSED', changed: false }
  }

  const current = row.stage as WorkflowStage
  const next = applyEvent(current, input.event)
  if (next === current) return { stage: current, changed: false }

  const timeline = appendTimeline(decodeJson<TimelineEntry[]>(row.timeline, []), {
    stage: next,
    at: now.toISOString(),
    by: input.by ?? null,
    reason: input.reason,
  })

  // CAS：只有 stage 仍是读到的那个才写，避免并发推进把时间线写乱。
  const res = await db.introductionWorkflow.updateMany({
    where: { id: row.id, organizationId: input.organizationId, stage: current },
    data: { stage: next, stageEnteredAt: now, timeline: encodeJson(timeline) },
  })
  if (res.count !== 1) {
    // 被人抢先推进了 —— 读回现状，不覆盖。
    const fresh = await db.introductionWorkflow
      .findUnique({ where: { proposalId: input.proposalId }, select: { stage: true } })
      .catch(() => null)
    return { stage: (fresh?.stage as WorkflowStage) ?? current, changed: false }
  }
  return { stage: next, changed: true }
}

export interface IntroductionWorkflowView {
  proposalId: string
  missionId: string
  stage: WorkflowStage
  stageEnteredAt: Date
  timeline: TimelineEntry[]
  stalled: boolean
}

export async function getIntroductionWorkflow(
  organizationId: string,
  proposalId: string,
  now: Date = new Date()
): Promise<IntroductionWorkflowView | null> {
  const row = await db.introductionWorkflow.findFirst({
    where: { proposalId, organizationId },
  })
  if (!row) return null
  return {
    proposalId: row.proposalId,
    missionId: row.missionId,
    stage: row.stage as WorkflowStage,
    stageEnteredAt: row.stageEnteredAt,
    timeline: decodeJson<TimelineEntry[]>(row.timeline, []),
    stalled: isStageTimedOut(row.stageEnteredAt, now),
  }
}

// ═══════════════════════════════════════════════════════════════
// 运营视图
// ═══════════════════════════════════════════════════════════════

export interface WorkflowJobView {
  id: string
  kind: string
  status: WorkflowJobStatus
  proposalId: string | null
  missionId: string | null
  attempts: number
  maxAttempts: number
  nextAttemptAt: Date
  lastError: string | null
  deadLetteredAt: Date | null
  takenOverAt: Date | null
  takenOverBy: string | null
  cancelledAt: Date | null
  completedAt: Date | null
  createdAt: Date
}

const JOB_SELECT = {
  id: true,
  kind: true,
  status: true,
  proposalId: true,
  missionId: true,
  attempts: true,
  maxAttempts: true,
  nextAttemptAt: true,
  lastError: true,
  deadLetteredAt: true,
  takenOverAt: true,
  takenOverBy: true,
  cancelledAt: true,
  completedAt: true,
  createdAt: true,
} as const

export async function listWorkflowJobs(
  organizationId: string,
  options: { statuses?: WorkflowJobStatus[]; limit?: number } = {}
): Promise<WorkflowJobView[]> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200)
  const rows = await db.workflowJob.findMany({
    where: {
      organizationId,
      ...(options.statuses?.length ? { status: { in: options.statuses } } : {}),
    },
    orderBy: [{ createdAt: 'desc' }],
    take: limit,
    select: JOB_SELECT,
  })
  return rows.map((r) => ({ ...r, kind: r.kind, status: r.status as WorkflowJobStatus }))
}

export interface WorkflowOverview {
  counts: Record<WorkflowJobStatus, number>
  /** 需要人处置的：死信 + 已接管。 */
  needsAttention: WorkflowJobView[]
  /** 停滞的阶段（超时未推进）。 */
  stalled: Array<{ proposalId: string; stage: WorkflowStage; stageEnteredAt: Date }>
  deliveries: { sent: number; captured: number; failed: number; pending: number }
}

const ALL_JOB_STATUSES: WorkflowJobStatus[] = [
  'PENDING',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'DEAD',
  'TAKEN_OVER',
  'CANCELLED',
]

/**
 * 「需要人处置」的任务状态。
 *
 * ⚠️ 这是**运营视图**（`getWorkflowOverview.needsAttention`）与**运营告警**
 * （`alerts.ts`）的共同判据 —— 两处必须一致，否则会出现"视图里有红点、
 * 告警却不触发"（或反之）的静默漂移。故提取为单一来源。
 */
export const ATTENTION_JOB_STATUSES: WorkflowJobStatus[] = ['DEAD', 'TAKEN_OVER', 'FAILED']

export async function getWorkflowOverview(
  organizationId: string,
  now: Date = new Date()
): Promise<WorkflowOverview> {
  const grouped = await db.workflowJob.groupBy({
    by: ['status'],
    where: { organizationId },
    _count: { _all: true },
  })
  const counts = Object.fromEntries(ALL_JOB_STATUSES.map((s) => [s, 0])) as Record<
    WorkflowJobStatus,
    number
  >
  for (const g of grouped) {
    const key = g.status as WorkflowJobStatus
    if (key in counts) counts[key] = g._count._all
  }

  const needsAttention = await listWorkflowJobs(organizationId, {
    statuses: ATTENTION_JOB_STATUSES,
    limit: 50,
  })

  // 停滞：仍停在非终态阶段、且进入该阶段已超过阈值。
  const stalledRows = await db.introductionWorkflow.findMany({
    where: { organizationId },
    orderBy: { stageEnteredAt: 'asc' },
    take: 200,
    select: { proposalId: true, stage: true, stageEnteredAt: true },
  })
  const stalled = stalledRows
    .filter((r) => !isTerminalStage(r.stage as WorkflowStage) && isStageTimedOut(r.stageEnteredAt, now))
    .map((r) => ({
      proposalId: r.proposalId,
      stage: r.stage as WorkflowStage,
      stageEnteredAt: r.stageEnteredAt,
    }))

  const [sent, captured, failed, pending] = await Promise.all([
    db.notificationDelivery.count({ where: { organizationId, status: 'SENT' } }),
    db.notificationDelivery.count({ where: { organizationId, status: 'CAPTURED' } }),
    db.notificationDelivery.count({ where: { organizationId, status: 'FAILED' } }),
    db.notificationDelivery.count({ where: { organizationId, status: 'PENDING' } }),
  ])

  return { counts, needsAttention, stalled, deliveries: { sent, captured, failed, pending } }
}

/** 列出某租户全部工作流（用于运营侧"连接进度"视图）。 */
export async function listIntroductionWorkflows(
  organizationId: string,
  options: { limit?: number } = {}
): Promise<Array<{ proposalId: string; missionId: string; stage: WorkflowStage; stageEnteredAt: Date }>> {
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 300)
  const rows = await db.introductionWorkflow.findMany({
    where: { organizationId },
    orderBy: { updatedAt: 'desc' },
    take: limit,
    select: { proposalId: true, missionId: true, stage: true, stageEnteredAt: true },
  })
  return rows.map((r) => ({
    proposalId: r.proposalId,
    missionId: r.missionId,
    stage: r.stage as WorkflowStage,
    stageEnteredAt: r.stageEnteredAt,
  }))
}

/** 阶段次序（供上层排序/展示，避免各处重复 import STAGE_ORDER）。 */
export { STAGE_ORDER, stageIndex }
