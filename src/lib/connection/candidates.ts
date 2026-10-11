/**
 * T04 · 候选装配（服务层）—— 把"排序内核"与"披露投影"接起来
 *
 * ═══════════════════════════════════════════════════════════════
 * 为什么必须有这一层（而不是让内核直接吐完整候选）
 * ═══════════════════════════════════════════════════════════════
 *
 *   `recall.ts` 是**纯函数内核**：只回答"谁值得被推荐、凭什么"，不碰数据库、
 *   不碰档案。它刻意连 `subject` 占位都没有（上一刀的占位已删除），
 *   就是为了逼着投影必须发生在**别处**、并且**显式**。
 *
 *   投影的**唯一**出口是 `discloseSubject()`（T03 立下的规矩）。本文件是
 *   候选这条新通道的装配点，因此它必须显式调用那个函数 —— 这不是"顺便"，
 *   而是 AC-03 在 T04 的落点：**新通道开一个，就必须接一次披露出口**。
 *
 * ═══════════════════════════════════════════════════════════════
 * 候选能看到什么（本文件的核心政策，逐条都可被测试证伪）
 * ═══════════════════════════════════════════════════════════════
 *
 *   1. **对方的 `need` / `offer` 正文**：这两个字段存在的意义就是"被匹配"，
 *      它们是**参与匹配的字段**，默认受众是"同任务参与者"。不含它们，
 *      候选页只剩几个词元，用户无法判断要不要建立连接。
 *      ⚠️ 这是一条**明示**的取舍：意图表单上写明了"我需要/我能提供会展示给
 *      同任务的参与者"（见 intent-form.tsx 的 `intent-text-visibility`）。
 *      不得在没有那句声明的情况下上线这条通道。
 *   2. **对方的档案字段**：经 `discloseSubject(profile, live, 'CANDIDATE')`
 *      白名单投影，未授权字段的**键不存在**。档位必须是 `CANDIDATE` ——
 *      候选页的浏览者身份就是"同任务的伙伴"。若改成 `COUNTERPARTY`，
 *      还没同意的人就会看到用户只授权给"已同意对手方"的字段。
 *      （档位次序与方向见 field-catalog.ts 顶部的真相表。）
 *   3. **`constraints`（约束）不进候选**：它是筛选口径（可能含内部判断，
 *      例如"不接受独家代理"），且**不参与匹配计算**。规则统一为
 *      "候选只能看到**参与匹配**的字段 + 经授权披露的档案字段"，
 *      比"逐个字段争论要不要给"更好审计。
 *   4. **被门控拒绝的行**只返回**原因码与计数**，永远不返回对方内容 ——
 *      否则"你已经被谁排除"本身就成了一条泄露。
 *
 * 披露范围实时从 Profile 读取（不落副本），撤销/过期的对方意图**当即可披露
 * 字段归零**（复用 `liveDisclosureOf`），因此候选列表不需要任何定时任务配合。
 */

import { db } from '@/lib/db'
import type { Prisma } from '@/generated'
import { NotFoundError } from '@/lib/errors'
import type { TenantContext } from '@/lib/tenancy'
import { CANDIDATE_PROFILE_AUDIENCE, type DisclosureAudience } from './field-catalog'
import { decodeDisclosure, discloseSubject, type DisclosedProfile } from './disclosure'
import { deriveIntentStatus, liveDisclosureOf } from './intents'
import { loadSubjectProfiles } from './subject-profile'
import {
  buildCandidates,
  type GateCode,
  type NoCandidateReason,
  type ReciprocalEvidence,
  type RecallRow,
} from './recall'

/** 服务层读意图时用到的列（比 `INTENT_SELECT` 窄：候选不需要 import 相关字段）。 */
const CANDIDATE_INTENT_SELECT = {
  id: true,
  organizationId: true,
  missionId: true,
  userId: true,
  need: true,
  offer: true,
  disclosure: true,
  status: true,
  expiresAt: true,
} as const

interface CandidateIntentRow {
  id: string
  organizationId: string
  missionId: string
  userId: string
  need: string
  offer: string
  disclosure: string | null
  status: string
  expiresAt: Date | null
}

/** DB 行 → 内核要求的 `RecallRow`（字段名与类型都要对齐，避免"顺手带进去"）。 */
function toRecallRow(row: CandidateIntentRow): RecallRow {
  return {
    intentId: row.id,
    userId: row.userId,
    organizationId: row.organizationId,
    missionId: row.missionId,
    status: row.status === 'ACTIVE' ? 'ACTIVE' : 'WITHDRAWN',
    expiresAt: row.expiresAt,
    need: row.need,
    offer: row.offer,
  }
}

