/**
 * T08 · 计费方案目录 —— **纯常量 + 纯函数**（零 IO）
 *
 * 对齐 AC-21：用量限额要能被判定，且判定必须**可复算、可解释**。
 *
 * ═══════════════════════════════════════════════════════════════
 * 为什么 `FREE` 不是一个 `BillingPlan`
 * ═══════════════════════════════════════════════════════════════
 * 数据库枚举 `BillingPlan` 只有 `STARTER / GROWTH / SCALE`。"从未订阅"不是一种订阅，
 * 用 `null` 表达比插一个假的 `FREE` 行更诚实（插了它，`SELECT plan FROM ...` 就会
 * 把"没订阅"和"订阅了免费档"混为一谈，而后者在商业上可能存在、也可能不存在）。
 * API 层需要一个**可读的有效方案**，故在这里引入 `EffectivePlan = 'FREE' | BillingPlan`：
 * `FREE` 只存在于本层的语义里，它意味着"没有任何订阅事件"。
 *
 * ═══════════════════════════════════════════════════════════════
 * 🔴 下面的数字是**占位假设**，不是商业事实
 * ═══════════════════════════════════════════════════════════════
 * 与 `metrics.ts` 的 `METRIC_ASSUMPTIONS` 同一纪律（见 `T08/risks.md` R12）：
 * 限额与单价都是**假设**，必须① 随响应下发（调用方看得见判定依据）、
 * ② 可注入（测试能换一组值，证明它真的被用上了而不是写死的）。
 * 定价敲定后应改为按租户配置读取（**不要**直接把这里的数字当成已定价格）。
 */

import type { BillingPlan as PrismaBillingPlan } from '@/generated'

/** 数据库里真实存在的方案枚举（与 prisma/schema/billing.prisma 逐字一致）。 */
export type BillingPlan = PrismaBillingPlan

export const BILLING_PLANS: readonly BillingPlan[] = ['STARTER', 'GROWTH', 'SCALE'] as const

/** 有效方案：`FREE` = **从未订阅**（不是一种订阅档位，见文件头）。 */
export type EffectivePlan = 'FREE' | BillingPlan

export const EFFECTIVE_PLANS: readonly EffectivePlan[] = ['FREE', ...BILLING_PLANS] as const

/** 方案序。升/降级由它推导，而不是靠调用方声明"我这是升级"。 */
export const PLAN_ORDER: Record<EffectivePlan, number> = {
  FREE: 0,
  STARTER: 1,
  GROWTH: 2,
  SCALE: 3,
}

export const PLAN_LABELS: Record<EffectivePlan, string> = {
  FREE: '未订阅',
  STARTER: 'Starter',
  GROWTH: 'Growth',
  SCALE: 'Scale',
}

export function planIndex(plan: EffectivePlan): number {
  return PLAN_ORDER[plan] ?? 0
}

/**
 * 把任意输入收敛为 `BillingPlan`（DB 枚举值）。无法识别 → null（调用方按 400 处理）。
 * 注意 `'FREE'` **不是**合法返回 —— 它不能写进数据库。
 */
export function parseBillingPlan(value: unknown): BillingPlan | null {
  if (typeof value !== 'string') return null
  const v = value.trim().toUpperCase()
  return (BILLING_PLANS as readonly string[]).includes(v) ? (v as BillingPlan) : null
}

/** 把任意输入收敛为 `EffectivePlan`（含只读语义的 `FREE`）。 */
export function parseEffectivePlan(value: unknown): EffectivePlan | null {
  if (value === null || value === undefined) return 'FREE'
  if (typeof value !== 'string') return null
  const v = value.trim().toUpperCase()
  return (EFFECTIVE_PLANS as readonly string[]).includes(v) ? (v as EffectivePlan) : null
}

export type PlanChangeDirection = 'UPGRADE' | 'DOWNGRADE' | 'SAME'

/**
 * 升/降级**由方案序推导**，不由调用方声明。
 *
 * 为什么较真：若允许请求体写 `direction: 'UPGRADE'`，那么把 SCALE 改成 STARTER 也能
 * 自称升级，而"升降级"正是 AC-21 要求"状态一致"的那类事实 —— 它必须只有一个来源。
 */
export function classifyPlanChange(from: EffectivePlan, to: EffectivePlan): PlanChangeDirection {
  const d = planIndex(to) - planIndex(from)
  return d > 0 ? 'UPGRADE' : d < 0 ? 'DOWNGRADE' : 'SAME'
}

