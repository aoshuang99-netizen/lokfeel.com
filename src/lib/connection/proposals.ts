/**
 * T05 · Consent & Trust —— 提案、双边表态、撤销、介绍执行点
 *
 * 契约对应（`contracts/`）：
 *   POST /connections/proposals                 → `createProposal()`
 *   POST /connections/{connectionId}/consent    → `decideProposal()`
 *   POST /connections/{connectionId}/revoke     → `revokeProposal()`
 *   （`POST /connections/{id}/introduce` 是本仓为 AC-06 显式新增的**执行点**；
 *     契约把它隐含在"介绍工作流"里，完整的重试/超时/死信属 T06。）
 *
 * ═══════════════════════════════════════════════════════════════
 * 三条不变量（对应 AC-04 / AC-05 / AC-06），每条都有测试钉住
 * ═══════════════════════════════════════════════════════════════
 *
 * 1. **单方同意不产生介绍**（AC-04）。
 *    `CONSENT_PENDING` 是双人状态机里"待决"的常态 —— 它**跨越第一次 accept**。
 *    一个很常见的实现错误是把 accept 直接写成"状态 = ACCEPTED"，
 *    于是**谁先点谁触发**：第一个同意的人就把提案推到了"可介绍"。
 *    本文件把"双方都 accept 才是 mutual"这条规则收敛进纯函数
 *    `resolveStatusAfterDecision()`，任何调用方都绕不过它。
 *
 * 2. **拒绝即关闭、撤销清空待发**（AC-05）。
 *    `REJECT` 与 `REVOKE` 立刻进入终态并写 `closedAt`；终态后**任何**表态一律 409
 *    （**不是**幂等成功）。因为"'拒绝'之后再'接受'"若被静默接受，
 *    用户会以为自己改变了主意，而对方早已收到拒绝 —— 这种"两端认知不一致"
 *    比一个显式报错危险得多。
 *
 * 3. **执行时再校验一次**（AC-06，race condition）。
 *    介绍是本任务唯一的**执行点**，必须在**执行的那一刻**重新确认两件事：
 *      ① 提案仍为 `MUTUALLY_ACCEPTED`、未过期、未撤销、未介绍过 —— `evaluateIntroducibility()`（纯函数）；
 *      ② **双方**的 `SocialIntent` 此刻仍 `ACTIVE` 且未过期 —— `loadLiveParties()`（IO）。
 *    写入用**条件更新**实现 compare-and-swap（`introducedAt: null` +
 *    `status: 'MUTUALLY_ACCEPTED'` 作为 WHERE 谓词）：两个并发请求只有一个能成功。
 *    这才是真正的"执行时校验"——"先查再写"在并发下仍然会双写。
 *
 * ═══════════════════════════════════════════════════════════════
 * 披露档位随阶段升级（T04 交接的落点）
 * ═══════════════════════════════════════════════════════════════
 *
 *   同意前 → `CANDIDATE` 档：双方本就是**同任务的伙伴**，与 T04 候选页同一档位
 *            （不因为"多了一条提案"而放宽）。
 *   介绍后 → `COUNTERPARTY` 档：用户在意图表单里为此档**单独授权**过。
 *
 *   ⚠️ 这是 `COUNTERPARTY` 档位在整个系统里**唯一的读路径**。T05 之前它是一档
 *   "能被选中但永不生效"的配置（用户选了「匹配后可见」，却没有任何界面会展示）。
 *
 *   两条护栏：
 *     - 升级只发生在 `introducedAt !== null`（介绍**真正落地**）之后，
 *       而不是"双方点了同意"就升级 —— 同意只表示"愿意被介绍"，介绍尚未发生前
 *       对方之间仍是候选关系；
 *     - 降级**即刻生效**：任一方撤销 / 过期意图后，`liveDisclosureOf()` 当次即为
 *       空表，投影立刻归零，不需要任何定时任务配合（T03 R6 的同一条不变量）。
 */

import { db } from '@/lib/db'
import { ConflictError, ForbiddenError, NotFoundError } from '@/lib/errors'
import type { TenantContext } from '@/lib/tenancy'
// 刻意从**具体模块**导入而非 barrel：`@/lib/tenancy` 会连带拉起 `resolve.ts`
// （next-auth 依赖），而本文件要在纯单测里被直接 import（不启数据库、不起 next）。
import { can, parseTenantRole } from '@/lib/tenancy/capabilities'
import { writeTenantAudit } from '@/lib/tenancy/audit'
import {
  CANDIDATE_PROFILE_AUDIENCE,
  COUNTERPARTY_PROFILE_AUDIENCE,
  type DisclosureAudience,
} from './field-catalog'
import {
  decodeDisclosure,
  discloseSubject,
  type DisclosedProfile,
  type DisclosureMap,
  type SubjectProfile,
} from './disclosure'
import { deriveIntentStatus, liveDisclosureOf } from './intents'
import { loadSubjectProfile, loadSubjectProfiles } from './subject-profile'

// ═══════════════════════════════════════════════════════════
// 常量与类型
// ═══════════════════════════════════════════════════════════

export const PROPOSAL_LIMITS = {
  /** 与契约 `rationale` 的语义对齐：太短的"理由"等于没理由。 */
  rationaleMin: 8,
  rationaleMax: 500,
  noteMax: 300,
} as const

/** DB 里真正存储的提案状态（与 `ConnectionProposalStatus` 枚举逐字一致）。 */
export type ProposalStatus = 'CONSENT_PENDING' | 'MUTUALLY_ACCEPTED' | 'REJECTED' | 'REVOKED'

