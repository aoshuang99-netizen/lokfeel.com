/**
 * T10 · Bridge **服务层** —— DTO 投影（**唯一**的对外形状）
 *
 * 🔴 本文件的全部意义是**投影边界**，与 T09 的 `agents/dto.ts` 同一职责：
 *
 *   - **行形状（`BridgeRow` / `MemberOptInRow`）也定义在这里**，但它们只是**数据描述**，
 *     不含任何 IO —— 这样 `bridges.ts` / `optins.ts` / `discovery.ts` 三处读同一张表时
 *     不会各自长出一个字段不同的"局部行类型"（那种漂移的典型症状是：
 *     新增一列后只有一条读路径带上它，另一条静默缺失，而类型检查是绿的）。
 *   - **跨群投影的字段值只在 `discovery.ts` 里产生**，且**必**经 `discloseSubject()`。
 *     本文件不做投影、不查库 —— 它只把「已经投影好的东西」摆成对外形状。
 *   - `recipientFieldKeys` / `initiatorFieldKeys` 是**双边配置**，属于协议公开信息
 *     （双方群主都知道彼此允许了什么），因此可以下发；
 *     而成员的**档案字段值**是否下发，取决于三方交集 —— 那是 `discovery.ts` 的事。
 *
 * ⚠️ 状态字段有两个，**故意都留**：
 *   - `status` = **视图**（`BridgeStatusView`，含**派生**的 `EXPIRED`）—— UI 读它。
 *   - `storedStatus` = **落库值**（`BridgeStatus`，只有三个值）—— 排障与测试对照用。
 *   只留一个的话，要么 UI 得自己判过期（多一个事实来源），要么排障时看不到真实列值。
 */

import {
  normalizeFieldKeys,
  type BridgeNarrowReason,
  type BridgeOptInStatus,
  type BridgeRefusalCode,
  type BridgeStatus,
  type BridgeStatusView,
} from '@/lib/bridge'
// 走**深路径**而不是 `@/lib/connection` 桶：桶会把 missions/proposals/operations 一并拉进来
// （它们 import db），而 dto.ts 只需要一个纯编解码函数与两个纯类型。
import { decodeStringArray } from '@/lib/connection/json-codec'
import type { DisclosureAudience } from '@/lib/connection/field-catalog'
import type { DisclosedProfile } from '@/lib/connection/disclosure'

// ═══════════════════════════════════════════════════════════
// 立场
// ═══════════════════════════════════════════════════════════

/**
 * 本组织在一份协议里的**立场**。
 *
 * 🔴 只由**服务层从 DB 行推导**（`sideOf()`），**绝不**从请求体读 ——
 *    否则调用方可以自称"我是被邀方"来绕过内核的 `WRONG_SIDE`（见 `planBridgeTransition`）。
 */
export type BridgeParty = 'INITIATOR' | 'RECIPIENT'

// ═══════════════════════════════════════════════════════════
// 行形状（与 prisma/schema/bridge.prisma 对齐）
// ═══════════════════════════════════════════════════════════

export interface BridgeRow {
  id: string
  initiatorOrgId: string
  recipientOrgId: string
  /** 落库状态（`PENDING | ACTIVE | REVOKED`）。**派生**的 `EXPIRED` 不在此列。 */
  status: string
  /** JSON 数组文本。读路径一律经 `decodeStringArray()`（容错，坏数据 → `[]`）。 */
  initiatorFieldKeys: string
  recipientFieldKeys: string
  shareableMissionKinds: string
  purpose: string
  initiatorApprovedAt: Date
  recipientApprovedAt: Date | null
  expiresAt: Date | null
  revokedAt: Date | null
  createdBy: string
  createdAt: Date
  updatedAt: Date
}

export interface MemberOptInRow {
  id: string
  bridgeId: string
  organizationId: string
  userId: string
  status: string
  /** JSON 数组文本。 */
  disclosedFieldKeys: string
  optedInAt: Date
  withdrawnAt: Date | null
}

// ═══════════════════════════════════════════════════════════
// DTO
// ═══════════════════════════════════════════════════════════

export interface MemberOptInDto {
  id: string
  userId: string
  status: BridgeOptInStatus
  /** 成员选择共享的字段键（**稳定排序** —— 见内核 `normalizeFieldKeys` 的排序理由）。 */
  disclosedFieldKeys: string[]
  optedInAt: string
  withdrawnAt: string | null
}

