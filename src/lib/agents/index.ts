/**
 * T09 · Agent **服务层**出口（Slice 2：持久化 + 审批 + 用量）
 *
 * 🔴 与 `@/lib/agent`（单数）的区别 —— 这是**唯一**需要记住的一条：
 *
 *   `@/lib/agent`    = 无 IO 的**内核**（编排、成本、状态机、provider）。
 *                      受 `scripts/check-agent-invariants.mjs` 的 A1/A2 约束：
 *                      不得 import tenancy、不得 import 数据库。
 *   `@/lib/agents`   = **有 IO 的服务层**（读写 AgentRun/AgentCall/AgentApproval、
 *                      过租户能力、写审计）。它 **import** 内核，反过来不成立。
 *
 * 因此：
 *   - 想把 Agent 跑起来（要落库、要审计、要限额）→ 从**这里** import。
 *   - 想复用纯逻辑（算成本、判状态迁移、解析 provider）→ 从 `@/lib/agent` import，
 *     这样不会把数据库依赖带进无 IO 的场景（单测也因此不需要起库）。
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

// ── DTO 投影（**唯一**的对外形状）──
export {
  PROVIDER_KIND_TO_DB,
  providerKindFromDb,
  providerKindToDb,
  toAgentRunDto,
  toAgentRunSummaryDto,
  type AgentApprovalDto,
  type AgentApprovalRow,
  type AgentCallDto,
  type AgentCallRow,
  type AgentExecutionAvailability,
  type AgentRunDto,
  type AgentRunRow,
  type AgentRunSummaryDto,
  type DbProviderKind,
} from './dto'
