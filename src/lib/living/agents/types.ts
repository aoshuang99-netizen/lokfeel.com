/**
 * P2 · Agent 区 —— 服务端形状的**客户端镜像**（取值域 + 文案）
 *
 * 🔴 类型来源是 `@/lib/agent`（**单数** = 无 IO 的内核），不是 `@/lib/agents`
 *    （复数 = 有 IO 的服务层，会拉 Prisma）。两者边界见 `src/lib/agents/index.ts`
 *    的文件头。门禁 R10 禁止客户端可达代码**值导入** `@/lib/agents`。
 *
 * ⚠️ 本区的诚实纪律（T09 反复强调的三条，UI 必须原样体现）：
 *   ① `execution.available` / `execution.reason` 由服务端执行计划下发，本区**原样透传**。
 *      原因文案**必须原样展示**，否则"点了批准到底会发生什么"就没有答案。
 *   ② `provider` 诚实块：没有凭据时"跑了 3 次花 0 分"不是"模型免费"，
 *      而是"走的是规则式兜底"。这个区别必须显示出来。
 *   ③ `rawText`（模型原文）**不在 DTO 里**，因此本区也无从展示 —— 这是设计，
 *      不是遗漏。可渲染的只有过了 zod 契约的 `proposal`。
 */

import type {
  AgentRunStatus,
  DegradeReason,
  ProviderKind,
  RiskLevel,
  SkillKey,
} from '@/lib/agent'

type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
type AssertTrue<T extends true> = T

// ═══════════════════════════════════════════════════════════
// 运行状态
// ═══════════════════════════════════════════════════════════

export const LIVING_AGENT_STATUSES = [
  'PROPOSED',
  'AWAITING_APPROVAL',
  'APPROVED',
  'REJECTED',
  'EXECUTED',
  'DEGRADED',
  'BLOCKED_QUOTA',
  'FAILED',
] as const
export type LivingAgentStatus = (typeof LIVING_AGENT_STATUSES)[number]

export const LIVING_AGENT_STATUS_LABELS: Record<LivingAgentStatus, string> = {
  PROPOSED: '已产出方案',
  AWAITING_APPROVAL: '等待人工批准',
  APPROVED: '已批准',
  REJECTED: '已驳回',
  EXECUTED: '已执行',
  DEGRADED: '降级产出',
  BLOCKED_QUOTA: '额度不足被拒',
  FAILED: '失败',
}

/** 每一档的**含义**（用户看到状态码时需要能判断"下一步是什么"）。 */
export const LIVING_AGENT_STATUS_HINTS: Record<LivingAgentStatus, string> = {
  PROPOSED: '产出已通过结构校验，但尚未执行任何副作用。',
  AWAITING_APPROVAL: '高风险：必须人工批准后才可能执行。',
  APPROVED: '状态已批准。但批准不等于执行：还需一次显式的执行动作，因此不会自动发生副作用。',
  REJECTED: '已被驳回，不可改判 —— 要推翻需重新发起一次运行。',
  EXECUTED: '副作用已发生。低风险运行可由有权限者直接执行；高风险运行必须先经人工批准。',
  DEGRADED: '走了降级路径（例如规则式兜底）：结果可用，但能力弱于正常路径。',
  BLOCKED_QUOTA: '在发起调用之前就被额度挡下 —— 没有产生真实模型花费。',
  FAILED: '运行失败。失败原因见降级码。',
}

/** 需要人工介入的档位（UI 用来把"待我处理"顶到前面，**不是**权限判定）。 */
export const LIVING_AGENT_ATTENTION_STATUSES: readonly LivingAgentStatus[] = [
  'AWAITING_APPROVAL',
  'FAILED',
  'BLOCKED_QUOTA',
  'DEGRADED',
]

// ═══════════════════════════════════════════════════════════
// 风险 / 降级码 / Provider / 技能
// ═══════════════════════════════════════════════════════════

export const LIVING_AGENT_RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH'] as const
export type LivingAgentRisk = (typeof LIVING_AGENT_RISK_LEVELS)[number]

export const LIVING_AGENT_RISK_LABELS: Record<LivingAgentRisk, string> = {
  LOW: '低风险',
  MEDIUM: '中风险',
  HIGH: '高风险（有对外可见副作用）',
}

export const LIVING_AGENT_DEGRADE_REASONS = [
  'PROVIDER_UNAVAILABLE',
  'PROVIDER_TIMEOUT',
  'PROVIDER_ERROR',
  'OUTPUT_SCHEMA_INVALID',
  'OUTPUT_NOT_PARSEABLE',
  'INPUT_INVALID',
  'NO_DEGRADE_PATH',
] as const
export type LivingAgentDegradeReason = (typeof LIVING_AGENT_DEGRADE_REASONS)[number]

export const LIVING_AGENT_DEGRADE_LABELS: Record<LivingAgentDegradeReason, string> = {
  PROVIDER_UNAVAILABLE: '模型提供方不可用（未配置或未启用）',
  PROVIDER_TIMEOUT: '模型调用超时',
  PROVIDER_ERROR: '模型调用报错',
  OUTPUT_SCHEMA_INVALID: '模型输出不符合结构契约',
  OUTPUT_NOT_PARSEABLE: '模型输出无法解析',
  INPUT_INVALID: '输入不合法',
  NO_DEGRADE_PATH: '没有可用的降级路径',
}

