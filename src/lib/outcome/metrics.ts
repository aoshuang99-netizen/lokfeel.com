/**
 * T08 · 商业指标 —— **纯函数内核**（零 IO、零 Prisma 依赖）
 *
 * 对齐 **AC-16**：任务成本 / 人工工时 / 介绍漏斗**可复算**。
 *
 * ═══════════════════════════════════════════════════════════════
 * 为什么"可复算"要求把它抽成纯函数
 * ═══════════════════════════════════════════════════════════════
 * AC-16 的判据不是"数字看起来对"，而是「**API 下发的每个数字，都能被原始表
 * 独立算出同一个值**」。要做到这一点，指标必须满足两条：
 *   1. **输入即计数**：本文件的所有输出都只是"原始计数 + 已声明的假设"的函数。
 *      凡是需要"再查一次库才能解释"的数字（例如现场算个平均值），都不可复算 ——
 *      对账脚本没有同样的中间态，只能复现**最终结果**。
 *   2. **假设显式且可注入**：单位成本、每次人工介入的分钟数都是**假设**，不是事实。
 *      它们必须① 出现在响应里（调用方能看见自己看到的是基于什么的估算），
 *      ② 可注入（测试能改成别的值，从而证明"假设真的被用上了"而不是写死的）。
 *
 * ⚠️ 因此本文件**不含** `Date.now()` / 随机数 / 任何 IO。时间戳由服务层加在 DTO 外层，
 *    不属于"指标本身"（否则同一份数据在不同时刻会算出不同的指标）。
 *
 * ═══════════════════════════════════════════════════════════════
 * 口径（口径不写清楚 = 数字不可复算）
 * ═══════════════════════════════════════════════════════════════
 *   1. **漏斗是"当前状态快照"**，不是历史队列。`mutuallyAccepted` 数的是
 *      `status = MUTUALLY_ACCEPTED` 的提案 —— 它**包含已介绍的那些**（介绍落地后
 *      授权状态冻结在 `MUTUALLY_ACCEPTED`，见 `ConnectionProposalStatus` 注释）。
 *      被撤销的提案（`REVOKED`）**不计入**任何一档，哪怕它曾经双方同意过。
 *      ⇒ 这是 SQL 一条 `COUNT(*)` 能算出的口径；历史队列需要事件日志，不在本切片。
 *   2. **不做时间窗口**（`basis.scope = 'all-time'`）。原因见 `risks.md` R10：
 *      库里的 DateTime 是 TEXT 且格式不统一（`...Z` / `...+00:00` / 空格分隔），
 *      跨格式的范围比较会给出**静默错误**的计数 —— 那正好摧毁 AC-16。
 *      时段口径留到 Slice 3 引入 `UsageRecord` 时一并做（那里的时间列由我们自己写）。
 *   3. **分母为 0 的比率返回 0**，不返回 `null` / `NaN` —— 界面出现 `NaN%` 比出现 `0%`
 *      更糟（前者看起来像系统坏了，后者是"还没有数据"的诚实表达）。
 */

import { VERIFIED_LEVELS, type OutcomeVerificationLevel } from './verification'

// ═══════════════════════════════════════════════════════════════
// 输入：原始计数（服务层用 SQL 聚合得到，对账脚本用原始表 SQL 独立算出）
// ═══════════════════════════════════════════════════════════════

export interface OutcomeMetricCounts {
  /** 已发起提案数。 */
  proposals: number
  /** 仍在等表态（`status = CONSENT_PENDING`）。 */
  consentPending: number
  /** 双方已同意（`status = MUTUALLY_ACCEPTED`，**含已介绍的**）。 */
  mutuallyAccepted: number
  /** 已完成介绍（`introducedAt IS NOT NULL`）。 */
  introduced: number
  /** 已上报成果数。 */
  outcomesReported: number
  /** 其中**已验证**的（`verificationLevel ∈ VERIFIED_LEVELS`，由 `isVerified` 派生）。 */
  outcomesVerified: number
  /** 人工接管的任务数（`TAKEN_OVER`）。 */
  takeovers: number
  /** 进入死信、等待人处置的任务数（`DEAD`）。 */
  deadLettered: number
}

/** 计费单元。三档 + 核验档，**都与"一条 SQL 谓词"一一对应**（可复算的前提）。 */
export type MetricUnit = 'proposal' | 'introduction' | 'outcome' | 'verification'

