/**
 * T06 · 工作流驱动器（**DB outbox 实现**）
 *
 * 这是"引擎"。业务侧钩子与运营视图在 `workflow.ts`；本文件只管：
 *   入队 → 领取（CAS + 租约）→ 执行 → 收尾（成功/重试/死信/失败/被取代）→ 人工接管
 *
 * ═══ 三条不变量（AC-07 / AC-17 全靠它们）═══
 *
 * 1. **同一业务动作只有一条任务** —— 由 `(organizationId, dedupeKey)` 唯一约束保证。
 *    入队撞唯一键不是错误，而是"已经排过队了"这一事实的正常表达。
 *
 * 2. **同一时刻只有一个执行者** —— 由 CAS（`updateMany` 带原状态与原租约值）+ 租约保证。
 *    崩溃的执行者不会被"超时后自动重发"变成第二次执行，因为**续租失败者不会写成功**：
 *    租约到期后任务回到可领取池，而抢到它的新执行者会走同一条幂等投递路径。
 *
 * 3. **终态不可复活** —— `SUCCEEDED/FAILED/DEAD/TAKEN_OVER/CANCELLED` 一律不再被自动领取。
 *    死信要人处置（`takeOverJob` / `requeueJobManually`），而不是被自动化重新捡起来。
 *
 * ═══ 与 T05 的接口约定（BACKLOG「交接 T06」）═══
 *   介绍的执行**原样调用** `introduceConnection()` —— 不另写一份校验。
 *   T05 已把 AC-06 的两段校验（提案自身 + 双方意图仍生效）与 CAS 写入收敛在那一个函数里；
 *   这里再抄一遍，就是给 AC-06 开了一条可以被绕开的旁路。
 */

import { db } from '@/lib/db'
import { ConflictError, ForbiddenError, NotFoundError } from '@/lib/errors'
import { decodeJson, encodeJson, introduceConnection } from '@/lib/connection'
import type { TenantContext } from '@/lib/tenancy'
import { parseTenantRole } from '@/lib/tenancy'
import { can } from '@/lib/tenancy/capabilities'
import { writeTenantAudit } from '@/lib/tenancy/audit'
import { deliverNotification, type DeliveryDeps } from './delivery'
import { NotificationLeakError, type NotificationTemplate } from './notification-content'
import { advanceIntroductionWorkflow } from './workflow'
import {
  DEFAULT_LEASE_MS,
  JobFailure,
  decideAfterFailure,
  deliveryDedupeKey,
  failureKindOf,
  jobDedupeKey,
  leaseExpiry,
  nextBackoffMs,
  type WorkflowJobKind,
} from './job-core'

// ═══════════════════════════════════════════════════════════════
// 入队（AC-07）
// ═══════════════════════════════════════════════════════════════

/**
 * 任务载荷。
 *
 * ⚠️ **只放寻址信息**：`recipientId` 决定"发给谁"，`decision` 让文案能微调。
 *   **不放** rationale、不放档案字段、不放任何要展示给用户的正文 ——
 *   任务载荷是内部调度凭据，正文由 `renderNotification()` 现场生成。
 *   把正文放进载荷，等于给了它一条绕开披露守卫的通道。
 */
export interface JobPayload {
  recipientId?: string
  /** T05 的决策类型，仅用于让文案区分"待处理"与"待你表态"。 */
  decision?: 'ACCEPT' | 'REJECT' | 'REVOKE'
}

export interface EnqueueJobInput {
  organizationId: string
  kind: WorkflowJobKind
  proposalId: string
  /** 通知类任务必须给（决定 dedupeKey 与收件人）。 */
  recipientId?: string
  missionId?: string | null
  payload?: JobPayload | null
  /** 延迟多久才可执行（默认 0 = 立即可领）。 */
  delayMs?: number
  maxAttempts?: number
}

export interface EnqueueResult {
  id: string
  /** true = 本次真的创建了；false = 已存在（重复入队，AC-07 的正常路径）。 */
  created: boolean
  dedupeKey: string
}

/**
 * 入队。**幂等**：同键重复调用不会产生第二条任务。
 *
 * 注意这里刻意**不**用 upsert：若已存在的任务已经 `SUCCEEDED`，
 * upsert 会把它的 `status` 重置回 `PENDING` —— 那等于让"已发过的通知"再发一次。
 * 幂等的正确含义是"什么都不做"，不是"重置为待办"。
 */
