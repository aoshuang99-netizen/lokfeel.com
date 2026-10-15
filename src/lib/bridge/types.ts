/**
 * T10 · Community Bridge —— 领域类型与取值域（**纯**：无 IO、无网络、不碰授权）
 *
 * 本目录（`src/lib/bridge/`，**单数**）是 T10 的**内核**。它只做一件事：
 * 把「一份合作协议 + 一名成员的 opt-in + 该成员自己的披露档位」算成
 * 「跨群**实际**能共享哪些字段」。全部是**纯函数**，因此可以在无数据库、
 * 无凭据的情况下被完整单测覆盖。
 *
 * 🔴 目录边界就是执法点（与 T09 的 `agent` / `agents` 同一手法）：
 *    内核无 IO ⇒ 「**不得直接查询对方私有行**」这条铁律在内核里**写不出来**。
 *    凡需要 IO 的（协议 CRUD、opt-in、跨群投影）都在 `src/lib/bridges/`（**复数**）。
 *    把两件事混进一个目录，门禁 B1/B2 会**静默**失效 —— 而「内核无 IO」
 *    这条保证会退化成口头约定。
 *
 * ── 为什么跨群**不**复用 `CONSENT_AUDIENCES`（T03 的受众档位）──────────
 *   `SELF / ORGANIZER / COUNTERPARTY / CANDIDATE` 四个档位全部预设一个前提：
 *   **双方在同一个租户（Organization）内**。跨社群把前提抽掉了 —— 两个群主
 *   各管一个租户，互不隶属。把跨群塞进那套受众，等于给同租户的四个受众
 *   **多开一个口子**，而「跨群」恰恰**不是**同一信任域。
 *   ⇒ 跨群是**独立的一层授权**，有自己的状态、拒绝码与字段交集规则。
 */

// ═══════════════════════════════════════════════════════════
// 协议状态
// ═══════════════════════════════════════════════════════════

/**
 * 合作协议状态（**落列**）。
 *
 * 🔴 为什么落列而不是像 `BillingEvent` 那样只由事件派生 —— 判据同 `AgentRun.status`：
 *    「本组织参与的**活跃**协议」是一个**必须下推 SQL** 的查询
 *    （`WHERE status = 'ACTIVE'`）。不落列就只能"取最近 N 条 → 应用层过滤"，
 *    列表页的**总数**会失真。
 *
 * 状态迁移（**真相表**，`planBridgeTransition()` 是唯一执法点）：
 *
 *   PENDING ──(被邀方批准)──▶ ACTIVE
 *   PENDING ──(任一方撤销)──▶ REVOKED
 *   ACTIVE  ──(任一方撤销)──▶ REVOKED
 *
 * ⚠️ 刻意**没有** `DRAFT`：发起方**创建即视为发起方已批准**（`initiatorApprovedAt`
 *    在创建时落值），协议直接落 `PENDING`。留一个永不出现的 `DRAFT` 只会制造死状态。
 * ⚠️ 刻意**没有** `EXPIRED`：过期是**派生值**（由 `expiresAt` 与当下时刻比较），
 *    与 T03 的 `IntentStatusView.EXPIRED` 同一取向 —— 落一个 `EXPIRED` 列就多出
 *    第二个事实来源，且需要 sweeper。相反，**查询一律带 `status = 'ACTIVE'`**，
 *    过期但未清理的行在 SQL 层就被排除（双保险）；用户看到的"已过期"来自
 *    拒绝码 `BRIDGE_EXPIRED`，而不是 status。
 */
export const BRIDGE_STATUSES = ['PENDING', 'ACTIVE', 'REVOKED'] as const
export type BridgeStatus = (typeof BRIDGE_STATUSES)[number]

/** 对外的状态视图 = 落库状态 + **派生**的 `EXPIRED`（供 UI/审计，不落库）。 */
export const BRIDGE_STATUS_VIEWS = ['PENDING', 'ACTIVE', 'REVOKED', 'EXPIRED'] as const
export type BridgeStatusView = (typeof BRIDGE_STATUS_VIEWS)[number]

export const BRIDGE_STATUS_LABELS: Record<BridgeStatusView, string> = {
  PENDING: '等待对方群主批准',
  ACTIVE: '已生效',
  REVOKED: '已撤销',
  EXPIRED: '已过期',
}

// ═══════════════════════════════════════════════════════════
// 成员 opt-in 状态
// ═══════════════════════════════════════════════════════════

/**
 * 成员 opt-in 状态。
 *
 * `WITHDRAWN` **保留行**（而不是删除）—— 「谁**曾**加入过、什么时候退出的」
 * 是审计问题，删行就答不了了。与 T06 的 `NotificationDelivery` 保留失败记录同一取向。
 */
