/**
 * T08 · 成果（Outcome）服务层
 *
 * 三条不变量（AC-15 的落点）：
 *   ① **自报不算验证成功** —— 级别由 `deriveVerificationLevel` 派生，**不接受入参**；
 *   ② **不得自我确认** —— 上报人不能把自己的自报抬成"双方确认"；
 *   ③ **租户谓词不可省** —— 每个查询都以 `organizationId` 为首要条件。
 *
 * 阶段机接线（T06 交接项 ①，此前 `ACTION_COMPLETED` / `OUTCOME_RECORDED`
 * **只有定义、没有任何触发点**）：
 *   上报成果           → `ACTION_COMPLETED`（有产出了，但**尚未被承认**）
 *   对手方确认 / 运营核验 → `OUTCOME_RECORDED`（**终态**）
 * 一律经 `advanceIntroductionWorkflow`（CAS 推进 + 时间线），**不另写一份推进逻辑**。
 * 🔴 与 T06 `risks.md` R7 一致：**不做**"到点自动置为已完成" —— 成果是**人**声明的。
 */

import { db } from '@/lib/db'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { can } from '@/lib/tenancy/capabilities'
import { writeTenantAudit } from '@/lib/tenancy/audit'
import type { TenantContext } from '@/lib/tenancy/resolve'
import { partyRoleOf } from '@/lib/connection/proposals'
import { advanceIntroductionWorkflow } from '@/lib/workflow/workflow'
import {
  deriveVerificationLevel,
  isVerified,
  outcomeRoleOf,
  VERIFIED_LEVELS,
  type OutcomeRole,
  type OutcomeVerificationLevel,
} from './verification'

export const OUTCOME_LIMITS = {
  /** 太短的"成果"等于没成果（与 `PROPOSAL_LIMITS.rationaleMin` 同一取向）。 */
  summaryMin: 8,
  summaryMax: 1000,
  /** 核验证据摘要上限（脱敏后落库）。 */
  evidenceMax: 500,
  /** 核验备注上限。 */
  noteMax: 300,
} as const

// ═══════════════════════════════════════════════════════════
// DTO —— 投影边界：**不含** reporterId / counterpartyId / evidence 原文
// ═══════════════════════════════════════════════════════════

export interface OutcomeVerificationView {
  level: OutcomeVerificationLevel
  at: string
}

export interface OutcomeDto {
  id: string
  missionId: string
  proposalId: string
  /** 自报陈述。属于**社群级产出**，与"谁跟谁连接"是两件事，故对读权限持有者可见。 */
  summary: string
  verificationLevel: OutcomeVerificationLevel
  /** `= isVerified(verificationLevel)`。UI 与指标都读它，**不要**各自比较 enum 字面量。 */
  verified: boolean
  occurredAt: string
  reportedAt: string
  /** 我相对本条成果的角色（**不是** userId）。 */
  myRole: OutcomeRole
  /** 我此刻能否做「对手方确认」（角色 + 尚未确认）。 */
  canConfirm: boolean
  /** 我此刻能否做「外部核验」（仅 ADMIN+ 且尚未核验）。 */
  canVerify: boolean
  /**
   * 已收到的验证记录。⚠️ **只给级别与时间** —— `note` / `evidence` 一律不外发
   * （与 T05 §3.7「拒绝理由不回流」同一取向：否则就成了一次计划外的信息披露）。
   */
  verifications: OutcomeVerificationView[]
}

// ═══════════════════════════════════════════════════════════
// 行 → DTO
// ═══════════════════════════════════════════════════════════

interface OutcomeRow {
  id: string
  organizationId: string
  proposalId: string
  missionId: string
  reporterId: string
  counterpartyId: string
  summary: string
  verificationLevel: string
  occurredAt: Date
  createdAt: Date
}

interface VerificationRow {
  level: string
  actorId: string | null
  createdAt: Date
}

function toVerificationViews(rows: readonly VerificationRow[]): OutcomeVerificationView[] {
  return [...rows]
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map((v) => ({ level: v.level as OutcomeVerificationLevel, at: v.createdAt.toISOString() }))
}