export const METRIC_UNITS: readonly MetricUnit[] = [
  'proposal',
  'introduction',
  'outcome',
  'verification',
] as const

export const METRIC_UNIT_LABELS: Record<MetricUnit, string> = {
  proposal: '提案',
  introduction: '介绍',
  outcome: '成果',
  verification: '核验',
}

/**
 * 🔴 全部是**假设**，不是从任何外部系统读来的真实费率。
 * 它们出现在响应里，就是为了让"这个成本数是怎么来的"一眼可见、且能被替换。
 * Slice 3 接入真实计量（`UsageRecord` + Creem）后，这里应改为按租户配置读取。
 */
export interface MetricAssumptions {
  /** 计价币种（ISO 4217）。 */
  currency: string
  /** 每次人工介入的估算耗时（分钟）。 */
  minutesPerIntervention: number
  /** 每个计费单元的单价（**分**，整数 —— 避免浮点求和误差）。 */
  unitCostsCents: Record<MetricUnit, number>
}

export const METRIC_ASSUMPTIONS: MetricAssumptions = {
  currency: 'USD',
  minutesPerIntervention: 15,
  unitCostsCents: {
    proposal: 20,
    introduction: 500,
    outcome: 300,
    // 「核验」单元按**已验证成果数**计费（不是验证记录条数）—— 见 METRIC_UNITS 注释：
    // 每条成果被核验一次即产生一次核验成本；多条确认记录是幂等重放，不该重复计费。
    verification: 100,
  },
}

// ═══════════════════════════════════════════════════════════════
// 输出
// ═══════════════════════════════════════════════════════════════

/** 换算口径：本端点的全部指标。 */
export interface OutcomeMetrics {
  currency: string
  basis: OutcomeMetricsBasis
  funnel: OutcomeFunnelMetrics
  workload: OutcomeWorkloadMetrics
  cost: OutcomeCostMetrics
}

export interface OutcomeMetricsBasis {
  /** 目前恒为 `all-time`（见文件头口径 2）。 */
  scope: 'all-time'
  /** 若指定了任务，则全部指标都被该任务限定（**包括** `verifiedLevels` 之外的字段）。 */
  missionId: string | null
  /** 判定"已验证"所用到的级别集合 —— 由 `isVerified` 派生，随响应下发以便对账脚本复算。 */
  verifiedLevels: OutcomeVerificationLevel[]
  /** 假设集（工时与单价的来源）。 */
  assumptions: MetricAssumptions
}

export interface OutcomeFunnelMetrics {
  proposals: number
  consentPending: number
  mutuallyAccepted: number
  introduced: number
  outcomesReported: number
  outcomesVerified: number
  /** 转化率（**百分比**，保留 1 位小数）。分母为 0 → 0（见文件头口径 3）。 */
  rates: {
    acceptedPerProposal: number
    introducedPerAccepted: number
    outcomePerIntroduced: number
    verifiedPerOutcome: number
  }
}

export interface OutcomeWorkloadMetrics {
  takeovers: number
  deadLettered: number
  /** 需要人介入的任务数 = `takeovers + deadLettered`。 */
  interventions: number
  minutesPerIntervention: number
  estimatedHumanMinutes: number
  estimatedHumanHours: number
}

export interface OutcomeCostLineItem {
  unit: MetricUnit
  units: number
  unitCostCents: number
  costCents: number
}

export interface OutcomeCostMetrics {
  currency: string
  lineItems: OutcomeCostLineItem[]
  totalCostCents: number
  totalCost: number
}

// ═══════════════════════════════════════════════════════════════
// 数值工具（**确定性** —— 不允许依赖运行时默认的舍入行为）
// ═══════════════════════════════════════════════════════════════

/**
 * 保留 1 位小数。用 `Math.round(x * 10) / 10` 而不是 `toFixed()`：
 * `toFixed` 走的是**二进制近似 + 银行家舍入**的边缘行为（`(1.005).toFixed(2) === '1.00'`），
 * 同一份数据在两台机器上可能给出不同字符串。这里只用整数运算，结果可复现。
 */
export function round1(x: number): number {
  return Math.round(x * 10) / 10
}

export function round2(x: number): number {
  return Math.round(x * 100) / 100
}

/** 百分比（1 位小数）。分母 ≤ 0 或非有限 → 0（口径 3）。 */
export function percent(numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return 0
  return round1((numerator / denominator) * 100)
}

