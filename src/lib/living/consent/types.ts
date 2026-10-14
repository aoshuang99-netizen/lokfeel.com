/**
 * P2 · Consent Gate —— 服务端形状的**客户端镜像**（取值域 + 文案）
 *
 * 🔴 为什么必须镜像而不是 `import { ... }` 服务端常量：
 *   本文件与它的消费者会进**客户端 bundle**。`@/lib/connection` 的桶文件会连带
 *   拉进 Prisma / 租户守卫 / 网络 —— 一行值导入就够了。所以这里只做两件事：
 *     ① `import type`（零运行时）取服务端类型，用**编译期双向等价断言**钉住取值域；
 *     ② 中文文案独立声明（文案不是服务端契约，改文案不该动服务端）。
 *
 * ⚠️ 漂移守卫的牙齿：`AssertTrue<Exact<镜像, 服务端>>` 在任一侧新增/删除取值时
 *    立刻 `tsc` 失败（TS2344）。P1 已经因为"展示枚举靠猜"吃过一次亏 ——
 *    真实数据一到就被 `z.strictObject` 拒绝，页面永久空白且不报错。
 *
 * ⚠️ 守卫**只有一半**的保护力：两侧一起改时它全绿，而语义已经变了。
 *    因此取值域同时在 `tests/living/consent/types.test.ts` 里**逐字硬编码**钉一遍。
 *    两者缺一不可：守卫防"单侧漂移"，硬编码回归防"双侧漂移"。
 */

import type {
  DecisionKind,
  DisclosureAudience,
  ExternalAudience,
  IntentStatusView,
  PartyRole,
  ProposalState,
} from '@/lib/connection'

// ═══════════════════════════════════════════════════════════
// 编译期守卫工具
// ═══════════════════════════════════════════════════════════

/** 双向包含才算等价（单向 `extends` 只能抓住"少写了一个取值"）。 */
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
/** `AssertTrue<false>` 违反 `T extends true` → **编译失败**。 */
type AssertTrue<T extends true> = T

// ═══════════════════════════════════════════════════════════
// 受众档位（披露给谁）
// ═══════════════════════════════════════════════════════════

/**
 * 披露档位。**声明顺序即权限大小**（索引越大 = 受众越广）——
 * 与 `field-catalog.ts` 的 `DISCLOSURE_AUDIENCES` 同序，不是巧合：
 * 服务端就是靠这个次序做 `rank(granted) >= rank(viewer)` 的包含式判定。
 */
export const CONSENT_AUDIENCES = ['SELF', 'ORGANIZER', 'COUNTERPARTY', 'CANDIDATE'] as const
export type ConsentAudience = (typeof CONSENT_AUDIENCES)[number]

export const CONSENT_AUDIENCE_LABELS: Record<ConsentAudience, string> = {
  SELF: '仅自己（不披露）',
  ORGANIZER: '组织者',
  COUNTERPARTY: '匹配后的对手方',
  CANDIDATE: '同任务的伙伴',
}

/** 外部受众 = 投影的合法目标。`SELF` 不是"受众"，它是"不披露"。 */
export const CONSENT_EXTERNAL_AUDIENCES = ['ORGANIZER', 'COUNTERPARTY', 'CANDIDATE'] as const
export type ConsentExternalAudience = (typeof CONSENT_EXTERNAL_AUDIENCES)[number]

export const CONSENT_EXTERNAL_AUDIENCE_LABELS: Record<ConsentExternalAudience, string> = {
  ORGANIZER: '组织者',
  COUNTERPARTY: '对手方（已双向同意）',
  CANDIDATE: '同任务伙伴',
}

/**
 * 档位的**可见性序列**（由窄到宽），供 UI 展示"同一份披露表下谁能看到什么"。
 *
 * 这不是"三个平行受众"：档位是**包含式**的，`ORGANIZER` 档同时被组织者与更宽的
 * 受众看到。UI 若不体现这一点，用户会以为"选了组织者，对手方就看不到" —— 恰恰相反。
 */
export const CONSENT_VISIBILITY_LADDER: readonly ConsentExternalAudience[] = [
  'ORGANIZER',
  'COUNTERPARTY',
  'CANDIDATE',
]

// ═══════════════════════════════════════════════════════════
// 意图状态 / 提案动作 / 当事方角色
// ═══════════════════════════════════════════════════════════

/** 意图对外状态（`IntentStatusView`）。`EXPIRED` 是**派生值**，不落库。 */
export const CONSENT_INTENT_STATUSES = ['ACTIVE', 'WITHDRAWN', 'EXPIRED'] as const
export type ConsentIntentStatus = (typeof CONSENT_INTENT_STATUSES)[number]

export const CONSENT_INTENT_STATUS_LABELS: Record<ConsentIntentStatus, string> = {
  ACTIVE: '生效中',
  WITHDRAWN: '已撤销',
  EXPIRED: '已过期',
}

/**
 * 提案的可执行动作（`ProposalAction`，与服务端 `DecisionKind` 同集）。
 * 请求体里的小写取值是**另一回事**（`{decision:'accept'}`），见 `CONSENT_DECISION_BODIES`。
 */
export const CONSENT_PROPOSAL_ACTIONS = ['ACCEPT', 'REJECT', 'REVOKE'] as const
export type ConsentProposalAction = (typeof CONSENT_PROPOSAL_ACTIONS)[number]

export const CONSENT_PROPOSAL_ACTION_LABELS: Record<ConsentProposalAction, string> = {
  ACCEPT: '接受',
  REJECT: '拒绝',
  REVOKE: '撤销',
}

