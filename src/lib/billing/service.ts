/**
 * T08 · 计费服务层 —— **唯一做 IO 的地方**（用量归集 / 汇总 / 订阅事件写入）
 *
 * 职责刻意分层（与 `outcome/metrics-service.ts` 同一取向）：
 *   - 公式在**纯内核**里（`usage.ts` / `subscription.ts`），不在这里 —— 否则对账脚本
 *     与这里会各写一份，而"两份实现"正是 AC-21 要消灭的东西（漂移不报错，只让两个数慢慢分开）；
 *   - 本文件只做三件事：**取数、判合法性、落库**。
 *
 * 🔴 四条不变量：
 *   ① **租户谓词不可省** —— 每个查询都以 `organizationId` 为首要条件（T01 铁律）；
 *   ② **账只增不减** —— 归集只 `INSERT` 缺的行，**从不** UPDATE / DELETE；
 *      （若允许删，`REFUNDED` 之后的对账就再也回不到已知状态）
 *   ③ **非法迁移在写入前被拒** —— 先 `reduceBillingEvents` 折叠一次，不通过就**不写**；
 *   ④ **幂等有两层** —— HTTP 层 `Idempotency-Key`（同键同体 → 回放）与账本层
 *      `dedupeKey` 唯一约束（即使没带幂等头，账也不重复）。**缺一层都不够**。
 *
 * ═══════════════════════════════════════════════════════════════
 * 为什么"归集"是**幂等扫描原始表**，而不是侵入各业务流程去写账
 * ═══════════════════════════════════════════════════════════════
 * 备选方案是在 T05 的 `introduceConnection`、T08 的 `reportOutcome` 等**业务执行点**内
 * 联调 `recordUsage()`。那样更"实时"，但代价是三重的：
 *   ① 要改动已上线的生产代码路径（引入回归面）——而账本不是业务的前置条件；
 *   ② 只要有一处漏接（新加的第四个入口），账就**静默**少一笔，且没有任何东西会报警；
 *   ③ 历史数据没有账，必须另写回填脚本 —— 于是"实时写入"与"回填"两套逻辑并存。
 * 改为**幂等扫描**后：任意时刻重跑都收敛到同一状态（可回填、可修复），
 * 业务路径一行不动；而 AC-21 的"可复算"反而**更强**了 —— 归集走 Prisma + 纯内核，
 * 对账走**原始 SQL**，两条独立路径算出同一个数才算数（与 AC-16 同一手法）。
 *
 * ⚠️ 代价（诚实记录）：若原始行被**硬删除**，账会失去依据。本仓的提案/成果/验证
 *    没有硬删除路径，且账本行一旦写入不会被删 —— 故该风险当前不可达，记在 `risks.md`。
 */

import { db } from '@/lib/db'
import type { TenantContext } from '@/lib/tenancy/resolve'
import { VERIFIED_LEVELS } from '@/lib/outcome'
import {
  BillingGatewayNotImplementedError,
  createCreemCharge,
  describeMissingCredentials,
  fingerprintRequest,
  resolveCreemCredentials,
  type CreemChargeDeps,
} from './creem'
import {
  type BillingPlan,
  type EffectivePlan,
  parseBillingPlan,
  planLimitsOf,
  type PlanLimits,
} from './plans'
import {
  reduceBillingEvents,
  type BillingEventLike,
  type BillingEventType,
  type BillingGatewayStatus,
  type BillingLedgerState,
  type ChargeSnapshot,
  type SubscriptionStatus,
} from './subscription'
import {
  DB_TO_USAGE_UNIT,
  USAGE_UNITS,
  USAGE_UNIT_TO_DB,
  aggregateUsage,
  emptyUsageTotals,
  evaluateLimits,
  parsePeriodKey,
  periodBoundsOf,
  periodKeyOf,
  usageDedupeKey,
  usageSourceTypeOf,
  type LimitStatus,
  type UsageTotals,
  type UsageUnit,
} from './usage'
import { ConflictError, ValidationError } from '@/lib/errors'

// ═══════════════════════════════════════════════════════════════
// 用量：归集
// ═══════════════════════════════════════════════════════════════

/** 一条"用量事实"：来自原始表的某一行。 */
export interface UsageFact {
  unit: UsageUnit
  sourceId: string
  occurredAt: Date
}