export async function enqueueJob(input: EnqueueJobInput, now: Date = new Date()): Promise<EnqueueResult> {
  const dedupeKey = jobDedupeKey(input.kind, {
    proposalId: input.proposalId,
    ...(input.recipientId ? { recipientId: input.recipientId } : {}),
  })

  const nextAttemptAt = input.delayMs && input.delayMs > 0 ? new Date(now.getTime() + input.delayMs) : now

  try {
    const row = await db.workflowJob.create({
      data: {
        organizationId: input.organizationId,
        dedupeKey,
        kind: input.kind,
        status: 'PENDING',
        proposalId: input.proposalId,
        missionId: input.missionId ?? null,
        payload: input.payload ? encodeJson(input.payload) : null,
        attempts: 0,
        maxAttempts: input.maxAttempts ?? 5,
        nextAttemptAt,
      },
      select: { id: true },
    })
    return { id: row.id, created: true, dedupeKey }
  } catch (err) {
    // 唯一键冲突 = 已入队。这不是异常，是"重复入队被正确吸收"。
    const existing = await db.workflowJob
      .findUnique({
        where: {
          organizationId_dedupeKey: { organizationId: input.organizationId, dedupeKey },
        },
        select: { id: true },
      })
      .catch(() => null)
    if (existing) return { id: existing.id, created: false, dedupeKey }
    throw err
  }
}

// ═══════════════════════════════════════════════════════════════
// 领取（CAS + 租约）
// ═══════════════════════════════════════════════════════════════

export interface ClaimedJob {
  id: string
  organizationId: string
  dedupeKey: string
  kind: WorkflowJobKind
  proposalId: string | null
  missionId: string | null
  payloadRaw: string | null
  attempts: number
  maxAttempts: number
}

export interface ClaimOptions {
  workerId: string
  limit: number
  now: Date
  /** 限定租户（cron 端点可全租户扫描；测试可限定）。 */
  organizationId?: string
  leaseMs?: number
}

export function readPayload(job: Pick<ClaimedJob, 'payloadRaw'>): JobPayload {
  return decodeJson<JobPayload>(job.payloadRaw, {})
}

/**
 * 领取一批可执行任务。
 *
 * 领取是 **CAS**：`updateMany` 的 where 里带上"读到的那个状态与那个租约值"，
 * 只有在这期间**没人改过**时 `count === 1`。于是两个 worker 同时领取同一行时，
 * 只有一个成功 —— 另一个 `count === 0`，安静地跳过。
 *
 * 若用"先读后写"（findUnique + update），两个 worker 会**都**认为自己领到了它，
 * 于是同一条通知被投递两次。这正是 AC-07 要防的形态。
 */
export async function claimJobs(opts: ClaimOptions): Promise<ClaimedJob[]> {
  const { workerId, limit, now } = opts
  if (limit <= 0) return []
  const leaseMs = opts.leaseMs ?? DEFAULT_LEASE_MS

  const candidates = await db.workflowJob.findMany({
    where: {
      ...(opts.organizationId ? { organizationId: opts.organizationId } : {}),
      OR: [
        { status: 'PENDING', nextAttemptAt: { lte: now } },
        // 租约过期的 RUNNING：上一个执行者崩了（AC-17 的崩溃恢复路径）。
        { status: 'RUNNING', lockedUntil: { lt: now } },
      ],
    },
    orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }],
    // 多取一些：CAS 可能被他人抢先，取少了会白跑一趟。
    take: Math.min(limit * 4, 200),
  })

  const claimed: ClaimedJob[] = []
  for (const row of candidates) {
    if (claimed.length >= limit) break

    const res = await db.workflowJob.updateMany({
      where: {
        id: row.id,
        organizationId: row.organizationId,
        status: row.status,
        lockedUntil: row.lockedUntil,
        nextAttemptAt: row.nextAttemptAt,
      },
      data: {
        status: 'RUNNING',
        lockedBy: workerId,
        lockedUntil: leaseExpiry(now, leaseMs),
      },
    })
    if (res.count !== 1) continue // 被别人抢走了 —— 跳过，不是错误

    claimed.push({
      id: row.id,
      organizationId: row.organizationId,
      dedupeKey: row.dedupeKey,
      kind: row.kind as WorkflowJobKind,
      proposalId: row.proposalId,
      missionId: row.missionId,
      payloadRaw: row.payload,
      attempts: row.attempts,
      maxAttempts: row.maxAttempts,
    })
  }
  return claimed
}

// ═══════════════════════════════════════════════════════════════
// 执行
// ═══════════════════════════════════════════════════════════════

export type ExecuteOutcome = 'SUCCEEDED' | 'RETRY' | 'DEAD' | 'FAILED' | 'SUPERSEDED' | 'LOST'

export interface ExecuteResult {
  jobId: string
  kind: WorkflowJobKind
  outcome: ExecuteOutcome
  attempts: number
  nextAttemptAt?: Date
  error?: string
}

export interface ExecuteDeps extends DeliveryDeps {
  now?: Date
}

