/**
 * P2 · Outcome Observatory —— 服务端形状的**客户端镜像**（取值域 + 文案）
 *
 * 🔴 与 `consent/types.ts` 同一取向：只 `import type` 服务端模块（零运行时），
 *    再用**编译期双向等价断言**把取值域钉住。值导入会把 `@/lib/outcome`
 *    （连带 Prisma）拖进客户端 bundle —— 由门禁 R10 把守。
 *
 * ⚠️ 语言纪律（本区最容易写错的一处）：
 *    「已验证」的判据**只有**服务端 `isVerified()` 一处实现。前端**不得**
 *    自己比较 `level === 'EXTERNALLY_VERIFIED'` 这类字面量 —— 那在日后新增第四级时
 *    会**静默漏算**（散落的比较不会报错，只会少算）。
 *    因此：本目录只提供**文案**与**展示顺序**，判据永远读服务端下发的 `verified` 布尔。
 */

import type { MetricUnit, OutcomeRole, OutcomeVerificationLevel } from '@/lib/outcome'

type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
type AssertTrue<T extends true> = T

// ═══════════════════════════════════════════════════════════
// 三级成果验证
// ═══════════════════════════════════════════════════════════

/** 由低到高。**顺序即语义**（派生取最高，迁移只允许前进）。 */
export const OBSERVATORY_LEVELS = [
  'SELF_REPORTED',
  'COUNTERPARTY_CONFIRMED',
  'EXTERNALLY_VERIFIED',
] as const
export type ObservatoryLevel = (typeof OBSERVATORY_LEVELS)[number]

/** 文案与服务端 `LEVEL_LABELS` **保持一致** —— 同一档位两处不同说法会让用户以为是两回事。 */
export const OBSERVATORY_LEVEL_LABELS: Record<ObservatoryLevel, string> = {
  SELF_REPORTED: '仅自报',
  COUNTERPARTY_CONFIRMED: '对手方已确认',
  EXTERNALLY_VERIFIED: '外部已核验',
}

/** 每一档的**含义说明**（为什么它算/不算验证成功）。 */
export const OBSERVATORY_LEVEL_HINTS: Record<ObservatoryLevel, string> = {
  SELF_REPORTED: '上报即得的下限，不是验证结论 —— 不计入"已验证"。',
  COUNTERPARTY_CONFIRMED: '对手方对同一件事做了确认，双方陈述一致。',
  EXTERNALLY_VERIFIED: '运营/admin 做了外部核验。',
}

export const OBSERVATORY_ROLES = ['REPORTER', 'COUNTERPARTY', 'OBSERVER'] as const
export type ObservatoryRole = (typeof OBSERVATORY_ROLES)[number]

export const OBSERVATORY_ROLE_LABELS: Record<ObservatoryRole, string> = {
  REPORTER: '我上报的',
  COUNTERPARTY: '我作为对手方',
  OBSERVER: '旁观（我与此条无直接关系）',
}

export const OBSERVATORY_METRIC_UNITS = [
  'proposal',
  'introduction',
  'outcome',
  'verification',
] as const
export type ObservatoryMetricUnit = (typeof OBSERVATORY_METRIC_UNITS)[number]

export const OBSERVATORY_METRIC_UNIT_LABELS: Record<ObservatoryMetricUnit, string> = {
  proposal: '提案',
  introduction: '介绍',
  outcome: '成果',
  verification: '核验',
}

/**
 * 漏斗**主线**（服务端 `funnel` 里构成"逐级收窄"的那 5 个数）。
 *
 * ⚠️ `consentPending` **刻意不在主线里**：它是 `proposals` 的**子集状态**
 *    （"还有多少条等着表态"），不是漏斗的一级。把它插进主线会让漏斗看起来
 *    像在"从提案掉到待表态"，而真实语义是"提案中有一批还没表态"。
 *    服务端的 4 个 `rates` 也正好对应本序列的 4 次相邻转化 —— 一一对齐。
 */
export const OBSERVATORY_FUNNEL_STAGES = [
  'proposals',
  'mutuallyAccepted',
  'introduced',
  'outcomesReported',
  'outcomesVerified',
] as const
export type ObservatoryFunnelStage = (typeof OBSERVATORY_FUNNEL_STAGES)[number]