/**
 * 扫描原始表，列出本租户的全部用量事实。
 *
 * 每个单元对应**一条可独立重写的 SQL 谓词**（与 `metrics-service.ts` 同一保证）：
 *   proposal     ⟵ ConnectionProposal（全部）
 *   introduction ⟵ ConnectionProposal（`introducedAt IS NOT NULL`）
 *   outcome      ⟵ Outcome（全部）
 *   verification ⟵ Outcome（`verificationLevel ∈ VERIFIED_LEVELS`），时间取该成果
 *                  **最早一条**验证记录的 `createdAt`
 *
 * ⚠️ `verification` 取**成果**而不是验证记录：多条确认是幂等重放，不该重复计费
 *    （与 `metrics.ts` 的 `verification` 单元口径一致 —— 这正是不许两处各写一套的理由）。
 */
export async function listUsageFacts(ctx: TenantContext): Promise<UsageFact[]> {
  const organizationId = ctx.organizationId
  const facts: UsageFact[] = []

  const [proposals, outcomes, verifications] = await Promise.all([
    db.connectionProposal.findMany({
      where: { organizationId },
      select: { id: true, createdAt: true, introducedAt: true },
    }),
    db.outcome.findMany({
      where: { organizationId },
      select: { id: true, occurredAt: true, verificationLevel: true },
    }),
    db.outcomeVerification.findMany({
      where: { organizationId },
      select: { outcomeId: true, createdAt: true },
    }),
  ])

  for (const p of proposals) {
    facts.push({ unit: 'proposal', sourceId: p.id, occurredAt: p.createdAt })
    if (p.introducedAt) {
      facts.push({ unit: 'introduction', sourceId: p.id, occurredAt: p.introducedAt })
    }
  }

  // 该成果最早一条验证记录的 createdAt —— 决定"核验"这件事发生在哪个期次。
  const firstVerificationAt = new Map<string, Date>()
  for (const v of verifications) {
    const prev = firstVerificationAt.get(v.outcomeId)
    if (!prev || v.createdAt.getTime() < prev.getTime()) {
      firstVerificationAt.set(v.outcomeId, v.createdAt)
    }
  }

  const verified = new Set<string>(VERIFIED_LEVELS)
  for (const o of outcomes) {
    facts.push({ unit: 'outcome', sourceId: o.id, occurredAt: o.occurredAt })
    if (verified.has(o.verificationLevel)) {
      facts.push({
        unit: 'verification',
        sourceId: o.id,
        // 退化到成果的 occurredAt：理论上每个"已验证"成果都必有验证记录（级别是**派生**的），
        // 若没有则说明数据被绕过服务层写过 —— 仍要能归集，但取一个确定的替代值。
        occurredAt: firstVerificationAt.get(o.id) ?? o.occurredAt,
      })
    }
  }

  return facts
}

export interface CollectUsageResult {
  /** 本次新入账的行数。 */
  inserted: number
  /** 已存在而跳过的行数（幂等重跑时 = 事实总数）。 */
  skipped: number
  /** 事实总数。 */
  total: number
  perUnit: UsageTotals
}

/**
 * 把用量事实**幂等**写入账本。
 *
 * "只增不减"：只插入缺失的 `dedupeKey`，既不改也不删。
 * 并发下两个归集同时跑时，后到的插入会撞唯一约束 → **吞掉该冲突并记为 skipped**
 * （它不是异常，是"别人已经记过了"）。绝不因为一个重复键而让整批回滚。
 */
