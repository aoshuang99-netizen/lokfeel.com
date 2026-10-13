/**
 * T08 · 成果验证域统一出口
 *
 * 使用约定：
 *   - 级别**永不**来自请求体 —— 只能由 `deriveVerificationLevel` 从记录集派生；
 *   - `isVerified()` 是"算不算验证成功"的**唯一判据**（AC-15），别自己比较 enum；
 *   - 一切查询带 `organizationId` 谓词（T01 铁律）。
 */

// ── 纯函数内核 ──
export {
  LEVEL_ORDER,
  LEVEL_LABELS,
  VERIFIED_LEVELS,
  levelIndex,
  parseVerificationLevel,
  isVerified,
  deriveVerificationLevel,
  isLevelAdvance,
  outcomeRoleOf,
  type OutcomeVerificationLevel,
  type OutcomeRole,
} from './verification'

// ── 服务层（IO） ──
export {
  OUTCOME_LIMITS,
  toOutcomeDto,
  reportOutcome,
  getOutcomeById,
  listOutcomes,
  confirmOutcome,
  verifyOutcome,
  type OutcomeDto,
  type OutcomeVerificationView,
  type ReportOutcomeInput,
  type ConfirmOutcomeInput,
  type VerifyOutcomeInput,
  type ListOutcomesOptions,
} from './outcomes'

// ── 商业指标（AC-16）──
export {
  METRIC_UNITS,
  METRIC_UNIT_LABELS,
  METRIC_ASSUMPTIONS,
  round1,
  round2,
  percent,
  unitsOf,
  computeOutcomeMetrics,
  type MetricUnit,
  type MetricAssumptions,
  type OutcomeMetricCounts,
  type OutcomeMetrics,
  type OutcomeMetricsBasis,
  type OutcomeFunnelMetrics,
  type OutcomeWorkloadMetrics,
  type OutcomeCostMetrics,
  type OutcomeCostLineItem,
  type ComputeMetricsParams,
} from './metrics'

export {
  collectOutcomeMetricCounts,
  getOutcomeMetrics,
  type OutcomeMetricsDto,
  type OutcomeMetricsOptions,
} from './metrics-service'
