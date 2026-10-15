/**
 * T10 Slice 4 · Community Bridge —— 展示层类型与文案
 *
 * ── 🔴 为什么这里**不**像 P2 各区那样"再抄一份镜像" ──────────────────
 *   `src/lib/living/{consent,agents,observatory}/types.ts` 之所以要抄一份 + 加
 *   `AssertTrue<Exact<...>>` 漂移守卫，是因为它们的源模块（`@/lib/connection`、
 *   `@/lib/agents`）是**服务端模块** —— 值导入会把 Prisma / 租户守卫拖进客户端
 *   bundle（`check:ui-invariants` 的 R10）。抄一份是**被迫**的。
 *
 *   T10 的取值域住在 `@/lib/bridge`（**单数**）—— 那是**零 import 的纯函数内核**：
 *     · `types.ts` / `policy.ts` 各自的 import 计数为 0（实测），
 *     · 由 `check:bridge-invariants.mjs` 的 B1（不 import tenancy）/ B2（不 import db）
 *       / B5（无网络）三条门禁把守，
 *     · R10 黑名单刻意**不**包含单数前缀（只禁 `@/lib/bridges` 服务层），
 *       理由写在该脚本的 `SERVER_MODULE_PREFIXES` 注释里。
 *   ⇒ 这里**直接值导入**状态、拒绝码、标签、归因归属。**只有一份**，
 *     因此"镜像漂移"这种失败模式在本区**不存在**。
 *
 *     这比"抄一份 + 双向等价断言"严格更强：抄一份的守卫只能抓住**单侧**漂移，
 *     两侧一起改时它全绿而语义已经变了（`consent/types.ts` 自己也写明了这一半的
 *     保护力缺失）。T10 直接消灭了这个类别。
 *
 * ── 🔴 但**服务层 DTO 只 `import type`** ────────────────────────────
 *   `@/lib/bridges/dto` 是服务端模块（在 R10 黑名单里）。`import type` 零运行时，
 *   它的全部作用是**编译期漂移守卫**：服务端 DTO 改名/改形状时，本文件底部的
 *   `AssertTrue<Exact<...>>` 立刻 `tsc` 失败 —— 而不是等运行时装配器把字段悄悄丢掉
 *   （那类故障的形态是"某个数字恒为 0"，页面不报错）。
 */

// ── 仅类型：零 import 的纯内核（取值域的唯一真相源） ──
//    本文件只放"类型与文案"。**值**（zod 枚举要用的常量、标签表）一律在 board.ts 里
//    消费 —— 放在这里就是未使用的导入，而 eslint 以 --max-warnings=0 运行，会直接失败。
import type {
  BridgeNarrowReason,
  BridgeOptInStatus,
  BridgeRefusalCode,
  BridgeStatusView,
} from '@/lib/bridge'

// ── 仅类型：服务端 DTO（零运行时；用于底部漂移守卫） ──
import type { BridgeDiscoveryDto, BridgeDto, BridgeParty, BridgeSelfProjectionDto } from '@/lib/bridges/dto'

// ═══════════════════════════════════════════════════════════
// 编译期守卫工具
// ═══════════════════════════════════════════════════════════

/** 双向包含才算等价（单向 `extends` 只能抓住"少写了一个取值"）。 */
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
type AssertTrue<T extends true> = T
/** 去掉 `null`（服务端不少字段是 `X | null`，守卫要的是那一半非空取值域）。 */
type NonNull<T> = Exclude<T, null>

// ═══════════════════════════════════════════════════════════
// 展示模型
// ═══════════════════════════════════════════════════════════

/** 我方在一份协议里的立场 —— 由**服务端**从 DB 行推导（不是前端比对组织 id）。 */
export const BRIDGE_PARTY_LABELS: Record<BridgeParty, string> = {
  INITIATOR: '我方发起',
  RECIPIENT: '对方发起',
}

/** 「该找谁」的人话版本（`BRIDGE_NARROW_OWNER` 的归属 + 本区措辞）。 */
export const BRIDGE_NARROW_OWNER_LABELS: Record<'ORGANIZER' | 'MEMBER', string> = {
  ORGANIZER: '需要群主调整协议配置',
  MEMBER: '需要成员本人调整选择',
}