export async function collectUsage(ctx: TenantContext): Promise<CollectUsageResult> {
  const organizationId = ctx.organizationId
  const facts = await listUsageFacts(ctx)

  // 去重（同一租户内 dedupeKey 唯一）。同一次扫描里同一事实只会出现一次，
  // 但防御性地过一遍：重复的 sourceId（理论不可达）不该变成两条账。
  const desired = new Map<
    string,
    { unit: UsageUnit; sourceId: string; occurredAt: Date; periodKey: string; dedupeKey: string }
  >()
  for (const fact of facts) {
    const dedupeKey = usageDedupeKey(fact.unit, fact.sourceId)
    if (desired.has(dedupeKey)) continue
    desired.set(dedupeKey, {
      unit: fact.unit,
      sourceId: fact.sourceId,
      occurredAt: fact.occurredAt,
      periodKey: periodKeyOf(fact.occurredAt),
      dedupeKey,
    })
  }

  const keys = [...desired.keys()]
  if (keys.length === 0) {
    return { inserted: 0, skipped: 0, total: 0, perUnit: emptyUsageTotals() }
  }

  const existing = await db.usageRecord.findMany({
    where: { organizationId, dedupeKey: { in: keys } },
    select: { dedupeKey: true },
  })
  const existingKeys = new Set(existing.map((r) => r.dedupeKey))

  const rows = keys
    .filter((k) => !existingKeys.has(k))
    .map((k) => {
      const d = desired.get(k)!
      return {
        organizationId,
        unit: USAGE_UNIT_TO_DB[d.unit],
        quantity: 1,
        occurredAt: d.occurredAt,
        periodKey: d.periodKey,
        sourceType: usageSourceTypeOf(d.unit),
        sourceId: d.sourceId,
        dedupeKey: d.dedupeKey,
      }
    })

  let inserted = 0
  if (rows.length > 0) {
    try {
      const res = await db.usageRecord.createMany({ data: rows })
      inserted = res.count
    } catch {
      // 批量插入失败（极可能是并发下撞唯一键）→ 退化为逐行插入，
      // 这样"只有几行冲突"不会让整批白跑，也不会把冲突当成错误抛给调用方。
      for (const row of rows) {
        try {
          await db.usageRecord.create({ data: row })
          inserted += 1
        } catch {
          // 已存在 —— 正常，跳过。
        }
      }
    }
  }

  const perUnit = emptyUsageTotals()
  for (const fact of facts) perUnit[fact.unit] += 1

  return {
    inserted,
    skipped: keys.length - inserted,
    total: keys.length,
    perUnit,
  }
}

// ═══════════════════════════════════════════════════════════════
// 用量：汇总（AC-21「可复算」的响应面）
// ═══════════════════════════════════════════════════════════════

export interface UsageBasis {
  /** 目前恒为 `period`（按期归集；见 `usage.ts` 文件头）。 */
  scope: 'period'
  periodKey: string
  /** `[periodStart, periodEnd)`，ISO 8601 —— **上界开**，对账脚本据此拼 SQL。 */
  periodStart: string
  periodEnd: string
  /** 判定限额所用的方案与限额值（**随响应下发**，调用方看得见依据）。 */
  plan: EffectivePlan
  planLimits: PlanLimits
  /** 单元口径（指标口径，小写）→ 数据库枚举（大写），供对账脚本对齐。 */
  unitMapping: Record<string, string>
  currency: string
}

export interface UsageSummaryDto {
  generatedAt: string
  basis: UsageBasis
  totals: UsageTotals
  /** 四单元合计。 */
  totalUnits: number
  limits: LimitStatus[]
  /**
   * 网关诚实块：告诉调用方**当前是否真的能收款**。
   * 🔴 没有它，沙箱态与真实态在响应里长得一模一样。
   */
  gateway: GatewayReality
}

export interface GatewayReality {
  provider: 'creem'
  /** `sandbox` = 无凭据，仅捕获"要发什么"；`not_implemented` = 有凭据但接入点未实现。 */
  mode: 'sandbox' | 'not_implemented'
  /** 真实扣款是否可用（当前恒 false —— AC-21 真实扣款 `BLOCKED`）。 */
  realChargesEnabled: boolean
  /** 缺失的凭据名（沙箱态下用于说明"为什么是沙箱"）。 */
  credentialsMissing: string[]
}

export function gatewayReality(
  env: Record<string, string | undefined> = process.env
): GatewayReality {
  const creds = resolveCreemCredentials(env)
  const missing = describeMissingCredentials(env)
  return {
    provider: 'creem',
    mode: creds ? 'not_implemented' : 'sandbox',
    // 明确写死 false：**没有任何代码路径**能让真实扣款成立（transport 未实现）。
    // 将来接入真实网关时，这一行必须与新测试一起改 —— 它是个刻意显眼的开关。
    realChargesEnabled: false,
    credentialsMissing: missing,
  }
}

