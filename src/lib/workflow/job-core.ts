/**
 * T06 · 工作流任务内核（**纯函数，无 IO，零依赖**）
 *
 * 本文件是 outbox 的"决策大脑"：给定一个任务的状态与一次失败，算出下一步该做什么。
 * 所有 IO（读库、加锁、调外部服务）都在 `service.ts`；这里只做判定。
 *
 * 为什么要把判定抽出来：
 *   1. **可离线覆盖**：重试/超时/死信是最容易写错、又最难在集成测试里复现的部分
 *      （要造 5 次连续失败、要等租约过期）。纯函数让这些分支能被秒级穷举。
 *   2. **单一事实来源**：AC-17 要求"故障注入后无重复动作"。重复动作的来源无非两种 ——
 *      退避算错导致同一时刻两个 worker 都认为自己该跑，或终态判定漏了某个状态。
 *      把这两件事收敛到纯函数，就能用断言钉住，而不是靠人工推演。
 *
 * 依赖约定：本文件**不 import Prisma client**，类型用字符串字面量 union 表达，
 * 与 `prisma/schema/connection.prisma` 的枚举取值**逐字一致**。
 * 这样单测无需起数据库（与 `src/lib/tenancy/capabilities.ts` 同一取向）。
 */

// ═══════════════════════════════════════════════════════════════
// 类型：与 prisma/schema/connection.prisma 的枚举逐字一致
// ═══════════════════════════════════════════════════════════════

/** 任务类型。必须与 `WorkflowJobKind` 枚举同步。 */
export type WorkflowJobKind =
  | 'PROPOSAL_CREATED'
  | 'CONSENT_ACCEPTED'
  | 'INTRODUCE_CONNECTION'
  | 'COORDINATION_FOLLOWUP'

/** 任务状态。必须与 `WorkflowJobStatus` 枚举同步。 */
export type WorkflowJobStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'DEAD'
  | 'TAKEN_OVER'
  | 'CANCELLED'

/** 终态集合。**任何"还能不能被处理"的判定都必须先排除它们**。 */
export const TERMINAL_JOB_STATUSES: readonly WorkflowJobStatus[] = [
  'SUCCEEDED',
  'FAILED',
  'DEAD',
  'TAKEN_OVER',
  'CANCELLED',
] as const

export function isTerminalJobStatus(status: WorkflowJobStatus): boolean {
  return TERMINAL_JOB_STATUSES.includes(status)
}

// ═══════════════════════════════════════════════════════════════
// 幂等键（AC-07 的构造点）
// ═══════════════════════════════════════════════════════════════

/**
 * 构造任务幂等键。键的形状是 AC-07 的**一半**保证（另一半是数据库唯一约束）。
 *
 * 约定：
 *   - `PROPOSAL_CREATED` / `CONSENT_ACCEPTED` / `COORDINATION_FOLLOWUP` 是**针对某个收件人**
 *     的通知，键必须含收件人 —— 否则"通知双方"会退化成"只通知了一个人"。
 *   - `INTRODUCE_CONNECTION` 是**提案级**的原子动作（T05 R1 明确要求
 *     `(proposalId, 'introduce')` 固定），**不含收件人** —— 介绍只发生一次，与谁收到通知无关。
 *
 * ⚠️ 键里**不得**包含时间戳或随机数。那会让"重复入队"变成"两条任务"，
 * 而 AC-07 要的正是"重复入队只有一条"。
 */
export function jobDedupeKey(
  kind: WorkflowJobKind,
  ref: { proposalId: string; recipientId?: string }
): string {
  switch (kind) {
    case 'INTRODUCE_CONNECTION':
      // 提案级原子动作：同一个提案永远只有一条介绍任务。
      return `introduce:${ref.proposalId}`
    case 'PROPOSAL_CREATED':
      if (!ref.recipientId) {
        throw new Error('PROPOSAL_CREATED dedupe key requires recipientId')
      }
      return `proposal-created:${ref.proposalId}:${ref.recipientId}`
    case 'CONSENT_ACCEPTED':
      if (!ref.recipientId) {
        throw new Error('CONSENT_ACCEPTED dedupe key requires recipientId')
      }
      return `consent-accepted:${ref.proposalId}:${ref.recipientId}`
    case 'COORDINATION_FOLLOWUP':
      if (!ref.recipientId) {
        throw new Error('COORDINATION_FOLLOWUP dedupe key requires recipientId')
      }
      return `coordination-followup:${ref.proposalId}:${ref.recipientId}`
  }
}

