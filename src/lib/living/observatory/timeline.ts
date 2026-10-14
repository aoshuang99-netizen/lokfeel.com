/**
 * P2 · Outcome Observatory —— 时间轴与指标装配器（纯函数，零 IO）
 *
 * 数据源：`GET /api/v1/outcomes`（T08 列表）
 *         `GET /api/v1/outcomes/metrics`（T08 商业指标，AC-16）
 *
 * 🔴 五条纪律：
 *
 *   1. **零 IO**。取数在容器组件里；本文件只做映射，从而可被纯单测覆盖，
 *      也能被 E2E 脚本直接喂真实 HTTP 载荷。
 *
 *   2. **判据不重写**。「已验证」只读服务端下发的 `verified` 布尔 ——
 *      前端**不得**写 `level === 'EXTERNALLY_VERIFIED'`。T08 的 `isVerified()`
 *      是唯一实现，日后加第四级时散落的比较会**静默漏算**。
 *
 *   3. **口径随载荷下发**。指标的 `basis.verifiedLevels` 与 `basis.assumptions`
 *      原样展示：它们是"这些数字怎么来的"，不是 UI 修辞。用户看到"成本 $X"
 *      时必须能同时看到"按什么单价算的"。
 *
 *   4. **载荷自洽性要自证**。列表侧 `count` / `unverifiedCount` 与服务端下发一致
 *      时才算可信；`count !== items.length` 说明载荷被截断或被改过 —— 说出来，
 *      而不是默默按 items 展示。
 *
 *   5. **顺序必须确定**。时间轴按 `occurredAt` 降序、同刻按 `id` 升序；
 *      无法解析的时间排到最后（连同一条说明），而不是随浏览器实现漂移。
 */

import { z } from 'zod'
import {
  OBSERVATORY_FUNNEL_LABELS,
  OBSERVATORY_FUNNEL_STAGES,
  OBSERVATORY_LEVEL_LABELS,
  OBSERVATORY_METRIC_UNIT_LABELS,
  OBSERVATORY_METRIC_UNITS,
  OBSERVATORY_RATE_KEYS,
  OBSERVATORY_RATE_LABELS,
  OBSERVATORY_ROLES,
  OBSERVATORY_ROLE_LABELS,
  OBSERVATORY_LEVELS,
  type ObservatoryCostRow,
  type ObservatoryFunnelRow,
  type ObservatoryLevel,
  type ObservatoryMetricsView,
  type ObservatoryTimeline,
  type ObservatoryTimelineEntry,
} from './types'

export type ObservatoryAssembly<T> = { ok: true; value: T } | { ok: false; error: string }

function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0]
  const path = issue?.path.length ? `字段 ${issue.path.join('.')}` : '顶层形状'
  return `${path} 不符合契约（${issue?.message ?? '未知'}）`
}

// ═══════════════════════════════════════════════════════════
// 输入侧
// ═══════════════════════════════════════════════════════════

const VerificationLike = z.looseObject({
  level: z.enum(OBSERVATORY_LEVELS),
  at: z.string(),
})

const OutcomeLike = z.looseObject({
  id: z.string().min(1),
  summary: z.string().min(1),
  verificationLevel: z.enum(OBSERVATORY_LEVELS),
  /** 🔴 服务端派生的布尔。前端只读它。 */
  verified: z.boolean(),
  occurredAt: z.string(),
  reportedAt: z.string(),
  myRole: z.enum(OBSERVATORY_ROLES),
  canConfirm: z.boolean(),
  canVerify: z.boolean(),
  verifications: z.array(VerificationLike),
})

const OutcomesListLike = z.looseObject({
  items: z.array(OutcomeLike),
  count: z.number().int().min(0),
  unverifiedCount: z.number().int().min(0),
})

const RatesLike = z.looseObject({
  acceptedPerProposal: z.number(),
  introducedPerAccepted: z.number(),
  outcomePerIntroduced: z.number(),
  verifiedPerOutcome: z.number(),
})

const FunnelLike = z.looseObject({
  proposals: z.number(),
  consentPending: z.number(),
  mutuallyAccepted: z.number(),
  introduced: z.number(),
  outcomesReported: z.number(),
  outcomesVerified: z.number(),
  rates: RatesLike,
})

const WorkloadLike = z.looseObject({
  takeovers: z.number(),
  deadLettered: z.number(),
  interventions: z.number(),
  minutesPerIntervention: z.number(),
  estimatedHumanMinutes: z.number(),
  estimatedHumanHours: z.number(),
})

const CostRowLike = z.looseObject({
  unit: z.enum(OBSERVATORY_METRIC_UNITS),
  units: z.number(),
  unitCostCents: z.number(),
  costCents: z.number(),
})

