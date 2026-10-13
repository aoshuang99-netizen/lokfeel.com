/**
 * T08 · 订阅与账单状态机 —— **纯函数内核**（零 IO、零 Prisma 依赖）
 *
 * 对齐 **AC-21**：「退款 / 失败 / 升级 / 降级**状态一致**」。
 *
 * ═══════════════════════════════════════════════════════════════
 * 为什么是"事件溯源 + 纯派生"，而不是一个 `status` 列
 * ═══════════════════════════════════════════════════════════════
 * 一个 `status` 列意味着**第二个事实来源**。它迟早会与事件集不一致，而**不一致的那一刻
 * 没有任何东西会报错** —— 报表照常输出，只是数字悄悄错了。这正是 AC-21 要防的。
 * 改为「事件是唯一真相，状态读时派生」之后，"当前是什么状态"这个问题只有一个答案，
 * 而且它可以被**穷举测试**（本文件的测试把每一条合法/非法迁移都钉住）。
 *
 * ═══════════════════════════════════════════════════════════════
 * 🔴 非法迁移必须在**写入前**被拒
 * ═══════════════════════════════════════════════════════════════
 * AC-21 点名的例子是 `REFUNDED → SUCCEEDED` **必须失败**。这里有两层同名规则：
 *   ① 款项层：一笔款项一旦 `SUCCEEDED` 后退款成 `REFUNDED`，就是**终态** ——
 *      再对它发 `CHARGE_SUCCEEDED` 会被拒（因为 `CHARGE_SUCCEEDED` 只接受 `PENDING`）。
 *   ② 订阅层：订阅退到 `REFUNDED` 后，除"重新 `SUBSCRIPTION_STARTED`"外一律拒绝。
 * 只做一层是不够的：只做②会漏掉"同一笔款项被重复标记成功"，
 * 只做①会漏掉"退订之后又收到一笔成功款"。
 *
 * ⚠️ 判据（本文件）与执行点（服务层）共用同一函数 —— 服务层写入前先 `reduceBillingEvents`
 *    一次，不通过就**不写**。绝不"先写库再校验"：那会让非法事件永久留在账本里。
 *
 * ═══════════════════════════════════════════════════════════════
 * 排序：为什么必须显式定序
 * ═══════════════════════════════════════════════════════════════
 * 事件集是**多重集**，折叠结果依赖顺序。同一毫秒写入的两条事件（真实存在：服务层一次
 * 事务里写两条）若顺序不定，"派生状态"就会在不同调用间抖动 —— 一个会抖的状态机
 * 无法被断言。故此处按 `(occurredAt, createdAt, id)` **字典序**定序：id 是最终裁决者，
 * 保证全序且稳定。
 */

import {
  type BillingEventType as PrismaBillingEventType,
  type BillingGatewayStatus as PrismaBillingGatewayStatus,
} from '@/generated'
import { ConflictError, ValidationError } from '@/lib/errors'
import {
  type BillingPlan,
  type EffectivePlan,
  type PlanChangeDirection,
  classifyPlanChange,
  parseBillingPlan,
} from './plans'

// ═══════════════════════════════════════════════════════════════
// 类型（与 prisma/schema/billing.prisma 的枚举逐字一致）
// ═══════════════════════════════════════════════════════════════

export type BillingEventType = PrismaBillingEventType
export type BillingGatewayStatus = PrismaBillingGatewayStatus

export const BILLING_EVENT_TYPES: readonly BillingEventType[] = [
  'SUBSCRIPTION_STARTED',
  'PLAN_CHANGED',
  'SUBSCRIPTION_CANCELED',
  'CHARGE_CREATED',
  'CHARGE_SUCCEEDED',
  'CHARGE_FAILED',
  'CHARGE_REFUNDED',
] as const

/** 订阅状态（**派生**，不落库）。 */
export type SubscriptionStatus = 'NONE' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'REFUNDED'

export const SUBSCRIPTION_STATUSES: readonly SubscriptionStatus[] = [
  'NONE',
  'ACTIVE',
  'PAST_DUE',
  'CANCELED',
  'REFUNDED',
] as const

/** 单笔款项状态（**派生**，不落库）。 */
export type ChargeStatus = 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'REFUNDED'