/**
 * 动作 → 请求体。**撤销走独立端点**（`/revoke`），不是 `{decision:'revoke'}`：
 * 契约就是这么定的，且界面上撤销是独立动作（不与接受/拒绝并列成三选一）。
 */
export const CONSENT_DECISION_BODIES: Record<'ACCEPT' | 'REJECT', { decision: 'accept' | 'reject' }> = {
  ACCEPT: { decision: 'accept' },
  REJECT: { decision: 'reject' },
}

/** 我在提案里的角色（`PartyRole`）。 */
export const CONSENT_PARTY_ROLES = ['PROPOSER', 'CANDIDATE'] as const
export type ConsentPartyRole = (typeof CONSENT_PARTY_ROLES)[number]

export const CONSENT_PARTY_ROLE_LABELS: Record<ConsentPartyRole, string> = {
  PROPOSER: '我发起的',
  CANDIDATE: '我被提名',
}

/** 我的表态（`DecisionKind | null`）。`null` 不是取值域成员，单独处理。 */
export const CONSENT_DECISION_LABELS: Record<DecisionKind, string> = {
  ACCEPT: '已接受',
  REJECT: '已拒绝',
  REVOKE: '已撤销',
}

export const CONSENT_NO_DECISION_LABEL = '尚未表态'

/**
 * 提案的对外状态（`ProposalState`）。
 *
 * 与 P2 · Field 那份文案**刻意不同**：这里是"我作为当事方在等谁表态"的语境，
 * Field 那侧是"运营视角的管道分桶"。枚举值必须一致（守卫把守），措辞可以不同 ——
 * 把两处的文案强行合并，只会让其中一侧说不到点上。
 */
export const CONSENT_PROPOSAL_STATES = [
  'CONSENT_PENDING',
  'MUTUALLY_ACCEPTED',
  'REJECTED',
  'REVOKED',
  'EXPIRED',
] as const
export type ConsentProposalState = (typeof CONSENT_PROPOSAL_STATES)[number]

export const CONSENT_PROPOSAL_STATE_LABELS: Record<ConsentProposalState, string> = {
  CONSENT_PENDING: '等待双方表态',
  MUTUALLY_ACCEPTED: '双方已同意',
  REJECTED: '已被拒绝',
  REVOKED: '已被撤销',
  EXPIRED: '已过期',
}

// ═══════════════════════════════════════════════════════════
// 漂移守卫（5 条）
// ═══════════════════════════════════════════════════════════

export type _DriftGuardConsentAudience = AssertTrue<Exact<ConsentAudience, DisclosureAudience>>
export type _DriftGuardConsentExternalAudience = AssertTrue<
  Exact<ConsentExternalAudience, ExternalAudience>
>
export type _DriftGuardConsentIntentStatus = AssertTrue<Exact<ConsentIntentStatus, IntentStatusView>>
export type _DriftGuardConsentProposalAction = AssertTrue<Exact<ConsentProposalAction, DecisionKind>>
export type _DriftGuardConsentPartyRole = AssertTrue<Exact<ConsentPartyRole, PartyRole>>
export type _DriftGuardConsentProposalState = AssertTrue<Exact<ConsentProposalState, ProposalState>>

// ═══════════════════════════════════════════════════════════
// 装配器出口类型
// ═══════════════════════════════════════════════════════════

/** 逐字段披露表的一行。 */
export interface ConsentFieldRow {
  key: string
  /** 中文标签。**来自服务端**（`DisclosureEntry.label`）；目录里查不到时回退为键本身。 */
  label: string
  /** 我当前为该字段选的档位。 */
  audience: ConsentAudience
  audienceLabel: string
  /** 服务端标记的敏感字段（UI 可做视觉区分，但**不得**据此隐藏）。 */
  sensitive: boolean
  /**
   * 🔴 结构性不可授权（联系方式类）。与"用户没开"是两件事：
   *   前者是"开了也走不了这条路"，后者是"用户自己的选择"。
   *   混为一谈会让用户以为"只要我勾上就能披露邮箱"。
   */
  protectedFromDisclosure: boolean
  /** 三个受众**实际**会看到的值（服务端投影；未授权或该字段无值 → null）。 */
  values: Record<ConsentExternalAudience, string | null>
}

/** 各受众**实际**可见的字段数 —— 直接取服务端数组长度，**不前端重算**。 */
export interface ConsentGateTotals {
  disclosedToOrganizer: number
  disclosedToCounterparty: number
  disclosedToCandidate: number
  /** 谁都不披露（仅自己）的字段数。 */
  withheld: number
  /** 结构性不可授权的字段数。 */
  protectedFields: number
}

export interface ConsentGateModel {
  intentId: string
  status: ConsentIntentStatus
  statusLabel: string
  rows: ConsentFieldRow[]
  totals: ConsentGateTotals
  /** 面向用户的说明：来源形状不认识 / 目录落后 / 单调性被破坏。 */
  notes: string[]
}

/** 提案行（同一份载荷里另一个视角：双边同意状态 + 我能做的动作）。 */
export interface ConsentProposalRow {
  id: string
  state: ConsentProposalState
  stateLabel: string
  rationale: string
  myRole: ConsentPartyRole
  myRoleLabel: string
  myDecisionLabel: string
  counterpartDecisionLabel: string
  /** 对侧档案投影里**确实存在**的字段键（未授权字段的键根本不存在）。 */
  counterpartFieldKeys: string[]
  /** 服务端算好的可执行动作 —— 前端**不自己判权限**。 */
  availableActions: ConsentProposalAction[]
  canIntroduce: boolean
  introducedAt: string | null
  expiresAt: string | null
}

export interface ConsentProposalBoard {
  rows: ConsentProposalRow[]
  notes: string[]
}