export async function executeJob(job: ClaimedJob, deps: ExecuteDeps = {}): Promise<ExecuteResult> {
  const now = deps.now ?? new Date()
  const attempts = job.attempts + 1

  try {
    const outcome = await handleJob(job, now, deps)
    if (outcome.kind === 'SUPERSEDED') {
      await finishSuperseded(job, outcome.reason, now)
      return { jobId: job.id, kind: job.kind, outcome: 'SUPERSEDED', attempts, error: outcome.reason }
    }
    if (outcome.kind === 'LOST') {
      // CAS 更新 0 行 = 这次领取的租约已经不属于我们（到期被接管 / 被取消）。
      // 不能记成功，也不能记失败 —— 它不是"我们的结果"。
      return { jobId: job.id, kind: job.kind, outcome: 'LOST', attempts }
    }
    const ok = await finishSucceeded(job, now)
    return {
      jobId: job.id,
      kind: job.kind,
      outcome: ok ? 'SUCCEEDED' : 'LOST',
      attempts,
      ...(ok ? {} : { error: 'lease lost before completion' }),
    }
  } catch (rawErr) {
    // 先规范化：内容泄漏是**确定性**失败（模板固定，重试一万次还是泄漏），
    // 必须归为 permanent —— 否则它会被当作暂时性错误一路重试到耗尽，既浪费额度，
    // 又让"有一批通知因为内容越界发不出去"这件事淹没在重试日志里。
    const err = normalizeJobError(rawErr)
    const kind = failureKindOf(err)
    const message = err instanceof Error ? err.message : String(err)
    const decision = decideAfterFailure({ attempts, maxAttempts: job.maxAttempts, kind })

    switch (decision) {
      case 'SUPERSEDE':
        await finishSuperseded(job, message, now)
        return { jobId: job.id, kind: job.kind, outcome: 'SUPERSEDED', attempts, error: message }
      case 'FAIL':
        await finishFailed(job, message, now)
        return { jobId: job.id, kind: job.kind, outcome: 'FAILED', attempts, error: message }
      case 'DEAD':
        await finishDead(job, message, now)
        return { jobId: job.id, kind: job.kind, outcome: 'DEAD', attempts, error: message }
      case 'RETRY': {
        const delay = nextBackoffMs(attempts)
        const nextAttemptAt = new Date(now.getTime() + delay)
        await finishRetry(job, attempts, message, nextAttemptAt)
        return { jobId: job.id, kind: job.kind, outcome: 'RETRY', attempts, nextAttemptAt, error: message }
      }
    }
  }
}

// ── 收尾：全部用 CAS（只更新"仍归我们所有"的那一行）───────────────

async function finishSucceeded(job: ClaimedJob, now: Date): Promise<boolean> {
  // CAS：只收尾"仍是 RUNNING"的那一行。
  // 若期间任务被人工接管（→ TAKEN_OVER），count 会是 0 —— 那时**不**把它改回 SUCCEEDED：
  // 人的处置优先于自动流程的结论（通知即便已发出，也由人去核对）。
  const res = await db.workflowJob.updateMany({
    where: { id: job.id, organizationId: job.organizationId, status: 'RUNNING' },
    data: { status: 'SUCCEEDED', completedAt: now, lockedBy: null, lockedUntil: null, lastError: null },
  })
  return res.count === 1
}

async function finishRetry(
  job: ClaimedJob,
  attempts: number,
  message: string,
  nextAttemptAt: Date
): Promise<void> {
  await db.workflowJob.updateMany({
    where: { id: job.id, organizationId: job.organizationId, status: 'RUNNING' },
    data: {
      status: 'PENDING',
      attempts,
      nextAttemptAt,
      lastError: truncate(message),
      lockedBy: null,
      lockedUntil: null,
    },
  })
  await writeTenantAudit({
    organizationId: job.organizationId,
    actorId: null,
    eventType: 'workflow.retry_scheduled',
    resourceType: 'workflow_job',
    resourceId: job.id,
    safeMetadata: { kind: job.kind, attempts, nextAttemptAt: nextAttemptAt.toISOString() },
  }).catch(() => {})
}

async function finishDead(job: ClaimedJob, message: string, now: Date): Promise<void> {
  await db.workflowJob.updateMany({
    where: { id: job.id, organizationId: job.organizationId, status: 'RUNNING' },
    data: {
      status: 'DEAD',
      attempts: job.attempts + 1,
      lastError: truncate(message),
      deadLetteredAt: now,
      lockedBy: null,
      lockedUntil: null,
    },
  })
  await writeTenantAudit({
    organizationId: job.organizationId,
    actorId: null,
    eventType: 'workflow.dead_lettered',
    resourceType: 'workflow_job',
    resourceId: job.id,
    safeMetadata: { kind: job.kind, attempts: job.attempts + 1 },
  }).catch(() => {})
}

