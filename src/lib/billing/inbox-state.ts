/**
 * V25.5 P0.1 · R-15 Durable Inbox —— 最终结算状态机（**纯内核，无 IO**）
 * ═══════════════════════════════════════════════════════════════════════
 *
 * 解决的真实缺口
 * --------------
 * 原 webhook 在 `payment.failed → payment.succeeded`（同一 payment_id）时返回
 * `200 + deferred + ledger_rejected`：它只证明了"拒绝非法改判"，**没有证明资金
 * 与权益最终结算**。用户可以真的付了钱，却因为账本内核把 FAILED 设为终态
 * （`CHARGE_TRANSITIONS.FAILED = []`）而永远拿不到权益 —— 静默吞单。
 *
 * 本内核把"拒绝"变成**有终态、可恢复、可告警**的状态机：
 *
 *   RECEIVED ──┬─→ APPLIED                        （账本命令成功落库）
 *              ├─→ SETTLED                        （冲突经 Provider 确认后补偿结算）
 *              ├─→ NEEDS_PROVIDER_RECONCILIATION   （需查 Provider 权威状态）
 *              ├─→ RETRYABLE                      （瞬时故障，可重试）
 *              ├─→ REQUIRES_REVIEW                （持久人工复核，绝不误发权益）
 *              └─→ DEAD_LETTER                    （确定性永久失败）
 *
 * 三条不可妥协的纪律
 * ------------------
 *  1. **签名/验签通过的事件必须先持久化再 ACK**（本内核只做判决，持久化在
 *     inbox-store.ts；webhook 路由把"持久化成功"与 2xx 绑定）。
 *  2. **冲突绝不静默**：任何无法自动结算的冲突都落到 `REQUIRES_REVIEW` 或
 *     持久 `NEEDS_PROVIDER_RECONCILIATION`，而不是 `ignored` / `deferred` 后消失。
 *  3. **Provider 未确认前不得授予或移除权益**：只有 `providerTruth.paid === true`
 *     才允许补偿结算；`unknown` / `unavailable` 一律进人工复核队列。
 *
 * 为什么"失败后成功"用**派生新 chargeId** 结算
 * ---------------------------------------------
 * 账本内核刻意规定 FAILED 是终态（`FAILED: []`），这是对的：同一 chargeId
 * 若能从 FAILED 复活成 SUCCEEDED，重投就会重复入账。因此真正的钱到了之后，
 * 正确做法不是"改判旧款项"，而是**新建一笔款项**（`${paymentId}:recovered:${eventId}`）
 * 来承接这笔真实收款，与旧失败款项并存、互不覆盖。这样：
 *   · 账本历史真实反映"先失败一次、后成功一次"；
 *   · paidTotalCents 只增加一次（补偿 charges 用新 id，dedupeKey 幂等）；
 *   · 权益按成功款项授予，符合资金事实。
 *
 * 所有函数是纯函数：同输入必同输出，可对历史事件回放、可穷举负例。
 */

import type { BillingEventType } from './subscription'

// ═══════════════════════════════════════════════════════════════
// 类型
// ═══════════════════════════════════════════════════════════════

/** Inbox 事件的持久状态。 */
export const INBOX_STATUSES = [
  'RECEIVED',
  'APPLIED',
  'SETTLED',
  'NEEDS_PROVIDER_RECONCILIATION',
  'RETRYABLE',
  'REQUIRES_REVIEW',
  'DEAD_LETTER',
] as const
export type InboxStatus = (typeof INBOX_STATUSES)[number]

/** 终态：不会再被自动处理器拾取（REQUIRES_REVIEW 需人工介入后才可推进）。 */
export const TERMINAL_INBOX_STATUSES: readonly InboxStatus[] = [
  'APPLIED',
  'SETTLED',
  'DEAD_LETTER',
]

/** Provider 权威状态查询的抽象结果。无凭据/未测试时如实报 unavailable。 */
export interface PaymentTruth {
  /** payment_id 在 Provider 侧的权威收款状态。 */
  status: 'paid' | 'unpaid' | 'unknown'
  /** 是否真的查过 Provider（false = 无凭据/未授权/未测试）。 */
  verified: boolean
  /** Provider 侧的金额（分），用于金额一致性核对；未知为 null。 */
  amountCents: number | null
  /** Provider 侧币种；未知为 null。 */
  currency: string | null
  /** 说明（only reason，不含敏感原文）。 */
  reason?: string
}