/** 个体表态类型（与 `ProposalDecisionKind` 枚举逐字一致）。 */
export type DecisionKind = 'ACCEPT' | 'REJECT' | 'REVOKE'

/**
 * 对外状态 = DB 状态 + **派生的** `EXPIRED`。
 *
 * 为什么 `EXPIRED` 不落库（与 T03 的 `IntentStatus` 同一取向）：
 * 落库就必须有人按时把它翻过去 —— 一旦那个定时任务停摆，"过期"会静默失效，
 * 而过期的提案仍然可被介绍。派生没有这个失败模式。
 */
export type ProposalState = ProposalStatus | 'EXPIRED'

/** 提案的两个参与方，用于表达"我是哪一方"。 */
export type PartyRole = 'PROPOSER' | 'CANDIDATE'

/** 提案对外的可执行动作（**只含参与方身份可做的**；运营动作见 `canIntroduce`）。 */
export type ProposalAction = 'ACCEPT' | 'REJECT' | 'REVOKE'

/** 纯函数层能判定的介绍阻断原因。 */
export type IntroducibilityBlocker =
  | 'already_introduced'
  | 'rejected'
  | 'revoked'
  | 'expired'
  | 'not_mutually_accepted'

/** IO 层在纯函数结论之上追加的阻断原因（AC-06 的"授权仍然有效吗"）。 */
export type LivePartyBlocker = 'proposer_intent_not_live' | 'candidate_intent_not_live'

export type IntroductionBlocker = IntroducibilityBlocker | LivePartyBlocker

// ═══════════════════════════════════════════════════════════
// 纯函数内核（无 IO —— 单测直接覆盖，不需要数据库）
// ═══════════════════════════════════════════════════════════

/** 提案是否已过期。`expiresAt === null` 表示不过期。 */
export function isExpired(row: { expiresAt: Date | null }, now: Date): boolean {
  return row.expiresAt !== null && row.expiresAt.getTime() <= now.getTime()
}

/**
 * 派生对外状态。
 *
 * `introducedAt !== null` 优先于一切：介绍一旦落地就是**已完成的事实**，
 * 之后既不会因过期变成 `EXPIRED`，也不会被撤销改写（见 `decideProposal` 的 409）。
 */
export function deriveProposalState(
  row: { status: ProposalStatus; introducedAt: Date | null; expiresAt: Date | null },
  now: Date
): ProposalState {
  if (row.introducedAt !== null) return 'MUTUALLY_ACCEPTED'
  if (row.status === 'REJECTED') return 'REJECTED'
  if (row.status === 'REVOKED') return 'REVOKED'
  if (isExpired(row, now)) return 'EXPIRED'
  return row.status
}

/** 双方当前的表态（`null` = 尚未表态）。 */
export interface DecisionPair {
  proposer: DecisionKind | null
  candidate: DecisionKind | null
}

/**
 * 一次表态之后提案应处于什么状态（**AC-04 的规则本身**）。
 *
 * - `REJECT` → `REJECTED`（立刻关闭）
 * - `REVOKE` → `REVOKED`（立刻关闭）
 * - `ACCEPT` → **双方都 ACCEPT 才是 `MUTUALLY_ACCEPTED`**，否则留在 `CONSENT_PENDING`
 *
 * `pair` 传入的是**已含本次表态**的两人现状；`who` 仅用于自证（与 `pair` 冗余交叉检查），
 * 这样调用方传错 `pair` 时会在测试里立刻暴露，而不是静默算出一个错状态。
 */
export function resolveStatusAfterDecision(
  who: 'proposer' | 'candidate',
  decision: DecisionKind,
  pair: DecisionPair
): ProposalStatus {
  if (decision === 'REJECT') return 'REJECTED'
  if (decision === 'REVOKE') return 'REVOKED'
  if (pair[who] !== 'ACCEPT') {
    throw new Error('resolveStatusAfterDecision: decision pair is out of sync with the decision')
  }
  return pair.proposer === 'ACCEPT' && pair.candidate === 'ACCEPT'
    ? 'MUTUALLY_ACCEPTED'
    : 'CONSENT_PENDING'
}

export interface Introducibility {
  introducible: boolean
  blockers: IntroducibilityBlocker[]
}

/**
 * 提案**自身**此刻是否可介绍（AC-06 的第①层）。
 * 不含"双方意图是否仍然有效"——那需要 IO，由 `introduceConnection()` 叠加。
 */
export function evaluateIntroducibility(
  row: { status: ProposalStatus; introducedAt: Date | null; expiresAt: Date | null },
  now: Date
): Introducibility {
  const blockers: IntroducibilityBlocker[] = []
  if (row.introducedAt !== null) blockers.push('already_introduced')
  if (row.status === 'REJECTED') blockers.push('rejected')
  if (row.status === 'REVOKED') blockers.push('revoked')
  if (isExpired(row, now)) blockers.push('expired')
  if (row.status !== 'MUTUALLY_ACCEPTED') blockers.push('not_mutually_accepted')
  return { introducible: blockers.length === 0, blockers }
}

/** 提案是否已"合上"（终态或已介绍）—— 合上之后不再接受任何表态。 */
export function isClosed(row: {
  status: ProposalStatus
  introducedAt: Date | null
}): boolean {
  return row.status === 'REJECTED' || row.status === 'REVOKED' || row.introducedAt !== null
}