export function toOutcomeDto(
  row: OutcomeRow,
  verifications: readonly VerificationRow[],
  ctx: TenantContext
): OutcomeDto {
  const level = row.verificationLevel as OutcomeVerificationLevel
  const myRole = outcomeRoleOf(row, ctx.userId)
  const confirmedByCounterparty = verifications.some(
    (v) => (v.level as OutcomeVerificationLevel) === 'COUNTERPARTY_CONFIRMED'
  )
  const verifiedExternally = verifications.some(
    (v) => (v.level as OutcomeVerificationLevel) === 'EXTERNALLY_VERIFIED'
  )
  return {
    id: row.id,
    missionId: row.missionId,
    proposalId: row.proposalId,
    summary: row.summary,
    verificationLevel: level,
    verified: isVerified(level),
    occurredAt: row.occurredAt.toISOString(),
    reportedAt: row.createdAt.toISOString(),
    myRole,
    // 只有对手方能确认；且确认过就不再提示（AC-18：不留"点了必然 409"的按钮）。
    canConfirm: myRole === 'COUNTERPARTY' && !confirmedByCounterparty,
    canVerify: can(ctx.role, 'outcome.verify') && !verifiedExternally,
    verifications: toVerificationViews(verifications),
  }
}

// ═══════════════════════════════════════════════════════════
// 上报（AC-15 的入口）
// ═══════════════════════════════════════════════════════════

export interface ReportOutcomeInput {
  proposalId: string
  summary: string
  /** 成果发生时间（可选，缺省 = 现在）。允许回填，但**不得早于介绍时间**。 */
  occurredAt?: Date | string | null
}

function normalizeSummary(raw: unknown): string {
  if (typeof raw !== 'string') throw new ValidationError('summary must be a string', { field: 'summary' })
  const summary = raw.trim()
  if (summary.length < OUTCOME_LIMITS.summaryMin) {
    throw new ValidationError(`summary must be at least ${OUTCOME_LIMITS.summaryMin} characters`, {
      field: 'summary',
    })
  }
  if (summary.length > OUTCOME_LIMITS.summaryMax) {
    throw new ValidationError(`summary must be at most ${OUTCOME_LIMITS.summaryMax} characters`, {
      field: 'summary',
    })
  }
  return summary
}

function normalizeOccurredAt(raw: Date | string | null | undefined, now: Date): Date {
  if (raw === null || raw === undefined) return now
  const at = raw instanceof Date ? raw : new Date(raw)
  if (Number.isNaN(at.getTime())) {
    throw new ValidationError('occurredAt is not a valid date', { field: 'occurredAt' })
  }
  return at
}

/**
 * 上报成果。
 *
 * 权限：`outcome.report`（全员）**只是进这道门**；真正的判据是
 * **"你是不是这条提案的当事方"**（服务层判定）—— 第三方即便有该能力也不能代报。
 *
 * 前置：提案必须**已介绍**（`introducedAt !== null`）—— 成果是"连接建立之后"的产出，
 * 没有连接就没有成果。未介绍 → 409。
 */