/** 无凭据时的标准 truth —— 禁止据此授予权益。 */
export const PROVIDER_UNAVAILABLE: PaymentTruth = {
  status: 'unknown',
  verified: false,
  amountCents: null,
  currency: null,
  reason: 'PROVIDER_NOT_TESTED: 无授权凭据，未查询权威状态',
}

/** 还原自账本的最小 charge 状态（由 store 层从 reduceBillingEvents 投影）。 */
export interface ChargeFacts {
  chargeId: string
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'REFUNDED'
  amountCents: number
  currency: string
}

export interface LedgerFacts {
  organizationId: string
  status: 'NONE' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'REFUNDED'
  charges: ChargeFacts[]
}

/** 一条规范化后的 inbox 事件（原文最小化为字段，不存敏感 payload）。 */
export interface InboxEvent {
  /** Provider 的 delivery id（Standard Webhooks `webhook-id`），首要幂等键。 */
  deliveryId: string
  /** Provider 的 event id（可能与 deliveryId 不同），次幂等键。 */
  eventId: string
  /** 事件类型，如 payment.succeeded。 */
  type: string
  organizationId: string
  paymentId: string | null
  subscriptionId: string | null
  amountCents: number | null
  currency: string | null
  /** 规范化 payload 的 sha256（审计用，不存原文）。 */
  payloadHash: string
  /** 收到时间（ISO）。 */
  receivedAt: string
}

/** 判决产生的账本写入命令（交给 store 层真正落库）。 */
export interface SettlementCommand {
  type: BillingEventType
  chargeId: string
  amountCents: number
  currency: string
  plan: string
  /** 用于账本 dedupeKey，保证补偿结算幂等。 */
  dedupeKey: string
  /** 是否为"失败后成功"的补偿款项（新 chargeId）。 */
  recovery: boolean
}

export type Decision =
  | {
      kind: 'apply'
      status: 'APPLIED'
      commands: SettlementCommand[]
      note: string
    }
  | {
      kind: 'settle'
      status: 'SETTLED'
      commands: SettlementCommand[]
      note: string
    }
  | {
      kind: 'reconcile'
      status: 'NEEDS_PROVIDER_RECONCILIATION'
      commands: []
      note: string
    }
  | {
      kind: 'retry'
      status: 'RETRYABLE'
      commands: []
      note: string
    }
  | {
      kind: 'review'
      status: 'REQUIRES_REVIEW'
      commands: []
      note: string
    }
  | {
      kind: 'dead'
      status: 'DEAD_LETTER'
      commands: []
      note: string
    }

export interface DecideInput {
  event: InboxEvent
  ledger: LedgerFacts
  providerTruth: PaymentTruth
  /** 该 delivery 此前是否已被处理过（幂等回放）。 */
  alreadyApplied: boolean
  /** 期望的收款方案（由 metadata/product 解析，未提供则不能结算）。 */
  plan: string | null
}

// ═══════════════════════════════════════════════════════════════
// 主判决
// ═══════════════════════════════════════════════════════════════

function chargeOf(ledger: LedgerFacts, chargeId: string): ChargeFacts | null {
  return ledger.charges.find((c) => c.chargeId === chargeId) ?? null
}

/** 金额/币种是否与账本已有款项一致。 */
function amountsMatch(charge: ChargeFacts, event: InboxEvent): boolean {
  if (event.amountCents !== null && event.amountCents !== charge.amountCents) return false
  if (event.currency !== null && event.currency.toUpperCase() !== charge.currency.toUpperCase()) return false
  return true
}

