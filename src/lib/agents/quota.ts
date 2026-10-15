/**
 * T09 · **组织级 Agent 额度** —— 从订阅方案派生（AC-20 的"额度从哪来"）
 *
 * ═══════════════════════════════════════════════════════════════
 * 这个文件解决的是一个**具体的**遗留问题
 * ═══════════════════════════════════════════════════════════════
 * Slice 2/3 里，`createAgentRun` / `agentUsage` 的额度默认是内核的 `DEFAULT_QUOTA`
 * —— 一个**占位常量**，并且响应里明确写着"组织级真实额度配置尚未接线"。
 * 那句话是诚实的，但它意味着：**限额判定用的数字与这个组织付了多少钱毫无关系**。
 * 一个 SCALE 客户与一个从没订阅过的组织，拿到的是同一个上限。
 *
 * 本文件把额度接到**唯一已有的方案事实来源**上：
 *   组织订阅事件（`BillingEvent`）→ `getSubscriptionState()` → `EffectivePlan`
 *   → `planLimitsOf(plan)`（`src/lib/billing/plans.ts` 的**同一张表**）
 *   → `AgentQuota`。
 *
 * 🔴 **不新造第二张"额度表"**：方案的限额已经有一个家（`PLAN_LIMITS`）。
 *    在这里另立一张按方案索引的额度表，就等于造了第二个事实来源 ——
 *    它迟早与 `PLAN_LIMITS` 不一致，而且不一致的那一刻**没有任何东西会报错**
 *    （与 `billing.prisma` 文件头"状态是派生值，不是可写的列"同一取向）。
 *
 * ═══════════════════════════════════════════════════════════════
 * 两条边界（写清楚，避免被误读）
 * ═══════════════════════════════════════════════════════════════
 *   1. 🔴 **数字仍是占位假设**。本文件接的是"**额度从哪来**"（从未订阅 ⇒ FREE 档），
 *      不是"额度该是多少"。`PLAN_LIMITS` 里的数字是待定价的假设，
 *      因此 `runs.ts` 的 `assumptions` 块**继续下发它**（T08 立的纪律：假设随响应下发）。
 *      换句话说：接线把"没有来源"变成了"来源是方案"，**没有**把假设变成事实。
 *   2. 🔴 **本文件不做判定**。放行与否只由内核 `checkQuota()` 说。这里只回答
 *      "这个组织的上限是哪两个数"。
 */

import { planLimitsOf, type EffectivePlan } from '@/lib/billing/plans'
import { getSubscriptionState } from '@/lib/billing/service'
import type { AgentQuota } from '@/lib/agent'
import type { TenantContext } from '@/lib/tenancy/resolve'

/**
 * 方案 → Agent 额度。**纯函数**（不碰 IO）—— 因此"哪个方案给多少"可以被单测逐格钉死，
 * 而不需要起库造订阅事件。
 *
 * ⚠️ 内部**没有** `?? DEFAULT_QUOTA` 这类兜底：`planLimitsOf()` 自己保证未知输入落到
 *    `FREE`（见其实现），再加一层兜底只会掩盖"表里少了一档"这件事。
 */
export function agentQuotaOf(plan: EffectivePlan): AgentQuota {
  const limits = planLimitsOf(plan)
  return {
    maxMicroCents: limits.agentMicroCentsPerMonth,
    maxHighCostCalls: limits.agentHighCostCallsPerMonth,
  }
}

export interface OrganizationAgentQuota {
  quota: AgentQuota
  /** 派生用的有效方案（`FREE` = 本组织**从未**订阅）。随用量响应下发，供界面解释额度来源。 */
  plan: EffectivePlan
}

/**
 * 读当前租户的 Agent 额度。
 *
 * 🔴 为什么额度要**每次调用时读**、而不是缓存进 `Organization`：
 *    订阅会升/降级。把额度落成一列，就得到一个"改方案时忘了同步"的静默错值 ——
 *    表现是"我升级了但额度没变"，而**没有任何东西会报错**。读时派生没有这个失效模式
 *    （与 `billing.prisma` 文件头"状态是派生值"同一条理由）。
 *
 * ⚠️ 这是**热路径上的一次额外查询**，因此调用点必须**每请求一次**、不要在循环里调。
 *    当前两个调用点（`createAgentRun` / `agentUsage`）都是每请求一次。
 */
export async function resolveOrganizationAgentQuota(
  ctx: TenantContext,
): Promise<OrganizationAgentQuota> {
  const state = await getSubscriptionState(ctx)
  return { quota: agentQuotaOf(state.plan), plan: state.plan }
}