/** 计数收敛为非负整数（防御：调用方传入 undefined / 负数 / 小数都不该污染指标）。 */
function asCount(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 0
  return Math.max(0, Math.floor(n))
}

/** 每个计费单元对应的**单元数**。这张表是"成本从哪来"的唯一事实来源。 */
export function unitsOf(counts: OutcomeMetricCounts): Record<MetricUnit, number> {
  return {
    proposal: counts.proposals,
    introduction: counts.introduced,
    outcome: counts.outcomesReported,
    verification: counts.outcomesVerified,
  }
}

// ═══════════════════════════════════════════════════════════════
// 主函数
// ═══════════════════════════════════════════════════════════════

export interface ComputeMetricsParams {
  missionId?: string | null
  assumptions?: MetricAssumptions
  /** 覆盖"已验证"级别集合（默认取 `VERIFIED_LEVELS`）。**仅供测试注入**。 */
  verifiedLevels?: readonly OutcomeVerificationLevel[]
}

/**
 * 由**原始计数**算出全部指标。纯函数：同输入必同输出。
 *
 * ⚠️ 这里的每次乘法都用**整数分**（`units × unitCostCents`），最后才除以 100 得到
 *    主币种金额 —— 先转 float 再乘会积累误差，让"对账相等"变成浮点运气问题。
 */
export function computeOutcomeMetrics(
  rawCounts: OutcomeMetricCounts,
  params: ComputeMetricsParams = {}
): OutcomeMetrics {
  const assumptions = params.assumptions ?? METRIC_ASSUMPTIONS
  const verifiedLevels = [...(params.verifiedLevels ?? VERIFIED_LEVELS)]

  const counts: OutcomeMetricCounts = {
    proposals: asCount(rawCounts?.proposals),
    consentPending: asCount(rawCounts?.consentPending),
    mutuallyAccepted: asCount(rawCounts?.mutuallyAccepted),
    introduced: asCount(rawCounts?.introduced),
    outcomesReported: asCount(rawCounts?.outcomesReported),
    outcomesVerified: asCount(rawCounts?.outcomesVerified),
    takeovers: asCount(rawCounts?.takeovers),
    deadLettered: asCount(rawCounts?.deadLettered),
  }

  // ── 漏斗 ──
  const funnel: OutcomeFunnelMetrics = {
    proposals: counts.proposals,
    consentPending: counts.consentPending,
    mutuallyAccepted: counts.mutuallyAccepted,
    introduced: counts.introduced,
    outcomesReported: counts.outcomesReported,
    outcomesVerified: counts.outcomesVerified,
    rates: {
      acceptedPerProposal: percent(counts.mutuallyAccepted, counts.proposals),
      introducedPerAccepted: percent(counts.introduced, counts.mutuallyAccepted),
      outcomePerIntroduced: percent(counts.outcomesReported, counts.introduced),
      verifiedPerOutcome: percent(counts.outcomesVerified, counts.outcomesReported),
    },
  }

  // ── 人工工时 ──
  const interventions = counts.takeovers + counts.deadLettered
  const estimatedHumanMinutes = interventions * assumptions.minutesPerIntervention
  const workload: OutcomeWorkloadMetrics = {
    takeovers: counts.takeovers,
    deadLettered: counts.deadLettered,
    interventions,
    minutesPerIntervention: assumptions.minutesPerIntervention,
    estimatedHumanMinutes,
    estimatedHumanHours: round2(estimatedHumanMinutes / 60),
  }

  // ── 任务成本（整数分累加，最后再换主币种）──
  const units = unitsOf(counts)
  const lineItems: OutcomeCostLineItem[] = METRIC_UNITS.map((unit) => {
    const unitCostCents = assumptions.unitCostsCents[unit] ?? 0
    return {
      unit,
      units: units[unit],
      unitCostCents,
      costCents: units[unit] * unitCostCents,
    }
  })
  const totalCostCents = lineItems.reduce((sum, item) => sum + item.costCents, 0)
  const cost: OutcomeCostMetrics = {
    currency: assumptions.currency,
    lineItems,
    totalCostCents,
    totalCost: round2(totalCostCents / 100),
  }

  return {
    currency: assumptions.currency,
    basis: {
      scope: 'all-time',
      missionId: params.missionId ?? null,
      verifiedLevels,
      assumptions,
    },
    funnel,
    workload,
    cost,
  }
}