export const LIVING_AGENT_PROVIDER_KINDS = ['openai', 'workbuddy', 'stub', 'rules'] as const
export type LivingAgentProvider = (typeof LIVING_AGENT_PROVIDER_KINDS)[number]

export const LIVING_AGENT_PROVIDER_LABELS: Record<LivingAgentProvider, string> = {
  openai: 'OpenAI（真实调用）',
  workbuddy: 'WorkBuddy 云端算力（真实调用）',
  stub: 'Stub（仅测试）',
  rules: '规则式兜底（没有调用模型）',
}

export const LIVING_AGENT_SKILL_KEYS = [
  'INTENT_EXTRACTION',
  'INTRO_DRAFT',
  'COORDINATION_ADVICE',
] as const
export type LivingAgentSkill = (typeof LIVING_AGENT_SKILL_KEYS)[number]

export const LIVING_AGENT_SKILL_LABELS: Record<LivingAgentSkill, string> = {
  INTENT_EXTRACTION: '意图抽取',
  INTRO_DRAFT: '介绍草稿',
  COORDINATION_ADVICE: '协调建议',
}

/** 裁决（审批结果）文案。 */
export const LIVING_AGENT_DECISION_LABELS = {
  APPROVED: '已批准',
  REJECTED: '已驳回',
} as const

// ═══════════════════════════════════════════════════════════
// 漂移守卫（5 条）
// ═══════════════════════════════════════════════════════════

export type _DriftGuardLivingAgentStatus = AssertTrue<Exact<LivingAgentStatus, AgentRunStatus>>
export type _DriftGuardLivingAgentRisk = AssertTrue<Exact<LivingAgentRisk, RiskLevel>>
export type _DriftGuardLivingAgentDegrade = AssertTrue<
  Exact<LivingAgentDegradeReason, DegradeReason>
>
export type _DriftGuardLivingAgentProvider = AssertTrue<Exact<LivingAgentProvider, ProviderKind>>
export type _DriftGuardLivingAgentSkill = AssertTrue<Exact<LivingAgentSkill, SkillKey>>

// ═══════════════════════════════════════════════════════════
// 装配器出口类型
// ═══════════════════════════════════════════════════════════

export interface LivingAgentApprovalView {
  decision: 'APPROVED' | 'REJECTED'
  decisionLabel: string
  deciderRole: string
  note: string | null
  decidedAt: string
}

export interface LivingAgentRunRow {
  id: string
  skill: LivingAgentSkill
  skillLabel: string
  status: LivingAgentStatus
  statusLabel: string
  statusHint: string
  /** 需要我关注（UI 排序用；**不是**权限判定）。 */
  needsAttention: boolean
  risk: LivingAgentRisk
  riskLabel: string
  requiresApproval: boolean
  requestedBy: string
  subjectLabel: string | null
  goal: string
  reason: string | null
  degradeCode: LivingAgentDegradeReason | null
  degradeLabel: string | null
  provider: LivingAgentProvider
  providerLabel: string
  /**
   * 注入信号命中（**仅告警/升级审批的旁证**，不是放行判据）。
   *
   * ⚠️ 列表形状**只给这个布尔**：`injectionSignals` 的明细（code + excerpt）
   *    只存在于单条运行的完整 DTO 里。因此本区**不展示信号条数** ——
   *    那是无从得知的数字，编一个 0 或 1 都是在伪造。
   */
  injectionFlagged: boolean
  costMicroCents: number
  costLabel: string
  callCount: number
  approval: LivingAgentApprovalView | null
  /** 🔴 「能不能执行」——本切片恒 `available:false`，`reason` 必须原样展示。 */
  execution: { available: boolean; reason: string }
  createdAt: string
}

export interface LivingAgentBoardModel {
  runs: LivingAgentRunRow[]
  /** 服务端回显的过滤条件（用于说明"这不是全量"）。 */
  filters: { status: LivingAgentStatus | null; skill: LivingAgentSkill | null; limit: number }
  notes: string[]
}

export interface LivingAgentUsageModel {
  periodKey: string
  totals: {
    calls: number
    okCalls: number
    failedCalls: number
    highCostCalls: number
    inputTokens: number
    outputTokens: number
    microCents: number
    costLabel: string
  }
  bySkill: Array<{ skill: string; skillLabel: string; calls: number; microCents: number; costLabel: string }>
  runsByStatus: Array<{ status: string; statusLabel: string; count: number }>
  quota: {
    maxMicroCents: number
    maxHighCostCalls: number
    usedMicroCents: number
    remainingMicroCents: number
    highCostCalls: number
    /** 已用额度占比（0–100，整数）；`maxMicroCents` 为 0 时为 null。 */
    usedPercent: number | null
    usedLabel: string
    maxLabel: string
  }
  /** 🔴 诚实块：真实模型调用到底开没开。**必须原样展示**。 */
  provider: { provider: string; realCallsEnabled: boolean; reason: string }
  /** 假设随响应下发（额度与单价都是占位假设，不是财务事实）。 */
  assumptions: { quota: string; price: string; period: string }
  notes: string[]
}