/** `CHARGE_SUCCEEDED` 只接受 `PENDING` —— 这就是"终态不可复活"的落点。 */
const CHARGE_TRANSITIONS: Record<ChargeStatus, readonly ChargeStatus[]> = {
  PENDING: ['SUCCEEDED', 'FAILED'],
  SUCCEEDED: ['REFUNDED'],
  FAILED: [], // 失败不可"改判"成功：要重试就**新建一笔**款项（否则同一 chargeId 会被重复入账）
  REFUNDED: [], // 🔴 终态：AC-21 点名的 `REFUNDED → SUCCEEDED` 走这里被拒
}

/** 订阅层允许的前置状态。 */
const SUBSCRIPTION_ALLOWED_FROM: Record<BillingEventType, readonly SubscriptionStatus[]> = {
  // 首次开通，或退订/退款后**重新开通**。已 ACTIVE/PAST_DUE 走 PLAN_CHANGED。
  SUBSCRIPTION_STARTED: ['NONE', 'CANCELED', 'REFUNDED'],
  PLAN_CHANGED: ['ACTIVE', 'PAST_DUE'],
  SUBSCRIPTION_CANCELED: ['ACTIVE', 'PAST_DUE'],
  // 未订阅 / 已退订 / 已退款 → 不该再产生新款项。
  CHARGE_CREATED: ['ACTIVE', 'PAST_DUE'],
  CHARGE_SUCCEEDED: ['ACTIVE', 'PAST_DUE'],
  CHARGE_FAILED: ['ACTIVE', 'PAST_DUE'],
  // 退款不改变"有没有订阅"以外的任何东西；但只允许在**已订阅过**的前提下退款，
  // 否则会出现"从没付过钱却有一条退款"的账。
  CHARGE_REFUNDED: ['ACTIVE', 'PAST_DUE'],
}

/** 需要 `plan` 字段的事件。 */
const REQUIRES_PLAN: readonly BillingEventType[] = ['SUBSCRIPTION_STARTED', 'PLAN_CHANGED']
/** 需要 `chargeId` 的事件。 */
const REQUIRES_CHARGE: readonly BillingEventType[] = [
  'CHARGE_CREATED',
  'CHARGE_SUCCEEDED',
  'CHARGE_FAILED',
  'CHARGE_REFUNDED',
]
/** 需要 `reason` 的事件（失败原因是要给人看的）。 */
const REQUIRES_REASON: readonly BillingEventType[] = ['CHARGE_FAILED']

/** 折叠所需的最小事件形状（服务层从 Prisma 行映射而来）。 */
export interface BillingEventLike {
  id: string
  type: BillingEventType
  plan: BillingPlan | null
  chargeId: string | null
  amountCents: number | null
  currency: string | null
  gatewayStatus: BillingGatewayStatus | null
  reason: string | null
  /** ISO 8601（服务层统一 `toISOString()`，避免多格式混排）。 */
  occurredAt: string
  createdAt: string
}

export interface ChargeSnapshot {
  chargeId: string
  status: ChargeStatus
  amountCents: number
  currency: string
  /** 最近一次与该款项相关事件上的网关状态快照。 */
  gatewayStatus: BillingGatewayStatus | null
  createdAt: string
  settledAt: string | null
}

export interface BillingLedgerState {
  /** 有效方案。无任何订阅事件时为 `FREE`。 */
  plan: EffectivePlan
  status: SubscriptionStatus
  /** 已成功收款总额（分）。 */
  paidTotalCents: number
  /** 已退款总额（分）。 */
  refundedTotalCents: number
  /** 净额 = 已收 − 已退（分）。 */
  netPaidCents: number
  startedAt: string | null
  canceledAt: string | null
  refundedAt: string | null
  lastEventAt: string | null
  eventCount: number
  /** 款项快照，按 `(occurredAt, createdAt, id)` 升序。 */
  charges: ChargeSnapshot[]
  /** 最近一次方案变更的方向（无变更 → null）。 */
  lastPlanChangeDirection: PlanChangeDirection | null
}

// ═══════════════════════════════════════════════════════════════
// 校验
// ═══════════════════════════════════════════════════════════════

function shapeError(message: string, detail: Record<string, unknown>): never {
  throw new ValidationError(message, { code: 'INVALID_BILLING_EVENT', ...detail })
}

function transitionError(
  message: string,
  detail: Record<string, unknown>
): never {
  throw new ConflictError(message, { code: 'ILLEGAL_TRANSITION', ...detail })
}

