/**
 * T08 · 用量口径 —— **纯函数内核**（零 IO）
 *
 * 对齐 **AC-21**：使用量**可复算**。
 *
 * ═══════════════════════════════════════════════════════════════
 * 与 `outcome/metrics.ts` 的分工（两者都对，回答不同问题）
 * ═══════════════════════════════════════════════════════════════
 *   - 指标（`metrics.ts`）是**当前状态快照**："现在有多少提案双方同意"；
 *   - 用量（本文件 + `UsageRecord`）是**历史流水**："这个月真实发生了多少次介绍"。
 *   二者在"提案被撤销"这类场景下会**故意**不同：撤销不退款，账不动。
 *   这就是不能用一条 SQL 从现状反推账单的原因。
 *
 * ⚠️ 但**单元词表必须同源** —— 故 `UsageUnit` 直接就是 `MetricUnit`（见下）。
 *    若各定义一套，"介绍 3 次"会在报表里变成两个数，而**不会报任何错**。
 *
 * ═══════════════════════════════════════════════════════════════
 * 期次（periodKey）：账单的一等概念
 * ═══════════════════════════════════════════════════════════════
 * 归集与限额都按月分组，期次显式落列（`UsageRecord.periodKey`），
 * 而不是让对账脚本去 `WHERE occurredAt >= ? AND occurredAt < ?` —— 理由见
 * `prisma/schema/billing.prisma` 的字段注释与 `T08/risks.md` R10：
 * 本项目的 DateTime 列历史上出现过多种文本格式混排，范围比较会给出**静默错误**的计数。
 * 期次是纯等值比较，与日期格式彻底解耦。
 *
 * 期次一律按 **UTC 自然月**。理由：本项目所有时间戳以 UTC 落库，跨时区用"本地月"
 * 会让同一个租户在不同机器上得到不同的期次边界 —— 而账单必须只有一个边界。
 */

import { METRIC_UNITS, METRIC_UNIT_LABELS, type MetricUnit } from '@/lib/outcome/metrics'
import { type EffectivePlan, type PlanLimits, planLimitsOf } from './plans'

// ═══════════════════════════════════════════════════════════════
// 单元词表（与指标**同源**）
// ═══════════════════════════════════════════════════════════════

/** 计费单元 = 指标单元（刻意同源，见文件头）。 */
export type UsageUnit = MetricUnit

export const USAGE_UNITS: readonly UsageUnit[] = METRIC_UNITS
export const USAGE_UNIT_LABELS: Record<UsageUnit, string> = METRIC_UNIT_LABELS

/** 指标口径（小写）→ 数据库枚举（大写）。这是唯一的映射点。 */
export const USAGE_UNIT_TO_DB: Record<
  UsageUnit,
  'PROPOSAL' | 'INTRODUCTION' | 'OUTCOME' | 'VERIFICATION'
> = {
  proposal: 'PROPOSAL',
  introduction: 'INTRODUCTION',
  outcome: 'OUTCOME',
  verification: 'VERIFICATION',
}

/** 数据库枚举 → 指标口径。服务层读库时用。 */
export const DB_TO_USAGE_UNIT: Record<string, UsageUnit> = {
  PROPOSAL: 'proposal',
  INTRODUCTION: 'introduction',
  OUTCOME: 'outcome',
  VERIFICATION: 'verification',
}

export function parseUsageUnit(value: unknown): UsageUnit | null {
  if (typeof value !== 'string') return null
  const v = value.trim().toLowerCase()
  return (USAGE_UNITS as readonly string[]).includes(v) ? (v as UsageUnit) : null
}

/**
 * 来源类型 = 单元名（一一对应，不再引入第二套命名）。
 * 它落进 `UsageRecord.sourceType`，供对账脚本按"来源表"分组核对。
 */
export function usageSourceTypeOf(unit: UsageUnit): string {
  return unit
}

/**
 * 账本幂等键：`<unit>:<sourceId>`。
 *
 * 语义：**一条业务事实只入账一次**。唯一约束在 `(organizationId, dedupeKey)`，
 * 故同一租户内重复归集是空操作，跨租户互不影响。
 * ⚠️ 与 HTTP 层的 `IdempotencyRecord` **并存而不互替**：即使调用方没带幂等头，
 *    账也不会重复（账本层的自保）。
 */
export function usageDedupeKey(unit: UsageUnit, sourceId: string): string {
  return `${unit}:${sourceId}`
}

/** 单元 → 来源资源类型（`sourceType`）与资源 id 的解析（对账脚本与本文件同源）。 */
export interface UsageSourceRef {
  unit: UsageUnit
  sourceType: string
  sourceId: string
}

export function usageSourceRefOf(unit: UsageUnit, sourceId: string): UsageSourceRef {
  return { unit, sourceType: usageSourceTypeOf(unit), sourceId }
}

// ═══════════════════════════════════════════════════════════════
// 期次
// ═══════════════════════════════════════════════════════════════

