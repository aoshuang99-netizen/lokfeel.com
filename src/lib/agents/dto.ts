/**
 * T09 · Agent 服务层 —— DTO 投影（**唯一**的对外形状）
 *
 * 🔴 本文件的全部意义是**投影边界**：
 *
 *   - `rawText`（模型原文）**永不进 DTO** —— 它只是审计证据。对外可渲染的只有
 *     `proposal`（已过 zod 契约的那一份）。把 `rawText` 发出去，就等于把
 *     "未经校验的模型文本"重新变成可渲染内容，AC-08 的 A3 保证当场失效。
 *   - `dedupeKey` / `requestHash` **不进 DTO**：前者是内部幂等键（外发等于鼓励调用方
 *     复用别人的键），后者是请求体指纹（可能反推出请求内容）。
 *   - `execution`（**能不能执行 / 会发生什么**）由内核的 `planExecution()` 算出，**不在这里**
 *     写死、也不在这里判断 —— 答案只有一个来源（`src/lib/agent/execution.ts` 的真相表），
 *     于是新增执行器时改的是内核，而不是散落各处的 `if`。
 *   - `executionRecord`（**执行实际做了什么**）是只增不改的事件投影；`null` = 还没执行过。
 *
 * ⚠️ Prisma 的 enum 用大写下划线风格（`AgentRiskLevel.HIGH`），而内核的 TS 联合用
 * 小写（`ProviderKind = 'openai' | 'stub' | 'rules'`）。两者**必须**有唯一映射，
 * 且漂移要被测试抓到（`tests/agents/schema-drift.test.ts`）。
 */

import {
  PROVIDER_KINDS,
  canTransition,
  isSkillKey,
  planExecution,
  planOutboundDelivery,
  type AgentRunStatus,
  type DegradeReason,
  type ExecutionChannel,
  type ExecutionGateCode,
  type ExecutionKind,
  type InjectionSignal,
  type ProviderKind,
  type RiskLevel,
} from '@/lib/agent'
// ⚠️ **只**为行形状而 import 类型：`dto.ts` 不碰数据库，也不该知道目标怎么解析。
import type { DeliveryTargetRow } from './delivery-target'

// ═══════════════════════════════════════════════════════════
// 内核 ↔ 数据库 的枚举映射
// ═══════════════════════════════════════════════════════════

/**
 * `ProviderKind`（内核，小写）→ 数据库值（Prisma enum，大写）。
 *
 * 三个键**逐一列出**而不是写 `kind.toUpperCase()`：后者在新增一个 kind 时
 * **不会**报错（例如 `'anthropic'` → `'ANTHROPIC'` 恰好也能编出来），
 * 而 Prisma enum 里根本没有它 —— 错误会推迟到运行期写入才炸。
 */
export const PROVIDER_KIND_TO_DB = {
  openai: 'OPENAI',
  workbuddy: 'WORKBUDDY',
  stub: 'STUB',
  rules: 'RULES',
} as const satisfies Record<ProviderKind, string>

export type DbProviderKind = (typeof PROVIDER_KIND_TO_DB)[ProviderKind]

export function providerKindToDb(kind: ProviderKind): DbProviderKind {
  return PROVIDER_KIND_TO_DB[kind]
}

/**
 * 数据库值 → `ProviderKind`。未知值**抛错**，不猜默认值。
 *
 * 理由：能在库里读到映射表之外的值，只有两种可能 —— 数据被手工改过，或
 * Prisma enum 与内核联合发生了漂移。两种都**不该**被一个默认值抹平：
 * 那会把"账本与代码不一致"静默成"看起来正常的一条记录"。
 */
export function providerKindFromDb(raw: string): ProviderKind {
  const found = PROVIDER_KINDS.find((k) => PROVIDER_KIND_TO_DB[k] === raw)
  if (!found) {
    throw new Error(`未知的 providerKind：${raw}（数据库值与内核 PROVIDER_KINDS 不一致）`)
  }
  return found
}

// ═══════════════════════════════════════════════════════════
// 行类型（与 prisma/schema/agent.prisma 对齐）
// ═══════════════════════════════════════════════════════════

export interface AgentCallRow {
  seq: number
  skill: string
  providerKind: string
  risk: string
  highCost: boolean
  ok: boolean
  inputTokens: number
  outputTokens: number
  microCents: number
  at: Date
}