/** 我方的 opt-in（展示投影）。 */
export interface BridgeOptInView {
  status: BridgeOptInStatus
  statusLabel: string
  disclosedFieldKeys: string[]
  disclosedFieldLabels: string[]
  optedInAt: string
  withdrawnAt: string | null
}

/**
 * 一份协议在一张卡片上的全部信息。
 *
 * ⚠️ `agreedFieldKeys` = **①环**（双边配置交集）。界面**只**展示它 ——
 *    单侧的 `initiatorFieldKeys` 只是"我方愿意给什么"，不等于"对方能拿到什么"。
 *    把单侧键当成"已共享"是 T10 最典型的一处误读，故本模型**刻意不暴露**单侧键
 *    为"已共享"语义（只作为 `myAllowedFieldKeys` 供 opt-in 勾选范围使用）。
 */
export interface BridgeCard {
  id: string
  status: BridgeStatusView
  statusLabel: string
  /** 观察者立场；`null` = 观察者组织不是当事方（正常路径下不会出现）。 */
  side: BridgeParty | null
  sideLabel: string
  counterpartyOrgId: string | null
  /** 用途声明（purpose limitation）—— 协议必须写明为什么共享。 */
  purpose: string
  /** ①环：双方都同意共享的字段键（稳定排序）。 */
  agreedFieldKeys: string[]
  agreedFieldLabels: string[]
  /** ①环：**我方单侧**配置的字段键（成员 opt-in 的可选范围，不是"已共享"）。 */
  myAllowedFieldKeys: string[]
  /** 可共享的任务类型（自由文本，非枚举）。 */
  shareableMissionKinds: string[]
  expiresAt: string | null
  recipientApprovedAt: string | null
  createdAt: string
  myOptIn: BridgeOptInView | null
  canApprove: boolean
  canRevoke: boolean
  canOptIn: boolean
  canOptOut: boolean
}

export interface BridgeListModel {
  cards: BridgeCard[]
  total: number
  notes: string[]
}

/** 被收窄的一个字段：**该找谁**由领域层写死（`BRIDGE_NARROW_OWNER`），不由 UI 猜。 */
export interface BridgeNarrowedRow {
  key: string
  label: string
  reason: BridgeNarrowReason
  reasonLabel: string
  owner: 'ORGANIZER' | 'MEMBER'
  ownerLabel: string
}

/** opt-in 勾选框的一项。 */
export interface BridgeOptInOption {
  key: string
  label: string
  /** 我当前是否已勾选（来自服务端 `myOptIn.disclosedFieldKeys`）。 */
  selected: boolean
  /** 服务端标记的敏感字段（UI 可视觉区分，但**不得**据此隐藏）。 */
  sensitive: boolean
  /**
   * 是否允许通过披露表授权。联系方式类为 `false` —— 结构性不可授权，
   * 与"用户没勾"是两件事。这类字段**不会**出现在本列表里（服务端配置里也没有），
   * 保留该字段是为了在异常载荷下也能说清楚。
   */
  disclosable: boolean
}

/**
 * 本人视角：「我**为什么**（不）被对方看到」。
 *
 * 🔴 逐字段归因（`narrowed` + `owner`）**只**出现在本人视角 —— 跨群视图只有聚合计数。
 *    把"张三没勾 email"下发给对方组织属元数据泄漏（见 `src/lib/bridges/dto.ts`）。
 */
export interface BridgeDetailModel {
  card: BridgeCard
  /** 我方**实际**可被对方看到的字段键。 */
  mySharedFieldKeys: string[]
  mySharedFieldLabels: string[]
  narrowed: BridgeNarrowedRow[]
  /** 协议层拒绝码（`null` = 协议可用，逐字段原因看 `narrowed`）。 */
  bridgeRefusalCode: BridgeRefusalCode | null
  bridgeRefusalLabel: string | null
  /** 本次投影用的披露档位（自描述，供人核对）。 */
  profileAudienceLabel: string
  /** opt-in 勾选框数据源。 */
  optInOptions: BridgeOptInOption[]
  notes: string[]
}