const CostLike = z.looseObject({
  currency: z.string(),
  lineItems: z.array(CostRowLike),
  totalCostCents: z.number(),
  totalCost: z.number(),
})

const AssumptionsLike = z.looseObject({
  currency: z.string(),
  minutesPerIntervention: z.number(),
  unitCostsCents: z.record(z.string(), z.number()),
})

const BasisLike = z.looseObject({
  scope: z.string(),
  missionId: z.string().nullable(),
  verifiedLevels: z.array(z.enum(OBSERVATORY_LEVELS)),
  assumptions: AssumptionsLike,
})

const MetricsLike = z.looseObject({
  currency: z.string(),
  basis: BasisLike,
  funnel: FunnelLike,
  workload: WorkloadLike,
  cost: CostLike,
  generatedAt: z.string(),
})

// ═══════════════════════════════════════════════════════════
// 时间轴
// ═══════════════════════════════════════════════════════════

/**
 * 无法解析的时间排到最后。
 *
 * ⚠️ 必须是 **负** 无穷：时间轴是**降序**排的，`+Infinity` 会跑到最前面
 *    （与"排到末尾"相反，且不会报错 —— 只是顺序看起来"有点怪"）。
 */
function timeOf(iso: string): number {
  const t = Date.parse(iso)
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t
}

export function assembleObservatoryTimeline(payload: unknown): ObservatoryAssembly<ObservatoryTimeline> {
  const parsed = OutcomesListLike.safeParse(payload)
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) }

  const { items, count, unverifiedCount } = parsed.data
  const notes: string[] = []

  // ── 载荷自洽性：count 是服务端对各 items 的计数断言 ──
  if (count !== items.length) {
    notes.push(
      `载荷自洽性未通过：服务端称共 ${count} 条，实际只下发 ${items.length} 条 —— ` +
        `本页按实际下发的 ${items.length} 条展示，不把差额当成"没有"。`,
    )
  }

  const entries: ObservatoryTimelineEntry[] = [...items]
    .sort((a, b) => {
      const diff = timeOf(b.occurredAt) - timeOf(a.occurredAt)
      // `Infinity - Infinity = NaN`（两侧都不可解析）→ 落到 id 比较，保证确定性。
      return diff || a.id.localeCompare(b.id)
    })
    .map((o) => ({
      id: o.id,
      summary: o.summary,
      level: o.verificationLevel,
      levelLabel: OBSERVATORY_LEVEL_LABELS[o.verificationLevel],
      verified: o.verified,
      occurredAt: o.occurredAt,
      reportedAt: o.reportedAt,
      myRole: o.myRole,
      myRoleLabel: OBSERVATORY_ROLE_LABELS[o.myRole],
      canConfirm: o.canConfirm,
      canVerify: o.canVerify,
      verifications: o.verifications.map((v) => ({
        level: v.level,
        levelLabel: OBSERVATORY_LEVEL_LABELS[v.level],
        at: v.at,
      })),
    }))

  const unparsable = entries.filter((e) => Number.isNaN(Date.parse(e.occurredAt))).length
  if (unparsable > 0) {
    notes.push(`有 ${unparsable} 条成果的发生时间无法解析 —— 它们被排在时间轴末尾，而不是被丢弃。`)
  }

  const verified = count - unverifiedCount
  if (verified < 0) {
    notes.push(
      `服务端下发的 unverifiedCount（${unverifiedCount}）大于总数（${count}）—— 数据自相矛盾，本页不给出"已验证"计数。`,
    )
  }

  return {
    ok: true,
    value: {
      entries,
      counts: {
        total: count,
        verified: verified >= 0 ? verified : 0,
        unverified: unverifiedCount,
        // 明确标注口径来源：这两个数都是**服务端**下发的，不是前端 filter 出来的。
        unverifiedSource: 'server',
      },
      notes,
    },
  }
}

// ═══════════════════════════════════════════════════════════
// 指标
// ═══════════════════════════════════════════════════════════

/** 每级 → 下一级的转化率（与服务端 `rates` 的四个键一一对应）。 */
const RATE_BY_STAGE: Partial<Record<(typeof OBSERVATORY_FUNNEL_STAGES)[number], (typeof OBSERVATORY_RATE_KEYS)[number]>> = {
  proposals: 'acceptedPerProposal',
  mutuallyAccepted: 'introducedPerAccepted',
  introduced: 'outcomePerIntroduced',
  outcomesReported: 'verifiedPerOutcome',
}

