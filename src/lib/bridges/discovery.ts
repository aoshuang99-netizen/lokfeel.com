/**
 * T10 · Bridge **服务层** —— 跨群投影（**唯一**的跨群读取路径）
 *
 * ═══════════════════════════════════════════════════════════════
 * 这个文件是 AC-19 铁律「**不得直接查询对方私有行**」的运行时落点
 * ═══════════════════════════════════════════════════════════════
 * 门禁 B2（内核不得 import db）保证的是「**内核里写不出**直查对方行的代码」——
 * 那是**文本级**保证。真正需要我们**运行时可核对**的是两条：
 *
 *   ① 跨群查询的**谓词**只有 `bridgeId + organizationId + status`，
 *      **没有**任何以对方档案字段为条件的过滤（没有
 *      `prisma.user.findMany({ where: { city: ... } })` 这种形状）。
 *      ⇒ 我们能拿到的对方行**只有**"谁 opt-in 了"，而不是"谁符合某个画像"。
 *   ② 对方成员的**字段值**只有一条出口：`discloseSubject(profile, live, 'CANDIDATE')`，
 *      且出口之后**再**按三方交集的 `sharedFieldKeys` 二次裁剪。
 *      ⇒ 即使 `discloseSubject` 的档位语义将来放宽，交集这一层仍然独立生效（两把锁）。
 *
 * ── 为什么元数据（归因）也要分级 ────────────────────────────────
 *   见 `dto.ts` 里 `BridgeDiscoveryDto` 的长注释：逐字段收窄归因属**对方组织的内部配置**，
 *   下发给我们就是元数据泄漏。因此本文件把两个视角**分成两个函数**：
 *     · `listBridgeDiscoveries()`  → **跨群**视角：只给聚合计数，不给逐人归因；
 *     · `planMyBridgeVisibility()` → **本人**视角：给完整逐字段归因（含"该找谁"）。
 *
 * ── 读取路径的两处 `fail silent`（降级方向必须是"更少共享"）──────────
 *   ① 一行脏 JSON → `decodeStringArray()` 返回 `[]` ⇒ 该行字段集为空 ⇒ 不共享；
 *   ② 用户的意图读不到 / 非 `ACTIVE` / 已过期 ⇒ 披露依据为空 ⇒ **不共享**
 *      （而不是"读不到就当没限制"）。
 */

import { db } from '@/lib/db'
import { NotFoundError } from '@/lib/errors'
import type { TenantContext } from '@/lib/tenancy/resolve'
import { decodeDisclosure, discloseSubject, fieldsVisibleTo, type DisclosedProfile, type DisclosureMap } from '@/lib/connection/disclosure'
import { CANDIDATE_PROFILE_AUDIENCE } from '@/lib/connection/field-catalog'
import { decodeStringArray } from '@/lib/connection/json-codec'
import { liveDisclosureOf } from '@/lib/connection/intents'
import { loadSubjectProfiles } from '@/lib/connection/subject-profile'
import {
  bridgeStatusView,
  bridgeUsableReason,
  planBridgeVisibility,
  BRIDGE_NARROW_OWNER,
  type BridgeRefusalCode,
} from '@/lib/bridge'
import {
  BRIDGE_LIMITS,
  findBridgeRow,
  findMyOptInRow,
  requireBridgeId,
  toBridgeView,
} from './bridges'
import {
  counterpartyOf,
  toMemberOptInDto,
  type BridgeDiscoveryDto,
  type BridgeDiscoveryMemberDto,
  type BridgeSelfProjectionDto,
  type MemberOptInRow,
} from './dto'

/** 对方成员 opt-in 行读取列。**没有**任何档案字段 —— 见文件头 ①。 */
const PARTNER_OPT_IN_SELECT = {
  userId: true,
  status: true,
  disclosedFieldKeys: true,
  optedInAt: true,
} as const

interface PartnerOptInRow {
  userId: string
  status: string
  disclosedFieldKeys: string
  optedInAt: Date
}

/** 一名成员的**披露依据**（第三环）。 */
interface DisclosureBasis {
  /** 实时披露表（撤销/过期即刻归零 —— 由 `liveDisclosureOf` 保证）。 */
  live: DisclosureMap
  /**
   * 该用户经 `fieldsVisibleTo(..., 'CANDIDATE')` 得到的字段键。
   * `null` = **没有可依据的披露**（没有意图 / 非 ACTIVE / 已过期 / 授权集为空）。
   */
  visibleKeys: string[] | null
}

/**
 * 批量读取若干成员在**其所属组织**的披露依据。
 *
 * 🔴 谓词是 `organizationId`（**成员自己的组织**）+ `userId in (...)`。
 *    这不是"跨租户直查"：查询被限制在该成员所属的组织内，而我们调用它时
 *    传入的 `organizationId` 正是**对方组织**—— 也就是说我们只读"对方组织里
 *    已经 opt-in 的那几个人"的**披露配置**，而值仍要过 `discloseSubject` 才出得去。
 *
 * ⚠️ 一个用户可能有多条意图（跨任务）。本函数**取最新创建的一条**
 *    （`orderBy createdAt desc`），而不是取并集：
 *      · 取并集 = 更宽（把一个任务里的披露授权带到另一个任务上）；
 *      · 取单条 = 相对并集**更保守**，且规则唯一、可解释、无任意排序。
 *    这是一个**刻意的保守选择**，在 plan.md §8 的诚实清单里可查。
 */