/** 跨群可见的**一名**成员（对方组织的成员）。 */
export interface BridgeDiscoveryMember {
  userId: string
  sharedFieldKeys: string[]
  /**
   * 字段键 → 标签 + 值。
   *
   * 🔴 只包含**既在 `sharedFieldKeys` 里、又真的出现在服务端投影里**的键。
   *    若服务端投影里出现了交集之外的键，装配器**剔除它并产出告警说明** ——
   *    那是服务端裁剪失效，静默渲染出去就等于把泄漏显示在屏幕上。
   */
  fields: Array<{ key: string; label: string; value: string }>
  optedInAt: string
}

export interface BridgeDiscoveryModel {
  bridgeId: string
  status: BridgeStatusView
  statusLabel: string
  counterpartyOrgId: string
  bridgeRefusalCode: BridgeRefusalCode | null
  bridgeRefusalLabel: string | null
  profileAudienceLabel: string
  /** **真正可见**的成员数。 */
  visibleCount: number
  /** 对方组织在本协议上**已 opt-in** 的总人数（含未产生任何可见字段的人）。 */
  optedInCount: number
  members: BridgeDiscoveryMember[]
  /** 已 opt-in 但未产生可见字段的人数，按原因码聚合（**只有计数**，无 userId、无字段键）。 */
  gatedOut: Array<{ code: BridgeRefusalCode; label: string; count: number }>
  notes: string[]
}

// ═══════════════════════════════════════════════════════════
// 漂移守卫（6 条，全部编译期）
// ═══════════════════════════════════════════════════════════
//
// 这些断言的作用是：服务端 DTO 或内核取值域一变，本文件立刻 tsc 失败。
// 它们**不产生运行时开销**（全部是类型别名，编译后消失）。

/** 内核 `BridgeStatusView` 必须与服务端 DTO 的 `status` 完全一致。 */
export type _DriftGuardBridgeStatus = AssertTrue<Exact<BridgeStatusView, BridgeDto['status']>>
/** 内核 `BridgeRefusalCode` 必须与服务端 discovery 的拒绝码（非空侧）一致。 */
export type _DriftGuardBridgeRefusal = AssertTrue<
  Exact<BridgeRefusalCode, NonNull<BridgeDiscoveryDto['bridgeRefusalCode']>>
>
/** 内核 `BridgeNarrowReason` 必须与本人投影的 `narrowed[].by` 一致。 */
export type _DriftGuardBridgeNarrow = AssertTrue<
  Exact<BridgeNarrowReason, BridgeSelfProjectionDto['narrowed'][number]['by']>
>
/** 内核 `BridgeOptInStatus` 必须与 DTO 里 opt-in 行的 `status`（非空侧）一致。 */
export type _DriftGuardBridgeOptIn = AssertTrue<
  Exact<BridgeOptInStatus, NonNull<BridgeDto['myOptIn']>['status']>
>
/** 本区 `BridgeCard.side` 必须与服务端 DTO 的 `side` 一致（`BridgeParty` 只有两个取值）。 */
export type _DriftGuardBridgeSide = AssertTrue<Exact<BridgeCard['side'], BridgeDto['side']>>

/**
 * 守卫「我方单侧配置」的**取值来源**：它只能是 DTO 的单侧键（类型上同为 string[]）。
 *
 * ⚠️ 这条守卫**只有类型的保护力**，边界必须说清楚：它证明不了"运行时读的到底是
 *    发起侧键、被邀侧键、还是交集" —— 那是**行为**，类型系统看不出来。
 *    行为由 tests/living/bridge/board.test.ts 的**逐侧夹具**钉住
 *    （INITIATOR / RECIPIENT 各一条，断言读到的确实是本侧那一份）。
 *
 *    为什么值得为它单独写字：若哪天有人把它接到 agreedFieldKeys（①环交集）上，
 *    opt-in 的可选范围会被交集收窄 —— 成员就只能勾"群主已经和对方谈好的字段"，
 *    而**对方还没批准**时界面会显示"无可勾选项"，看起来像功能坏了而不是像设计。
 */
export type _DriftGuardBridgeSideKeys = AssertTrue<
  Exact<
    BridgeCard['myAllowedFieldKeys'],
    BridgeDto['initiatorFieldKeys']
  >
>