async function finishFailed(job: ClaimedJob, message: string, now: Date): Promise<void> {
  await db.workflowJob.updateMany({
    where: { id: job.id, organizationId: job.organizationId, status: 'RUNNING' },
    data: {
      status: 'FAILED',
      attempts: job.attempts + 1,
      lastError: truncate(message),
      completedAt: now,
      lockedBy: null,
      lockedUntil: null,
    },
  })
  await writeTenantAudit({
    organizationId: job.organizationId,
    actorId: null,
    eventType: 'workflow.failed_permanently',
    resourceType: 'workflow_job',
    resourceId: job.id,
    safeMetadata: { kind: job.kind, attempts: job.attempts + 1 },
  }).catch(() => {})
}

async function finishSuperseded(job: ClaimedJob, reason: string, now: Date): Promise<void> {
  // "被取代"记成 CANCELLED 而不是 FAILED：这不是失败，是"目标已由别的路径达成/已失效"。
  // 记成 FAILED 会让运营在告警里看到一个假失败（见 job-core 的三分法说明）。
  await db.workflowJob.updateMany({
    where: { id: job.id, organizationId: job.organizationId, status: 'RUNNING' },
    data: {
      status: 'CANCELLED',
      cancelledAt: now,
      lastError: truncate(reason),
      lockedBy: null,
      lockedUntil: null,
    },
  })
  await writeTenantAudit({
    organizationId: job.organizationId,
    actorId: null,
    eventType: 'workflow.superseded',
    resourceType: 'workflow_job',
    resourceId: job.id,
    safeMetadata: { kind: job.kind, reason: truncate(reason) },
  }).catch(() => {})
}

const MAX_ERROR_LENGTH = 500
function truncate(text: string): string {
  return text.length > MAX_ERROR_LENGTH ? `${text.slice(0, MAX_ERROR_LENGTH)}…` : text
}

/**
 * 把"内核不认识的异常"翻译成内核能分类的异常。
 *
 * 目前只处理一种：`NotificationLeakError`（渲染结果里混进了受保护原文）。
 * 它是**确定性**的 —— 同一条提案再算一次仍会泄漏，因为模板与 rationale 都没变。
 * 因此归为 `permanent`，让它立刻停在 FAILED 等人看，而不是重试 5 次再进死信。
 */
function normalizeJobError(err: unknown): unknown {
  if (err instanceof NotificationLeakError) {
    return new JobFailure('permanent', `notification_content_leak: ${err.message}`)
  }
  return err
}

// ═══════════════════════════════════════════════════════════════
// 处理器分发
// ═══════════════════════════════════════════════════════════════

type HandlerOutcome =
  | { kind: 'OK' }
  | { kind: 'SUPERSEDED'; reason: string }
  | { kind: 'LOST' }

async function handleJob(job: ClaimedJob, now: Date, deps: ExecuteDeps): Promise<HandlerOutcome> {
  switch (job.kind) {
    case 'INTRODUCE_CONNECTION':
      return handleIntroduce(job, now, deps)
    case 'PROPOSAL_CREATED':
      return handleNotify(job, now, 'proposal.pending', deps)
    case 'CONSENT_ACCEPTED':
      return handleNotify(job, now, 'proposal.accepted', deps)
    case 'COORDINATION_FOLLOWUP':
      return handleNotify(job, now, 'connection.followup', deps)
  }
}

/**
 * 介绍处理器 —— **AC-06 在队列化之后的落点**。
 *
 * 全部分量都压在"原样调用 `introduceConnection()`"。本函数**不做**任何
 * 独立的资格判断：它只负责（a）把明显不该跑的情况识别为 superseded，
 * （b）把 T05 的错误翻译成"要不要重试"，然后交给引擎。
 *
 * ⚠️ 尤其**不要**在这里"优化"成"先查一下提案状态再决定要不要调" ——
 *    那会把 AC-06 的两段校验拆成两处，而两处之间的时间窗口正是 race condition 的所在。
 */