export const BRIDGE_OPT_IN_STATUSES = ['ACTIVE', 'WITHDRAWN'] as const
export type BridgeOptInStatus = (typeof BRIDGE_OPT_IN_STATUSES)[number]

export const BRIDGE_OPT_IN_STATUS_LABELS: Record<BridgeOptInStatus, string> = {
  ACTIVE: '已加入',
  WITHDRAWN: '已退出',
}

// ═══════════════════════════════════════════════════════════
// 拒绝码
// ═══════════════════════════════════════════════════════════

/**
 * 跨群共享的**整体**拒绝码。**分开列**，理由同 T09 的 `EXECUTION_GATE_CODES`：
 *   UI 与审计要区分「等对方群主批准」与「授权已被撤销」—— 两者给出的下一步
 *   动作**完全不同**（前者是"催对方"，后者是"重新发起"）。
 *   压成一个 `DENIED` 就没法给出正确的引导，用户只会看到"不能用"。
 *
 * 🔴 这些码**不是** HTTP 状态码的复述：它们是**领域**结论，API 层再决定映射
 *    （本切片的映射见 `src/app/api/v1/bridges/` 的注释）。
 */
export const BRIDGE_REFUSAL_CODES = [
  /** 协议已提交、等被邀方群主批准。 */
  'BRIDGE_PENDING',
  /** 协议已被任一方撤销。 */
  'BRIDGE_REVOKED',
  /** 协议已过有效期（含 `expiresAt` 无法解析的 fail-closed 情形）。 */
  'BRIDGE_EXPIRED',
  /** 目标成员**从未** opt-in（没有那一行）。 */
  'MEMBER_NOT_OPTED_IN',
  /** 目标成员已主动退出。 */
  'MEMBER_OPTED_OUT',
  /** 目标成员**没有**有效意图（T03）—— 没有可依据的披露档位。 */
  'NO_INTENT_DISCLOSURE',
  /** 所有闸门都过了，但三方交集为空（配置了却没凑出任何字段）。 */
  'NOTHING_SHARED',
] as const
export type BridgeRefusalCode = (typeof BRIDGE_REFUSAL_CODES)[number]

export const BRIDGE_REFUSAL_LABELS: Record<BridgeRefusalCode, string> = {
  BRIDGE_PENDING: '等待对方群主批准，暂不能共享',
  BRIDGE_REVOKED: '协议已被撤销',
  BRIDGE_EXPIRED: '协议已过期，需要重新发起',
  MEMBER_NOT_OPTED_IN: '该成员尚未选择加入',
  MEMBER_OPTED_OUT: '该成员已退出共享',
  NO_INTENT_DISCLOSURE: '该成员没有生效中的意图，无披露依据',
  NOTHING_SHARED: '配置与选择没有交集，当前无字段可共享',
}

// ═══════════════════════════════════════════════════════════
// 字段被收窄的归因
// ═══════════════════════════════════════════════════════════

/**
 * 一个字段**被哪一环收窄**。
 *
 * 🔴 必须逐环可归因：只报"不可见"会让用户在两件完全不同的动作之间瞎猜 ——
 *    「去问群主调整配置」还是「改我自己的 opt-in」。归因错了，用户会找错人。
 *    `BRIDGE_NARROW_OWNER` 把"该找谁"也一并写死（不是 UI 自己猜的）。
 */
export const BRIDGE_NARROW_REASONS = [
  /** 群主配置没允许该字段（找**群主**改协议）。 */
  'GROUP_POLICY',
  /** 成员 opt-in 时没勾该字段（找**该成员自己**）。 */
  'MEMBER_POLICY',
  /** 成员的意图披露档位没覆盖该字段（找**该成员自己**）。 */
  'INTENT_DISCLOSURE',
] as const
export type BridgeNarrowReason = (typeof BRIDGE_NARROW_REASONS)[number]

/** 「这个收窄该找谁」—— 写死在领域层，避免 UI 各自猜一份。 */
export const BRIDGE_NARROW_OWNER: Record<BridgeNarrowReason, 'ORGANIZER' | 'MEMBER'> = {
  GROUP_POLICY: 'ORGANIZER',
  MEMBER_POLICY: 'MEMBER',
  INTENT_DISCLOSURE: 'MEMBER',
}

export const BRIDGE_NARROW_LABELS: Record<BridgeNarrowReason, string> = {
  GROUP_POLICY: '群主协议未开放该字段',
  MEMBER_POLICY: '成员未选择共享该字段',
  INTENT_DISCLOSURE: '成员的意图披露未覆盖该字段',
}

// ═══════════════════════════════════════════════════════════
// 领域视角（与服务层的 DB 行**解耦**）
// ═══════════════════════════════════════════════════════════