async function loadDisclosureBasis(
  organizationId: string,
  userIds: readonly string[],
  now: Date,
): Promise<Map<string, DisclosureBasis>> {
  const out = new Map<string, DisclosureBasis>()
  if (userIds.length === 0) return out

  const intents = await db.socialIntent.findMany({
    where: { organizationId, userId: { in: [...userIds] } },
    select: { userId: true, disclosure: true, status: true, expiresAt: true, createdAt: true },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  })

  for (const intent of intents) {
    // 已经取到"最新的一条"就跳过更早的（结果已知，只是 map 里第一次写入生效）。
    if (out.has(intent.userId)) continue
    const live = liveDisclosureOf(intent, now)
    const keys = fieldsVisibleTo(live, CANDIDATE_PROFILE_AUDIENCE)
    out.set(intent.userId, {
      live,
      // 空集与"没有意图"在判据上等价（都是"没有可依据的披露"），统一收敛成 `null`，
      // 免得内核里多出一个"结果相同但拒绝码不同"的分支 —— 那个分支只会让文案分叉。
      visibleKeys: keys.length > 0 ? keys : null,
    })
  }

  for (const userId of userIds) {
    if (!out.has(userId)) {
      out.set(userId, { live: decodeDisclosure(null), visibleKeys: null })
    }
  }
  return out
}

/**
 * 把 `discloseSubject()` 的投影**再**按交集键裁剪一次。
 *
 * 🔴 这是**第二把锁**，刻意冗余：`discloseSubject(CANDIDATE)` 已经只留下成员
 *    "对候选可见"的字段，而交集键**必然**是它的子集（内核第三环就是这么算的）。
 *    但"两层都写对"与"只有一层写对"在代码上长得一样，只靠注释区分不了 ——
 *    所以这里显式再裁一次：将来若有人放宽了档位语义，**这一层仍然独立生效**。
 */
function restrictToKeys(
  disclosed: DisclosedProfile,
  sharedFieldKeys: readonly string[],
): DisclosedProfile {
  const allow = new Set(sharedFieldKeys)
  const out: DisclosedProfile = {}
  for (const [key, value] of Object.entries(disclosed)) {
    if (allow.has(key)) out[key as keyof DisclosedProfile] = value
  }
  return out
}

export interface DiscoveryOptions {
  limit?: number
  now?: Date
}

/**
 * **跨群**投影：列出对方组织里**真正可见**的成员。
 *
 * 早退顺序（与内核的闸门顺序一致）：协议不可用 → 无人 opt-in → 逐人三环判定。
 * 协议不可用**不抛错**，回空列表 + `bridgeRefusalCode`（见 dto.ts 的理由）。
 */