export async function reportOutcome(
  ctx: TenantContext,
  input: ReportOutcomeInput,
  now: Date = new Date()
): Promise<OutcomeDto> {
  if (!can(ctx.role, 'outcome.report')) {
    throw new ForbiddenError('Forbidden: reporting an outcome requires the outcome.report capability')
  }
  const proposalId = typeof input?.proposalId === 'string' ? input.proposalId.trim() : ''
  if (!proposalId) throw new ValidationError('proposalId is required', { field: 'proposalId' })
  const summary = normalizeSummary(input?.summary)
  const occurredAt = normalizeOccurredAt(input?.occurredAt, now)

  const proposal = await db.connectionProposal.findFirst({
    where: { id: proposalId, organizationId: ctx.organizationId },
    select: {
      id: true,
      missionId: true,
      proposerId: true,
      candidateId: true,
      status: true,
      introducedAt: true,
    },
  })
  if (!proposal) throw new NotFoundError('Proposal not found')

  // 当事人判据：只有提案双方能上报成果。
  if (partyRoleOf(proposal, ctx.userId) === null) {
    throw new ForbiddenError('Only a party of this proposal can report an outcome')
  }

  if (proposal.introducedAt === null) {
    throw new ConflictError('Cannot report an outcome before the connection is introduced', {
      blockers: ['not_introduced'],
    })
  }
  if (proposal.status === 'REJECTED' || proposal.status === 'REVOKED') {
    throw new ConflictError('Cannot report an outcome for a closed proposal', {
      blockers: [proposal.status.toLowerCase()],
    })
  }
  if (occurredAt.getTime() < proposal.introducedAt.getTime()) {
    throw new ValidationError('occurredAt cannot be earlier than the introduction time', {
      field: 'occurredAt',
    })
  }

  const counterpartyId =
    proposal.proposerId === ctx.userId ? proposal.candidateId : proposal.proposerId

  // 一个提案只落一份成果（`Outcome.proposalId` 唯一）。先查后写 + 并发兜底。
  const existing = await db.outcome.findUnique({
    where: { proposalId: proposal.id },
    select: { id: true },
  })
  if (existing) {
    throw new ConflictError('An outcome has already been reported for this proposal', {
      outcomeId: existing.id,
    })
  }

  let outcomeId: string
  try {
    const created = await db.outcome.create({
      data: {
        organizationId: ctx.organizationId,
        proposalId: proposal.id,
        missionId: proposal.missionId,
        reporterId: ctx.userId,
        counterpartyId,
        summary,
        verificationLevel: 'SELF_REPORTED',
        occurredAt,
      },
      select: { id: true },
    })
    outcomeId = created.id
  } catch {
    // 并发：另一个请求先写了（唯一键 proposalId 撞车）→ 读回胜者并如实报冲突。
    const winner = await db.outcome
      .findUnique({ where: { proposalId: proposal.id }, select: { id: true } })
      .catch(() => null)
    if (winner) {
      throw new ConflictError('An outcome has already been reported for this proposal', {
        outcomeId: winner.id,
      })
    }
    throw new Error('Failed to create outcome')
  }

  await writeTenantAudit({
    organizationId: ctx.organizationId,
    actorId: ctx.userId,
    eventType: 'outcome.reported',
    resourceType: 'outcome',
    resourceId: outcomeId,
    // ⚠️ 只记标识与级别，**不记** summary 原文（可能含 PII）。
    safeMetadata: { missionId: proposal.missionId, proposalId: proposal.id, level: 'SELF_REPORTED' },
  }).catch(() => {})

  // 阶段机接线：产物已出现 → ACTION_COMPLETED（但**尚未**被承认）。
  await advanceIntroductionWorkflow({
    organizationId: ctx.organizationId,
    proposalId: proposal.id,
    event: 'ACTION_COMPLETED',
    reason: 'outcome_reported',
    by: ctx.userId,
    now,
  }).catch(() => {})

  const dto = await getOutcomeById(ctx, outcomeId)
  if (!dto) throw new Error('Failed to load created outcome')
  return dto
}

// ═══════════════════════════════════════════════════════════
// 读
// ═══════════════════════════════════════════════════════════

const OUTCOME_SELECT = {
  id: true,
  organizationId: true,
  proposalId: true,
  missionId: true,
  reporterId: true,
  counterpartyId: true,
  summary: true,
  verificationLevel: true,
  occurredAt: true,
  createdAt: true,
} as const

/**
 * 读单条成果（租户谓词不可省）。
 *
 * 刻意**不接收 `now`** —— 它的输出完全由已落库的行与记录集决定，与"现在几点"无关。
 * （若日后要在 DTO 里加"距上次确认多久"这类派生字段，再加参数。）
 */
export async function getOutcomeById(
  ctx: TenantContext,
  outcomeId: string
): Promise<OutcomeDto | null> {
  if (!outcomeId) return null
  const row = (await db.outcome.findFirst({
    where: { id: outcomeId, organizationId: ctx.organizationId },
    select: OUTCOME_SELECT,
  })) as OutcomeRow | null
  if (!row) return null
  const verifications = (await db.outcomeVerification.findMany({
    where: { outcomeId: row.id, organizationId: ctx.organizationId },
    select: { level: true, actorId: true, createdAt: true },
  })) as VerificationRow[]
  return toOutcomeDto(row, verifications, ctx)
}

export interface ListOutcomesOptions {
  /** 只看某级别（对外级别）。 */
  level?: OutcomeVerificationLevel
  missionId?: string
  /** 只看"已验证"（`isVerified` 派生的级别集合，**不手写**）。 */
  verifiedOnly?: boolean
  limit?: number
}

/**
 * 租户级成果列表。
 *
 * `verificationLevel` 是**落库的派生快照**，所以"只看已验证"可以**下推 SQL**
 * （不需要像 T07 的 pipeline 那样取一批再内存过滤）—— 这是"派生快照"设计换来的。
 * 级别集合经 `VERIFIED_LEVELS`（由 `isVerified` 派生），**不手写**字面量。
 */