export interface AgentApprovalRow {
  decision: string
  actorId: string | null
  deciderRole: string
  note: string | null
  decidedAt: Date
}

/** 执行记录行（与 prisma/schema/agent.prisma 的 AgentExecution 对齐）。 */
export interface AgentExecutionRow {
  id: string
  kind: string
  channel: string
  recipientId: string
  deliveryId: string | null
  deliveryStatus: string
  actorId: string | null
  executedAt: Date
}

export interface AgentRunRow {
  id: string
  skill: string
  status: string
  risk: string
  requiresApproval: boolean
  requestedBy: string
  subjectLabel: string | null
  goal: string
  proposalJson: string | null
  /** ⚠️ 读得进来，但**绝不进 DTO**。 */
  rawText?: string | null
  reason: string | null
  degradeCode: string | null
  providerKind: string
  injectionSignals: string | null
  costMicroCents: number
  createdAt: Date
  updatedAt: Date
  calls?: readonly AgentCallRow[]
  approval?: AgentApprovalRow | null
  /**
   * 对外送达的目标（Slice 6）。
   *
   * ⚠️ 它是**创建时**落库的事实（`AgentDeliveryTarget`，一条运行最多一行）。
   *    这里只投影"送给谁"与"依据的授权快照"；**是否还能送**由 `executionOf()` 经内核判据算。
   */
  deliveryTarget?: DeliveryTargetRow | null
  /**
   * 执行记录（Slice 4 起）。
   *
   * ⚠️ 命名注意：**行**上的 `execution` 是 Prisma 关系（"执行发生了吗/怎么发生的"），
   * 而 **DTO** 上的 `execution` 是**可用性**（"现在能不能执行"）。两者是不同的问题，
   * DTO 里分别叫 `execution`（可用性）与 `executionRecord`（证据）。
   */
  execution?: AgentExecutionRow | null
}

// ═══════════════════════════════════════════════════════════
// DTO
// ═══════════════════════════════════════════════════════════

export interface AgentCallDto {
  seq: number
  skill: string
  providerKind: ProviderKind
  risk: RiskLevel
  /** 是否属"高成本"调用（AC-20 的判定对象）。 */
  highCost: boolean
  /** 失败的调用也在列表里（"失败不花钱"这个假设需要被看见）。 */
  ok: boolean
  inputTokens: number
  outputTokens: number
  microCents: number
  at: string
}

export interface AgentApprovalDto {
  decision: 'APPROVED' | 'REJECTED'
  actorId: string | null
  deciderRole: string
  note: string | null
  decidedAt: string
}

/**
 * 「能不能执行」——只有一个答案，且答案永远可核对。
 *
 * 🔴 与 Slice 2 的区别：那时这里是**写死**的 `available:false`（"本切片没有执行器"）。
 *    现在它由内核**两道门**算出来（`planExecution()` + `planOutboundDelivery()`）——
 *    于是答案只有一个来源，且新增执行器/新增送达目标时**不需要**改这里。
 *
 * ⚠️ 为什么两道门的结果并进**同一个**字段：界面上只有"执行"这一个按钮。
 *    若对外送达那一道失败却不反映在这里，就会出现"界面说能执行、点了必然 409"
 *    的空按钮 —— 正是 AC-18 要挡的东西。
 */
export interface AgentExecutionAvailability {
  available: boolean
  /** `available:false` 时**必须**有原因（前端据此禁用按钮，而不是留一个点了必然失败的入口）。 */
  reason: string
  /**
   * 可判定的原因码（`available:true` 时为 null）—— 前端与测试据此分支，不解析文案。
   * 取值域 = 两道门的并集（`EXECUTION_GATE_CODES`）：前者答"能不能跑"，
   * 后者答"能不能送到目标"（`NO_TARGET` / `DISCLOSURE_*`）。
   */
  code: ExecutionGateCode | null
  /** 执行效果与渠道（`available:true` 时给出，供 UI 说明"点了会发生什么"）。 */
  kind: ExecutionKind | null
  channel: ExecutionChannel | null
}

/**
 * 执行记录的 DTO（"这条运行真的产生了副作用"的对外形状）。
 *
 * ⚠️ 与 `AgentApprovalDto` 同一取向：**只增不改**的事件，因此没有"状态"字段可改。
 *    `deliveryStatus` 是**投递当时**的结果快照（SENT/CAPTURED），不是可变更的状态机。
 */