function formatCents(cents: number, currency: string): string {
  // 只做"整数分 → 两位小数"的确定性换算，不依赖 `Intl` 的区域默认值
  // （同一份数据在不同机器/时区上必须给出同一个字符串）。
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  const whole = Math.floor(abs / 100)
  const frac = String(abs % 100).padStart(2, '0')
  return `${sign}${currency} ${whole}.${frac}`
}

export function assembleObservatoryMetrics(payload: unknown): ObservatoryAssembly<ObservatoryMetricsView> {
  const parsed = MetricsLike.safeParse(payload)
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) }

  const m = parsed.data
  const notes: string[] = []

  const funnel: ObservatoryFunnelRow[] = OBSERVATORY_FUNNEL_STAGES.map((stage, idx) => {
    const count = m.funnel[stage]
    const rateKey = RATE_BY_STAGE[stage]
    const isLast = idx === OBSERVATORY_FUNNEL_STAGES.length - 1
    return {
      stage,
      label: OBSERVATORY_FUNNEL_LABELS[stage],
      count,
      rateToNext: isLast || !rateKey ? null : m.funnel.rates[rateKey],
      rateLabel: isLast || !rateKey ? null : OBSERVATORY_RATE_LABELS[rateKey],
    }
  })

  const rows: ObservatoryCostRow[] = [...m.cost.lineItems]
    .sort((a, b) => {
      // 按服务端定义的单位次序排（稳定），未知单位排到末尾。
      const ia = (OBSERVATORY_METRIC_UNITS as readonly string[]).indexOf(a.unit)
      const ib = (OBSERVATORY_METRIC_UNITS as readonly string[]).indexOf(b.unit)
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
    })
    .map((li) => ({
      unit: li.unit,
      label: OBSERVATORY_METRIC_UNIT_LABELS[li.unit],
      units: li.units,
      unitCostCents: li.unitCostCents,
      costCents: li.costCents,
    }))

  // 成本合计的自洽性：逐项之和 vs 服务端合计。不等 → 说出来（可能是新增了计费单元
  // 而前端这个视图没显示出来，也可能服务端算错）。
  const sum = rows.reduce((acc, r) => acc + r.costCents, 0)
  if (sum !== m.cost.totalCostCents) {
    notes.push(
      `成本逐项之和（${formatCents(sum, m.currency)}）与服务端合计（${formatCents(m.cost.totalCostCents, m.currency)}）不一致 —— ` +
        `以服务端合计为准展示，但这一条值得核对。`,
    )
  }

  const unitCosts = Object.entries(m.basis.assumptions.unitCostsCents)
    .map(([unit, cents]) => `${unit}: ${formatCents(cents, m.basis.assumptions.currency)}`)
    .sort()

  if (m.basis.verifiedLevels.length === 0) {
    notes.push('服务端未下发"已验证"的级别集合 —— 本页不自行推断哪些档位算已验证。')
  }

  return {
    ok: true,
    value: {
      currency: m.currency,
      scopeLabel: m.basis.missionId === null ? '全部（不限任务）' : `限定任务 ${m.basis.missionId}`,
      missionId: m.basis.missionId,
      verifiedLevels: m.basis.verifiedLevels as ObservatoryLevel[],
      assumptions: {
        currency: m.basis.assumptions.currency,
        minutesPerIntervention: m.basis.assumptions.minutesPerIntervention,
        unitCosts,
      },
      funnel,
      consentPending: m.funnel.consentPending,
      workload: {
        takeovers: m.workload.takeovers,
        deadLettered: m.workload.deadLettered,
        interventions: m.workload.interventions,
        minutesPerIntervention: m.workload.minutesPerIntervention,
        estimatedHumanMinutes: m.workload.estimatedHumanMinutes,
        estimatedHumanHours: m.workload.estimatedHumanHours,
      },
      cost: {
        rows,
        totalCostCents: m.cost.totalCostCents,
        totalCost: m.cost.totalCost,
      },
      generatedAt: m.generatedAt,
      notes,
    },
  }
}

// ═══════════════════════════════════════════════════════════
// 动作
// ═══════════════════════════════════════════════════════════

export type ObservatoryAction = 'confirm' | 'verify'

/**
 * 动作 → 请求。两个端点**都不接受** `level` 入参（级别永远由记录集派生，AC-15）。
 * `evidence` / `note` 可选；这里不代用户编造任何内容。
 */
export function observatoryActionRequest(
  outcomeId: string,
  action: ObservatoryAction,
): { url: string; body: Record<string, never> } {
  return {
    url: `/api/v1/outcomes/${encodeURIComponent(outcomeId)}/${action}`,
    body: {},
  }
}

/** 金额展示（与装配器同一口径，供 UI 复用）。 */
export function formatCurrency(cents: number, currency: string): string {
  return formatCents(cents, currency)
}
