/**
 * V25.5 P0.1 · R-15 Durable Inbox —— 持久化 + 编排层
 * ═══════════════════════════════════════════════════════════════════════
 *
 * 与 inbox-state.ts（纯判决内核）的分工：
 *   · state 层：给定事实 → 判决（新 chargeId 补偿 / 核验 / 复核 / 丢弃）；
 *   · store 层：持久化事件（ACK 与持久化绑定）、装载账本事实、应用结算命令、
 *     维护状态机、可注入 Provider 权威核验。
 *
 * ── 三条诚实纪律 ──────────────────────────────────────────────────
 *  1. **先持久化再返回**：`receiveEvent()` 在写库成功前不返回 ok —— webhook
 *     路由据此把 2xx 与"事件已可靠落地"绑定，不再"回了 200 却没存下来"。
 *  2. **幂等**：deliveryId 全局唯一；重复投递返回已存在记录，不重复判决/写账。
 *  3. **Provider 未核实不授权**：无凭据时 truth=PROVIDER_UNAVAILABLE，状态机
 *     只会进 NEEDS_PROVIDER_RECONCILIATION，绝不擅自结算权益。
 *
 * 依赖注入：`processInboxEvent` 接受可选 `deps`（db / provider / 时间），便于
 * 在隔离库上做真实集成测试，也能在单测里注入确定性的 Provider truth。
 */

import { db as defaultDb } from '@/lib/db'
import {
  decideSettlement,
  isProcessable,
  shouldDeadLetter,
  PROVIDER_UNAVAILABLE,
  type InboxEvent,
  type InboxStatus,
  type LedgerFacts,
  type PaymentTruth,
  type SettlementCommand,
} from './inbox-state'
import { reduceBillingEvents } from './subscription'
import { appendBillingEvent } from './service'
import type { TenantContext } from '@/lib/tenancy/resolve'

// ═══════════════════════════════════════════════════════════════
// Provider 权威核验抽象
// ═══════════════════════════════════════════════════════════════

export interface ProviderVerifier {
  /** 查询某 payment 在 Provider 侧的权威收款状态。 */
  verifyPayment(input: {
    paymentId: string
    subscriptionId: string | null
    amountCents: number | null
    currency: string | null
  }): Promise<PaymentTruth>
}

/** 默认：无授权凭据 → 如实报"未测试"，不联网、不猜状态。 */
export const NO_CREDENTIALS_VERIFIER: ProviderVerifier = {
  async verifyPayment() {
    return PROVIDER_UNAVAILABLE
  },
}

// ═══════════════════════════════════════════════════════════════
// 依赖与类型
// ═══════════════════════════════════════════════════════════════

type DbLike = typeof defaultDb

export interface InboxDeps {
  db?: DbLike
  verifier?: ProviderVerifier
  now?: () => Date
  maxAttempts?: number
}

export interface ReceiveResult {
  /** 是否新插入（false = 幂等回放，已存在）。 */
  inserted: boolean
  id: string
  status: InboxStatus
}

export interface ProcessResult {
  status: InboxStatus
  note: string
  appliedCommands: number
  replayedCommands: number
}

// ═══════════════════════════════════════════════════════════════

function systemContext(organizationId: string): TenantContext {
  return {
    organizationId,
    userId: 'system:inbox',
    role: 'OWNER',
    membershipId: 'system:inbox',
  }
}

/** 把 inbox 状态映射到可持久化的枚举值（逐字一致，避免漂移）。 */
function statusOf(raw: string): InboxStatus {
  const allowed = [
    'RECEIVED', 'APPLIED', 'SETTLED', 'NEEDS_PROVIDER_RECONCILIATION',
    'RETRYABLE', 'REQUIRES_REVIEW', 'DEAD_LETTER',
  ]
  return (allowed.includes(raw) ? raw : 'REQUIRES_REVIEW') as InboxStatus
}