export const OBSERVATORY_FUNNEL_LABELS: Record<ObservatoryFunnelStage, string> = {
  proposals: '已发起提案',
  mutuallyAccepted: '双方已同意',
  introduced: '已完成介绍',
  outcomesReported: '已上报成果',
  outcomesVerified: '已验证成果',
}

/** 转化率（百分比，1 位小数）。键与服务端 `funnel.rates` 逐字一致。 */
export const OBSERVATORY_RATE_KEYS = [
  'acceptedPerProposal',
  'introducedPerAccepted',
  'outcomePerIntroduced',
  'verifiedPerOutcome',
] as const
export type ObservatoryRateKey = (typeof OBSERVATORY_RATE_KEYS)[number]

export const OBSERVATORY_RATE_LABELS: Record<ObservatoryRateKey, string> = {
  acceptedPerProposal: '提案 → 双方同意',
  introducedPerAccepted: '同意 → 完成介绍',
  outcomePerIntroduced: '介绍 → 产生成果',
  verifiedPerOutcome: '成果 → 通过验证',
}

// ═══════════════════════════════════════════════════════════
// 漂移守卫（3 条）
// ═══════════════════════════════════════════════════════════

export type _DriftGuardObservatoryLevel = AssertTrue<Exact<ObservatoryLevel, OutcomeVerificationLevel>>
export type _DriftGuardObservatoryRole = AssertTrue<Exact<ObservatoryRole, OutcomeRole>>
export type _DriftGuardObservatoryMetricUnit = AssertTrue<Exact<ObservatoryMetricUnit, MetricUnit>>

// ═══════════════════════════════════════════════════════════
// 装配器出口类型
// ═══════════════════════════════════════════════════════════

export interface ObservatoryVerificationMark {
  level: ObservatoryLevel
  levelLabel: string
  at: string
}

export interface ObservatoryTimelineEntry {
  id: string
  summary: string
  level: ObservatoryLevel
  levelLabel: string
  /** 🔴 **服务端下发的派生值**，前端不比较枚举字面量。 */
  verified: boolean
  /** 事件发生时间（业务时间，不是上报时间）。 */
  occurredAt: string
  reportedAt: string
  myRole: ObservatoryRole
  myRoleLabel: string
  /** 我此刻能否做「对手方确认」（服务端算好，前端不自判）。 */
  canConfirm: boolean
  /** 我此刻能否做「外部核验」（仅 ADMIN+）。 */
  canVerify: boolean
  verifications: ObservatoryVerificationMark[]
}

export interface ObservatoryTimeline {
  entries: ObservatoryTimelineEntry[]
  counts: {
    total: number
    verified: number
    unverified: number
    /** `unverified` 是取自服务端下发值还是前端自算 —— 口径必须可辨。 */
    unverifiedSource: 'server' | 'computed-from-items'
  }
  notes: string[]
}

/** 漏斗一行：计数 + （若适用）它到下一级的转化率。 */
export interface ObservatoryFunnelRow {
  stage: ObservatoryFunnelStage
  label: string
  count: number
  /** 该级 → 下一级的转化率（百分比）。最后一级为 null。 */
  rateToNext: number | null
  rateLabel: string | null
}

export interface ObservatoryCostRow {
  unit: ObservatoryMetricUnit
  label: string
  units: number
  unitCostCents: number
  costCents: number
}

export interface ObservatoryMetricsView {
  currency: string
  /** 指标口径：全时 / 某任务。 */
  scopeLabel: string
  missionId: string | null
  /** 判定"已验证"用的级别集合 —— **服务端下发**，供对账复算（不是前端猜的）。 */
  verifiedLevels: ObservatoryLevel[]
  /** 假设集（工时与单价的来源）。**必须原样展示** —— 它们是假设，不是财务事实。 */
  assumptions: {
    currency: string
    minutesPerIntervention: number
    unitCosts: string[]
  }
  funnel: ObservatoryFunnelRow[]
  /** `proposals` 中仍在等表态的条数（**子集状态**，不属于漏斗主线 —— 见上方注释）。 */
  consentPending: number
  workload: {
    takeovers: number
    deadLettered: number
    interventions: number
    minutesPerIntervention: number
    estimatedHumanMinutes: number
    estimatedHumanHours: number
  }
  cost: {
    rows: ObservatoryCostRow[]
    totalCostCents: number
    totalCost: number
  }
  generatedAt: string
  notes: string[]
}