/** 本租户当期用量汇总。 */
export async function getUsageSummary(
  ctx: TenantContext,
  options: { periodKey?: string | null } = {},
  now: Date = new Date()
): Promise<UsageSummaryDto> {
  const organizationId = ctx.organizationId
  const periodKey = options.periodKey ? parsePeriodKey(options.periodKey) : periodKeyOf(now)
  if (!periodKey) {
    throw new ValidationError('periodKey 必须是 YYYY-MM', { field: 'periodKey' })
  }
  const bounds = periodBoundsOf(periodKey)!

  const [records, state] = await Promise.all([
    db.usageRecord.findMany({
      where: { organizationId, periodKey },
      select: { unit: true, quantity: true },
    }),
    loadSubscriptionState(ctx.organizationId),
  ])

  const totals = aggregateUsage(
    records.map((r) => ({ unit: DB_TO_USAGE_UNIT[r.unit] ?? ('proposal' as UsageUnit), quantity: r.quantity }))
  )
  const plan = state.plan

  return {
    generatedAt: now.toISOString(),
    basis: {
      scope: 'period',
      periodKey,
      periodStart: bounds.start,
      periodEnd: bounds.end,
      plan,
      planLimits: planLimitsOf(plan),
      unitMapping: { ...USAGE_UNIT_TO_DB },
      currency: 'USD',
    },
    totals,
    totalUnits: USAGE_UNITS.reduce((sum, u) => sum + totals[u], 0),
    limits: evaluateLimits(plan, totals),
    gateway: gatewayReality(),
  }
}

// ═══════════════════════════════════════════════════════════════
// 订阅：读
// ═══════════════════════════════════════════════════════════════

export interface SubscriptionDto {
  generatedAt: string
  plan: EffectivePlan
  status: SubscriptionStatus
  /** 是否处于"订阅中"（`ACTIVE` / `PAST_DUE`）。 */
  live: boolean
  currency: string
  paidTotalCents: number
  refundedTotalCents: number
  netPaidCents: number
  startedAt: string | null
  canceledAt: string | null
  refundedAt: string | null
  lastEventAt: string | null
  eventCount: number
  lastPlanChangeDirection: BillingLedgerState['lastPlanChangeDirection']
  charges: ChargeSnapshot[]
  gateway: GatewayReality
}

/** 从 Prisma 行映射为内核可折叠的事件（**唯一**的映射点）。 */
function toEventLike(row: {
  id: string
  type: string
  plan: string | null
  chargeId: string | null
  amountCents: number | null
  currency: string
  gatewayStatus: string | null
  reason: string | null
  occurredAt: Date
  createdAt: Date
}): BillingEventLike {
  const plan = parseBillingPlan(row.plan)
  return {
    id: row.id,
    // 未知枚举值原样透传给内核 → 内核会以 400 拒绝（不静默忽略）。
    type: row.type as BillingEventLike['type'],
    plan,
    chargeId: row.chargeId,
    amountCents: row.amountCents,
    currency: row.currency,
    gatewayStatus: (row.gatewayStatus as BillingGatewayStatus | null) ?? null,
    reason: row.reason,
    occurredAt: row.occurredAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  }
}

const EVENT_SELECT = {
  id: true,
  type: true,
  plan: true,
  chargeId: true,
  amountCents: true,
  currency: true,
  gatewayStatus: true,
  reason: true,
  occurredAt: true,
  createdAt: true,
  requestHash: true,
} as const

async function loadEvents(organizationId: string): Promise<BillingEventLike[]> {
  const rows = await db.billingEvent.findMany({
    where: { organizationId },
    select: EVENT_SELECT,
    orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
  })
  return rows.map(toEventLike)
}

async function loadSubscriptionState(organizationId: string): Promise<BillingLedgerState> {
  const events = await loadEvents(organizationId)
  return reduceBillingEvents(events)
}

export async function getSubscription(
  ctx: TenantContext,
  now: Date = new Date()
): Promise<SubscriptionDto> {
  const state = await loadSubscriptionState(ctx.organizationId)
  return {
    generatedAt: now.toISOString(),
    plan: state.plan,
    status: state.status,
    live: state.status === 'ACTIVE' || state.status === 'PAST_DUE',
    currency: 'USD',
    paidTotalCents: state.paidTotalCents,
    refundedTotalCents: state.refundedTotalCents,
    netPaidCents: state.netPaidCents,
    startedAt: state.startedAt,
    canceledAt: state.canceledAt,
    refundedAt: state.refundedAt,
    lastEventAt: state.lastEventAt,
    eventCount: state.eventCount,
    lastPlanChangeDirection: state.lastPlanChangeDirection,
    charges: state.charges,
    gateway: gatewayReality(),
  }
}