/**
 * 一份协议的对外形状（**观察者视角**）。
 *
 * 🔴 `side` / `counterpartyOrgId` 是**相对观察者**的，不是绝对事实。
 *    同一个桥，A 群看到的是 `side: 'INITIATOR'`，B 群看到的是 `side: 'RECIPIENT'`。
 *    把它们算进 DTO 而不是让前端自己比对 `organizationId`：前端比对就得知道
 *    "我是哪个组织"，而那个值来自客户端存储 —— 多一处可以被改坏的地方。
 */
export interface BridgeDto {
  id: string
  /** 对外状态视图（含**派生** `EXPIRED`）。 */
  status: BridgeStatusView
  /** 落库状态（排障/测试对照用，UI 不应基于它分支）。 */
  storedStatus: BridgeStatus
  initiatorOrgId: string
  recipientOrgId: string
  /** 观察者组织的立场；`null` = 观察者组织不是当事方（正常路径下不会出现）。 */
  side: BridgeParty | null
  /** 对方组织 id（观察者视角）。`side === null` 时为 `null`。 */
  counterpartyOrgId: string | null
  /** 发起方允许共享的字段键。 */
  initiatorFieldKeys: string[]
  /** 被邀方允许共享的字段键。 */
  recipientFieldKeys: string[]
  /**
   * ①环：**双边配置的交集**（双方都同意共享的字段）。
   *
   * 🔴 界面**应当**只展示它 —— 单侧的 `initiatorFieldKeys` 只是"我方愿意给什么"，
   *    不等于"对方能拿到什么"。把单侧键当成"已共享"是 T10 最典型的误读。
   */
  agreedFieldKeys: string[]
  /** 可共享的任务类型（自由文本，非枚举 —— 见 plan.md §8.2）。 */
  shareableMissionKinds: string[]
  purpose: string
  initiatorApprovedAt: string
  /** `null` ⇒ 协议仍是 `PENDING`（**不是**"默认同意"）。 */
  recipientApprovedAt: string | null
  expiresAt: string | null
  revokedAt: string | null
  createdAt: string
  updatedAt: string
  /** 观察者**自己**的 opt-in（`null` = 尚未加入）。 */
  myOptIn: MemberOptInDto | null
  /**
   * 下述四个 `canX` 全部由**服务端**算（前端不许自己判 —— "前端不重写状态机"）。
   * 合取项：① 观察者持有对应能力（服务层查表）；② 内核状态机允许该迁移；③ 尚无裁决。
   * 少任何一项，界面上就会出现"点了必然 403/409"的空按钮。
   */
  canApprove: boolean
  canRevoke: boolean
  canOptIn: boolean
  canOptOut: boolean
}

/**
 * 跨群可见的**一名**成员。
 *
 * 🔴 `subject` 是**唯一**的跨群泄漏面，且它**已经**被两层锁住：
 *    ① `discloseSubject(profile, live, 'CANDIDATE')` 的白名单投影（T03 立的规矩）；
 *    ② 再按三方交集的 `sharedFieldKeys` 二次裁剪（纵深防御）。
 *    未授权字段的键**根本不存在**（不是 `null`）—— 这样"泄露断言"可以用
 *    `hasOwnProperty` 精确判定，序列化后也不会留下 `"email": null` 这种痕迹。
 *
 * 🔴 刻意**没有** `refusalCode` / `narrowed` —— 见 `BridgeDiscoveryDto` 的说明。
 */
export interface BridgeDiscoveryMemberDto {
  userId: string
  /** 三方交集后**真正**可共享的字段键（稳定排序）。 */
  sharedFieldKeys: string[]
  /** 投影后的字段值。**只有** `sharedFieldKeys` 里的键会出现在这里。 */
  subject: DisclosedProfile
  optedInAt: string
}