async function handleIntroduce(job: ClaimedJob, now: Date, deps: ExecuteDeps): Promise<HandlerOutcome> {
  const proposalId = job.proposalId
  if (!proposalId) {
    throw new JobFailure('permanent', 'INTRODUCE_CONNECTION job has no proposalId')
  }

  const proposal = await db.connectionProposal.findFirst({
    where: { id: proposalId, organizationId: job.organizationId },
    select: {
      id: true,
      organizationId: true,
      missionId: true,
      proposerId: true,
      candidateId: true,
      status: true,
      introducedAt: true,
      rationale: true,
    },
  })
  if (!proposal) return { kind: 'SUPERSEDED', reason: 'proposal_not_found' }

  // 已介绍过 → **不能**直接判 superseded。上一次执行很可能是"介绍成功、通知阶段失败"，
  // 于是本任务被重试到这里。正确动作是**补投递**（投递本身幂等，重复调用只发一次），
  // 而不是把通知永久丢掉 —— 那会让"连接已建立"这件事永远没人知道。
  if (proposal.introducedAt !== null) {
    await advanceIntroductionWorkflow({
      organizationId: job.organizationId,
      proposalId,
      event: 'INTRODUCED',
      reason: 'introduce_already_landed_backfill',
      by: null,
      now,
    })
    await deliverIntroduceNotifications(job, now, deps, {
      organizationId: job.organizationId,
      proposalId,
      missionId: proposal.missionId,
      proposerId: proposal.proposerId,
      candidateId: proposal.candidateId,
    })
    return { kind: 'OK' }
  }
  // 已关闭（拒绝/撤销）：不该介绍 —— AC-05「撤销取消待发任务」。
  if (proposal.status === 'REJECTED') return { kind: 'SUPERSEDED', reason: 'proposal_rejected' }
  if (proposal.status === 'REVOKED') return { kind: 'SUPERSEDED', reason: 'proposal_revoked' }
  if (proposal.status !== 'MUTUALLY_ACCEPTED') {
    // 走到这里说明入队时并非双方同意，或状态被人改过 —— 需要人看一眼，重试无意义。
    throw new JobFailure('permanent', `Proposal is not mutually accepted (status=${proposal.status})`, {
      proposalId,
    })
  }

  const ctx = await operatorContext(job.organizationId, proposal.proposerId)

  try {
    // ★ AC-06：执行时校验 + CAS 写入，全部在 introduceConnection 内部完成。
    await introduceConnection(ctx, proposalId, now)
  } catch (err) {
    throw await translateIntroduceError(err, proposalId, job.organizationId, now)
  }

  // 介绍落地 → 先推进工作流阶段（记事实），再通知双方。
  // 顺序刻意如此：阶段推进是幂等的（applyEvent 不回退），先写它，
  // 之后无论通知成功与否，流程状态都已经是正确的。
  await advanceIntroductionWorkflow({
    organizationId: job.organizationId,
    proposalId,
    event: 'INTRODUCED',
    reason: 'introduce_job_succeeded',
    by: null,
    now,
  })

  // 介绍落地 → 通知双方（AC-14 的"介绍"段结束，进入"跟进"）。
  await deliverIntroduceNotifications(job, now, deps, {
    organizationId: job.organizationId,
    proposalId,
    missionId: proposal.missionId,
    proposerId: proposal.proposerId,
    candidateId: proposal.candidateId,
  })
  return { kind: 'OK' }
}

/**
 * 把 T05 的错误翻译成引擎能理解的失败分类。
 *
 * 这是本文件**最需要小心**的一段：分错的代价是"该重试的被永久放弃"或相反。
 * 判据（全部来自 T05 已定义的语义）：
 *   - 提案已不存在 / 已介绍 / 已拒绝 / 已撤销 / 已过期 → **superseded**（不该做，且不会变好）
 *   - 一方**意图**已失效（`*_intent_not_live`）→ **superseded**（AC-06 的正当拒绝）
 *   - 仍是 MUTUALLY_ACCEPTED 却 CAS 失败 → **retryable**（并发争抢，等一下就好）
 *   - 权限/成员身份问题 → **permanent**（重试一万次也一样）
 */
async function translateIntroduceError(
  err: unknown,
  proposalId: string,
  organizationId: string,
  now: Date
): Promise<unknown> {
  if (err instanceof JobFailure) return err

  if (err instanceof NotFoundError) {
    return new JobFailure('superseded', `proposal_not_found: ${err.message}`)
  }

  if (err instanceof ForbiddenError) {
    return new JobFailure('permanent', `introduce_forbidden: ${err.message}`)
  }

  if (err instanceof ConflictError) {
    const blockers = (err.details as { blockers?: string[] } | undefined)?.blockers ?? []

    // 先看字段级阻断原因（T05 的 IntroductionBlocker 语义）——
    // 逐一映射，不做"凡 409 皆 superseded"的粗判。
    if (blockers.includes('already_introduced')) {
      return new JobFailure('superseded', 'already_introduced')
    }
    if (blockers.includes('rejected')) return new JobFailure('superseded', 'proposal_rejected')
    if (blockers.includes('revoked')) return new JobFailure('superseded', 'proposal_revoked')
    if (blockers.includes('expired')) return new JobFailure('superseded', 'proposal_expired')
    if (blockers.some((b) => b.endsWith('_intent_not_live'))) {
      return new JobFailure('superseded', `intent_not_live:${blockers.join(',')}`)
    }

    // 没有可解释的阻断原因 → 重读一次现状，用**事实**而不是猜测来分类。
    const fresh = await db.connectionProposal
      .findFirst({
        where: { id: proposalId, organizationId },
        select: { status: true, introducedAt: true, expiresAt: true },
      })
      .catch(() => null)
    if (!fresh) return new JobFailure('superseded', 'proposal_not_found')
    if (fresh.introducedAt !== null) return new JobFailure('superseded', 'already_introduced')
    if (fresh.status === 'REJECTED') return new JobFailure('superseded', 'proposal_rejected')
    if (fresh.status === 'REVOKED') return new JobFailure('superseded', 'proposal_revoked')
    if (fresh.expiresAt && fresh.expiresAt.getTime() <= now.getTime()) {
      return new JobFailure('superseded', 'proposal_expired')
    }
    if (blockers.includes('not_mutually_accepted')) {
      // 仍是 MUTUALLY_ACCEPTED 却不是"双方同意"？只可能是入队逻辑出了问题 → 让人看。
      return new JobFailure('permanent', 'not_mutually_accepted')
    }
    // 到此：提案仍是 MUTUALLY_ACCEPTED，CAS 却被别人抢先 —— 并发，可重试。
    return new JobFailure('retryable', `introduce_cas_conflict: ${err.message}`)
  }

  // 未知错误 → 交给默认策略（retryable）。
  return err
}