/** 投递记录幂等键：同一业务动作对同一人只投递一次。 */
export function deliveryDedupeKey(input: {
  jobDedupeKey: string
  channel: 'IN_APP' | 'EMAIL'
  recipientId: string
}): string {
  return `${input.jobDedupeKey}:${input.channel.toLowerCase()}:${input.recipientId}`
}

// ═══════════════════════════════════════════════════════════════
// 退避（指数 + 抖动）
// ═══════════════════════════════════════════════════════════════

export interface BackoffPolicy {
  /** 首次重试的基准延迟。 */
  baseMs: number
  /** 指数因子。 */
  factor: number
  /** 上限（防止退避无界增长到宇宙热寂）。 */
  maxMs: number
  /** 抖动比例 0..1。 */
  jitterRatio: number
}

/**
 * 默认策略：30s → 1m → 2m → 4m → 8m（上限 30m），±25% 抖动。
 *
 * ⚠️ **抖动不是可选项**。若所有任务同时失败，固定退避会让它们在**同一毫秒**集体重试
 *   （惊群），把一次上游抖动放大成一次自我 DDoS。抖动把它们摊开。
 */
export const DEFAULT_BACKOFF: BackoffPolicy = {
  baseMs: 30_000,
  factor: 2,
  maxMs: 30 * 60_000,
  jitterRatio: 0.25,
}

/**
 * 第 `attempt` 次失败后的等待毫秒数（`attempt` 从 1 开始）。
 *
 * `rand` 可注入，便于测试给出**确定**的期望值 —— 否则断言只能写成范围，
 * 而范围断言对"抖动被误写成固定值"这件事是盲的。
 */
export function nextBackoffMs(
  attempt: number,
  policy: BackoffPolicy = DEFAULT_BACKOFF,
  rand: () => number = Math.random
): number {
  if (attempt < 1) return 0
  const raw = policy.baseMs * Math.pow(policy.factor, attempt - 1)
  const capped = Math.min(raw, policy.maxMs)
  if (policy.jitterRatio <= 0) return Math.round(capped)
  // 抖动区间 [capped*(1-r), capped*(1+r)]，但不超过 maxMs 也不低于 0。
  const spread = capped * policy.jitterRatio
  const jittered = capped - spread + rand() * spread * 2
  return Math.round(Math.max(0, Math.min(jittered, policy.maxMs * (1 + policy.jitterRatio))))
}

// ═══════════════════════════════════════════════════════════════
// 租约与可领取性（AC-17 崩溃恢复的落点）
// ═══════════════════════════════════════════════════════════════

/** 默认租约时长。取 60s：远大于一次投递的正常耗时，又短到崩溃后能及时被接手。 */
export const DEFAULT_LEASE_MS = 60_000

export function leaseExpiry(now: Date, leaseMs: number = DEFAULT_LEASE_MS): Date {
  return new Date(now.getTime() + leaseMs)
}

/** 租约是否仍然有效（有主）。 */
export function isLeaseAlive(
  job: { status: WorkflowJobStatus; lockedUntil: Date | null },
  now: Date
): boolean {
  if (job.status !== 'RUNNING') return false
  if (!job.lockedUntil) return false
  return job.lockedUntil.getTime() > now.getTime()
}

/**
 * 这个任务此刻能否被领取？
 *
 * 三种"能"：
 *   1. `PENDING` 且已到 `nextAttemptAt`（正常待执行）；
 *   2. `RUNNING` 但**租约已过期**（上一个执行者崩了 —— 这是 AC-17 的崩溃恢复路径）；
 *   3. 无。
 * 其他一律不能 —— 尤其是 `TAKEN_OVER` / `DEAD` / `SUCCEEDED` 等终态，
 * 它们**永远**不该被自动重试重新捡起来。
 *
 * ⚠️ 注意 `DEAD` 不在可领取之列：死信要人处置（`TAKEN_OVER`），
 *   让自动流程再捡它等于把"耗尽重试"这件事变成无限循环。
 */
export function isClaimable(
  job: {
    status: WorkflowJobStatus
    nextAttemptAt: Date
    lockedUntil: Date | null
  },
  now: Date
): boolean {
  if (isTerminalJobStatus(job.status)) return false
  if (job.status === 'RUNNING') {
    // 只有租约过期才可被他人接管（否则会把正在跑的任务抢走 → 重复投递）。
    return !isLeaseAlive(job, now)
  }
  return job.nextAttemptAt.getTime() <= now.getTime()
}