export interface AgentExecutionDto {
  id: string
  kind: ExecutionKind
  channel: ExecutionChannel
  /**
   * 收件人（**服务端决定**，见内核 `ExecutionPlan.recipient` 与 `AgentDeliveryTarget`）：
   * 计划收件人为发起人时是发起人，为对手方时是**创建时**固定的那个目标身份。
   */
  recipientId: string
  /** T06 投递归宿的 `NotificationDelivery.id`（软引用）。 */
  deliveryId: string | null
  deliveryStatus: string
  /** 执行人（与发起人分开记）。 */
  actorId: string | null
  executedAt: string
}

export interface AgentRunDto {
  id: string
  skill: string
  status: AgentRunStatus
  risk: RiskLevel
  requiresApproval: boolean
  requestedBy: string
  subjectLabel: string | null
  goal: string
  /** 经过 zod 契约校验的结构化产出。**唯一的可渲染来源**。 */
  proposal: unknown | null
  reason: string | null
  degradeCode: DegradeReason | null
  providerKind: ProviderKind
  /** 注入信号（**仅告警/升级审批的旁证**，不是放行判据）。 */
  injectionSignals: InjectionSignal[]
  /** `= injectionSignals.length > 0`。UI 读它，避免各处自己判空数组。 */
  injectionFlagged: boolean
  /** 本次运行全部调用的成本合计（微分）。 */
  costMicroCents: number
  calls: AgentCallDto[]
  approval: AgentApprovalDto | null
  /** 「现在能不能执行」——由内核执行计划算出的唯一答案。 */
  execution: AgentExecutionAvailability
  /** 「执行实际发生了什么」——`null` = 还没执行过。 */
  executionRecord: AgentExecutionDto | null
  /**
   * 这条运行的对外送达目标（`null` = 执行计划不涉及对外送达，或创建时未给出目标）。
   *
   * 🔴 只下发**目标身份**，不下发"授权快照"：后者是内部判据的输入，
   *    对外只需要回答"这条产出送给谁"，多下发一个数组就多一处会漂移的对外承诺。
   */
  deliveryTarget: { targetUserId: string } | null
  /**
   * 当前**观察者**能否批准 / 驳回这条运行。
   *
   * 🔴 由**服务端**算，前端不许自己判（"前端不重写状态机"）。三项合取：
   *    ① 观察者持有 `agent.approve`（**由服务层判**，见 `AgentRunViewer.canDecide`）；
   *    ② 当前状态允许迁移到 APPROVED / REJECTED（内核 `canTransition`，与
   *       `decideAgentRun` 用的是**同一张真相表**）；
   *    ③ 尚无裁决（已有裁决 → 服务层抛 409，不可改判）。
   *    少任何一项，界面上就会出现"点了必然 403/409"的空按钮 —— 正是 AC-18 要挡的东西。
   *    与 T08 成果屏的 `canConfirm` / `canVerify` 同一手法。
   */
  canApprove: boolean
  canReject: boolean
  createdAt: string
  updatedAt: string
}

// ═══════════════════════════════════════════════════════════
// 投影
// ═══════════════════════════════════════════════════════════