/**
 * 以**发起提案的运营**身份执行系统任务。
 *
 * 为什么不是"系统万能身份"：介绍是一个**运营动作**（`proposal.create` 能力）。
 * 队列只是把"已经在运营授权下决定要做的事"延迟执行，它**不产生新的权限**。
 * 若发起该提案的运营已被移除或降级，介绍就应当停下等人接管，
 * 而不是由"系统"越过权限检查替他把事情做完 —— 那正是主指令禁止的
 * 「Agent 不能做最终权限判断」在反方向上的对应：系统也不能。
 */
async function operatorContext(organizationId: string, actorId: string): Promise<TenantContext> {
  const membership = await db.membership.findFirst({
    where: { organizationId, userId: actorId, status: 'ACTIVE' },
    select: { id: true, role: true },
  })
  const role = parseTenantRole(membership?.role)
  if (!membership || !role) {
    throw new JobFailure(
      'permanent',
      'The proposing operator is no longer an active member of this organization; manual takeover required'
    )
  }
  return { organizationId, userId: actorId, role, membershipId: membership.id }
}

/** 介绍落地后给双方各发一条通知（两个收件人 → 两条独立任务级投递）。 */
async function deliverIntroduceNotifications(
  job: ClaimedJob,
  now: Date,
  deps: ExecuteDeps,
  ref: {
    organizationId: string
    proposalId: string
    missionId: string | null
    proposerId: string
    candidateId: string
  }
): Promise<void> {
  const org = await db.organization.findUnique({
    where: { id: ref.organizationId },
    select: { name: true },
  })
  const mission = ref.missionId
    ? await db.mission.findUnique({ where: { id: ref.missionId }, select: { title: true, shareToken: true } })
    : null

  for (const recipientId of [ref.proposerId, ref.candidateId]) {
    for (const channel of ['IN_APP', 'EMAIL'] as const) {
      await deliverNotification(
        {
          organizationId: ref.organizationId,
          dedupeKey: deliveryDedupeKey({ jobDedupeKey: job.dedupeKey, channel, recipientId }),
          channel,
          recipientId,
          template: 'connection.introduced',
          organizationName: org?.name ?? '你的社群',
          missionTitle: mission?.title ?? null,
          actionUrl: mission?.shareToken ? `/m/${mission.shareToken}/proposals` : '/dashboard/connections',
          proposalId: ref.proposalId,
          missionId: ref.missionId,
          // 介绍已落地，rationale 早已对双方可见；但仍**不进渲染入参** ——
          // 通知不是披露渠道，这一点不因"现在可以看了"而改变。
          protectedTexts: [],
        },
        { emailSender: deps.emailSender, now }
      )
    }
  }
}

/** 通知类处理器。 */
async function handleNotify(
  job: ClaimedJob,
  now: Date,
  template: NotificationTemplate,
  deps: ExecuteDeps
): Promise<HandlerOutcome> {
  const payload = readPayload(job)
  const recipientId = payload.recipientId
  if (!recipientId) {
    throw new JobFailure('permanent', `${job.kind} job is missing payload.recipientId`)
  }
  const proposalId = job.proposalId
  if (!proposalId) {
    throw new JobFailure('permanent', `${job.kind} job is missing proposalId`)
  }

  const proposal = await db.connectionProposal.findFirst({
    where: { id: proposalId, organizationId: job.organizationId },
    select: {
      id: true,
      missionId: true,
      status: true,
      introducedAt: true,
      rationale: true,
    },
  })
  if (!proposal) return { kind: 'SUPERSEDED', reason: 'proposal_not_found' }

  // AC-05：撤销/拒绝之后，**待发的通知**不该再出街。
  if (proposal.status === 'REJECTED') return { kind: 'SUPERSEDED', reason: 'proposal_rejected' }
  if (proposal.status === 'REVOKED') return { kind: 'SUPERSEDED', reason: 'proposal_revoked' }

  const org = await db.organization.findUnique({
    where: { id: job.organizationId },
    select: { name: true },
  })
  const mission = proposal.missionId
    ? await db.mission.findUnique({
        where: { id: proposal.missionId },
        select: { title: true, shareToken: true },
      })
    : null

  for (const channel of ['IN_APP', 'EMAIL'] as const) {
    await deliverNotification(
      {
        organizationId: job.organizationId,
        dedupeKey: deliveryDedupeKey({ jobDedupeKey: job.dedupeKey, channel, recipientId }),
        channel,
        recipientId,
        template,
        organizationName: org?.name ?? '你的社群',
        missionTitle: mission?.title ?? null,
        actionUrl: mission?.shareToken ? `/m/${mission.shareToken}/proposals` : '/dashboard/connections',
        proposalId: proposal.id,
        missionId: proposal.missionId,
        // 披露边界：rationale 只作为"被检测对象"传入，绝不参与渲染。
        protectedTexts: [proposal.rationale],
      },
      { emailSender: deps.emailSender, now }
    )
  }
  return { kind: 'OK' }
}

