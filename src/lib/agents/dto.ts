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
 *   - `execution` 恒为 `available:false` —— 本切片**没有**注册执行器。写死在 DTO 里
 *     而不是留给前端判断，是为了让"能不能执行"只有一个答案，且这个答案是可核对的。
 *
 * ⚠️ Prisma 的 enum 用大写下划线风格（`AgentRiskLevel.HIGH`），而内核的 TS 联合用
 * 小写（`ProviderKind = 'openai' | 'stub' | 'rules'`）。两者**必须**有唯一映射，
 * 且漂移要被测试抓到（`tests/agents/schema-drift.test.ts`）。
 */

import {
  PROVIDER_KINDS,
  canExecute,
  type AgentRunStatus,
  type DegradeReason,
  type InjectionSignal,
  type ProviderKind,
  type RiskLevel,
} from '@/lib/agent'

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

/** 「能不能执行」——只有一个答案，且答案永远可核对。 */
export interface AgentExecutionAvailability {
  available: boolean
  /** `available:false` 时**必须**有原因（前端据此禁用按钮，而不是留一个点了必然失败的入口）。 */
  reason: string
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
  execution: AgentExecutionAvailability
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
 * 执行可用性。
 *
 * 🔴 **Slice 2 里永远不可用** —— 没有注册任何执行器。两条分支的措辞刻意不同：
 *   - 状态本身不允许（例如还在待批 / 已被驳回）→ 说明是哪一类**状态**问题；
 *   - 状态允许但**没有执行器** → 说明是**能力尚未接线**。
 * 把这两者混成一句"不可用"，会让"接线后就能用"与"这个状态永远不行"分不清。
 */
function executionOf(status: AgentRunStatus, requiresApproval: boolean): AgentExecutionAvailability {
  if (!canExecute(status, requiresApproval)) {
    const reason =
      requiresApproval && status === 'AWAITING_APPROVAL'
        ? '需要人工批准后才能执行（当前状态：AWAITING_APPROVAL）'
        : `当前状态（${status}）不允许执行`
    return { available: false, reason }
  }
  return {
    available: false,
    reason: '本切片未注册执行器 —— 执行属后续任务（需先接 T05 披露出口 / T06 投递出口）',
  }
}

export function toAgentRunDto(row: AgentRunRow): AgentRunDto {
  const status = row.status as AgentRunStatus
  const signals = toSignals(row.injectionSignals)
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
    execution: executionOf(status, row.requiresApproval),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** 列表页用的精简形状（**不带 calls** —— 列表里堆逐次调用没有意义且会拖慢查询）。 */
export type AgentRunSummaryDto = Omit<AgentRunDto, 'calls' | 'injectionSignals'> & {
  callCount: number
}

export function toAgentRunSummaryDto(row: AgentRunRow, callCount: number): AgentRunSummaryDto {
  const full = toAgentRunDto(row)
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
    createdAt: full.createdAt,
    updatedAt: full.updatedAt,
    callCount,
  }
}