/**
 * 协议（**内核视角**）：只含判定所需的最小字段。
 *
 * 为什么不直接吃 Prisma 行：① 内核不 import Prisma（门禁 B2）；
 * ② 把"判定需要什么"与"表里存了什么"分开，才能在**不碰数据库**的情况下单测。
 * 服务层负责把 DB 行映射成这里的形状。
 *
 * ⚠️ 字段键是 `readonly string[]` 而非 `DisclosureFieldKey[]` —— 这是**刻意**的：
 *    内核的职责是"集合交集 + 归因"，与具体字段目录无关。这样字段目录
 *    （`field-catalog.ts`）演进时，内核**不需要改**；"是否是合法可披露字段"
 *    由服务层在映射时把关（它才 import 目录）。
 */
export interface BridgeView {
  status: BridgeStatus
  /** 发起方允许共享的字段键。 */
  initiatorFieldKeys: readonly string[]
  /** 被邀方允许共享的字段键。 */
  recipientFieldKeys: readonly string[]
  /** 有效期（ISO-8601 字符串）；`null` = 永久。 */
  expiresAt: string | null
}

/** 成员 opt-in（内核视角）。`null` = 该成员**从未**加入。 */
export interface MemberOptInView {
  status: BridgeOptInStatus
  /** 成员选择共享的字段键（必须 ⊆ 本组织在协议里配置的字段）。 */
  disclosedFieldKeys: readonly string[]
}

export interface BridgeVisibilityInput {
  bridge: BridgeView
  /** 目标成员的 opt-in 行；`null` = 没有这一行。 */
  optIn: MemberOptInView | null
  /**
   * 目标成员**自己的**披露档位能覆盖的字段键（服务层经
   * `fieldsVisibleTo(map, 'CANDIDATE')` 得出）。
   *
   * `null` = 该成员没有生效中的意图 ⇒ **没有披露依据** ⇒ 保守不共享。
   *
   * ⚠️ 为什么第三环取 `CANDIDATE` 档（同租户最宽受众）：跨群伙伴在语义上
   *    就是"任务伙伴"，用成员**已对伙伴公开**的集合作底线是合理的；
   *    要更严，由第二环（成员 opt-in 时**显式**勾选）来收窄 —— 那才是针对
   *    **这次跨群**的授权。三层里第二环最贴切，第三环是"底线"。
   */
  intentVisibleFieldKeys: readonly string[] | null
  now: Date
}

export interface BridgeVisibilityPlan {
  /** 整体是否可共享（= 存在至少一个通过三环的字段）。 */
  ok: boolean
  /** 整体拒绝码；`ok === true` 时为 `null`。 */
  code: BridgeRefusalCode | null
  /**
   * 三方交集后的字段键（**去重 + 稳定排序**）。
   * ⚠️ 它**只是键**，不是值 —— 值必须由服务层经 `discloseSubject()` 投影获得。
   *    把键当成"可以返回给对方的字段列表"是错的：键可见 ≠ 值可给。
   */
  sharedFieldKeys: string[]
  /** 候选字段中被收窄掉的，及原因（供 UI 说明与审计）。 */
  narrowed: ReadonlyArray<{ key: string; by: BridgeNarrowReason }>
}

/** 协议审批/撤销的**动作**。取值域刻意与 T05 的 `DecisionKind` **分开** —— 语义不同。 */
export const BRIDGE_ACTIONS = ['APPROVE', 'REVOKE'] as const
export type BridgeAction = (typeof BRIDGE_ACTIONS)[number]

/**
 * **动作**的拒绝码 —— 与可见性拒绝码（`BRIDGE_REFUSAL_CODES`）**刻意分开**。
 *
 * 为什么不复用同一张表：两张表回答的是不同问题。可见性问「这个字段现在能不能被对方看到」，
 * 动作问「你能不能对这个协议做这个操作」。把它们合并，会让审计里出现
 * "用户 Y 因为 `NOTHING_SHARED` 而无法批准"这种**答非所问**的记录。
 */
export const BRIDGE_ACTION_REFUSALS = [
  /** 协议状态不允许该动作（如已 `REVOKED`）。 */
  'BRIDGE_REVOKED',
  /** 协议已过期。 */
  'BRIDGE_EXPIRED',
  /** 已经是 `ACTIVE`（重复批准）。 */
  'ALREADY_ACTIVE',
  /** 调用者不是本协议的当事组织。 */
  'NOT_A_PARTY',
  /** 只有**被邀方**能批准（发起方在创建时已自动批准）。 */
  'WRONG_SIDE',
] as const
export type BridgeActionRefusal = (typeof BRIDGE_ACTION_REFUSALS)[number]

/** 状态迁移判定结果（`planBridgeTransition()` 的返回）。 */
export type BridgeTransitionPlan =
  | { ok: true; from: BridgeStatus; to: BridgeStatus }
  | { ok: false; reason: BridgeActionRefusal }