/**
 * 一个候选（对外形状）。
 *
 * 字段分三组，边界要清楚：**参与匹配的正文**（need/offer）、
 * **匹配依据**（evidence/matchedTokens）、**经授权披露的档案**（subject）。
 */
export interface CandidateView {
  intentId: string
  userId: string
  /** 对方的互补诉求（参与匹配的字段；见文件头第 1 条）。 */
  need: string
  offer: string
  /** 匹配依据：实际命中的词元（可复算，不是分数）。 */
  evidence: ReciprocalEvidence
  matchedTokens: number
  /** 对方的档案投影。未授权字段的键**不存在**。 */
  subject: DisclosedProfile
}

export interface CandidateList {
  missionId: string
  candidates: CandidateView[]
  /** 没有候选时给出原因；有候选时为 null。 */
  noCandidatesReason: NoCandidateReason | null
  /** 被门控拒绝的明细（**只有原因码与计数**，不含对方内容）。 */
  gatedOut: { code: GateCode; count: number }[]
  /** 过了门控、真正进入互补判定的行数（用于向用户解释"为什么只有这些"）。 */
  considered: number
  /**
   * 本次投影实际使用的受众档位（**自描述**）。
   * 存在的意义：让调用方、测试与审计都能看到"候选用的是哪一档"，
   * 而不是去读代码猜。测试断言它必须等于 `CANDIDATE`。
   */
  profileAudience: DisclosureAudience
}

function emptyResult(
  missionId: string,
  reason: NoCandidateReason,
  gatedOut: { code: GateCode; count: number }[] = [],
  considered = 0
): CandidateList {
  return {
    missionId,
    candidates: [],
    noCandidatesReason: reason,
    gatedOut,
    considered,
    profileAudience: CANDIDATE_PROFILE_AUDIENCE,
  }
}

/**
 * 把内核的不变量带过类型边界。
 *
 * `recall.ts` 的三个空返回分支**必然**附一个原因码（它没有"空列表 + 无原因"的出口），
 * 但 TS 看不到这个联系（`noCandidatesReason` 的声明类型是 `| null`）。
 * 这里用**断言**而不是 `?? '某个原因'`：后者会造出一个假原因，
 * 把"内核不变量被破坏"这种真问题伪装成一次普通的空结果。
 */
function assertHasReason(reason: NoCandidateReason | null): asserts reason is NoCandidateReason {
  if (reason === null) {
    throw new Error('recall kernel returned an empty candidate list without a reason')
  }
}

/**
 * 内部核心。**调用方必须先确认 (userId, organizationId) 的成员关系** ——
 * 本函数自己**不做**成员校验（那是 `withTenant` / 分享令牌入口的职责），
 * 所以它不导出：绕开校验直接调用它，等于绕开租户隔离。
 */