// ═══════════════════════════════════════════════════════════════
// 限额（按月计费期）
// ═══════════════════════════════════════════════════════════════

/**
 * 每个方案的限额。`null` = **不限**（不是 0，也不是"未定义"）。
 *
 * ⚠️ 注意后两项（Agent）**刻意不是** `number | null` —— 见各自的注释。
 */
export interface PlanLimits {
  /** 每月提案数上限。 */
  proposalPerMonth: number | null
  /** 每月介绍数上限。 */
  introductionPerMonth: number | null
  /** 每月成果上报数上限。 */
  outcomePerMonth: number | null
  /** 每月核验数上限。 */
  verificationPerMonth: number | null
  /** 席位上限（成员数）。**不由用量派生** —— 由成员服务提供，故不参与 `evaluateLimits`。 */
  seats: number | null

  /**
   * 每月 **Agent 花费**上限（**微分** —— 与 `src/lib/agent/cost.ts` 同口径：
   * 1 分 = 1_000_000 微分；整数结算，避免浮点累加让对账变成"看运气"）。
   *
   * 🔴 **为什么不是 `number | null`**（与上面四项刻意不同）：
   *   上面四项是**业务配额**（"一个月最多介绍 3 次"），`null` = "不设限"是合理的商业选择；
   *   这一项是**花费上限**，而"不设限的支出"恰恰是成本控制面**最不该**提供的选项
   *   —— AC-20 要的正是"限额触发时停下来"。所以每个方案都给一个**有限**数字：
   *   `SCALE` 给得很大，而不是无限。于是判定侧不需要"无限"哨兵，
   *   也就不会出现 `JSON.stringify(Infinity) === 'null'` 这种"响应里额度变成 null"的暗雷。
   *
   * 消费方：`src/lib/agents/quota.ts` 的 `agentQuotaOf()`（T09 组织级额度接线的唯一入口）。
   */
  agentMicroCentsPerMonth: number
  /** 每月 **高成本 Agent 调用**次数上限（AC-20"停止高成本任务"的落点）。同上：有限值。 */
  agentHighCostCallsPerMonth: number
}

/**
 * 🔴 占位假设（见文件头）。改动这里必须同步 `T08/changes.md` 的假设表。
 *
 * ⚠️ `agentMicroCentsPerMonth` 的数值以**分**换算（×1_000_000 = 微分），
 *    这样改的人一眼能看出"这是几块钱"，而不是对着一串 0 数位。
 */
export const PLAN_LIMITS: Record<EffectivePlan, PlanLimits> = {
  FREE: {
    proposalPerMonth: 20,
    introductionPerMonth: 3,
    outcomePerMonth: 10,
    verificationPerMonth: 2,
    seats: 5,
    // FREE 的 Agent 额度 = T09 原先写死的 `DEFAULT_QUOTA`（500 分 / 20 次）**逐字沿用**。
    // 刻意如此：接线前"未订阅组织"跑的就是这两个数；接线后**行为不变**，
    // 只是把它从"没有理由的常量"变成"FREE 档的额度"。回归面因此为零。
    agentMicroCentsPerMonth: 500 * 1_000_000,
    agentHighCostCallsPerMonth: 20,
  },
  STARTER: {
    proposalPerMonth: 200,
    introductionPerMonth: 30,
    outcomePerMonth: 100,
    verificationPerMonth: 25,
    seats: 25,
    agentMicroCentsPerMonth: 5_000 * 1_000_000, // 5 000 分
    agentHighCostCallsPerMonth: 200,
  },
  GROWTH: {
    proposalPerMonth: 1500,
    introductionPerMonth: 200,
    outcomePerMonth: 800,
    verificationPerMonth: 200,
    seats: 100,
    agentMicroCentsPerMonth: 25_000 * 1_000_000, // 25 000 分
    agentHighCostCallsPerMonth: 1_000,
  },
  SCALE: {
    proposalPerMonth: null,
    introductionPerMonth: null,
    outcomePerMonth: null,
    verificationPerMonth: null,
    seats: 500,
    // 「很大」而不是「无限」—— 见 `PlanLimits.agentMicroCentsPerMonth` 的注释。
    agentMicroCentsPerMonth: 100_000 * 1_000_000, // 100 000 分
    agentHighCostCallsPerMonth: 5_000,
  },
}

export function planLimitsOf(plan: EffectivePlan): PlanLimits {
  return PLAN_LIMITS[plan] ?? PLAN_LIMITS.FREE
}