/**
 * ① 收件：签名验证通过后立即持久化。幂等键 = deliveryId。
 *    **只有本函数成功返回，webhook 才应回 2xx**（ACK 与持久化绑定）。
 */
export async function receiveEvent(event: InboxEvent, deps: InboxDeps = {}): Promise<ReceiveResult> {
  const db = deps.db ?? defaultDb
  const existing = await db.billingInboxEvent.findUnique({ where: { deliveryId: event.deliveryId } })
  if (existing) {
    return { inserted: false, id: existing.id, status: statusOf(existing.status) }
  }
  const created = await db.billingInboxEvent.create({
    data: {
      deliveryId: event.deliveryId,
      eventId: event.eventId,
      organizationId: event.organizationId,
      type: event.type,
      paymentId: event.paymentId,
      subscriptionId: event.subscriptionId,
      amountCents: event.amountCents,
      currency: event.currency,
      payloadHash: event.payloadHash,
      status: 'RECEIVED',
      receivedAt: new Date(event.receivedAt),
    },
  })
  return { inserted: true, id: created.id, status: 'RECEIVED' }
}

/**
 * ② 装载账本事实（Feed store 层从 BillingEvent 派生）。
 */
export async function loadLedgerFacts(organizationId: string, deps: InboxDeps = {}): Promise<LedgerFacts> {
  const db = deps.db ?? defaultDb
  const rows = await db.billingEvent.findMany({
    where: { organizationId },
    select: {
      type: true, plan: true, chargeId: true, amountCents: true, currency: true,
      gatewayStatus: true, reason: true, occurredAt: true, createdAt: true,
    },
    orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }],
  })
  const state = reduceBillingEvents(
    rows.map((r) => ({
      id: `${r.occurredAt.toISOString()}:${r.createdAt.toISOString()}`,
      type: r.type,
      plan: r.plan,
      chargeId: r.chargeId,
      amountCents: r.amountCents,
      currency: r.currency,
      gatewayStatus: r.gatewayStatus,
      reason: r.reason,
      occurredAt: r.occurredAt.toISOString(),
      createdAt: r.createdAt.toISOString(),
    })),
  )
  return {
    organizationId,
    status: state.status,
    charges: state.charges.map((c) => ({
      chargeId: c.chargeId,
      status: c.status,
      amountCents: c.amountCents,
      currency: c.currency,
    })),
  }
}

/** 将结算命令真正写入账本（补偿命令用 recovery chargeId；幂等靠 dedupeKey）。 */
async function applyCommands(
  organizationId: string,
  commands: readonly SettlementCommand[],
  deps: InboxDeps,
): Promise<{ applied: number; replayed: number }> {
  const ctx = systemContext(organizationId)
  const now = (deps.now ?? (() => new Date()))()
  let applied = 0
  let replayed = 0
  // 串行：CHARGE_CREATED 必须先于 CHARGE_SUCCEEDED 落库（内核约束）。
  for (const cmd of commands) {
    const result = await appendBillingEvent(
      ctx,
      {
        type: cmd.type,
        plan: cmd.plan as never,
        chargeId: cmd.chargeId,
        amountCents: cmd.amountCents,
        currency: cmd.currency,
        dedupeKey: cmd.dedupeKey,
        gatewayStatus: cmd.type === 'CHARGE_SUCCEEDED' ? 'CAPTURED' : null,
        reason: null,
        actorId: null,
      },
      now,
    )
    if (result.replayed) replayed += 1
    else applied += 1
  }
  return { applied, replayed }
}

/**
 * ③ 处理一条已收件事件：判决 → （必要时查 Provider）→ 应用命令 → 更新状态。
 *    可重复调用；非可推进态与"已应用"事件不会再产生副作用。
 */