export async function listOutcomes(
  ctx: TenantContext,
  options: ListOutcomesOptions = {}
): Promise<OutcomeDto[]> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200)
  const levelFilter = options.verifiedOnly
    ? { in: [...VERIFIED_LEVELS] }
    : options.level
      ? options.level
      : undefined

  const rows = (await db.outcome.findMany({
    where: {
      organizationId: ctx.organizationId,
      ...(levelFilter ? { verificationLevel: levelFilter } : {}),
      ...(options.missionId ? { missionId: options.missionId } : {}),
    },
    orderBy: [{ createdAt: 'desc' }],
    take: limit,
    select: OUTCOME_SELECT,
  })) as OutcomeRow[]

  if (rows.length === 0) return []

  // 一次查回全部验证记录（避免 N+1），再按 outcomeId 分组。
  const allVerifications = (await db.outcomeVerification.findMany({
    where: {
      organizationId: ctx.organizationId,
      outcomeId: { in: rows.map((r) => r.id) },
    },
    select: { outcomeId: true, level: true, actorId: true, createdAt: true },
  })) as Array<VerificationRow & { outcomeId: string }>

  const byOutcome = new Map<string, VerificationRow[]>()
  for (const v of allVerifications) {
    if (!byOutcome.has(v.outcomeId)) byOutcome.set(v.outcomeId, [])
    byOutcome.get(v.outcomeId)!.push(v)
  }

  return rows.map((r) => toOutcomeDto(r, byOutcome.get(r.id) ?? [], ctx))
}

// ═══════════════════════════════════════════════════════════
// 确认（对手方） / 核验（运营）
// ═══════════════════════════════════════════════════════════

/** 重算派生快照并写回。返回算出的级别。 */
async function refreshVerificationLevel(
  organizationId: string,
  outcomeId: string
): Promise<OutcomeVerificationLevel> {
  const all = (await db.outcomeVerification.findMany({
    where: { outcomeId, organizationId },
    select: { level: true },
  })) as Array<{ level: string }>
  const level = deriveVerificationLevel(
    all.map((v) => ({ level: v.level as OutcomeVerificationLevel }))
  )
  await db.outcome.updateMany({
    where: { id: outcomeId, organizationId },
    data: { verificationLevel: level },
  })
  return level
}

export interface ConfirmOutcomeInput {
  /** 可选备注（落库供审计，**不回流**给对侧）。 */
  note?: string | null
}

function normalizeNote(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw !== 'string') throw new ValidationError('note must be a string', { field: 'note' })
  const note = raw.trim()
  if (note.length === 0) return null
  if (note.length > OUTCOME_LIMITS.noteMax) {
    throw new ValidationError(`note must be at most ${OUTCOME_LIMITS.noteMax} characters`, {
      field: 'note',
    })
  }
  return note
}

/**
 * **对手方确认**。
 *
 * 两条硬约束（AC-15 的核心）：
 *   ① **不得自我确认** —— 上报人自己调本端点 → 400（不是 403：这不是权限问题，
 *      而是**语义上不成立**的请求）；
 *   ② 只有**对手方**能确认 —— 第三方（OBSERVER）→ 403。
 *
 * 幂等：同一人对同一成果的同一级别只落一条记录（唯一键 `(outcomeId, level, actorId)`）。
 * 重复提交**不报错**，回放当前状态 —— 与 T05 §3.6 的取向对照：
 * 那里"再介绍一次"是错误请求（409），而这里"再点一次确认"是**无害的重放**。
 */
export async function confirmOutcome(
  ctx: TenantContext,
  outcomeId: string,
  input: ConfirmOutcomeInput = {},
  now: Date = new Date()
): Promise<{ outcome: OutcomeDto; created: boolean }> {
  if (!can(ctx.role, 'outcome.report')) {
    throw new ForbiddenError('Forbidden: confirming an outcome requires the outcome.report capability')
  }
  const row = (await db.outcome.findFirst({
    where: { id: outcomeId, organizationId: ctx.organizationId },
    select: OUTCOME_SELECT,
  })) as OutcomeRow | null
  if (!row) throw new NotFoundError('Outcome not found')

  const role = outcomeRoleOf(row, ctx.userId)
  if (role === 'REPORTER') {
    throw new ValidationError('The reporter cannot confirm their own outcome', { field: 'actorId' })
  }
  if (role !== 'COUNTERPARTY') {
    throw new ForbiddenError('Only the counterparty of this outcome can confirm it')
  }

  const note = normalizeNote(input?.note)
  const existing = await db.outcomeVerification.findFirst({
    where: { outcomeId: row.id, level: 'COUNTERPARTY_CONFIRMED', actorId: ctx.userId },
    select: { id: true },
  })

  let created = false
  if (!existing) {
    try {
      await db.outcomeVerification.create({
        data: {
          organizationId: ctx.organizationId,
          outcomeId: row.id,
          level: 'COUNTERPARTY_CONFIRMED',
          actorId: ctx.userId,
          note,
        },
      })
      created = true
    } catch {
      // 并发重放撞唯一键 → 视为已确认（不报错）。
      created = false
    }
  }

  const level = await refreshVerificationLevel(ctx.organizationId, row.id)

  if (created) {
    await writeTenantAudit({
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
      eventType: 'outcome.confirmed',
      resourceType: 'outcome',
      resourceId: row.id,
      safeMetadata: { missionId: row.missionId, proposalId: row.proposalId, level },
    }).catch(() => {})

    // 对手方确认 = 成果被承认为真 → 终态 OUTCOME_RECORDED（阶段机只前进不回退）。
    await advanceIntroductionWorkflow({
      organizationId: ctx.organizationId,
      proposalId: row.proposalId,
      event: 'OUTCOME_RECORDED',
      reason: 'counterparty_confirmed',
      by: ctx.userId,
      now,
    }).catch(() => {})
  }

  const outcome = await getOutcomeById(ctx, row.id)
  if (!outcome) throw new NotFoundError('Outcome not found')
  return { outcome, created }
}

