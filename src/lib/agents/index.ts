/**
 * T09 · Agent **服务层**出口（Slice 2/3：持久化 + 审批 + 用量 + 真实 Provider）
 *
 * 🔴 与 `@/lib/agent`（单数）的区别 —— 这是**唯一**需要记住的一条：
 *
 *   `@/lib/agent`    = 无 IO 的**内核**（编排、成本、状态机、provider 接口与纯配置）。
 *                      受 `scripts/check-agent-invariants.mjs` 的 A1/A2/A5 约束：
 *                      不得 import tenancy、不得 import 数据库、**不得发起网络调用**。
 *   `@/lib/agents`   = **有 IO 的服务层**（读写 AgentRun/AgentCall/AgentApproval、
 *                      过租户能力、写审计、打真实模型端点）。它 **import** 内核，反过来不成立。
 *
 * 因此：
 *   - 想把 Agent 跑起来（要落库、要审计、要限额、要真模型）→ 从**这里** import。
 *   - 想复用纯逻辑（算成本、判状态迁移、解 provider 配置）→ 从 `@/lib/agent` import，
 *     这样不会把数据库/网络依赖带进无 IO 的场景（单测也因此不需要起库、不需要联网）。
 */

// ── 服务层 API ──
export {
  AGENT_LIMITS,
  AGENT_RUN_SCOPE,
  agentUsage,
  createAgentRun,
  decideAgentRun,
  getAgentRun,
  listAgentRuns,
  periodKeyOf,
  requireSkillKey,
  type AgentDecision,
  type AgentUsageDto,
  type CreateAgentRunInput,
  type CreateAgentRunResult,
  type ListAgentRunsOptions,
  type ListAgentRunsResult,
} from './runs'

// ── 组织级额度（按订阅方案派生 —— 额度的**来源**，不做判定）──
export {
  agentQuotaOf,
  resolveOrganizationAgentQuota,
  type OrganizationAgentQuota,
} from './quota'

// ── 执行器（`EXECUTED` 的**唯一**写入点）──
export {
  executeAgentRun,
  type DeliverFn,
  type ExecuteAgentRunOptions,
  type ExecuteAgentRunResult,
} from './executor'

// ── 对外送达（Slice 6）：目标身份在**创建时**固定，披露依据在**执行时**复验 ──
export {
  DELIVERY_PROFILE_AUDIENCE,
  decodeAuthorizedFieldKeys,
  loadOutboundGate,
  loadOutboundGates,
  normalizeDeliveryInput,
  resolveDeliveryTarget,
  skillSupportsOutboundDelivery,
  toDeliveryTargetRow,
  type DeliveryTargetRow,
  type OutboundGate,
  type ResolvedDeliveryTarget,
} from './delivery-target'

// ── 服务端出口自检（生产侧连通性可复验；只读 / 不计费 / 不落库）──
export {
  probeAgentConnectivity,
  summarizeConnectivity,
  type ConnectivityLayer,
  type ConnectivityReport,
  type ProbeOptions,
  type ProbeVerdict,
} from './connectivity'

// ── Provider（真实 HTTP 实现 —— IO 归服务层，内核只留纯判据）──
export {
  createOpenAIProvider,
  providerHonesty,
  resolveRuntimeProvider,
  type OpenAIProviderOptions,
  type ProviderHonesty,
} from './provider-openai'

// ── DTO 投影（**唯一**的对外形状）──
export {
  PROVIDER_KIND_TO_DB,
  providerKindFromDb,
  providerKindToDb,
  toAgentRunDto,
  toAgentRunSummaryDto,
  toExecutionDto,
  type AgentApprovalDto,
  type AgentApprovalRow,
  type AgentCallDto,
  type AgentCallRow,
  type AgentExecutionAvailability,
  type AgentExecutionDto,
  type AgentExecutionRow,
  type AgentRunDto,
  type AgentRunRow,
  type AgentRunSummaryDto,
  type DbProviderKind,
} from './dto'