/** 参与方在某个阶段能对提案做什么。 */
export function availableActions(
  row: { status: ProposalStatus; introducedAt: Date | null; expiresAt: Date | null },
  now: Date
): ProposalAction[] {
  if (isClosed(row)) return []
  const actions: ProposalAction[] = []
  // 过期后**只保留「撤销」**：
  //   - 不能再「接受」：同意一个已失效的提案没有意义；
  //   - 也不再给「拒绝」：拒绝的对象是"一个待决的邀约"，而它已经不待决了。
  //     给两个语义重叠的按钮只会让用户犹豫该点哪个；「撤销」（把它从待办里撤下来）
  //     才是此刻唯一准确的描述，而且同样能合上它，不会让它永远卡在列表里。
  if (row.status === 'CONSENT_PENDING' && !isExpired(row, now)) {
    actions.push('ACCEPT')
  }
  if (!isExpired(row, now)) {
    actions.push('REJECT')
  }
  actions.push('REVOKE')
  return actions
}

// ═══════════════════════════════════════════════════════════
// DTO
// ═══════════════════════════════════════════════════════════

/** 提案中"对侧那一方"的可见形状。 */
export interface ProposalPartyView {
  userId: string
  /** 该人在**当前阶段**允许我看到的档案投影（未授权字段的键**不存在**）。 */
  subject: DisclosedProfile
  /** 本次投影用的档位（**自描述**，便于审计与负测断言）。 */
  audience: DisclosureAudience
}

export interface ProposalDto {
  id: string
  organizationId: string
  missionId: string
  state: ProposalState
  rationale: string
  /** 我是哪一方。第三方读不到本 DTO（403）。 */
  myRole: PartyRole
  /** 我自己的表态（null = 未表态）。 */
  myDecision: DecisionKind | null
  /** 对侧的表态：**只给"是否已表态"，不给 `note`** —— 拒绝理由不回流给对侧。 */
  counterpartDecision: DecisionKind | null
  /** 对侧身份与档案投影（档位随阶段升级，见文件头）。 */
  counterpart: ProposalPartyView
  /** 我现在能做的事（服务端算好下发，避免前端自己猜权限）。 */
  actions: ProposalAction[]
  /** 我能否执行「介绍」（需要 `proposal.create`，且提案当前确实可介绍）。 */
  canIntroduce: boolean
  /** 介绍不可执行时的原因（供运营界面解释"为什么点不了"）。 */
  introduceBlockers: IntroductionBlocker[]
  expiresAt: string | null
  introducedAt: string | null
  closedAt: string | null
  createdAt: string
  updatedAt: string
}

/** 「已建立连接」的对方（`COUNTERPARTY` 档投影）。 */
export interface IntroductionView {
  proposalId: string
  missionId: string
  userId: string
  state: ProposalState
  introducedAt: string
  /** 经 `COUNTERPARTY` 档投影；对方若已撤销意图，这里会是**空投影**。 */
  subject: DisclosedProfile
  audience: DisclosureAudience
}

// ═══════════════════════════════════════════════════════════
// DB 行与装配
// ═══════════════════════════════════════════════════════════

const PROPOSAL_SELECT = {
  id: true,
  organizationId: true,
  missionId: true,
  proposerId: true,
  candidateId: true,
  status: true,
  rationale: true,
  expiresAt: true,
  introducedAt: true,
  closedAt: true,
  createdAt: true,
  updatedAt: true,
} as const

