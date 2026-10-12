/**
 * T06 · 业务钩子 —— 把 T05 的业务事件翻译成工作流任务
 *
 * 调用点在**路由层**（T05 的提案创建 / 表态 / 撤销 / 介绍端点之后）。
 * 为什么不写进 T05 的服务层：那会让 T05 依赖 T06 的队列，而队列是本任务才引入的。
 * 依赖方向应当单向：**新层依赖旧层**，不是反过来。
 *
 * ═══ 入参为什么只有 id ═══
 * `ProposalDto`（T05 的对外 DTO）**刻意不含** `proposerId` / `candidateId` ——
 * 它只给 `myRole` 与 `counterpart`，为的是不给"通过 API 反查双方身份"留通道。
 * 钩子需要双方 id，因此**自己去数据库读**，而不是要求调用方（路由层）把它们
 * 从内部行里挖出来再传进来 —— 那会诱使路由层多读一次并可能把 id 放进响应。
 *
 * ═══ 可靠性缺口与它的补偿（必读）═══
 *
 * 钩子在业务写之后执行，**不在同一个事务里**。因此存在一个真实窗口：
 * "提案已创建，但入队失败（进程崩了 / DB 抖动）" → 提案在那里，却永远不会被通知。
 *
 * 两层补偿：
 *   1. **钩子自身不抛错**：入队失败只记进 `errors`，绝不让它把已经成功的业务操作
 *      变成 500 —— 那会让用户以为提案没创建成功，于是再点一次。
 *   2. **`reconcileMissingJobs()` 对账兜底**：tick 时扫描"已双方同意但未介绍"
 *      的提案补入队。由于入队幂等，补入队**不会**复活被人为取消或已进死信的任务。
 *
 * 第 2 点是这个设计成立的关键 —— 没有它，钩子失败就是静默丢消息；
 * 有了它，漏掉的任务会在下一轮被捡回来。
 */

import { db } from '@/lib/db'
import { enqueueJob, cancelJobsForProposal } from './runtime'
import { advanceIntroductionWorkflow, ensureIntroductionWorkflow } from './workflow'

/** 跟进的默认延迟：介绍落地 3 天后问一句"还顺利吗"。 */
export const FOLLOWUP_DELAY_MS = 3 * 24 * 60 * 60 * 1000

/** 钩子只需要"哪条提案、属于哪个租户"。 */
export interface ProposalRef {
  id: string
  organizationId: string
}

export interface HookResult {
  /** 本次真正新建的任务 id。 */
  enqueued: string[]
  /** 是否推进了工作流阶段。 */
  advanced: boolean
  /** 被取消的任务数（拒绝/撤销路径）。 */
  cancelled: number
  /** 非致命错误（已记录、不影响主业务）。 */
  errors: string[]
}