/**
 * 跨群投影的返回值。
 *
 * 🔴 协议层不可用（`PENDING` / `REVOKED` / `EXPIRED`）时**不抛错**，而是回一个
 *    **空列表 + 原因码**：这三种都是**正常**状态（"等对方批准"是常态），
 *    抛错会让 UI 只能显示一个错误页，而正确做法是显示"等待对方群主批准"。
 *
 * ── 🔴 为什么这里**没有**逐成员的收窄归因（`narrowed`）──────────────
 *   归因回答的是「**该找谁**改」：`MEMBER_POLICY` / `INTENT_DISCLOSURE` 意味着
 *   要去问**对方组织的那名成员**调整他的 opt-in 或意图披露。把这份归因下发给我们，
 *    等于把**对方组织的内部配置**（"张三没有勾 email"、"李四的意图没覆盖 city"）
 *    透给外部 —— 那不是"共享字段"，是**元数据泄漏**。
 *    因此：
 *      · 跨群视图只给**聚合计数**（`gatedOut`：原因码 + 人数，**不含** userId、不含字段键）；
 *      · 逐字段归因只出现在**成员自己**的视图里（`BridgeSelfProjectionDto`，见下）——
 *        那是他自己的数据，也只有他自己该看到"是我的设置还是群主的协议挡住了"。
 */
export interface BridgeDiscoveryDto {
  bridgeId: string
  /** 协议状态视图。 */
  status: BridgeStatusView
  /** 观察者组织 id。 */
  organizationId: string
  /** 被投影的**对方**组织 id。 */
  counterpartyOrgId: string
  /** 协议层面的拒绝码；协议可用时为 `null`（此时每位成员各自的原因码在 `gatedOut` 里）。 */
  bridgeRefusalCode: BridgeRefusalCode | null
  /** **真正可见**的成员（已按 `optedInAt desc, userId asc` 稳定排序）。 */
  members: BridgeDiscoveryMemberDto[]
  /** `members.length`（单独给出，避免调用方各处 `.length`）。 */
  visibleCount: number
  /** 对方组织在本协议上**已 opt-in 的总人数**（含未产生任何可见字段的人）。 */
  optedInCount: number
  /**
   * 已 opt-in 但**未产生可见字段**的人数，按原因码聚合。
   * **只给计数，不给 userId、不给字段键** —— 见上文"元数据泄漏"。
   */
  gatedOut: Array<{ code: BridgeRefusalCode; count: number }>
  /**
   * 本次投影所用的披露档位（**自描述**）。
   * 意义同 T03 `CandidateList.profileAudience`：让调用方、测试与审计都能看到
   * "跨群用的是哪一档"，而不是去读代码猜。E2E 断言它恒为 `CANDIDATE`。
   */
  profileAudience: DisclosureAudience
}

/**
 * **成员自己**的跨群可见性投影（「为什么对方看不到我的 email？」）。
 *
 * 🔴 这是**唯一**带逐字段归因的形状，因为它是**本人视角**：
 *    `owner: 'ORGANIZER'` → 去找群主改协议；`owner: 'MEMBER'` → 去改自己的 opt-in / 意图披露。
 *    `BRIDGE_NARROW_OWNER` 把"该找谁"写死在领域层，避免 UI 各自猜一份。
 */
export interface BridgeSelfProjectionDto {
  bridgeId: string
  /** 协议状态视图。 */
  status: BridgeStatusView
  /** 我所在的组织。 */
  organizationId: string
  /** 我的数据会被投给哪一方。 */
  counterpartyOrgId: string
  /** 协议层拒绝码；可用时为 `null`。 */
  bridgeRefusalCode: BridgeRefusalCode | null
  /** 我**实际**可被对方看到的字段键。 */
  sharedFieldKeys: string[]
  /** 被收窄的字段、原因、以及**该找谁**。 */
  narrowed: Array<{ key: string; by: BridgeNarrowReason; owner: 'ORGANIZER' | 'MEMBER' }>
  /** 我的 opt-in（`null` = 未加入）。 */
  myOptIn: MemberOptInDto | null
  profileAudience: DisclosureAudience
}

// ═══════════════════════════════════════════════════════════
// 投影
// ═══════════════════════════════════════════════════════════

/** 观察者视角（由服务层取好后传入 —— DTO **不查库**、也不自己判能力）。 */
export interface BridgeViewer {
  /** 观察者组织 id（用于推导 `side` / `counterpartyOrgId`）。 */
  organizationId: string
  /** 观察者是否持有 `bridge.manage`（由服务层判，缺省 = 不持有）。 */
  canManage?: boolean
  /** 观察者是否持有 `bridge.optin`（由服务层判，缺省 = 不持有）。 */
  canOptIn?: boolean
  /** 观察者自己的 opt-in 行（由服务层查好；缺省 = 未加入）。 */
  myOptIn?: MemberOptInRow | null
  /** 判定当前时刻（过期派生用）。 */
  now: Date
}