// ═══════════════════════════════════════════════════════════════
// 订阅：写（事件追加）
// ═══════════════════════════════════════════════════════════════

export interface AppendBillingEventInput {
  type: BillingEventType
  plan?: string | null
  chargeId?: string | null
  amountCents?: number | null
  currency?: string | null
  reason?: string | null
  /** 账本幂等键（**必填** —— 不允许"没有幂等的账"）。 */
  dedupeKey: string
  /**
   * 请求体指纹（**建议必填**）。命中同一 `dedupeKey` 时：
   *   指纹相同（或双方都未提供）→ 回放；**不同 → 409**。
   * 少了它，把旧键复用于新意图会被**静默回放**成"成功"，见 schema 字段注释。
   */
  requestHash?: string | null
  occurredAt?: Date | null
  gatewayStatus?: BillingGatewayStatus | null
  providerRef?: string | null
  actorId?: string | null
}

export interface AppendBillingEventResult {
  /** 本次事件（重放时为首次那条）。 */
  event: BillingEventLike & { dedupeKey: string }
  /** true = 命中已有 dedupeKey，本次未新增。 */
  replayed: boolean
  state: BillingLedgerState
}

/**
 * 追加一条计费事件。
 *
 * 顺序（每一步都不能省）：
 *   1. **形状规范化**（来自请求体的字符串一律经 `parse*`，不直接信任）；
 *   2. **账本幂等**：同 `dedupeKey` 已存在 → 直接回放首次结果，**不再校验迁移**
 *      （那一条当初已经校验过；现在订阅状态变了不代表当初的决定是错的）；
 *   3. 🔴 **迁移校验**：`reduceBillingEvents(已有 + 候选)` —— 不通过则**不写**；
 *   4. 写入；并发撞唯一键 → 重读并回放。
 */
/**
 * 命中同一 `dedupeKey` 时判定"是不是同一个意图"。
 *
 * 三种情形（**取严方向是刻意的**）：
 *   · 双方都有指纹且相同 → 放行（回放）；
 *   · 双方都有指纹但不同 → **409**（旧键被复用于新意图）；
 *   · 原事件有指纹、本次没提供 → **409**（无法证明是同一意图）。
 *     ⚠️ 这一条看似苛刻，但反过来（"没提供就放行"）等于给了一条绕过指纹的路径：
 *        只要不带指纹，就能把任意新意图伪装成旧键的重放。宁可让脚本补一个指纹。
 *   · 双方都没有指纹 → 放行（兼容"没有请求体"的系统事件）。
 */
function assertSameIntent(
  storedHash: string | null | undefined,
  incomingHash: string | null,
  dedupeKey: string
): void {
  const stored = (storedHash ?? '').trim()
  const incoming = (incomingHash ?? '').trim()
  if (!stored && !incoming) return
  if (stored && !incoming) {
    throw new ConflictError(
      `dedupeKey ${dedupeKey} 已存在且带请求指纹，本次未提供指纹 —— 无法证明是同一意图`,
      { code: 'IDEMPOTENCY_FINGERPRINT_REQUIRED', dedupeKey }
    )
  }
  if (stored !== incoming) {
    throw new ConflictError(`dedupeKey ${dedupeKey} 已被用于另一个请求体`, {
      code: 'IDEMPOTENCY_KEY_REUSED',
      dedupeKey,
    })
  }
}

