/**
 * T09 · Agent Runtime —— 模块出口（纯内核）
 *
 * 使用约定：
 *   1. **权限与披露不由本模块判定** —— 它只产**提案**；执行要过
 *      `assertExecutable()`，权限要过 `withTenant(capability)`，披露要过 `discloseSubject()`。
 *   2. **任何渲染都必须消费 `payload`（已过 zod），不得消费 `rawText`。**
 *   3. 想省成本就调 `checkQuota`，**不要**在调用之后再算账。
 *   4. **本模块无 IO**（A1/A2/A5 执法）：要真实模型请用服务层的
 *      `@/lib/agents` 的 `resolveRuntimeProvider()` —— 它会用这里的
 *      `resolveProviderConfig()` 做判据，再在服务层构造 HTTP Provider。
 *      内核只保留"认哪个键、默认模型是哪个"这类**纯**决策。
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

// ── 执行计划（"能不能执行 / 效果是什么"的唯一判据；真正的 IO 在服务层） ──
export {
  EXECUTION_CHANNELS,
  EXECUTION_KINDS,
  EXECUTION_PLANS,
  EXECUTION_REFUSAL_CODES,
  agentExecutionDedupeKey,
  executionPlanOf,
  planExecution,
  skillsWithoutExecutionPlan,
  type ExecutionChannel,
  type ExecutionDecision,
  type ExecutionKind,
  type ExecutionPlan,
  type ExecutionRefusalCode,
} from './execution'

// ── Provider（接口 + 纯环境解码；真实 HTTP 实现在服务层 —— 见 A5） ──
export {
  OPENAI_DEFAULTS,
  createFailingProvider,
  createStubProvider,
  resolveProviderConfig,
  type ModelProvider,
  type ModelRequest,
  type ModelResult,
  type OpenAIConfig,
  type ProviderConfigResolution,
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