/** 本组织在一份协议里的立场；非当事组织 → `null`。 */
export function sideOf(
  row: { initiatorOrgId: string; recipientOrgId: string },
  organizationId: string,
): BridgeParty | null {
  if (row.initiatorOrgId === organizationId) return 'INITIATOR'
  if (row.recipientOrgId === organizationId) return 'RECIPIENT'
  return null
}

/** 本协议里**另一方**的组织 id；非当事组织 → `null`。 */
export function counterpartyOf(
  row: { initiatorOrgId: string; recipientOrgId: string },
  organizationId: string,
): string | null {
  const side = sideOf(row, organizationId)
  if (side === 'INITIATOR') return row.recipientOrgId
  if (side === 'RECIPIENT') return row.initiatorOrgId
  return null
}

export function toMemberOptInDto(row: MemberOptInRow): MemberOptInDto {
  return {
    id: row.id,
    userId: row.userId,
    status: row.status === 'WITHDRAWN' ? 'WITHDRAWN' : 'ACTIVE',
    disclosedFieldKeys: normalizeFieldKeys(decodeStringArray(row.disclosedFieldKeys)),
    optedInAt: row.optedInAt.toISOString(),
    withdrawnAt: row.withdrawnAt ? row.withdrawnAt.toISOString() : null,
  }
}

/**
 * 行 → DTO。
 *
 * ⚠️ `statusView` 由调用方传入（内核 `bridgeStatusView()` 算出的值），
 *    而不是在本文件里重算一遍 —— 过期判定只能有一个来源。
 */
export function toBridgeDto(
  row: BridgeRow,
  statusView: BridgeStatusView,
  transition: { canApprove: boolean; canRevoke: boolean },
  viewer: BridgeViewer,
): BridgeDto {
  const side = sideOf(row, viewer.organizationId)
  const initiatorFieldKeys = normalizeFieldKeys(decodeStringArray(row.initiatorFieldKeys))
  const recipientFieldKeys = normalizeFieldKeys(decodeStringArray(row.recipientFieldKeys))

  // ①环：双边配置交集。用 Set 求交后回到**稳定排序**（与内核同一约定）。
  const initiatorSet = new Set(initiatorFieldKeys)
  const agreedFieldKeys = recipientFieldKeys.filter((k) => initiatorSet.has(k))

  const myOptIn = viewer.myOptIn ? toMemberOptInDto(viewer.myOptIn) : null

  return {
    id: row.id,
    status: statusView,
    storedStatus: row.status as BridgeStatus,
    initiatorOrgId: row.initiatorOrgId,
    recipientOrgId: row.recipientOrgId,
    side,
    counterpartyOrgId: counterpartyOf(row, viewer.organizationId),
    initiatorFieldKeys,
    recipientFieldKeys,
    agreedFieldKeys,
    shareableMissionKinds: normalizeFieldKeys(decodeStringArray(row.shareableMissionKinds)),
    purpose: row.purpose,
    initiatorApprovedAt: row.initiatorApprovedAt.toISOString(),
    recipientApprovedAt: row.recipientApprovedAt ? row.recipientApprovedAt.toISOString() : null,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    myOptIn,
    // 🔴 三态合取（与 T09 `canApprove` 同一手法）：
    //    ① 能力（服务层算好传进来）② 状态机允许（内核真相表算好传进来）
    //    ③ **尚未生效/尚未撤销** —— 已有裁决的动作不给按钮，否则点了必然 409。
    canApprove: transition.canApprove,
    canRevoke: transition.canRevoke,
    // opt-in 的可用性：能力 ∧ 协议**未撤销且未过期**。
    // 注意 `PENDING` **可以** opt-in（成员提前表态无害 —— 协议不 ACTIVE 时投影恒为空），
    // 这一条与 `canApprove` 不同，刻意不要求 `ACTIVE`。
    canOptIn: viewer.canOptIn === true && statusView !== 'REVOKED' && statusView !== 'EXPIRED',
    canOptOut: viewer.canOptIn === true && myOptIn !== null && myOptIn.status === 'ACTIVE',
  }
}