export async function appendBillingEvent(
  ctx: TenantContext,
  input: AppendBillingEventInput,
  now: Date = new Date()
): Promise<AppendBillingEventResult> {
  const organizationId = ctx.organizationId
  const dedupeKey = (input.dedupeKey || '').trim()
  if (!dedupeKey) {
    throw new ValidationError('dedupeKey 不能为空', { field: 'dedupeKey' })
  }

  const existing = await db.billingEvent.findFirst({ where: { organizationId, dedupeKey }, select: EVENT_SELECT })
  if (existing) {
    assertSameIntent(existing.requestHash, input.requestHash ?? null, dedupeKey)
    const state = await loadSubscriptionState(organizationId)
    return {
      event: { ...toEventLike(existing), dedupeKey },
      replayed: true,
      state,
    }
  }

  const occurredAt = input.occurredAt ?? now
  const candidate: BillingEventLike = {
    id: 'pending',
    type: input.type,
    plan: parseBillingPlan(input.plan),
    chargeId: input.chargeId ?? null,
    amountCents: typeof input.amountCents === 'number' ? input.amountCents : null,
    currency: (input.currency || 'USD').toUpperCase(),
    gatewayStatus: input.gatewayStatus ?? null,
    reason: input.reason ?? null,
    occurredAt: occurredAt.toISOString(),
    // 🔴 `createdAt` 取**我们即将写进库的那个值**，不用 DB 的 `now()` 默认值。
    // 否则"校验时看到的事件顺序"与"落库后的顺序"会不一致：
    // 候选事件的 createdAt 是本次调用时间，而刚插入的那一行 createdAt 是 DB 时间（更晚），
    // 于是候选会被排到已存在事件**之前** —— 表现为"款项不存在"这类莫名其妙的报错。
    // 显式落 `createdAt` 后，两者逐字一致（见 `create` 的数据）。
    createdAt: now.toISOString(),
  }

  // ── 校验：把候选事件与已有事件一起折叠。抛错 ⇒ 不写。 ──
  const events = await loadEvents(organizationId)
  reduceBillingEvents([...events, candidate])

  try {
    const created = await db.billingEvent.create({
      data: {
        organizationId,
        type: input.type,
        plan: candidate.plan,
        chargeId: candidate.chargeId,
        amountCents: candidate.amountCents,
        // ⚠️ `BillingEventLike.currency` 是 `string | null`（内核允许缺币种），
        // 而 Prisma 的 `currency` 是**非空**（schema 里有 `@default("USD")`）。
        // 候选事件构造时已归一成大写且**总有值**，这里的 `?? 'USD'` 纯粹是把类型收窄回
        // `string` —— 缺了它 tsc 报 TS2322（`null` 不可赋给 `string`），而 ts-jest 只转译
        // 不做全量类型检查，**单测全绿也照样漏掉**（T08 Slice 3 的真实踩坑）。
        currency: candidate.currency ?? 'USD',
        gatewayStatus: candidate.gatewayStatus,
        providerRef: input.providerRef ?? null,
        reason: candidate.reason,
        actorId: input.actorId ?? null,
        dedupeKey,
        requestHash: input.requestHash ?? null,
        occurredAt,
        // 显式落 createdAt（不用 DB 默认值），理由见上面候选事件处的注释与 schema 说明。
        createdAt: now,
      },
      select: EVENT_SELECT,
    })
    const event = toEventLike(created)
    return { event: { ...event, dedupeKey }, replayed: false, state: await loadSubscriptionState(organizationId) }
  } catch (err) {
    // 并发：另一个请求刚写了同一 dedupeKey。重读并回放（不是错误）——
    // 但仍要比对指纹：并发写入的两个请求若意图不同，那是真正的冲突。
    const winner = await db.billingEvent.findFirst({
      where: { organizationId, dedupeKey },
      select: EVENT_SELECT,
    })
    if (winner) {
      assertSameIntent(winner.requestHash, input.requestHash ?? null, dedupeKey)
      return {
        event: { ...toEventLike(winner), dedupeKey },
        replayed: true,
        state: await loadSubscriptionState(organizationId),
      }
    }
    throw err
  }
}

// ═══════════════════════════════════════════════════════════════
// 组合动作：发起一次扣款（走沙箱适配器）
// ═══════════════════════════════════════════════════════════════

export interface StartChargeInput {
  amountCents: number
  description: string
  currency?: string
  /** 账本幂等键前缀（同一次扣款重试应传同一个）。 */
  dedupeKey: string
  actorId?: string | null
}

export interface StartChargeResult {
  chargeId: string
  gatewayStatus: BillingGatewayStatus
  providerRef: string
  /** 「本来会发出去的请求」的快照（沙箱下的**唯一**可证物）。 */
  requestSnapshot: Record<string, unknown>
  events: AppendBillingEventResult[]
  state: BillingLedgerState
}

/**
 * 发起一次扣款：先 `CHARGE_CREATED`，拿到网关结果后再 `CHARGE_SUCCEEDED` / `CHARGE_FAILED`。
 *
 * 🔴 **两个正交的轴**，别混为一谈：
 *   · `charge.status`（账本语义）—— 我们这边是否认为这笔账已结清；
 *   · `gatewayStatus`（网关现实）—— 沙箱下恒为 `CAPTURED`，**永不**为 `SUCCEEDED`。
 *   沙箱态下账本会走完 `PENDING → SUCCEEDED`（否则状态机没法端到端演示），
 *   但每一处都带着 `gatewayStatus = CAPTURED`，且响应里 `gateway.mode = 'sandbox'`
 *   —— 任何读者都无法把它误读成"收到钱了"。
 */