// ═══════════════════════════════════════════════════════════════
// 人工接管 / 手动重试 / 取消
// ═══════════════════════════════════════════════════════════════

/**
 * 人工接管：把任务从自动流程手里取走。
 *
 * 接管之后**自动重试必须停止**（终态 `TAKEN_OVER` 不可被 `claimJobs` 领取）——
 * 否则运营刚看完、决定"先别发"，下一次 tick 就把它又发出去了。
 */
export async function takeOverJob(
  ctx: TenantContext,
  jobId: string,
  note: string | null = null,
  now: Date = new Date()
): Promise<void> {
  if (!can(ctx.role, 'workflow.manage')) {
    throw new ForbiddenError('Forbidden: taking over a workflow job requires workflow.manage')
  }

  const job = await db.workflowJob.findFirst({
    where: { id: jobId, organizationId: ctx.organizationId },
    select: { id: true, status: true },
  })
  if (!job) throw new NotFoundError('Workflow job not found')

  // CAS：只接管"仍非终态"的任务。已 SUCCEEDED 的任务接管没有意义。
  const res = await db.workflowJob.updateMany({
    where: {
      id: jobId,
      organizationId: ctx.organizationId,
      status: { in: ['PENDING', 'RUNNING', 'DEAD', 'FAILED'] },
    },
    data: {
      status: 'TAKEN_OVER',
      takenOverBy: ctx.userId,
      takenOverAt: now,
      lockedBy: null,
      lockedUntil: null,
      ...(note ? { lastError: truncate(`taken over: ${note}`) } : {}),
    },
  })
  if (res.count !== 1) {
    throw new ConflictError('Workflow job is already terminal and cannot be taken over')
  }

  await writeTenantAudit({
    organizationId: ctx.organizationId,
    actorId: ctx.userId,
    eventType: 'workflow.taken_over',
    resourceType: 'workflow_job',
    resourceId: jobId,
    safeMetadata: { from: job.status, note: note ? truncate(note) : null },
  }).catch(() => {})
}

/**
 * 人工重试：把死信/永久失败/已接管的任务**重新放回**待执行。
 *
 * 与 `enqueueJob` 的区别：这是**人明确要求再试一次**，所以允许重置 `attempts`。
 * 自动流程永远不该调用它 —— 那会让"耗尽重试"失去意义。
 */
export async function requeueJobManually(
  ctx: TenantContext,
  jobId: string,
  now: Date = new Date()
): Promise<void> {
  if (!can(ctx.role, 'workflow.manage')) {
    throw new ForbiddenError('Forbidden: requeueing a workflow job requires workflow.manage')
  }

  const res = await db.workflowJob.updateMany({
    where: {
      id: jobId,
      organizationId: ctx.organizationId,
      status: { in: ['DEAD', 'FAILED', 'TAKEN_OVER'] },
    },
    data: {
      status: 'PENDING',
      attempts: 0,
      nextAttemptAt: now,
      lockedBy: null,
      lockedUntil: null,
      deadLetteredAt: null,
      takenOverBy: null,
      takenOverAt: null,
      lastError: null,
    },
  })
  if (res.count !== 1) {
    throw new ConflictError('Workflow job is not in a state that can be requeued')
  }

  await writeTenantAudit({
    organizationId: ctx.organizationId,
    actorId: ctx.userId,
    eventType: 'workflow.requeued_manually',
    resourceType: 'workflow_job',
    resourceId: jobId,
    safeMetadata: {},
  }).catch(() => {})
}

/**
 * 取消某提案下所有**尚未完成**的任务（AC-05：「撤销取消待发任务并阻止后续动作」）。
 *
 * 只碰 `PENDING` / `RUNNING` / `DEAD`：
 *   - `SUCCEEDED` 不能取消 —— 已经发生的事实不可撤销（T05 R6 同一条取向）；
 *   - `DEAD` 也一并清掉 —— 否则撤销之后，一条死信还在运营的待办里等人处理。
 */
