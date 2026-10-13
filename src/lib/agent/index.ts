/**
 * T09 · Agent Runtime —— 模块出口（Slice 1：纯内核）
 *
 * 使用约定：
 *   1. **权限与披露不由本模块判定** —— 它只产**提案**；执行要过
 *      `assertExecutable()`，权限要过 `withTenant(capability)`，披露要过 `discloseSubject()`。
 *   2. **任何渲染都必须消费 `payload`（已过 zod），不得消费 `rawText`。**
 *   3. 想省成本就调 `checkQuota`，**不要**在调用之后再算账。
 */

// ── 类型 ──
export {
  AGENT_RUN_STATUSES,
  DEGRADE_REASONS,
  PROVIDER_KINDS,
  RISK_LEVELS,
  RISK_ORDER,
  riskAtLeast,
  type AgentRunStatus,
  type DegradeReason,
  type InjectionSignal,
  type ProviderKind,
  type RiskLevel,
} from './types'

// ── 技能注册表 ──
export {
  SKILLS,
  SKILL_KEYS,
  CoordinationAdviceOutputSchema,
  IntroDraftOutputSchema,
  getSkill,
  isSkillKey,
  type SkillCostProfile,
  type SkillKey,
  type SkillSpec,
} from './skills'

// ── 不可信数据通道 + 注入信号 ──
export {
  INJECTION_PATTERNS,
  UNTRUSTED_CLOSE,
  UNTRUSTED_OPEN,
  dedupeSignals,
  detectInjection,
  escapeUntrusted,
  wrapUntrusted,
} from './guard'

// ── 成本账本 + 限额 ──
export {
  DEFAULT_PRICE_TABLE,
  DEFAULT_QUOTA,
  EMPTY_LEDGER,
  MICRO_CENTS_PER_CENT,
  ZERO_USAGE,
  appendCall,
  checkQuota,
  costMicroCents,
  estimateMicroCents,
  formatMicroCents,
  ledgerTotals,
  microCentsToCents,
  type AgentCallRecord,
  type AgentQuota,
  type LedgerSnapshot,
  type LedgerTotals,
  type ModelUsage,
  type PriceTable,
  type QuotaDecision,
  type QuotaRefusalCode,
} from './cost'

// ── 批准状态机 ──
export {
  APPROVAL_TRANSITIONS,
  AgentTransitionError,
  TERMINAL_STATUSES,
  assertExecutable,
  assertTransition,
  canExecute,
  canTransition,
  isTerminal,
  nextStatuses,
} from './approval'

// ── Provider ──
export {
  createFailingProvider,
  createStubProvider,
  resolveProvider,
  type ModelProvider,
  type ModelRequest,
  type ModelResult,
  type ProviderResolution,
} from './provider'

// ── 编排 ──
export {
  buildInstruction,
  buildUntrusted,
  checkConstrained,
  extractJson,
  runSkill,
  type AgentOutcome,
  type RunSkillOptions,
} from './runtime'