export async function listBridgeDiscoveries(
  ctx: TenantContext,
  bridgeIdRaw: unknown,
  options: DiscoveryOptions = {},
): Promise<BridgeDiscoveryDto> {
  const now = options.now ?? new Date()
  const limit = Math.min(options.limit ?? BRIDGE_LIMITS.discoveryMax, BRIDGE_LIMITS.discoveryMax)
  const bridgeId = requireBridgeId(bridgeIdRaw)

  const row = await findBridgeRow(ctx.organizationId, bridgeId)
  if (!row) throw new NotFoundError('Bridge not found')

  const counterpartyOrgId = counterpartyOf(row, ctx.organizationId)
  if (counterpartyOrgId === null) {
    // 不可达（`findBridgeRow` 已含当事方谓词）—— 纵深防御。
    throw new NotFoundError('Bridge not found')
  }

  const view = toBridgeView(row)
  const status = bridgeStatusView(view, now)
  const usable = bridgeUsableReason(view, now)

  const empty = (code: BridgeRefusalCode | null): BridgeDiscoveryDto => ({
    bridgeId: row.id,
    status,
    organizationId: ctx.organizationId,
    counterpartyOrgId,
    bridgeRefusalCode: code,
    members: [],
    visibleCount: 0,
    optedInCount: 0,
    gatedOut: [],
    profileAudience: CANDIDATE_PROFILE_AUDIENCE,
  })

  if (!usable.ok) return empty(usable.code)

  // 🔴 跨群查询本身：谓词只有 bridgeId + organizationId + status。
  //    `organizationId` 是**对方组织** —— 但选择的是"谁 opt-in 了这份协议"，
  //    而不是"谁符合某个条件"；字段值一个都没取。
  const optInRows = (await db.bridgeMemberOptIn.findMany({
    where: { bridgeId: row.id, organizationId: counterpartyOrgId, status: 'ACTIVE' },
    select: PARTNER_OPT_IN_SELECT,
    orderBy: [{ optedInAt: 'desc' }, { userId: 'asc' }],
    take: limit,
  })) as PartnerOptInRow[]

  if (optInRows.length === 0) return empty(null)

  const userIds = optInRows.map((r) => r.userId)
  const [basis, profiles] = await Promise.all([
    loadDisclosureBasis(counterpartyOrgId, userIds, now),
    loadSubjectProfiles(userIds),
  ])

  const members: BridgeDiscoveryMemberDto[] = []
  const gatedCounts = new Map<BridgeRefusalCode, number>()

  for (const optIn of optInRows) {
    const b = basis.get(optIn.userId) ?? { live: {}, visibleKeys: null }
    const plan = planBridgeVisibility({
      bridge: view,
      optIn: {
        status: optIn.status === 'WITHDRAWN' ? 'WITHDRAWN' : 'ACTIVE',
        disclosedFieldKeys: decodeStringArray(optIn.disclosedFieldKeys),
      },
      intentVisibleFieldKeys: b.visibleKeys,
      now,
    })

    if (!plan.ok) {
      // 未产生可见字段的人**不进列表**：只留计数与原因码（不给 userId、不给字段键）。
      if (plan.code) gatedCounts.set(plan.code, (gatedCounts.get(plan.code) ?? 0) + 1)
      continue
    }

    const profile = profiles.get(optIn.userId) ?? {}
    // 🔴 跨群字段值的**唯一**出口：白名单投影 + 交集裁剪。
    //    **不得**改为返回 `profile` 原对象或 `b.live` 的键集。
    const subject = restrictToKeys(
      discloseSubject(profile, b.live, CANDIDATE_PROFILE_AUDIENCE),
      plan.sharedFieldKeys,
    )

    members.push({
      userId: optIn.userId,
      sharedFieldKeys: plan.sharedFieldKeys,
      subject,
      optedInAt: optIn.optedInAt.toISOString(),
    })
  }

  return {
    bridgeId: row.id,
    status,
    organizationId: ctx.organizationId,
    counterpartyOrgId,
    bridgeRefusalCode: null,
    members,
    visibleCount: members.length,
    optedInCount: optInRows.length,
    // 稳定排序（原因码字母序），让同一份数据两次请求的响应完全一致。
    gatedOut: [...gatedCounts.entries()]
      .map(([code, count]) => ({ code, count }))
      .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0)),
    profileAudience: CANDIDATE_PROFILE_AUDIENCE,
  }
}

/**
 * **本人**视角：我的数据现在会被对方看到哪些字段，以及被哪一环收窄、该找谁。
 *
 * 🔴 与上者的区别不只是"少一层"：归因（`narrowed`）只会出现在这里，
 *    因为只有本人有权知道"是我没勾、还是我群主没开"。见 dto.ts 的长注释。
 *
 * 不需要 `bridge.manage` 也不需要 `bridge.optin` —— 读自己的能力（`bridge.read`）即可，
 * 而 `bridge.read` 在 `SELF_SERVICE` 里（任何 ACTIVE 成员都有）。
 */
export async function planMyBridgeVisibility(
  ctx: TenantContext,
  bridgeIdRaw: unknown,
  options: { now?: Date } = {},
): Promise<BridgeSelfProjectionDto> {
  const now = options.now ?? new Date()
  const bridgeId = requireBridgeId(bridgeIdRaw)

  const row = await findBridgeRow(ctx.organizationId, bridgeId)
  if (!row) throw new NotFoundError('Bridge not found')

  const counterpartyOrgId = counterpartyOf(row, ctx.organizationId)
  if (counterpartyOrgId === null) throw new NotFoundError('Bridge not found')

  const view = toBridgeView(row)
  const status = bridgeStatusView(view, now)
  const usable = bridgeUsableReason(view, now)
  const myOptIn: MemberOptInRow | null = await findMyOptInRow(row.id, ctx.userId)

  const basis = await loadDisclosureBasis(ctx.organizationId, [ctx.userId], now)
  const mine = basis.get(ctx.userId) ?? { live: {}, visibleKeys: null }

  const plan = planBridgeVisibility({
    bridge: view,
    optIn: myOptIn
      ? {
          status: myOptIn.status === 'WITHDRAWN' ? 'WITHDRAWN' : 'ACTIVE',
          disclosedFieldKeys: decodeStringArray(myOptIn.disclosedFieldKeys),
        }
      : null,
    intentVisibleFieldKeys: mine.visibleKeys,
    now,
  })

  return {
    bridgeId: row.id,
    status,
    organizationId: ctx.organizationId,
    counterpartyOrgId,
    bridgeRefusalCode: usable.ok ? plan.code : usable.code,
    sharedFieldKeys: plan.sharedFieldKeys,
    narrowed: plan.narrowed.map((n) => ({ key: n.key, by: n.by, owner: BRIDGE_NARROW_OWNER[n.by] })),
    myOptIn: myOptIn ? toMemberOptInDto(myOptIn) : null,
    profileAudience: CANDIDATE_PROFILE_AUDIENCE,
  }
}