export async function cancelJobsForProposal(input: {
  organizationId: string
  proposalId: string
  reason: string
  now?: Date
}): Promise<number> {
  const now = input.now ?? new Date()
  const res = await db.workflowJob.updateMany({
    where: {
      organizationId: input.organizationId,
      proposalId: input.proposalId,
      status: { in: ['PENDING', 'RUNNING', 'DEAD'] },
    },
    data: {
      status: 'CANCELLED',
      cancelledAt: now,
      lastError: truncate(`cancelled: ${input.reason}`),
      lockedBy: null,
      lockedUntil: null,
    },
  })
  if (res.count > 0) {
    await writeTenantAudit({
      organizationId: input.organizationId,
      actorId: null,
      eventType: 'workflow.cancelled_by_upstream',
      resourceType: 'proposal',
      resourceId: input.proposalId,
      safeMetadata: { reason: input.reason, cancelled: res.count },
    }).catch(() => {})
  }
  return res.count
}

// ═══════════════════════════════════════════════════════════════
// tick（cron 驱动器）
// ═══════════════════════════════════════════════════════════════

export interface TickReport {
  workerId: string
  claimed: number
  succeeded: number
  retried: number
  dead: number
  failed: number
  superseded: number
  lost: number
  durationMs: number
  /** true = 因时间预算耗尽提前结束（Netlify 免费计划的函数上限内必须自己收手）。 */
  budgetExhausted: boolean
}

export interface TickOptions {
  workerId?: string
  limit?: number
  budgetMs?: number
  now?: Date
  organizationId?: string
  /** 注入邮件发送器（测试用）。 */
  emailSender?: DeliveryDeps['emailSender']
}

/** 默认单次 tick 的预算。Netlify 免费计划同步函数上限 10s，留足余量。 */
export const DEFAULT_TICK_BUDGET_MS = 8_000
export const DEFAULT_TICK_LIMIT = 20

/**
 * 跑一轮。**自己给自己设预算**：serverless 函数到点会被硬杀，
 * 那时既没有报告也没有收尾 —— 所以要在被杀之前主动停下，把已经处理完的如实汇报。
 */
export async function runWorkflowTick(opts: TickOptions = {}): Promise<TickReport> {
  const started = Date.now()
  const now = opts.now ?? new Date(started)
  const budgetMs = opts.budgetMs ?? DEFAULT_TICK_BUDGET_MS
  const limit = opts.limit ?? DEFAULT_TICK_LIMIT
  const workerId = opts.workerId ?? `tick-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`

  const report: TickReport = {
    workerId,
    claimed: 0,
    succeeded: 0,
    retried: 0,
    dead: 0,
    failed: 0,
    superseded: 0,
    lost: 0,
    durationMs: 0,
    budgetExhausted: false,
  }

  const jobs = await claimJobs({
    workerId,
    limit,
    now,
    ...(opts.organizationId ? { organizationId: opts.organizationId } : {}),
  })
  report.claimed = jobs.length

  for (const job of jobs) {
    if (Date.now() - started >= budgetMs) {
      report.budgetExhausted = true
      break
    }
    const result = await executeJob(job, {
      now: new Date(),
      ...(opts.emailSender !== undefined ? { emailSender: opts.emailSender } : {}),
    })
    switch (result.outcome) {
      case 'SUCCEEDED':
        report.succeeded++
        break
      case 'RETRY':
        report.retried++
        break
      case 'DEAD':
        report.dead++
        break
      case 'FAILED':
        report.failed++
        break
      case 'SUPERSEDED':
        report.superseded++
        break
      case 'LOST':
        report.lost++
        break
    }
  }

  report.durationMs = Date.now() - started
  return report
}

/**
 * 让当前 worker 释放租约（用于优雅退出）。
 * 未完成的 `RUNNING` 任务会因租约到期而被下一轮重新领取 —— 不需要额外补偿动作，
 * 因为整个执行路径是幂等的。
 */
export async function releaseLeases(workerId: string, now: Date = new Date()): Promise<number> {
  const res = await db.workflowJob.updateMany({
    where: { status: 'RUNNING', lockedBy: workerId },
    data: { status: 'PENDING', lockedBy: null, lockedUntil: null, nextAttemptAt: now },
  })
  return res.count
}

/**
 * 判断异常是否属于"通知内容越界"。
 *
 * 运维排障时用它区分两类失败：内容不合格（确定性，需改模板/数据）与网络抖动（重试即可）。
 * 注意 `normalizeJobError()` 已把这类失败归为 `permanent`，因此它**不会**被自动重试。
 */
export function isLeakageError(err: unknown): boolean {
  return err instanceof NotificationLeakError
}