/**
 * 对一条验签事件做最终结算判决。纯函数。
 *
 * 核心分支：
 *   · 已处理过（alreadyApplied） → 幂等回放，不再产生命令；
 *   · payment.succeeded：
 *       - 无对应款项 / 款项 PENDING → 正常 APPLIED（CHARGE_CREATED + CHARGE_SUCCEEDED 由
 *         事件翻译层负责，这里只补"冲突"场景的命令；见 note）；
 *       - 款项已 SUCCEEDED → 幂等，APPLIED 无新命令；
 *       - 款项 FAILED（R-15 冲突）→
 *           · Provider 确认 paid + 金额一致 + 有 plan → 派生新 chargeId 补偿结算 → SETTLED；
 *           · Provider 确认 unpaid → DEAD_LETTER（钱没到，不授予权益）；
 *           · Provider unknown/unavailable → NEEDS_PROVIDER_RECONCILIATION / REQUIRES_REVIEW；
 *       - 款项 REFUNDED → REQUIRES_REVIEW（已退款却收到成功，需人工判断）。
 *   · payment.failed：
 *       - 款项 SUCCEEDED 却收到 failed（成功→失败冲突）→ 需 Provider 核验，
 *         paid 则 DEAD_LETTER（不得撤销已确认权益），unpaid 则 APPLIED；
 *       - 其余 → APPLIED / REQUIRES_REVIEW。
 *   · 其他事件 → 交给调用方常规处理（APPLIED，无命令）。
 */