function assertEventShape(event: BillingEventLike): void {
  if (!BILLING_EVENT_TYPES.includes(event.type)) {
    shapeError(`未知计费事件类型：${String(event.type)}`, { eventType: event.type })
  }
  if (REQUIRES_PLAN.includes(event.type) && parseBillingPlan(event.plan) === null) {
    shapeError(`${event.type} 需要合法的 plan（STARTER / GROWTH / SCALE）`, {
      eventType: event.type,
      plan: event.plan,
    })
  }
  if (REQUIRES_CHARGE.includes(event.type)) {
    const cid = typeof event.chargeId === 'string' ? event.chargeId.trim() : ''
    if (!cid) shapeError(`${event.type} 需要 chargeId`, { eventType: event.type })
  }
  if (REQUIRES_REASON.includes(event.type)) {
    const r = typeof event.reason === 'string' ? event.reason.trim() : ''
    if (!r) shapeError(`${event.type} 需要 reason（失败原因要留痕）`, { eventType: event.type })
  }
  if (event.type === 'CHARGE_CREATED') {
    if (event.amountCents === null || !Number.isFinite(event.amountCents) || event.amountCents < 0) {
      shapeError('CHARGE_CREATED 需要非负的 amountCents（整数分）', { eventType: event.type })
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// 定序
// ═══════════════════════════════════════════════════════════════

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** 全序：`(occurredAt, createdAt, id)`。id 兜底，保证结果稳定（见文件头）。 */
export function compareBillingEvents(a: BillingEventLike, b: BillingEventLike): number {
  return cmp(a.occurredAt, b.occurredAt) || cmp(a.createdAt, b.createdAt) || cmp(a.id, b.id)
}

// ═══════════════════════════════════════════════════════════════
// 折叠
// ═══════════════════════════════════════════════════════════════

export function initialBillingState(): BillingLedgerState {
  return {
    plan: 'FREE',
    status: 'NONE',
    paidTotalCents: 0,
    refundedTotalCents: 0,
    netPaidCents: 0,
    startedAt: null,
    canceledAt: null,
    refundedAt: null,
    lastEventAt: null,
    eventCount: 0,
    charges: [],
    lastPlanChangeDirection: null,
  }
}

interface Acc {
  state: BillingLedgerState
  charges: Map<string, ChargeSnapshot>
}

function applyEvent(acc: Acc, event: BillingEventLike): void {
  const { state } = acc
  const at = event.occurredAt

  // ── 订阅层前置校验 ──
  const allowed = SUBSCRIPTION_ALLOWED_FROM[event.type]
  if (!allowed.includes(state.status)) {
    transitionError(
      `非法迁移：订阅处于 ${state.status} 时不允许 ${event.type}`,
      {
        eventType: event.type,
        from: state.status,
        allowedFrom: [...allowed],
        // 带上款项 id：`CHARGE_*` 被订阅层拦下时，运营仍需要知道"是哪一笔"。
        // 少了它，排障只剩"订阅状态不对"这一句，够不着具体款项。
        ...(event.chargeId ? { chargeId: event.chargeId } : {}),
      }
    )
  }

  switch (event.type) {
    case 'SUBSCRIPTION_STARTED': {
      const plan = parseBillingPlan(event.plan) as BillingPlan
      // 🔴 开通**不算**升降级：`lastPlanChangeDirection` 保持 null。
      // 若把 FREE → STARTER 记成 UPGRADE，"升降级"这条事实就有了两个来源
      // （一次开通被读成一次升级），而界面会用这个字段讲"你最近升级了"。
      state.plan = plan
      state.status = 'ACTIVE'
      state.startedAt = at
      // 重新开通会**保留**历史收款与退款总额（账是历史，不该被清零），
      // 但清掉上一次的终态时间戳 —— 当前这轮订阅没有"取消/退款"这件事。
      state.canceledAt = null
      state.refundedAt = null
      break
    }

    case 'PLAN_CHANGED': {
      const plan = parseBillingPlan(event.plan) as BillingPlan
      state.lastPlanChangeDirection = classifyPlanChange(state.plan, plan)
      state.plan = plan
      // 方案变更**不动** status：PAST_DUE 的租户可以降级以自救，不该因此被"洗白"成 ACTIVE。
      break
    }

    case 'SUBSCRIPTION_CANCELED': {
      state.status = 'CANCELED'
      state.canceledAt = at
      break
    }

    case 'CHARGE_CREATED': {
      const chargeId = event.chargeId as string
      if (acc.charges.has(chargeId)) {
        // 同一 chargeId 重新 CREATED → 幂等键本应拦住；走到这里说明调用方绕过了账本幂等。
        transitionError(`款项 ${chargeId} 已存在，不能重复创建`, {
          eventType: event.type,
          chargeId,
        })
      }
      acc.charges.set(chargeId, {
        chargeId,
        status: 'PENDING',
        amountCents: event.amountCents ?? 0,
        currency: event.currency ?? 'USD',
        gatewayStatus: event.gatewayStatus,
        createdAt: at,
        settledAt: null,
      })
      break
    }

    case 'CHARGE_SUCCEEDED':
    case 'CHARGE_FAILED':
    case 'CHARGE_REFUNDED': {
      const chargeId = event.chargeId as string
      const charge = acc.charges.get(chargeId)
      if (!charge) {
        // 款项不存在 → 拒绝。允许"凭一条成功事件凭空造出一笔款"会让账本变得不可审计。
        transitionError(`款项 ${chargeId} 不存在 —— 没有对应的 CHARGE_CREATED`, {
          eventType: event.type,
          chargeId,
        })
      }

      const target: ChargeStatus =
        event.type === 'CHARGE_SUCCEEDED'
          ? 'SUCCEEDED'
          : event.type === 'CHARGE_FAILED'
            ? 'FAILED'
            : 'REFUNDED'

      if (!CHARGE_TRANSITIONS[charge.status].includes(target)) {
        transitionError(
          `非法款项迁移：${chargeId} 处于 ${charge.status} 时不允许变为 ${target}`,
          {
            eventType: event.type,
            chargeId,
            from: charge.status,
            to: target,
            allowedTo: [...CHARGE_TRANSITIONS[charge.status]],
          }
        )
      }

      if (target === 'REFUNDED' && event.amountCents !== null) {
        // 目前只支持**全额退款**：部分退款会让"已退金额"与款项金额脱钩，
        // 那需要一张退款明细表，不在本切片范围内 —— 与其模糊处理，不如明确拒绝。
        if (event.amountCents !== charge.amountCents) {
          shapeError(
            `当前只支持全额退款：款项 ${chargeId} 金额 ${charge.amountCents} 分，收到 ${event.amountCents} 分`,
            { eventType: event.type, chargeId, expected: charge.amountCents, got: event.amountCents }
          )
        }
      }

      charge.status = target
      charge.gatewayStatus = event.gatewayStatus ?? charge.gatewayStatus
      charge.settledAt = at

      if (target === 'SUCCEEDED') {
        state.paidTotalCents += charge.amountCents
        state.status = 'ACTIVE' // PAST_DUE 的补款成功 → 恢复
      } else if (target === 'FAILED') {
        state.status = 'PAST_DUE'
      } else {
        state.refundedTotalCents += charge.amountCents
        state.status = 'REFUNDED'
        state.refundedAt = at
      }
      break
    }
  }

  state.netPaidCents = state.paidTotalCents - state.refundedTotalCents
  state.lastEventAt = at
  state.eventCount += 1
}

/**
 * 由事件集派生账本状态。**纯函数**：同输入必同输出。
 *
 * @throws ValidationError(400) 事件形状不合法（缺 plan / chargeId / reason、金额为负…）
 * @throws ConflictError(409)   **非法迁移**（AC-21 的核心判据）
 */
export function reduceBillingEvents(events: readonly BillingEventLike[]): BillingLedgerState {
  const sorted = [...events].sort(compareBillingEvents)
  const acc: Acc = { state: initialBillingState(), charges: new Map() }
  for (const event of sorted) {
    assertEventShape(event)
    applyEvent(acc, event)
  }
  acc.state.charges = [...acc.charges.values()].sort((a, b) =>
    cmp(a.createdAt, b.createdAt) || cmp(a.chargeId, b.chargeId)
  )
  return acc.state
}

/** 最近一笔款项（按创建时间）。 */
export function latestChargeOf(state: BillingLedgerState): ChargeSnapshot | null {
  if (state.charges.length === 0) return null
  return state.charges[state.charges.length - 1]
}

/** 是否存在未结清（PENDING）的款项 —— 用于界面提示"正在处理中"。 */
export function hasPendingCharge(state: BillingLedgerState): boolean {
  return state.charges.some((c) => c.status === 'PENDING')
}

/**
 * "订阅是否可用于限额判定"。`PAST_DUE` **仍然算订阅中**（宽限期语义）——
 * 欠费立刻断服务会把一次银行拒付放大成业务停摆；是否切断由产品决定，不由这里偷偷决定。
 */
export function isSubscriptionLive(status: SubscriptionStatus): boolean {
  return status === 'ACTIVE' || status === 'PAST_DUE'
}