interface ProposalRow {
  id: string
  organizationId: string
  missionId: string
  proposerId: string
  candidateId: string
  status: string
  rationale: string
  expiresAt: Date | null
  introducedAt: Date | null
  closedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

/** 把 DB 的字符串状态收敛为字面量 union（未知值 → 视作待决，**不**当作"可介绍"）。 */
function normalizeStatus(value: string): ProposalStatus {
  switch (value) {
    case 'MUTUALLY_ACCEPTED':
      return 'MUTUALLY_ACCEPTED'
    case 'REJECTED':
      return 'REJECTED'
    case 'REVOKED':
      return 'REVOKED'
    default:
      return 'CONSENT_PENDING'
  }
}

function normalizeDecision(value: string): DecisionKind | null {
  switch (value) {
    case 'ACCEPT':
      return 'ACCEPT'
    case 'REJECT':
      return 'REJECT'
    case 'REVOKE':
      return 'REVOKE'
    default:
      return null
  }
}

function toPair(row: ProposalRow, decisions: { personId: string; decision: string }[]): DecisionPair {
  const at = (userId: string): DecisionKind | null => {
    const d = decisions.find((x) => x.personId === userId)
    return d ? normalizeDecision(d.decision) : null
  }
  return { proposer: at(row.proposerId), candidate: at(row.candidateId) }
}

/** 我是哪一方；第三方 → null。 */
export function partyRoleOf(row: { proposerId: string; candidateId: string }, userId: string): PartyRole | null {
  if (row.proposerId === userId) return 'PROPOSER'
  if (row.candidateId === userId) return 'CANDIDATE'
  return null
}

function counterpartOf(row: { proposerId: string; candidateId: string }, userId: string): string {
  return row.proposerId === userId ? row.candidateId : row.proposerId
}

/**
 * 装配对外 DTO。
 *
 * `counterparty` 的档案与披露表由调用方准备（单条用 `loadSubjectProfile`，
 * 列表用批量版），避免这里退化成 N+1。
 */
function assembleProposal(
  row: ProposalRow,
  decisions: { personId: string; decision: string }[],
  ctx: TenantContext,
  counterparty: { subject: SubjectProfile | null; live: DisclosureMap },
  now: Date
): ProposalDto {
  const status = normalizeStatus(row.status)
  const normalized: ProposalRow & { status: ProposalStatus } = { ...row, status }
  const role = partyRoleOf(row, ctx.userId)
  if (!role) throw new ForbiddenError('Not a participant of this proposal')

  const pair = toPair(normalized, decisions)
  const myDecision = role === 'PROPOSER' ? pair.proposer : pair.candidate
  const counterpartDecision = role === 'PROPOSER' ? pair.candidate : pair.proposer

  // ⚠️ 档位随阶段升级：介绍**落地**之后才用 COUNTERPARTY，否则一律 CANDIDATE。
  const audience: DisclosureAudience =
    row.introducedAt !== null ? COUNTERPARTY_PROFILE_AUDIENCE : CANDIDATE_PROFILE_AUDIENCE

  const intro = evaluateIntroducibility(normalized, now)

  // 「我已经同意过」这一层过滤只能放在装配处：`availableActions()` 是**角色无关**的
  // 纯函数（它不知道"我"是谁），让它去关心"我表过什么态"会污染纯内核的语义。
  // （终态与已介绍时 `availableActions()` 返回空数组，走不到这里。）
  //
  // 同意过之后**既不给人「同意」、也不给人「拒绝」**：
  //   - 「同意」再点一次没有意义，还会让人以为第一次没生效；
  //   - 「拒绝」的对象本该是"一个待决的邀约"，而我已经（部分）同意了。此刻改主意的
  //     准确语义是**撤回同意**（`REVOKE`），不是"拒绝一个我没拒绝过的邀约"。
  //     若两个按钮都给，它们会产生**不同**的 `ProposalDecision`（REJECT vs REVOKE）
  //     却造成**相同**的终态 —— 审计里"曾经同意过"这件事就被覆盖成了"拒绝"。
  //   于是同意过之后，剩下唯一准确的出口是「撤回」。
  const myActions = (() => {
    const base = availableActions(normalized, now)
    if (myDecision !== 'ACCEPT') return base
    return base.filter((a) => a !== 'ACCEPT' && a !== 'REJECT')
  })()

  return {
    id: row.id,
    organizationId: row.organizationId,
    missionId: row.missionId,
    state: deriveProposalState(normalized, now),
    rationale: row.rationale,
    myRole: role,
    myDecision,
    counterpartDecision,
    counterpart: {
      userId: counterpartOf(row, ctx.userId),
      // ⚠️ 唯一出口：白名单投影。**不得**改成返回档案原对象。
      subject: discloseSubject(counterparty.subject ?? {}, counterparty.live, audience),
      audience,
    },
    actions: myActions,
    canIntroduce: can(ctx.role, 'proposal.create') && intro.introducible,
    introduceBlockers: intro.blockers,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    introducedAt: row.introducedAt ? row.introducedAt.toISOString() : null,
    closedAt: row.closedAt ? row.closedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** 读对侧那一方的「档案 + 当前生效的披露表」。对侧意图已撤销/过期 → 披露表为空。 */
async function loadCounterparty(
  row: ProposalRow,
  otherUserId: string,
  now: Date
): Promise<{ subject: SubjectProfile | null; live: DisclosureMap }> {
  const [subject, intent] = await Promise.all([
    loadSubjectProfile(otherUserId),
    db.socialIntent.findFirst({
      where: {
        organizationId: row.organizationId,
        missionId: row.missionId,
        userId: otherUserId,
      },
      select: { disclosure: true, status: true, expiresAt: true },
    }),
  ])
  const live = intent
    ? liveDisclosureOf({ disclosure: intent.disclosure, status: intent.status, expiresAt: intent.expiresAt }, now)
    : decodeDisclosure(null)
  return { subject, live }
}

const FULL_PROPOSAL_SELECT = PROPOSAL_SELECT

// ═══════════════════════════════════════════════════════════
// 写：发起提案
// ═══════════════════════════════════════════════════════════

export interface CreateProposalInput {
  missionId: string
  candidateId: string
  rationale: string
  /** 提案有效期（可空 = 不过期）。AC-06 会在介绍时再校验一次。 */
  expiresAt?: Date | null
}

/**
 * 发起一条连接提案。
 *
 * 权限：路由层要求 `proposal.create`（T01 定为 OPERATOR+）——
 * **牵线是运营动作**，普通成员只能"被牵线"和"表态"（`proposal.decide` 是自助能力）。
 *
 * 比参考实现更严的一条前置（**刻意为之**）：发起方与被介绍方**都必须是该任务的
 * ACTIVE 参与者**。理由是披露投影的前提 —— 提案双方用 `CANDIDATE` 档互看，
 * 而 `CANDIDATE` 的语义是"**同任务的**伙伴"。若允许给一个没加入任务的人提案，
 * 就会拿这一档去投影一个语境上不属于该任务的人 —— 一次越权披露。
 * 参考实现只校验"同租户已知成员"，那是 demo 的简化，不是可以照抄的口径。
 */
export async function createProposal(
  ctx: TenantContext,
  input: CreateProposalInput,
  now: Date = new Date()
): Promise<ProposalDto> {
  const { missionId, candidateId, rationale } = input

  if (!candidateId || candidateId === ctx.userId) {
    throw new ConflictError('A proposal needs a different candidate than the proposer')
  }

  // ① 任务必须属于本租户，且处于可牵线的状态（草稿不对外，关闭不再牵线）。
  const mission = await db.mission.findFirst({
    where: { id: missionId, organizationId: ctx.organizationId },
    select: { id: true, status: true },
  })
  if (!mission) throw new NotFoundError('Mission not found')
  if (mission.status === 'DRAFT') throw new ConflictError('Mission is not published yet')
  if (mission.status === 'CLOSED') throw new ConflictError('Mission is closed')

  // ② 被介绍方必须是本租户的 ACTIVE 成员。
  const membership = await db.membership.findFirst({
    where: {
      userId: candidateId,
      organizationId: ctx.organizationId,
      status: 'ACTIVE',
      organization: { status: 'ACTIVE' },
    },
    select: { id: true },
  })
  if (!membership) throw new ConflictError('Candidate is not an active member of this organization')

  // ③ 双方都必须是该任务的 ACTIVE 参与者（披露投影的前提，见函数注释）。
  const participations = await db.missionParticipation.findMany({
    where: {
      organizationId: ctx.organizationId,
      missionId: mission.id,
      userId: { in: [ctx.userId, candidateId] },
      status: 'INTERESTED',
    },
    select: { userId: true },
  })
  const joined = new Set(participations.map((p) => p.userId))
  if (!joined.has(ctx.userId)) {
    throw new ConflictError('Join the mission before proposing a connection on it')
  }
  if (!joined.has(candidateId)) {
    throw new ConflictError('Candidate has not joined this mission')
  }

  // ④ 同一对搭档在同一任务下只能有一条提案（DB 唯一约束是最终兜底，
  //    这里先查一次是为了给出可读的 409 而不是把约束冲突原样抛给用户）。
  const existing = await db.connectionProposal.findFirst({
    where: {
      organizationId: ctx.organizationId,
      missionId: mission.id,
      proposerId: ctx.userId,
      candidateId,
    },
    select: { id: true },
  })
  if (existing) throw new ConflictError('A proposal for this pair already exists in this mission')

  const row = (await db.connectionProposal.create({
    data: {
      organizationId: ctx.organizationId,
      missionId: mission.id,
      proposerId: ctx.userId,
      candidateId,
      status: 'CONSENT_PENDING',
      rationale,
      expiresAt: input.expiresAt ?? null,
    },
    select: FULL_PROPOSAL_SELECT,
  })) as ProposalRow

  await writeTenantAudit({
    organizationId: ctx.organizationId,
    actorId: ctx.userId,
    eventType: 'proposal.created',
    resourceType: 'proposal',
    resourceId: row.id,
    safeMetadata: { missionId: mission.id, candidateId },
  }).catch(() => {})

  const counterparty = await loadCounterparty(row, candidateId, now)
  return assembleProposal({ ...row, status: normalizeStatus(row.status) }, [], ctx, counterparty, now)
}

// ═══════════════════════════════════════════════════════════
// 写：表态（接受 / 拒绝 / 撤销）
// ═══════════════════════════════════════════════════════════

/**
 * 以**本人**身份对提案表态。`note` 只落库供审计，**不回流给对侧**。
 *
 * 三种决定共用一条路径，是因为它们的**前置条件完全相同**（参与方、未关闭），
 * 差异只体现在"新状态怎么算"（`resolveStatusAfterDecision`）。
 * 拆成三个函数会让三个前置条件慢慢漂移 —— 那正是权限检查最容易出错的方式。
 */
export async function decideProposal(
  ctx: TenantContext,
  proposalId: string,
  decision: DecisionKind,
  note: string | null = null,
  now: Date = new Date()
): Promise<ProposalDto> {
  const row = (await db.connectionProposal.findFirst({
    where: { id: proposalId, organizationId: ctx.organizationId },
    select: FULL_PROPOSAL_SELECT,
  })) as ProposalRow | null
  if (!row) throw new NotFoundError('Proposal not found')

  const role = partyRoleOf(row, ctx.userId)
  if (!role) throw new ForbiddenError('Not a participant of this proposal')

  const status = normalizeStatus(row.status)
  const normalized: ProposalRow & { status: ProposalStatus } = { ...row, status }

  // 契约：已关闭 → 409（`{'409': {description: Closed}}`）。
  // 介绍落地后同样视为"已合上"—— 介绍是已完成的事实，撤销改变不了它，
  // 允许撤销只会给用户"信息被收回"的错误预期（要停止联系应走 Block，不属本任务）。
  if (row.introducedAt !== null) {
    throw new ConflictError('Proposal has already been introduced')
  }
  if (status === 'REJECTED' || status === 'REVOKED') {
    throw new ConflictError('Proposal is closed')
  }

  // 过期后只允许"合上"（REJECT / REVOKE），不允许 ACCEPT。
  if (decision === 'ACCEPT' && isExpired(normalized, now)) {
    throw new ConflictError('Proposal has expired; it can no longer be accepted')
  }

  const who = role === 'PROPOSER' ? 'proposer' : 'candidate'

  // 已有的两人表态（本次写入前的现状），用于算新状态。
  const existingDecisions = await db.proposalDecision.findMany({
    where: { proposalId: row.id, organizationId: ctx.organizationId },
    select: { personId: true, decision: true },
  })
  const before = toPair(normalized, existingDecisions)
  const after: DecisionPair = { ...before, [who]: decision }
  const nextStatus = resolveStatusAfterDecision(who, decision, after)

  const closes = nextStatus === 'REJECTED' || nextStatus === 'REVOKED'

  // 两条写操作放进同一个事务：否则可能出现"决定已写入、状态没更新"的中间态，
  // 而那个中间态在界面上表现为"我点了拒绝，但提案还显示待决"。
  await db.$transaction([
    db.proposalDecision.upsert({
      where: { proposalId_personId: { proposalId: row.id, personId: ctx.userId } },
      create: {
        organizationId: ctx.organizationId,
        proposalId: row.id,
        personId: ctx.userId,
        decision,
        note,
        decidedAt: now,
      },
      update: { decision, note, decidedAt: now },
    }),
    db.connectionProposal.update({
      where: { id: row.id },
      data: { status: nextStatus, ...(closes ? { closedAt: now } : {}) },
    }),
  ])

  await writeTenantAudit({
    organizationId: ctx.organizationId,
    actorId: ctx.userId,
    eventType:
      decision === 'ACCEPT'
        ? 'proposal.accepted'
        : decision === 'REJECT'
          ? 'proposal.rejected'
          : 'proposal.revoked',
    resourceType: 'proposal',
    resourceId: row.id,
    safeMetadata: { role, from: status, to: nextStatus },
  }).catch(() => {})

  const updated = (await db.connectionProposal.findFirst({
    where: { id: row.id, organizationId: ctx.organizationId },
    select: FULL_PROPOSAL_SELECT,
  })) as ProposalRow
  const decisions = await db.proposalDecision.findMany({
    where: { proposalId: row.id, organizationId: ctx.organizationId },
    select: { personId: true, decision: true },
  })
  const counterparty = await loadCounterparty(updated, counterpartOf(updated, ctx.userId), now)
  return assembleProposal(updated, decisions, ctx, counterparty, now)
}

/** 撤销 = 以本人身份表态 `REVOKE`。保留独立函数名是为了让调用点读起来是"撤销提案"。 */
export async function revokeProposal(
  ctx: TenantContext,
  proposalId: string,
  note: string | null = null,
  now: Date = new Date()
): Promise<ProposalDto> {
  return decideProposal(ctx, proposalId, 'REVOKE', note, now)
}

// ═══════════════════════════════════════════════════════════
// 写：介绍（AC-06 的执行点）
// ═══════════════════════════════════════════════════════════

/** 读双方意图的"生效中"状态（AC-06 第②层）。 */
async function loadLiveParties(
  row: ProposalRow,
  now: Date
): Promise<{ proposerLive: boolean; candidateLive: boolean }> {
  const intents = await db.socialIntent.findMany({
    where: {
      organizationId: row.organizationId,
      missionId: row.missionId,
      userId: { in: [row.proposerId, row.candidateId] },
    },
    select: { userId: true, status: true, expiresAt: true },
  })
  const live = (userId: string): boolean => {
    const it = intents.find((i) => i.userId === userId)
    if (!it) return false
    return deriveIntentStatus({ status: it.status, expiresAt: it.expiresAt }, now) === 'ACTIVE'
  }
  return { proposerLive: live(row.proposerId), candidateLive: live(row.candidateId) }
}

/**
 * **介绍执行点**。AC-06 的全部意义都在这一个函数里。
 *
 * 权限：`proposal.create`（运营/组织者）。"发送正式介绍"是运营动作 ——
 * 单方同意不得触发它（AC-04），双方同意后由具备该能力的人显式执行。
 *
 * 执行时**重新**校验（不是复用创建/同意时的结论）：
 *   ① 提案自身：`MUTUALLY_ACCEPTED`、未过期、未撤销、未介绍过；
 *   ② 双方意图：此刻仍 `ACTIVE` 且未过期。
 * 然后用**条件更新**做 CAS 写入 —— 两个并发请求只有一个能成功。
 */
export async function introduceConnection(
  ctx: TenantContext,
  proposalId: string,
  now: Date = new Date()
): Promise<ProposalDto> {
  if (!can(ctx.role, 'proposal.create')) {
    throw new ForbiddenError('Forbidden: introducing a connection requires the proposal.create capability')
  }

  const row = (await db.connectionProposal.findFirst({
    where: { id: proposalId, organizationId: ctx.organizationId },
    select: FULL_PROPOSAL_SELECT,
  })) as ProposalRow | null
  if (!row) throw new NotFoundError('Proposal not found')

  const status = normalizeStatus(row.status)
  const normalized: ProposalRow & { status: ProposalStatus } = { ...row, status }

  const blockers: IntroductionBlocker[] = [...evaluateIntroducibility(normalized, now).blockers]

  // ① 已经不可能成功时，不必再查意图（省一次查询，也让错误信息更聚焦）。
  if (blockers.length === 0) {
    const { proposerLive, candidateLive } = await loadLiveParties(normalized, now)
    if (!proposerLive) blockers.push('proposer_intent_not_live')
    if (!candidateLive) blockers.push('candidate_intent_not_live')
  }

  if (blockers.length > 0) {
    throw new ConflictError('Proposal is not introducible', { blockers })
  }

  // ② CAS：把"再校验"和"写入"合并成一条原子语句。
  //    `introducedAt: null` 保证只写一次；`status: 'MUTUALLY_ACCEPTED'` 保证
  //    即便此刻有人并发撤销，也不会把一个已撤销的提案"介绍"出去。
  const updated = await db.connectionProposal.updateMany({
    where: {
      id: row.id,
      organizationId: ctx.organizationId,
      introducedAt: null,
      status: 'MUTUALLY_ACCEPTED',
    },
    data: { introducedAt: now },
  })
  if (updated.count !== 1) {
    throw new ConflictError('Proposal state changed while introducing; please retry')
  }

  await writeTenantAudit({
    organizationId: ctx.organizationId,
    actorId: ctx.userId,
    eventType: 'connection.introduced',
    resourceType: 'proposal',
    resourceId: row.id,
    safeMetadata: { missionId: row.missionId },
  }).catch(() => {})

  const after = (await db.connectionProposal.findFirst({
    where: { id: row.id, organizationId: ctx.organizationId },
    select: FULL_PROPOSAL_SELECT,
  })) as ProposalRow
  const decisions = await db.proposalDecision.findMany({
    where: { proposalId: row.id, organizationId: ctx.organizationId },
    select: { personId: true, decision: true },
  })
  const counterparty = await loadCounterparty(after, counterpartOf(after, ctx.userId), now)
  return assembleProposal(after, decisions, ctx, counterparty, now)
}

// ═══════════════════════════════════════════════════════════
// 读
// ═══════════════════════════════════════════════════════════

/**
 * 按 id 读单条提案；**不存在或非参与方 → null**（不抛错）。
 *
 * 为什么返回 null 而不是抛 403：它的主要调用点是幂等层的 `load()` ——
 * 那里需要「资源不可用 → 触发补偿/重建」的语义，而**抛错会被幂等层当成故障**。
 * 对外端点若需要区分 404 与 403，应自行先取行判断，不要复用本函数。
 */
export async function findProposalById(
  ctx: TenantContext,
  proposalId: string,
  now: Date = new Date()
): Promise<ProposalDto | null> {
  if (!proposalId) return null
  const row = (await db.connectionProposal.findFirst({
    where: { id: proposalId, organizationId: ctx.organizationId },
    select: FULL_PROPOSAL_SELECT,
  })) as ProposalRow | null
  if (!row) return null
  if (!partyRoleOf(row, ctx.userId)) return null

  const decisions = await db.proposalDecision.findMany({
    where: { proposalId: row.id, organizationId: ctx.organizationId },
    select: { personId: true, decision: true },
  })
  const counterparty = await loadCounterparty(row, counterpartOf(row, ctx.userId), now)
  return assembleProposal({ ...row, status: normalizeStatus(row.status) }, decisions, ctx, counterparty, now)
}

export interface ListProposalsOptions {
  /** 只看这些状态（对外状态，含派生的 `EXPIRED`）。 */
  states?: ProposalState[]
  /**
   * 只看某条任务下的提案。分享页（`/m/<token>/proposals`）**必须**传它 ——
   * 否则页面会把该租户下**其它任务**的提案一并列出来，与 URL 表达的
   * 「这是 <token> 这条任务的提案」不符（用户会以为那些提案也属于当前任务）。
   */
  missionId?: string
  limit?: number
}

/**
 * 列**与我相关**的提案（我是发起方或被介绍方）。
 *
 * 与候选列表同一取向：这里**不做**"无结果的解释"（没有提案不是异常，是常态），
 * 但没有提案与"被过滤掉"必须能区分 —— 后者不存在，因为查询谓词就是"我是参与方"。
 */
export async function listMyProposals(
  ctx: TenantContext,
  options: ListProposalsOptions = {},
  now: Date = new Date()
): Promise<ProposalDto[]> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200)
  const rows = (await db.connectionProposal.findMany({
    where: {
      organizationId: ctx.organizationId,
      ...(options.missionId ? { missionId: options.missionId } : {}),
      OR: [{ proposerId: ctx.userId }, { candidateId: ctx.userId }],
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: FULL_PROPOSAL_SELECT,
  })) as ProposalRow[]

  if (rows.length === 0) return []

  const ids = rows.map((r) => r.id)
  const decisions = await db.proposalDecision.findMany({
    where: { proposalId: { in: ids }, organizationId: ctx.organizationId },
    select: { proposalId: true, personId: true, decision: true },
  })

  // 批量取对方档案与披露表（避免 N+1）。
  const others = rows.map((r) => counterpartOf(r, ctx.userId))
  const uniqueOthers = [...new Set(others)]
  const [profiles, intents] = await Promise.all([
    loadSubjectProfiles(uniqueOthers),
    db.socialIntent.findMany({
      where: {
        organizationId: ctx.organizationId,
        missionId: { in: [...new Set(rows.map((r) => r.missionId))] },
        userId: { in: uniqueOthers },
      },
      select: { missionId: true, userId: true, disclosure: true, status: true, expiresAt: true },
    }),
  ])
  const liveKey = (missionId: string, userId: string) => `${missionId}::${userId}`
  const liveMap = new Map(
    intents.map((i) => [
      liveKey(i.missionId, i.userId),
      liveDisclosureOf({ disclosure: i.disclosure, status: i.status, expiresAt: i.expiresAt }, now),
    ])
  )

  const views = rows.map((row) => {
    const other = counterpartOf(row, ctx.userId)
    const normalized: ProposalRow = { ...row, status: normalizeStatus(row.status) }
    return assembleProposal(
      normalized,
      decisions.filter((d) => d.proposalId === row.id),
      ctx,
      {
        subject: profiles.get(other) ?? null,
        live: liveMap.get(liveKey(row.missionId, other)) ?? decodeDisclosure(null),
      },
      now
    )
  })

  // 状态过滤放在装配之后：`EXPIRED` 是派生的，SQL 里根本不存在这个值。
  if (options.states && options.states.length > 0) {
    return views.filter((v) => options.states!.includes(v.state))
  }
  return views
}

/** 由分享令牌解析出的页面级租户上下文（不再是裸 token）。 */
export interface ShareTokenTenant {
  /** 供服务函数使用的租户上下文（角色来自 DB，不是从令牌推导）。 */
  ctx: TenantContext
  missionId: string
  missionStatus: string
}

/**
 * 把**分享令牌**换成 `TenantContext` + mission 标识（页面路径专用）。
 *
 * 与 T03 的 `getMyIntentByShareToken` / T04 的 `listCandidatesByShareToken` 同一模式：
 * 公开投影刻意不含 `organizationId`，所以页面只能拿令牌来，由**服务端**换成
 * mission + 租户后再做一次**成员关系校验** —— 这一步不能省：
 * 令牌只证明"拿到了链接"，不证明"是这个社群的人"。
 *
 * 草稿任务与非成员一律返回 `null`（表现为"不存在"），不区分 403/404，
 * 避免用令牌探测"这个链接背后有没有组织"。
 *
 * ⚠️ 角色用**真实的 membership 记录**拼，而不是从令牌里"推导"：
 * 角色必须来自数据库，才与 API 路径上的 `withTenant` 是同一套事实来源。
 * 页面用它来判定"当前访客能否显示运营动作"（例如 `proposal.create`），
 * 但那只是**界面显隐**；真正的执法仍在 API 与 `introduceConnection()` 里。
 */
export async function resolveShareTokenTenant(
  shareToken: string,
  userId: string
): Promise<ShareTokenTenant | null> {
  const mission = await db.mission.findUnique({
    where: { shareToken },
    select: { id: true, status: true, organizationId: true },
  })
  if (!mission || mission.status === 'DRAFT') return null

  const membership = await db.membership.findFirst({
    where: {
      userId,
      organizationId: mission.organizationId,
      status: 'ACTIVE',
      organization: { status: 'ACTIVE' },
    },
    select: { id: true, role: true },
  })
  if (!membership) return null

  return {
    ctx: {
      organizationId: mission.organizationId,
      userId,
      role: parseTenantRole(membership.role) ?? 'MEMBER',
      membershipId: membership.id,
    },
    missionId: mission.id,
    missionStatus: mission.status,
  }
}

/**
 * 按**分享令牌**列出与我相关的提案（页面路径，`/m/<token>/proposals`）。
 *
 * 与 `listMyProposals` 的差别只有一处：租户与 mission 由令牌解析而来，
 * 且**强制**限定在该 mission 上 —— 否则页面会把该租户下其它任务的提案
 * 一并列出来，与 URL 表达的"这是 <token> 这条任务的提案"不符。
 */
export async function listMyProposalsByShareToken(
  shareToken: string,
  userId: string,
  options: ListProposalsOptions = {},
  now: Date = new Date()
): Promise<ProposalDto[] | null> {
  const resolved = await resolveShareTokenTenant(shareToken, userId)
  if (!resolved) return null
  return listMyProposals(resolved.ctx, { ...options, missionId: resolved.missionId }, now)
}

/**
 * 我已建立连接的对手方（`COUNTERPARTY` 档的**唯一**读路径）。
 *
 * 只返回 `introducedAt !== null` 的提案 —— 也就是说，只有**真正被运营介绍过**
 * 的人才会出现在这里。双方"都同意但还没介绍"不在此列。
 */
export async function listIntroductions(
  ctx: TenantContext,
  options: { limit?: number } = {},
  now: Date = new Date()
): Promise<IntroductionView[]> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200)
  const rows = (await db.connectionProposal.findMany({
    where: {
      organizationId: ctx.organizationId,
      introducedAt: { not: null },
      OR: [{ proposerId: ctx.userId }, { candidateId: ctx.userId }],
    },
    orderBy: { introducedAt: 'desc' },
    take: limit,
    select: FULL_PROPOSAL_SELECT,
  })) as ProposalRow[]