function newResult(): HookResult {
  return { enqueued: [], advanced: false, cancelled: 0, errors: [] }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

interface ProposalRow {
  id: string
  organizationId: string
  missionId: string
  proposerId: string
  candidateId: string
  status: 'CONSENT_PENDING' | 'MUTUALLY_ACCEPTED' | 'REJECTED' | 'REVOKED'
  introducedAt: Date | null
}

async function loadProposal(ref: ProposalRef): Promise<ProposalRow | null> {
  return (await db.connectionProposal.findFirst({
    where: { id: ref.id, organizationId: ref.organizationId },
    select: {
      id: true,
      organizationId: true,
      missionId: true,
      proposerId: true,
      candidateId: true,
      status: true,
      introducedAt: true,
    },
  })) as ProposalRow | null
}

/**
 * 提案创建之后：建工作流实例 + 通知被介绍方。
 *
 * 只通知**被介绍方**：发起方是自己点的"发起"，不需要系统再告诉他一遍。
 */
export async function onProposalCreated(ref: ProposalRef, now: Date = new Date()): Promise<HookResult> {
  const result = newResult()
  const proposal = await loadProposal(ref).catch((err) => {
    result.errors.push(`load_proposal: ${describe(err)}`)
    return null
  })
  if (!proposal) return result

  try {
    await ensureIntroductionWorkflow({
      organizationId: proposal.organizationId,
      proposalId: proposal.id,
      missionId: proposal.missionId,
      by: proposal.proposerId,
      now,
    })
  } catch (err) {
    result.errors.push(`ensure_workflow: ${describe(err)}`)
  }

  try {
    const r = await enqueueJob(
      {
        organizationId: proposal.organizationId,
        kind: 'PROPOSAL_CREATED',
        proposalId: proposal.id,
        recipientId: proposal.candidateId,
        missionId: proposal.missionId,
        payload: { recipientId: proposal.candidateId },
      },
      now
    )
    if (r.created) result.enqueued.push(r.id)
  } catch (err) {
    result.errors.push(`enqueue_proposal_created: ${describe(err)}`)
  }

  return result
}

/**
 * 一次表态之后：通知对方 / 取消待发 / 在双方同意时排入介绍。
 *
 * ⚠️ 状态是**重读**的，不是入参带来的：表态已经落库，这里读到的是权威现状。
 *   `ACCEPT` 之后提案可能仍是 `CONSENT_PENDING`（AC-04：一方同意不构成双方同意），
 *   只有读到 `MUTUALLY_ACCEPTED` 才排介绍任务。
 */
export async function onConsentDecided(
  ref: ProposalRef,
  input: { actorId: string; decision: 'ACCEPT' | 'REJECT' | 'REVOKE' },
  now: Date = new Date()
): Promise<HookResult> {
  const result = newResult()
  const proposal = await loadProposal(ref).catch((err) => {
    result.errors.push(`load_proposal: ${describe(err)}`)
    return null
  })
  if (!proposal) return result

  // ── 拒绝 / 撤销：AC-05「撤销取消待发任务并阻止后续动作」──
  if (input.decision !== 'ACCEPT') {
    try {
      result.cancelled = await cancelJobsForProposal({
        organizationId: proposal.organizationId,
        proposalId: proposal.id,
        reason: `proposal_${input.decision.toLowerCase()}`,
        now,
      })
    } catch (err) {
      result.errors.push(`cancel_jobs: ${describe(err)}`)
    }
    return result
  }

  const counterpartId =
    input.actorId === proposal.proposerId ? proposal.candidateId : proposal.proposerId

  // 阶段推进：双方同意就是 MUTUALLY_ACCEPTED，否则只是"有人表态了"。
  try {
    const mutual = proposal.status === 'MUTUALLY_ACCEPTED'
    const adv = await advanceIntroductionWorkflow({
      organizationId: proposal.organizationId,
      proposalId: proposal.id,
      event: mutual ? 'MUTUALLY_ACCEPTED' : 'CONSENT_RECORDED',
      reason: mutual ? 'mutual_consent' : 'consent_recorded',
      by: input.actorId,
      now,
    })
    result.advanced = adv.changed
  } catch (err) {
    result.errors.push(`advance_workflow: ${describe(err)}`)
  }

  // 通知对方（"对方已同意，等你表态"）。
  try {
    const r = await enqueueJob(
      {
        organizationId: proposal.organizationId,
        kind: 'CONSENT_ACCEPTED',
        proposalId: proposal.id,
        recipientId: counterpartId,
        missionId: proposal.missionId,
        payload: { recipientId: counterpartId, decision: 'ACCEPT' },
      },
      now
    )
    if (r.created) result.enqueued.push(r.id)
  } catch (err) {
    result.errors.push(`enqueue_consent_accepted: ${describe(err)}`)
  }

  // 双方同意 → 排入介绍（**提案级**任务，不带 recipientId）。
  if (proposal.status === 'MUTUALLY_ACCEPTED') {
    try {
      const r = await enqueueJob(
        {
          organizationId: proposal.organizationId,
          kind: 'INTRODUCE_CONNECTION',
          proposalId: proposal.id,
          missionId: proposal.missionId,
        },
        now
      )
      if (r.created) result.enqueued.push(r.id)
    } catch (err) {
      result.errors.push(`enqueue_introduce: ${describe(err)}`)
    }
  }

  return result
}

/**
 * 介绍落地之后：推进阶段 + 排入"跟进"。
 *
 * 两个调用点：
 *   - 队列执行（`runtime.handleIntroduce` 成功后）—— 由引擎自己推进与投递；
 *   - 同步端点（`POST /connections/{id}/introduce`）—— 由路由调用本钩子。
 * 两处都要，否则"同步介绍"不会产生跟进任务。
 */
export async function onConnectionIntroduced(
  ref: ProposalRef,
  now: Date = new Date()
): Promise<HookResult> {
  const result = newResult()
  const proposal = await loadProposal(ref).catch((err) => {
    result.errors.push(`load_proposal: ${describe(err)}`)
    return null
  })
  if (!proposal) return result

  try {
    const adv = await advanceIntroductionWorkflow({
      organizationId: proposal.organizationId,
      proposalId: proposal.id,
      event: 'INTRODUCED',
      reason: 'connection_introduced',
      by: null,
      now,
    })
    result.advanced = adv.changed
  } catch (err) {
    result.errors.push(`advance_workflow: ${describe(err)}`)
  }

  for (const recipientId of [proposal.proposerId, proposal.candidateId]) {
    try {
      const r = await enqueueJob(
        {
          organizationId: proposal.organizationId,
          kind: 'COORDINATION_FOLLOWUP',
          proposalId: proposal.id,
          recipientId,
          missionId: proposal.missionId,
          payload: { recipientId },
          delayMs: FOLLOWUP_DELAY_MS,
        },
        now
      )
      if (r.created) result.enqueued.push(r.id)
    } catch (err) {
      result.errors.push(`enqueue_followup: ${describe(err)}`)
    }
  }

  return result
}

/**
 * 对账：把"已双方同意、但没有任何介绍任务在跑"的提案补入队。
 *
 * **这是钩子非事务性的补偿**。判据刻意用"任务是否存在"而不是"是否刚刚入队"：
 * `enqueueJob` 撞到已存在的 dedupeKey 时会返回 `created: false`，
 * 所以被人工取消（`CANCELLED`）或已进死信（`DEAD`）的任务**不会**被复活 ——
 * 那正是我们要的：人处置过的任务，自动化不该偷偷把它捡回来。
 */
export async function reconcileMissingJobs(
  input: { limit?: number; now?: Date; organizationId?: string } = {}
): Promise<{ scanned: number; enqueued: number }> {
  const now = input.now ?? new Date()
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200)

  const rows = await db.connectionProposal.findMany({
    where: {
      ...(input.organizationId ? { organizationId: input.organizationId } : {}),
      status: 'MUTUALLY_ACCEPTED',
      introducedAt: null,
    },
    orderBy: { createdAt: 'asc' },
    take: limit,
    select: { id: true, organizationId: true, missionId: true },
  })

  let enqueued = 0
  for (const p of rows) {
    try {
      const r = await enqueueJob(
        {
          organizationId: p.organizationId,
          kind: 'INTRODUCE_CONNECTION',
          proposalId: p.id,
          missionId: p.missionId,
        },
        now
      )
      if (r.created) enqueued++
    } catch {
      // 单条失败不影响其余；下一轮 tick 会再试。
    }
  }
  return { scanned: rows.length, enqueued }
}