export async function processInboxEvent(
  deliveryId: string,
  opts: { plan: string | null },
  deps: InboxDeps = {},
): Promise<ProcessResult> {
  const db = deps.db ?? defaultDb
  const verifier = deps.verifier ?? NO_CREDENTIALS_VERIFIER
  const maxAttempts = deps.maxAttempts ?? 5

  const row = await db.billingInboxEvent.findUnique({ where: { deliveryId } })
  if (!row) throw new Error(`inbox event not found: ${deliveryId}`)

  const currentStatus = statusOf(row.status)
  const alreadyApplied = row.appliedToLedger === true

  // 终态 / 人工复核态：不再自动推进（IDEMPOTENT）
  if (!isProcessable(currentStatus) && currentStatus !== 'RECEIVED') {
    return { status: currentStatus, note: `NOT_PROCESSABLE(${currentStatus})`, appliedCommands: 0, replayedCommands: 0 }
  }

  const event: InboxEvent = {
    deliveryId: row.deliveryId,
    eventId: row.eventId,
    type: row.type,
    organizationId: row.organizationId,
    paymentId: row.paymentId,
    subscriptionId: row.subscriptionId,
    amountCents: row.amountCents,
    currency: row.currency,
    payloadHash: row.payloadHash,
    receivedAt: row.receivedAt.toISOString(),
  }

  const ledger = await loadLedgerFacts(row.organizationId, deps)

  // 只有"冲突需核验"类事件才查 Provider（无凭据不会联网）
  let providerTruth: PaymentTruth = PROVIDER_UNAVAILABLE
  const needsProvider = event.type === 'payment.succeeded' || event.type === 'payment.failed'
  if (needsProvider) {
    try {
      providerTruth = await verifier.verifyPayment({
        paymentId: event.paymentId ?? '',
        subscriptionId: event.subscriptionId,
        amountCents: event.amountCents,
        currency: event.currency,
      })
    } catch (err) {
      providerTruth = {
        status: 'unknown', verified: false, amountCents: null, currency: null,
        reason: `PROVIDER_ERROR: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  }

  const decision = decideSettlement({
    event,
    ledger,
    providerTruth,
    alreadyApplied,
    plan: opts.plan,
  })

  // 重试耗尽 → DEAD_LETTER（可追踪，不静默）
  const nextAttempts = row.attempts + 1
  const finalStatus: InboxStatus = shouldDeadLetter(nextAttempts, maxAttempts, decision.status as InboxStatus)
    ? 'DEAD_LETTER'
    : decision.status

  let applied = 0
  let replayed = 0
  if (decision.commands.length > 0 && !alreadyApplied) {
    const r = await applyCommands(row.organizationId, decision.commands, deps)
    applied = r.applied
    replayed = r.replayed
  }

  await db.billingInboxEvent.update({
    where: { deliveryId },
    data: {
      status: finalStatus,
      attempts: nextAttempts,
      lastNote: decision.note,
      providerTruth: providerTruth as object,
      resolutionCommands: decision.commands as unknown as object[],
      appliedToLedger: alreadyApplied || applied > 0,
    },
  })

  return {
    status: finalStatus,
    note: decision.note,
    appliedCommands: applied,
    replayedCommands: replayed,
  }
}

/** 供 webhook 路由读取收件状态（审计/观测）。 */
export async function getInboxEvent(deliveryId: string, deps: InboxDeps = {}) {
  const db = deps.db ?? defaultDb
  return db.billingInboxEvent.findUnique({ where: { deliveryId } })
}

/** 待处理/人工复核队列（可观测告警入口）。 */
export async function listPendingInbox(deps: InboxDeps = {}) {
  const db = deps.db ?? defaultDb
  return db.billingInboxEvent.findMany({
    where: {
      status: {
        in: ['RECEIVED', 'RETRYABLE', 'NEEDS_PROVIDER_RECONCILIATION', 'REQUIRES_REVIEW'] as never,
      },
    },
    orderBy: { updatedAt: 'asc' },
  })
}