export interface VerifyOutcomeInput {
  evidence?: string | null
  note?: string | null
}

/**
 * **外部核验**（抬到 `EXTERNALLY_VERIFIED`）。能力 `outcome.verify`（**仅 ADMIN+**）。
 *
 * ⚠️ 与"确认"不同，这里**不要求**是当事方 —— 它是运营/管理动作
 * （与 `workflow.manage` 同一取向：它决定"这条成果算不算数"）。
 * 仍**不接受**任何来自请求体的 `level` 入参：级别永远由记录集派生。
 */
export async function verifyOutcome(
  ctx: TenantContext,
  outcomeId: string,
  input: VerifyOutcomeInput = {},
  now: Date = new Date()
): Promise<{ outcome: OutcomeDto; created: boolean }> {
  if (!can(ctx.role, 'outcome.verify')) {
    throw new ForbiddenError('Forbidden: verifying an outcome requires the outcome.verify capability')
  }
  const row = (await db.outcome.findFirst({
    where: { id: outcomeId, organizationId: ctx.organizationId },
    select: OUTCOME_SELECT,
  })) as OutcomeRow | null
  if (!row) throw new NotFoundError('Outcome not found')

  let evidence: string | null = null
  if (input?.evidence !== null && input?.evidence !== undefined) {
    if (typeof input.evidence !== 'string') {
      throw new ValidationError('evidence must be a string', { field: 'evidence' })
    }
    evidence = input.evidence.trim() || null
    if (evidence && evidence.length > OUTCOME_LIMITS.evidenceMax) {
      throw new ValidationError(`evidence must be at most ${OUTCOME_LIMITS.evidenceMax} characters`, {
        field: 'evidence',
      })
    }
  }
  const note = normalizeNote(input?.note)

  const existing = await db.outcomeVerification.findFirst({
    where: { outcomeId: row.id, level: 'EXTERNALLY_VERIFIED', actorId: ctx.userId },
    select: { id: true },
  })

  let created = false
  if (!existing) {
    try {
      await db.outcomeVerification.create({
        data: {
          organizationId: ctx.organizationId,
          outcomeId: row.id,
          level: 'EXTERNALLY_VERIFIED',
          actorId: ctx.userId,
          evidence,
          note,
        },
      })
      created = true
    } catch {
      created = false
    }
  }

  const level = await refreshVerificationLevel(ctx.organizationId, row.id)

  if (created) {
    await writeTenantAudit({
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
      eventType: 'outcome.externally_verified',
      resourceType: 'outcome',
      resourceId: row.id,
      // ⚠️ 只记"有/无证据"，**不记** evidence 原文。
      safeMetadata: {
        missionId: row.missionId,
        proposalId: row.proposalId,
        level,
        hasEvidence: Boolean(evidence),
      },
    }).catch(() => {})

    await advanceIntroductionWorkflow({
      organizationId: ctx.organizationId,
      proposalId: row.proposalId,
      event: 'OUTCOME_RECORDED',
      reason: 'externally_verified',
      by: ctx.userId,
      now,
    }).catch(() => {})
  }

  const outcome = await getOutcomeById(ctx, row.id)
  if (!outcome) throw new NotFoundError('Outcome not found')
  return { outcome, created }
}