export async function startCharge(
  ctx: TenantContext,
  input: StartChargeInput,
  deps: CreemChargeDeps = {},
  now: Date = new Date()
): Promise<StartChargeResult> {
  const creds = resolveCreemCredentials(deps.env ?? process.env)
  if (creds && !deps.transport) {
    // 有凭据却没有真实接入 → 明确 501（绝不静默沙箱，见 creem.ts 文件头）。
    throw new BillingGatewayNotImplementedError(
      '检测到 Creem 凭据，但真实网关接入点尚未实现：拒绝以沙箱代替真实扣款'
    )
  }

  const chargeId = `ch_${input.dedupeKey.replace(/[^A-Za-z0-9_-]/g, '_')}`

  // 🔴 两个事件必须**严格递增**的时间戳。
  // `reduceBillingEvents` 按 `(occurredAt, createdAt, id)` 定序；两个事件若落在同一毫秒，
  // 顺序就退到 `id` 上，而 cuid 不保证与插入顺序一致 → `CHARGE_SUCCEEDED` 可能被排到
  // `CHARGE_CREATED` 之前 → 内核（正确地）报"款项不存在"。
  // 与其给内核加一条"同刻时 CREATED 优先"的特例（那会让定序规则变成两套），
  // 不如让时间戳如实递增。
  const tCreated = now
  const tSettled = new Date(Math.max(Date.now(), tCreated.getTime() + 1))

  // 本次扣款的"意图指纹"：金额/币种/描述任一变化都算**另一个意图**，
  // 复用同一 dedupeKey 会被 409 而不是静默回放。
  const requestHash = fingerprintRequest({
    amountCents: input.amountCents,
    currency: (input.currency ?? 'USD').toUpperCase(),
    description: input.description,
  })

  // 先落 CREATED（金额已知）；后续事件依赖它存在（内核会拒绝"凭空成功"）。
  const created = await appendBillingEvent(
    ctx,
    {
      type: 'CHARGE_CREATED',
      chargeId,
      amountCents: input.amountCents,
      currency: input.currency ?? 'USD',
      dedupeKey: `charge-created:${input.dedupeKey}`,
      requestHash,
      actorId: input.actorId ?? null,
    },
    tCreated
  )

  const charge = await createCreemCharge(
    {
      organizationId: ctx.organizationId,
      chargeId,
      amountCents: input.amountCents,
      currency: input.currency ?? 'USD',
      description: input.description,
    },
    deps
  )

  const settled = await appendBillingEvent(
    ctx,
    charge.gatewayStatus === 'FAILED'
      ? {
          type: 'CHARGE_FAILED',
          chargeId,
          reason: charge.reason ?? 'gateway_failed',
          gatewayStatus: 'FAILED',
          providerRef: charge.providerRef,
          dedupeKey: `charge-failed:${input.dedupeKey}`,
          requestHash,
          actorId: input.actorId ?? null,
        }
      : {
          type: 'CHARGE_SUCCEEDED',
          chargeId,
          amountCents: input.amountCents,
          currency: input.currency ?? 'USD',
          // CAPTURED 原样带下去 —— 这是"沙箱未扣款"在账本里的唯一痕迹。
          gatewayStatus: charge.gatewayStatus,
          providerRef: charge.providerRef,
          dedupeKey: `charge-succeeded:${input.dedupeKey}`,
          requestHash,
          actorId: input.actorId ?? null,
        },
    tSettled
  )

  return {
    chargeId,
    gatewayStatus: charge.gatewayStatus,
    providerRef: charge.providerRef,
    requestSnapshot: charge.requestSnapshot,
    events: [created, settled],
    state: settled.state,
  }
}

/** 便捷：本租户的派生订阅状态（供内部调用方与测试用）。 */
export async function getSubscriptionState(ctx: TenantContext): Promise<BillingLedgerState> {
  return loadSubscriptionState(ctx.organizationId)
}

/** 类型再导出（服务层出口）。 */
export type { EffectivePlan, PlanLimits, BillingPlan }
