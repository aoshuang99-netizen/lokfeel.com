/**
 * T09 · Agent Runtime —— 领域类型
 *
 * 这些枚举是**编排与状态机**的词汇表。刻意保持"少数几个、语义明确"，
 * 避免出现"看起来更精细、实际谁也不知道该怎么判"的状态。
 */

/** 风险级。`HIGH` = 会产生**对外可见**的副作用（发消息、披露资料）。 */
export const RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH'] as const
export type RiskLevel = (typeof RISK_LEVELS)[number]

/** 风险级的**次序**（用于 `>=` 比较，避免各处散落字符串比较）。 */
export const RISK_ORDER: Readonly<Record<RiskLevel, number>> = { LOW: 0, MEDIUM: 1, HIGH: 2 }

export function riskAtLeast(level: RiskLevel, threshold: RiskLevel): boolean {
  return RISK_ORDER[level] >= RISK_ORDER[threshold]
}

/**
 * Agent 运行状态。
 *
 * 🔴 **`EXECUTED` 不可由 `PROPOSED` 直达** —— 这是 AC-08「注入不得绕过审批」的结构性保证，
 *    由 `approval.ts` 的迁移表 + 断言把守（**不是**靠提示词）。
 */
export const AGENT_RUN_STATUSES = [
  /** 已产出**通过 zod 校验**的结构化结果，但尚未执行任何副作用。 */
  'PROPOSED',
  /** 高风险：必须人工批准后才可能执行。 */
  'AWAITING_APPROVAL',
  'APPROVED',
  'REJECTED',
  /** 已执行副作用（只有经历过 APPROVED 才可能到达）。 */
  'EXECUTED',
  /** 用了**降级路径**（例如规则式兜底），结果可用但能力弱于正常路径 —— 必须显式告知。 */
  'DEGRADED',
  /** 限额不足 → **在发起调用之前**就拒绝（AC-20）。 */
  'BLOCKED_QUOTA',
  'FAILED',
] as const
export type AgentRunStatus = (typeof AGENT_RUN_STATUSES)[number]

/** 降级/失败的原因码。用于 UI 与审计的**可判定**的说明（而不是自由文本）。 */
export const DEGRADE_REASONS = [
  'PROVIDER_UNAVAILABLE',
  'PROVIDER_TIMEOUT',
  'PROVIDER_ERROR',
  'OUTPUT_SCHEMA_INVALID',
  'OUTPUT_NOT_PARSEABLE',
  'INPUT_INVALID',
  'NO_DEGRADE_PATH',
] as const
export type DegradeReason = (typeof DEGRADE_REASONS)[number]

/** 模型提供方种类。`stub` 只用于测试；`rules` 表示**根本没调模型**（规则式兜底）。 */
export const PROVIDER_KINDS = ['openai', 'stub', 'rules'] as const
export type ProviderKind = (typeof PROVIDER_KINDS)[number]

/** 注入信号（**仅告警/升级审批用**，见 `guard.ts` 的诚实声明）。 */
export interface InjectionSignal {
  code: string
  /** 命中的原文片段（截断，避免把长文本塞进审计）。 */
  excerpt: string
}