async function evaluateCandidates(
  scope: { organizationId: string; userId: string },
  missionId: string,
  options: { limit?: number },
  now: Date
): Promise<CandidateList> {
  // ① 任务必须属于本租户。跨租户一律表现为"不存在"（不泄露"存在"这一事实）。
  const mission = await db.mission.findFirst({
    where: { id: missionId, organizationId: scope.organizationId },
    select: { id: true, status: true },
  })
  if (!mission || mission.status === 'DRAFT') throw new NotFoundError('Mission not found')

  // ② 我自己必须先有一条**生效中**的意图。
  //    这条前置不是形式主义：它同时是"互惠"的前提（我没有诉求就谈不上互补），
  //    也是最小披露的守门人 —— 不能让"什么都没提交的人"浏览别人的诉求。
  const myRow = (await db.socialIntent.findFirst({
    where: {
      missionId: mission.id,
      organizationId: scope.organizationId,
      userId: scope.userId,
    },
    select: CANDIDATE_INTENT_SELECT,
  })) as CandidateIntentRow | null
  if (!myRow) return emptyResult(mission.id, 'no_own_intent')
  if (deriveIntentStatus(myRow, now) !== 'ACTIVE') {
    return emptyResult(mission.id, 'no_own_intent')
  }

  // ③ 该任务下的 ACTIVE 参与人集合（硬门控的判据之一）。
  const participationWhere: Prisma.MissionParticipationWhereInput = {
    organizationId: scope.organizationId,
    missionId: mission.id,
    status: 'INTERESTED',
  }
  const participations = await db.missionParticipation.findMany({
    where: participationWhere,
    select: { userId: true },
  })
  const activeParticipantIds = new Set(participations.map((p) => p.userId))

  // ④ 除我之外的全部意图（**故意不在这里过滤 status/expiresAt** ——
  //    过滤是门控的职责，让它的原因码可被观测；这里先滤掉就永远看不到
  //    "有多少条被门控挡掉了"，用户也就得不到"为什么没有候选"的解释）。
  const otherRows = (await db.socialIntent.findMany({
    where: {
      organizationId: scope.organizationId,
      missionId: mission.id,
      userId: { not: scope.userId },
    },
    select: CANDIDATE_INTENT_SELECT,
  })) as CandidateIntentRow[]

  const rows = otherRows.map(toRecallRow)
  const result = buildCandidates(
    { need: myRow.need, offer: myRow.offer, userId: scope.userId },
    rows,
    {
      organizationId: scope.organizationId,
      viewerId: scope.userId,
      missionId: mission.id,
      activeParticipantIds,
      now,
    },
    { limit: options.limit }
  )

  if (result.candidates.length === 0) {
    assertHasReason(result.noCandidatesReason)
    return emptyResult(mission.id, result.noCandidatesReason, result.gatedOut, result.considered)
  }

  // ⑤ 投影：**这条通道唯一的披露出口**。
  //    注意 `live` 取自**候选自己的**意图行（不是我的）—— 撤销/过期即刻归零。
  const byUserId = new Map(otherRows.map((r) => [r.userId, r]))
  const profiles = await loadSubjectProfiles(result.candidates.map((c) => c.userId))

  const candidates: CandidateView[] = result.candidates.map((c) => {
    const row = byUserId.get(c.userId)
    const live = row ? liveDisclosureOf(row, now) : decodeDisclosure(null)
    const profile = profiles.get(c.userId) ?? {}
    return {
      intentId: c.intentId,
      userId: c.userId,
      need: row?.need ?? '',
      offer: row?.offer ?? '',
      evidence: c.evidence,
      matchedTokens: c.matchedTokens,
      // ⚠️ 唯一出口：白名单投影。**不得**改为返回 profile 原对象。
      subject: discloseSubject(profile, live, CANDIDATE_PROFILE_AUDIENCE),
    }
  })

  return {
    missionId: mission.id,
    candidates,
    noCandidatesReason: null,
    gatedOut: result.gatedOut,
    considered: result.considered,
    profileAudience: CANDIDATE_PROFILE_AUDIENCE,
  }
}

/**
 * 按 missionId 列候选（**API 路径**）。
 *
 * 入参是 `TenantContext` 而非裸的 `{organizationId,userId}`：这个类型本身就是
 * "已过 `resolveTenant` 的成员校验"的标记。收窄成裸对象会让调用方觉得自己
 * 可以随手拼一个 —— 而拼错 `organizationId` 的后果是跨租户读别人。
 */
export async function listCandidates(
  ctx: TenantContext,
  missionId: string,
  options: { limit?: number } = {},
  now: Date = new Date()
): Promise<CandidateList> {
  if (!missionId || typeof missionId !== 'string') throw new NotFoundError('Mission not found')
  return evaluateCandidates(ctx, missionId, options, now)
}

/**
 * 按**分享令牌**列候选（页面路径，`/m/<token>/matches`）。
 *
 * 为什么需要它：分享页与意图页的公开投影刻意**不含 `missionId`**
 * （内部标识不进 DOM）。因此页面只能拿令牌来，由**服务端**在渲染前把它换成
 * mission + 租户，再做一次**成员关系校验** —— 这一步不能省：
 * 令牌只证明"拿到了链接"，不证明"是这个社群的人"。
 * 与 T03 的 `getMyIntentByShareToken` 同一口径：草稿表现为"不存在"，
 * 非成员表现为"不存在"（不区分 404 与 403，避免探测）。
 */
export async function listCandidatesByShareToken(
  shareToken: string,
  userId: string,
  options: { limit?: number } = {},
  now: Date = new Date()
): Promise<CandidateList | null> {
  const mission = await db.mission.findUnique({
    where: { shareToken },
    select: { id: true, status: true, organizationId: true },
  })
  if (!mission || mission.status === 'DRAFT') return null

  const membershipWhere: Prisma.MembershipWhereInput = {
    userId,
    organizationId: mission.organizationId,
    status: 'ACTIVE',
    organization: { status: 'ACTIVE' },
  }
  const membership = await db.membership.findFirst({
    where: membershipWhere,
    select: { id: true },
  })
  if (!membership) return null

  return evaluateCandidates(
    { organizationId: mission.organizationId, userId },
    mission.id,
    options,
    now
  )
}