export function decideSettlement(input: DecideInput): Decision {
  const { event, ledger, providerTruth, alreadyApplied, plan } = input

  // ── 幂等回放：同一 delivery 已处理 → 不再产生任何命令 ────────
  if (alreadyApplied) {
    return {
      kind: 'apply',
      status: 'APPLIED',
      commands: [],
      note: `IDEMPOTENT_REPLAY delivery=${event.deliveryId}`,
    }
  }

  const isSucceeded = event.type === 'payment.succeeded'
  const isFailed = event.type === 'payment.failed' || event.type === 'subscription.past_due' || event.type === 'subscription.on_hold'
  if (!isSucceeded && !isFailed) {
    return {
      kind: 'apply',
      status: 'APPLIED',
      commands: [],
      note: `NON_MONEY_EVENT type=${event.type}`,
    }
  }

  if (!event.paymentId) {
    return {
      kind: 'dead',
      status: 'DEAD_LETTER',
      commands: [],
      note: 'MONEY_EVENT_WITHOUT_PAYMENT_ID',
    }
  }

  const charge = chargeOf(ledger, event.paymentId)

  // ── 成功事件 ──────────────────────────────────────────────────
  if (isSucceeded) {
    // 没有该款项：常规首单，翻译层会生成开通+建款+收款。本内核不重复产生命令。
    if (!charge || charge.status === 'PENDING') {
      return {
        kind: 'apply',
        status: 'APPLIED',
        commands: [],
        note: charge ? 'PENDING_NORMAL_SETTLEMENT' : 'NEW_CHARGE_NORMAL_SETTLEMENT',
      }
    }
    if (charge.status === 'SUCCEEDED') {
      return {
        kind: 'apply',
        status: 'APPLIED',
        commands: [],
        note: 'ALREADY_SETTLED_IDEMPOTENT',
      }
    }
    if (charge.status === 'REFUNDED') {
      return {
        kind: 'review',
        status: 'REQUIRES_REVIEW',
        commands: [],
        note: `SUCCESS_AFTER_REFUND payment=${event.paymentId}`,
      }
    }
    // ── R-15：FAILED 后收到 succeeded ───────────────────────────
    if (charge.status === 'FAILED') {
      // 金额/币种必须一致，否则可能是伪造/串单
      if (!amountsMatch(charge, event)) {
        return {
          kind: 'review',
          status: 'REQUIRES_REVIEW',
          commands: [],
          note: `AMOUNT_CURRENCY_MISMATCH payment=${event.paymentId}`,
        }
      }
      if (!plan) {
        return {
          kind: 'review',
          status: 'REQUIRES_REVIEW',
          commands: [],
          note: `NO_PLAN_FOR_SETTLEMENT payment=${event.paymentId}`,
        }
      }
      // Provider 未核实 → 可恢复的核验态，绝不擅自授予权益
      if (!providerTruth.verified || providerTruth.status === 'unknown') {
        return {
          kind: 'reconcile',
          status: 'NEEDS_PROVIDER_RECONCILIATION',
          commands: [],
          note: `PROVIDER_UNVERIFIED payment=${event.paymentId}: ${providerTruth.reason ?? ''}`,
        }
      }
      // Provider 明确说没收到钱 → 不授予权益，进死信（可人工重开）
      if (providerTruth.status === 'unpaid') {
        return {
          kind: 'dead',
          status: 'DEAD_LETTER',
          commands: [],
          note: `PROVIDER_SAYS_UNPAID payment=${event.paymentId}`,
        }
      }
      // Provider 确认已收款 → 派生新 chargeId 补偿结算，达到 SETTLED
      const recoveryChargeId = `${event.paymentId}:recovered:${event.eventId}`
      return {
        kind: 'settle',
        status: 'SETTLED',
        commands: [
          {
            type: 'CHARGE_CREATED',
            chargeId: recoveryChargeId,
            amountCents: charge.amountCents,
            currency: charge.currency,
            plan,
            dedupeKey: `inbox:recovery-created:${recoveryChargeId}`,
            recovery: true,
          },
          {
            type: 'CHARGE_SUCCEEDED',
            chargeId: recoveryChargeId,
            amountCents: charge.amountCents,
            currency: charge.currency,
            plan,
            dedupeKey: `inbox:recovery-settled:${recoveryChargeId}`,
            recovery: true,
          },
        ],
        note: `RECOVERED_TO_SETTLED payment=${event.paymentId} recovery=${recoveryChargeId}`,
      }
    }
  }

  // ── 失败事件 ──────────────────────────────────────────────────
  if (isFailed) {
    if (!charge) {
      return {
        kind: 'apply',
        status: 'APPLIED',
        commands: [],
        note: 'FAILED_WITHOUT_CHARGE_IGNORED',
      }
    }
    if (charge.status === 'SUCCEEDED' || charge.status === 'REFUNDED') {
      // 成功/退款后收到失败：绝不能撤销已确认权益，必须查 Provider
      if (!providerTruth.verified || providerTruth.status === 'unknown') {
        return {
          kind: 'reconcile',
          status: 'NEEDS_PROVIDER_RECONCILIATION',
          commands: [],
          note: `FAIL_AFTER_SUCCESS_NEEDS_PROVIDER payment=${event.paymentId}`,
        }
      }
      if (providerTruth.status === 'paid') {
        return {
          kind: 'review',
          status: 'REQUIRES_REVIEW',
          commands: [],
          note: `FAIL_AFTER_SUCCESS_BUT_PROVIDER_PAID payment=${event.paymentId}`,
        }
      }
      // Provider 确认未收款：记录失败事件（由账本内核判定能否落库），不撤销权益
      return {
        kind: 'dead',
        status: 'DEAD_LETTER',
        commands: [],
        note: `PROVIDER_CONFIRMED_UNPAID_AFTER_SUCCESS payment=${event.paymentId}`,
      }
    }
    // PENDING / FAILED：常规失败，交给账本内核
    return {
      kind: 'apply',
      status: 'APPLIED',
      commands: [],
      note: charge.status === 'FAILED' ? 'ALREADY_FAILED_IDEMPOTENT' : 'NORMAL_FAILURE',
    }
  }

  // 理论不可达，兜底为人工复核（绝不静默）
  return {
    kind: 'review',
    status: 'REQUIRES_REVIEW',
    commands: [],
    note: `UNHANDLED type=${event.type}`,
  }
}

/**
 * 状态机可推进性：非终态可被 worker 拾取重试/核验。
 */
export function isProcessable(status: InboxStatus): boolean {
  return (
    status === 'RECEIVED' ||
    status === 'RETRYABLE' ||
    status === 'NEEDS_PROVIDER_RECONCILIATION'
  )
}

/**
 * 重试次数是否耗尽 → 转 DEAD_LETTER（可追踪，不静默）。
 */
export function shouldDeadLetter(attempts: number, maxAttempts: number, status: InboxStatus): boolean {
  return isProcessable(status) && attempts >= maxAttempts
}