// ═══════════════════════════════════════════════════════════════
// 失败分类（AC-07 / AC-17 的核心判断）
// ═══════════════════════════════════════════════════════════════

/**
 * 失败的性质。**三种，不是两种** —— 这是本刀最容易写错的地方。
 *
 *   - `retryable`：暂时性（网络抖动、上游 5xx、DB 忙碌）。等一下再来。
 *   - `permanent`：确定性失败（提案不符合介绍条件、载荷非法）。重试一万次结果一样。
 *   - `superseded`：任务的**目标已经不需要达成**（提案已被他人介绍、上游已撤销）。
 *     这**不是失败** —— 是"这件事已经由别的路径处理了"。把它记成 FAILED 是错的：
 *     会让运营在告警里看到一个"失败"，而实际上系统运转完全正确。
 *     这正是 T05 的 CAS 语义（`updateMany({introducedAt: null})` 命中 0 行）
 *     在队列化之后的自然归宿。
 *
 * ⚠️ 若只分两类，`superseded` 必然被塞进 `permanent`，于是"提案已被介绍"
 *   在监控里长得和"数据损坏"一样。三分法是可观测性的前提。
 */
export type FailureKind = 'retryable' | 'permanent' | 'superseded'

/**
 * 带分类标记的失败。服务层在"知道原因"时抛它，内核据此决策。
 */
export class JobFailure extends Error {
  readonly kind: FailureKind
  /** 附加诊断信息（如 T05 的 blockers）。**不得**放正文内容或个人数据。 */
  readonly detail?: Record<string, unknown>

  constructor(kind: FailureKind, message: string, detail?: Record<string, unknown>) {
    super(message)
    this.name = 'JobFailure'
    this.kind = kind
    this.detail = detail
  }
}

export function isJobFailure(error: unknown): error is JobFailure {
  return error instanceof JobFailure
}

/**
 * 未知错误的默认分类。
 *
 * **默认 `retryable`**（而非 permanent）是一个刻意的取舍：
 *   - 投递类失败绝大多数是暂时性的（网络/限流/上游抖动），默认重试能自愈；
 *   - 代价有上限 —— `maxAttempts` 兜底，最终会进 `DEAD` 等人接管，不会无限循环；
 *   - 反过来（默认 permanent）会让一次网络抖动**永久**放弃一条真实通知，
 *     而且没人会发现（任务显示"已失败"而非"待重试"）。
 * 服务层对**已知**的确定性失败显式抛 `JobFailure('permanent')`，不走这条默认。
 */
export function failureKindOf(error: unknown): FailureKind {
  if (isJobFailure(error)) return error.kind
  return 'retryable'
}

/** 一次失败之后，任务该往哪走。 */
export type JobOutcome = 'RETRY' | 'DEAD' | 'FAIL' | 'SUPERSEDE'

export function decideAfterFailure(input: {
  attempts: number
  maxAttempts: number
  kind: FailureKind
}): JobOutcome {
  if (input.kind === 'superseded') return 'SUPERSEDE'
  if (input.kind === 'permanent') return 'FAIL'
  // retryable：还有预算就重试，用尽则进死信（等人，而不是永久放弃）。
  return input.attempts >= input.maxAttempts ? 'DEAD' : 'RETRY'
}

// ═══════════════════════════════════════════════════════════════
// 阶段超时（AC-17 的"超时"落点）
// ═══════════════════════════════════════════════════════════════

/**
 * 阶段停留多久算超时。
 *
 * 与"任务重试耗尽"是**两件事**：
 *   - 重试耗尽 = 某一次投递反复失败；
 *   - 阶段超时 = 投递都成功了，但业务**停在原地不动**（例如介绍落地后双方一个月没协调）。
 * 后者不会自己变成失败，只会静默地烂在那里 —— 所以需要一个显式的超时判据，
 * 让运营能看见"这些连接卡住了"。
 */
export const DEFAULT_STAGE_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000 // 7 天

export function isStageTimedOut(
  stageEnteredAt: Date,
  now: Date,
  timeoutMs: number = DEFAULT_STAGE_TIMEOUT_MS
): boolean {
  if (timeoutMs <= 0) return false
  return now.getTime() - stageEnteredAt.getTime() >= timeoutMs
}

/** 超时任务的可读标签（用于运营视图分组）。 */
export function stageTimeoutLabel(stage: string): string {
  return `stage-stalled:${stage}`
}
