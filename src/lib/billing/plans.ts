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

/** 每个方案的限额。`null` = **不限**（不是 0，也不是"未定义"）。 */
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
}

/** 🔴 占位假设（见文件头）。改动这里必须同步 `T08/changes.md` 的假设表。 */
export const PLAN_LIMITS: Record<EffectivePlan, PlanLimits> = {
  FREE: {
    proposalPerMonth: 20,
    introductionPerMonth: 3,
    outcomePerMonth: 10,
    verificationPerMonth: 2,
    seats: 5,
  },
  STARTER: {
    proposalPerMonth: 200,
    introductionPerMonth: 30,
    outcomePerMonth: 100,
    verificationPerMonth: 25,
    seats: 25,
  },
  GROWTH: {
    proposalPerMonth: 1500,
    introductionPerMonth: 200,
    outcomePerMonth: 800,
    verificationPerMonth: 200,
    seats: 100,
  },
  SCALE: {
    proposalPerMonth: null,
    introductionPerMonth: null,
    outcomePerMonth: null,
    verificationPerMonth: null,
    seats: 500,
  },
}

export function planLimitsOf(plan: EffectivePlan): PlanLimits {
  return PLAN_LIMITS[plan] ?? PLAN_LIMITS.FREE
}