/** JSON 文本 → 值。解析失败返回 null（不抛 —— 单条坏数据不该让列表 500）。 */
function safeJson(raw: string | null | undefined): unknown {
  if (raw === null || raw === undefined || raw === '') return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function toSignals(raw: string | null): InjectionSignal[] {
  const parsed = safeJson(raw)
  if (!Array.isArray(parsed)) return []
  return parsed.filter(
    (s): s is InjectionSignal =>
      Boolean(s) && typeof s === 'object' && typeof (s as InjectionSignal).code === 'string',
  )
}

function toCallDtos(rows: readonly AgentCallRow[]): AgentCallDto[] {
  return [...rows]
    .sort((a, b) => a.seq - b.seq)
    .map((c) => ({
      seq: c.seq,
      skill: c.skill,
      providerKind: providerKindFromDb(c.providerKind),
      risk: c.risk as RiskLevel,
      highCost: c.highCost,
      ok: c.ok,
      inputTokens: c.inputTokens,
      outputTokens: c.outputTokens,
      microCents: c.microCents,
      at: c.at.toISOString(),
    }))
}

function toApprovalDto(row: AgentApprovalRow | null | undefined): AgentApprovalDto | null {
  if (!row) return null
  return {
    decision: row.decision === 'REJECTED' ? 'REJECTED' : 'APPROVED',
    actorId: row.actorId,
    deciderRole: row.deciderRole,
    note: row.note,
    decidedAt: row.decidedAt.toISOString(),
  }
}

/**
 * 执行可用性 —— **完全由内核的执行计划决定**（`planExecution()`）。
 *
 * 🔴 这里**不写**任何"什么状态可以执行"的判断：那是 `approval.ts`（状态机）与
 *    `execution.ts`（执行计划）的职责。DTO 只做投影 —— 多一份判断就多一个会分叉的事实来源。
 *
 * ⚠️ 三个入参的来源不同，**故意都从行上取**：
 *   - `status` / `requiresApproval` 是**快照列**；
 *   - `hasApprovedDecision` 来自**裁决关系**（只增不改的事件表）。
 *     纵深防御：状态列可以被人工改坏，裁决表不会。
 */
function executionOf(
  row: AgentRunRow,
  status: AgentRunStatus,
  viewer: AgentRunViewer,
): AgentExecutionAvailability {
  // 技能键来自数据库（TEXT），可能存在"映射表之外的值"（手工改库 / TS↔Prisma 漂移）。
  // 那种情况下**必须显式不可执行**，而不是套一个默认计划 —— 否则一个脏 skill 会拿到执行器。
  const skill = isSkillKey(row.skill) ? row.skill : null
  const decision = skill
    ? planExecution({
        skill,
        status,
        requiresApproval: row.requiresApproval,
        hasApprovedDecision: row.approval?.decision === 'APPROVED',
      })
    : {
        executable: false as const,
        code: 'NOT_REGISTERED' as const,
        reason: `未知技能 ${row.skill}（数据库值与内核 SKILL_KEYS 不一致）—— 没有注册执行器。`,
      }

  if (!decision.executable) {
    return {
      available: false,
      reason: decision.reason,
      code: decision.code,
      kind: null,
      channel: null,
    }
  }

  // 🔴 第二道门：**只**对收件人是对手方的计划生效（内核里 `REQUESTER` 恒放行）。
  //    与执行器用的是**同一对**纯函数 + 同一份取值来源（服务端算好的 `viewer.outbound`）——
  //    所以"界面说能执行、执行器说不给执行"在结构上不存在。
  //    ⚠️ 缺省 `viewer.outbound`（未传）会被读成"没有目标" ⇒ 拒绝。
  //    **默认拒绝**是刻意的：忘传的后果是"按钮不可点"，而不是"点了一个会 403 的东西"。
  const outbound = planOutboundDelivery({
    recipient: decision.plan.recipient,
    targetUserId: viewer.outbound?.targetUserId ?? null,
    authorizedFieldKeys: viewer.outbound?.authorizedFieldKeys ?? [],
    visibleFieldKeys: viewer.outbound?.visibleFieldKeys ?? [],
  })
  if (!outbound.deliverable) {
    return {
      available: false,
      reason: outbound.reason,
      code: outbound.code,
      kind: null,
      channel: null,
    }
  }

  return {
    available: true,
    reason: decision.plan.description,
    code: null,
    kind: decision.plan.kind,
    channel: decision.plan.channel,
  }
}

/** 送达目标的对外投影（`null` = 这条运行没有对外送达这一步）。 */
function toDeliveryTargetDto(row: AgentRunRow): { targetUserId: string } | null {
  const t = row.deliveryTarget
  if (!t) return null
  return { targetUserId: t.targetUserId }
}

export function toExecutionDto(row: AgentExecutionRow | null | undefined): AgentExecutionDto | null {
  if (!row) return null
  return {
    id: row.id,
    kind: row.kind as ExecutionKind,
    channel: row.channel as ExecutionChannel,
    recipientId: row.recipientId,
    deliveryId: row.deliveryId,
    deliveryStatus: row.deliveryStatus,
    actorId: row.actorId,
    executedAt: row.executedAt.toISOString(),
  }
}

/**
 * 观察者视角。**刻意只收一个布尔**（而不是整个 `TenantContext` 或角色字符串）：
 * 角色 → 能力的映射只应存在于 `src/lib/tenancy/capabilities.ts` 一处；
 * 把角色传进来，DTO 迟早会自己长出一张判定表。
 */
export interface AgentRunViewer {
  /** 观察者是否持有 `agent.approve`（由服务层判）。缺省 = 不持有（默认拒绝）。 */
  canDecide?: boolean
  /**
   * 对外送达闸门的**输入**（由服务层取好：目标身份 + 授权快照 + 实时可见字段）。
   *
   * ⚠️ 与 `canDecide` 同一取向：DTO **不查库**、也不自己算披露 —— 它只把内核判据喂饱。
   *    缺省（undefined）= "这条运行没有对外送达这一步"（等价于内核判据里的 `REQUESTER` 分支）；
   *    若运行**确实**要送达却漏传，内核会以 `NO_TARGET` 拒绝 —— 界面少一个按钮，
   *    而不是多一个必然失败的按钮。
   */
  outbound?: {
    targetUserId: string | null
    authorizedFieldKeys: readonly string[]
    visibleFieldKeys: readonly string[]
  }
}

export function toAgentRunDto(row: AgentRunRow, viewer: AgentRunViewer = {}): AgentRunDto {
  const status = row.status as AgentRunStatus
  const signals = toSignals(row.injectionSignals)
  // 已有裁决 → 不可改判（`decideAgentRun` 会抛 409）。把它算进"能不能点"，
  // 界面才不会给出一个注定被拒的按钮。
  const decidable = viewer.canDecide === true && !row.approval
  return {
    id: row.id,
    skill: row.skill,
    status,
    risk: row.risk as RiskLevel,
    requiresApproval: row.requiresApproval,
    requestedBy: row.requestedBy,
    subjectLabel: row.subjectLabel,
    goal: row.goal,
    proposal: safeJson(row.proposalJson),
    reason: row.reason,
    degradeCode: (row.degradeCode as DegradeReason | null) ?? null,
    providerKind: providerKindFromDb(row.providerKind),
    injectionSignals: signals,
    injectionFlagged: signals.length > 0,
    costMicroCents: row.costMicroCents,
    calls: toCallDtos(row.calls ?? []),
    approval: toApprovalDto(row.approval),
    execution: executionOf(row, status, viewer),
    executionRecord: toExecutionDto(row.execution),
    deliveryTarget: toDeliveryTargetDto(row),
    canApprove: decidable && canTransition(status, 'APPROVED'),
    canReject: decidable && canTransition(status, 'REJECTED'),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** 列表页用的精简形状（**不带 calls** —— 列表里堆逐次调用没有意义且会拖慢查询）。 */
export type AgentRunSummaryDto = Omit<AgentRunDto, 'calls' | 'injectionSignals'> & {
  callCount: number
}

export function toAgentRunSummaryDto(
  row: AgentRunRow,
  callCount: number,
  viewer: AgentRunViewer = {},
): AgentRunSummaryDto {
  const full = toAgentRunDto(row, viewer)
  // 显式逐字段列出（而不是 `{...rest}` + 解构丢弃）：
  // 后者依赖 eslint 的 `ignoreRestSiblings`，且新增字段时会**静默**跟着进入列表 DTO
  // —— 列表页是"最小可见集"的地方，多一个字段就是一次计划外的对外暴露。
  // `callCount` 由调用方给出（列表查询用 Prisma 的 `_count` 得到），
  // 因此列表**不需要**把每个 run 的全部 AgentCall 行读进内存。
  return {
    id: full.id,
    skill: full.skill,
    status: full.status,
    risk: full.risk,
    requiresApproval: full.requiresApproval,
    requestedBy: full.requestedBy,
    subjectLabel: full.subjectLabel,
    goal: full.goal,
    proposal: full.proposal,
    reason: full.reason,
    degradeCode: full.degradeCode,
    providerKind: full.providerKind,
    injectionFlagged: full.injectionFlagged,
    costMicroCents: full.costMicroCents,
    approval: full.approval,
    execution: full.execution,
    executionRecord: full.executionRecord,
    deliveryTarget: full.deliveryTarget,
    canApprove: full.canApprove,
    canReject: full.canReject,
    createdAt: full.createdAt,
    updatedAt: full.updatedAt,
    callCount,
  }
}
