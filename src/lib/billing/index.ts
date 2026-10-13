/**
 * T08 · 组织级计费域统一出口（AC-21）
 *
 * 使用约定：
 *   - 订阅/账单状态**永不**直接读字段 —— 只能由 `reduceBillingEvents` 从事件集派生；
 *   - 用量只经 `UsageRecord`（历史流水），指标只经 `metrics.ts`（当前快照）——
 *     两者**故意**可以不同，别用其中一个去解释另一个；
 *   - 账**只增不减**：只有 `collectUsage`（幂等补缺）与 `appendBillingEvent`（追加）两个写入面；
 *   - 一切查询带 `organizationId` 谓词（T01 铁律）。
 *   - 🔴 沙箱 ≠ 已扣款：`gatewayStatus = CAPTURED` 与 `SUCCEEDED` 是两件事，别混读。
 */

// ── 纯函数内核：方案目录 ──
export {
  BILLING_PLANS,
  EFFECTIVE_PLANS,
  PLAN_LABELS,
  PLAN_LIMITS,
  PLAN_ORDER,
  classifyPlanChange,
  parseBillingPlan,
  parseEffectivePlan,
  planIndex,
  planLimitsOf,
  type BillingPlan,
  type EffectivePlan,
  type PlanChangeDirection,
  type PlanLimits,
} from './plans'

// ── 纯函数内核：订阅/账单状态机 ──
export {
  BILLING_EVENT_TYPES,
  SUBSCRIPTION_STATUSES,
  compareBillingEvents,
  hasPendingCharge,
  initialBillingState,
  isSubscriptionLive,
  latestChargeOf,
  reduceBillingEvents,
  type BillingEventLike,
  type BillingEventType,
  type BillingGatewayStatus,
  type BillingLedgerState,
  type ChargeSnapshot,
  type ChargeStatus,
  type SubscriptionStatus,
} from './subscription'

// ── 纯函数内核：用量口径 ──
export {
  DB_TO_USAGE_UNIT,
  USAGE_UNITS,
  USAGE_UNIT_LABELS,
  USAGE_UNIT_TO_DB,
  aggregateUsage,
  emptyUsageTotals,
  evaluateLimits,
  parsePeriodKey,
  parseUsageUnit,
  periodBoundsOf,
  periodKeyOf,
  shiftPeriodKey,
  usageDedupeKey,
  usageSourceRefOf,
  usageSourceTypeOf,
  type LimitStatus,
  type UsageSourceRef,
  type UsageTotals,
  type UsageUnit,
} from './usage'

// ── 网关（沙箱适配器）──
export {
  BillingGatewayNotImplementedError,
  buildCreemChargeRequest,
  createCreemCharge,
  describeMissingCredentials,
  fingerprintRequest,
  resolveCreemCredentials,
  type CreemChargeDeps,
  type CreemChargeInput,
  type CreemChargeResult,
  type CreemCredentials,
  type CreemGatewayStatus,
  type CreemTransport,
} from './creem'

// ── 服务层（IO）──
export {
  appendBillingEvent,
  collectUsage,
  gatewayReality,
  getSubscription,
  getSubscriptionState,
  getUsageSummary,
  listUsageFacts,
  startCharge,
  type AppendBillingEventInput,
  type AppendBillingEventResult,
  type CollectUsageResult,
  type GatewayReality,
  type StartChargeInput,
  type StartChargeResult,
  type SubscriptionDto,
  type UsageBasis,
  type UsageFact,
  type UsageSummaryDto,
} from './service'