const PERIOD_RE = /^(\d{4})-(0[1-9]|1[0-2])$/

/** `Date` → `YYYY-MM`（UTC 自然月）。 */
export function periodKeyOf(when: Date): string {
  const y = when.getUTCFullYear()
  const m = when.getUTCMonth() + 1
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}`
}

/** 校验期次字符串。非法 → null（调用方按 400 处理）。 */
export function parsePeriodKey(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const v = value.trim()
  return PERIOD_RE.test(v) ? v : null
}

/**
 * 期次边界：`[start, end)`，ISO 8601。
 * **上界开**（end 属于下一期）—— 闭区间会让相邻两期在边界时刻**重复计数**。
 */
export function periodBoundsOf(periodKey: string): { start: string; end: string } | null {
  const key = parsePeriodKey(periodKey)
  if (!key) return null
  const [yStr, mStr] = key.split('-')
  const y = Number(yStr)
  const m = Number(mStr)
  const start = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0, 0))
  const end = new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1, 0, 0, 0, 0))
  return { start: start.toISOString(), end: end.toISOString() }
}

/** 相对某期次偏移 n 个月（n 可为负）。用于"上期对比"这类展示。 */
export function shiftPeriodKey(periodKey: string, months: number): string | null {
  const key = parsePeriodKey(periodKey)
  if (!key) return null
  const [yStr, mStr] = key.split('-')
  const base = Number(yStr) * 12 + (Number(mStr) - 1) + months
  const y = Math.floor(base / 12)
  const m = (base % 12) + 1
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}`
}

// ═══════════════════════════════════════════════════════════════
// 聚合
// ═══════════════════════════════════════════════════════════════

export type UsageTotals = Record<UsageUnit, number>

export function emptyUsageTotals(): UsageTotals {
  return { proposal: 0, introduction: 0, outcome: 0, verification: 0 }
}

/** 计数收敛为非负整数（防御：undefined / 负数 / 小数都不该污染账）。 */
function asCount(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 0
  return Math.max(0, Math.floor(n))
}

/**
 * 把账本行聚合成各单元总量。
 *
 * ⚠️ 只做**加法**，不做时间过滤 —— 过滤在哪一层做必须唯一：服务层用
 * `periodKey` 等值筛出候选行（可被同一条 SQL 复算），本函数只是加总。
 */
export function aggregateUsage(
  records: readonly { unit: UsageUnit; quantity?: number | null }[]
): UsageTotals {
  const totals = emptyUsageTotals()
  for (const r of records) {
    const unit = r?.unit
    if (!unit || !(unit in totals)) continue
    totals[unit] += asCount(r.quantity ?? 1)
  }
  return totals
}

// ═══════════════════════════════════════════════════════════════
// 限额判定
// ═══════════════════════════════════════════════════════════════

/**
 * 单元 → `PlanLimits` 字段名的映射。
 *
 * 🔴 这里是 `Record<UsageUnit, ...>` 而不是 `Partial<...>`：若日后 `MetricUnit`
 *    新增一个单元，**本行会编译失败** —— 这正是我们要的（逼作者明确新单元的限额口径），
 *    而不是让新单元悄悄"没有限额"。
 */
const LIMIT_FIELD: Record<UsageUnit, keyof PlanLimits> = {
  proposal: 'proposalPerMonth',
  introduction: 'introductionPerMonth',
  outcome: 'outcomePerMonth',
  verification: 'verificationPerMonth',
}

export interface LimitStatus {
  unit: UsageUnit
  /** `null` = 不限。 */
  limit: number | null
  used: number
  /** 剩余额度；`null` = 不限；已超额时**钳到 0**（不出现负数）。 */
  remaining: number | null
  /** 已**用尽**（`used >= limit`）—— 再新增就会被拒。 */
  exhausted: boolean
  /** 已**超额**（`used > limit`）—— 数据上已越界（例如降级后旧用量超出新限额）。 */
  exceeded: boolean
}

/**
 * 逐单元判定限额。
 *
 * 🔴 `exhausted` 用 `>=`、`exceeded` 用 `>` —— 这两个不能合并：
 *    「刚好用满」是**正常的边界状态**（不该报成"超额"），但它**确实**挡住了下一次新增。
 *    合成一个布尔会让界面在"用满"时显示成"超额"（吓人且不准），
 *    或在"用满"时仍允许新增（超卖）。
 */
export function evaluateLimits(
  plan: EffectivePlan,
  totals: UsageTotals,
  limits: PlanLimits = planLimitsOf(plan)
): LimitStatus[] {
  return USAGE_UNITS.map((unit) => {
    const raw = limits[LIMIT_FIELD[unit]]
    const limit = typeof raw === 'number' && Number.isFinite(raw) ? raw : null
    const used = asCount(totals[unit])
    return {
      unit,
      limit,
      used,
      remaining: limit === null ? null : Math.max(0, limit - used),
      exhausted: limit !== null && used >= limit,
      exceeded: limit !== null && used > limit,
    }
  })
}