  if (rows.length === 0) return []

  const others = rows.map((r) => counterpartOf(r, ctx.userId))
  const uniqueOthers = [...new Set(others)]
  const [profiles, intents] = await Promise.all([
    loadSubjectProfiles(uniqueOthers),
    db.socialIntent.findMany({
      where: {
        organizationId: ctx.organizationId,
        missionId: { in: [...new Set(rows.map((r) => r.missionId))] },
        userId: { in: uniqueOthers },
      },
      select: { missionId: true, userId: true, disclosure: true, status: true, expiresAt: true },
    }),
  ])
  const liveMap = new Map(
    intents.map((i) => [
      `${i.missionId}::${i.userId}`,
      liveDisclosureOf({ disclosure: i.disclosure, status: i.status, expiresAt: i.expiresAt }, now),
    ])
  )

  return rows.map((row) => {
    const other = counterpartOf(row, ctx.userId)
    const live = liveMap.get(`${row.missionId}::${other}`) ?? decodeDisclosure(null)
    return {
      proposalId: row.id,
      missionId: row.missionId,
      userId: other,
      state: deriveProposalState({ ...row, status: normalizeStatus(row.status) }, now),
      introducedAt: (row.introducedAt as Date).toISOString(),
      subject: discloseSubject(profiles.get(other) ?? {}, live, COUNTERPARTY_PROFILE_AUDIENCE),
      audience: COUNTERPARTY_PROFILE_AUDIENCE,
    }
  })
}

/** 硬删除（仅供幂等补偿使用）。业务关闭走 `revokeProposal` / `decideProposal(REJECT)`。 */
export async function hardDeleteProposal(ctx: TenantContext, proposalId: string): Promise<void> {
  await db.connectionProposal.deleteMany({
    where: { id: proposalId, organizationId: ctx.organizationId },
  })
}
