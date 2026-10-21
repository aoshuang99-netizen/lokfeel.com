/**
 * V17 · Creem 订阅事件 → 内部状态（WB17-02）
 *
 * 为什么单独抽出来：Webhook 里那段 200 行的 `switch` 有三个问题，且都无法被单测覆盖：
 *   1. **死分支**：`subscription.created` / `subscription.cancelled`（英式拼写）/
 *      `payment.succeeded` / `payment.failed` 都不在 Creem 的事件目录里 —— 永远不会触发，
 *      却让"已处理 6 类事件"看起来比实际更完整。
 *   2. **续费不入账**：`subscription.paid`（每期扣款成功，含续费）**完全没处理**。
 *      首月收钱、次月静默丢失，正是交接书 §4 说的"首付正常时看不出问题"。
 *   3. **幂等键用错对象**：以 `object.id`（订阅 id）为键 ⇒ 第二期续费与首期同键，
 *      会被判成"重复事件"直接跳过；而退款也复用同一个 sale/subscription id。
 *
 * 本模块只做**纯映射**（无 IO、无 Prisma），因此可以用最便宜的方式穷举事件矩阵。
 * 事件目录以 Creem 官方文档为准（15 种，见 §CREEM_KNOWN_EVENTS）。
 */

/** 与 `prisma/schema/core.prisma` 的 `SubscriptionStatus` 逐字一致。 */
export type SubscriptionStatusValue = 'ACTIVE' | 'CANCELLED' | 'EXPIRED' | 'PAST_DUE' | 'TRIALING'

/** 官方文档列出的全部事件（2026-10 核对）。不在此列 = 不是 Creem 会发的类型。 */
export const CREEM_KNOWN_EVENTS = [
  'checkout.completed',
  'subscription.active',
  'subscription.paid',
  'subscription.canceled',
  'subscription.scheduled_cancel',
  'subscription.past_due',
  'subscription.unpaid',
  'subscription.expired',
  'subscription.update',
  'subscription.trialing',
  'subscription.paused',
  'refund.created',
  'dispute.created',
  'credits.granted',
  'credits.consumed',
  'customer_credits.exhausted',
  'credits.auto_recharged',
] as const

/**
 * 我们**实际处理**的事件。其余（credits / update / dispute）显式归入 `ignored`，
 * 不用 `default` 静默吞掉 —— 否则新增事件类型时会悄悄进黑洞。
 */
export type CreemEventKind =
  | 'activate' // 首次开通：checkout.completed / subscription.active
  | 'renew' // 每期扣款成功：subscription.paid（含续费）
  | 'trial' // 试用：subscription.trialing
  | 'cancel' // 终态取消：subscription.canceled
  | 'cancel_scheduled' // 期末取消（期内仍有效）
  | 'past_due' // 扣款失败（Creem 会自动重试）
  | 'unpaid' // 催收失败
  | 'expire' // 过期
  | 'pause' // 暂停
  | 'refund' // 退款
  | 'ignored' // 已知但不影响订阅状态
  | 'unknown' // 不在官方目录内（不应出现）

const KIND_BY_EVENT: Record<string, CreemEventKind> = {
  'checkout.completed': 'activate',
  'subscription.active': 'activate',
  'subscription.paid': 'renew',
  'subscription.trialing': 'trial',
  'subscription.canceled': 'cancel',
  'subscription.scheduled_cancel': 'cancel_scheduled',
  'subscription.past_due': 'past_due',
  'subscription.unpaid': 'unpaid',
  'subscription.expired': 'expire',
  'subscription.paused': 'pause',
  'subscription.update': 'ignored',
  'refund.created': 'refund',
  'dispute.created': 'ignored',
  'credits.granted': 'ignored',
  'credits.consumed': 'ignored',
  'customer_credits.exhausted': 'ignored',
  'credits.auto_recharged': 'ignored',
}

export function classifyCreemEvent(eventType: unknown): CreemEventKind {
  if (typeof eventType !== 'string') return 'unknown'
  return KIND_BY_EVENT[eventType] ?? 'unknown'
}

/**
 * 事件 → 目标状态。`null` 表示"不改状态"（只影响账务或什么都不做）。
 *
 * ⚠️ `pause` 映射到 `PAST_DUE` 是**有损**的：枚举里没有 PAUSED。
 *    选择 PAST_DUE 而不是 ACTIVE，是因为"暂停"必须停止发放权益；
 *    宁可让用户看到"逾期"去找客服，也不能继续白送。
 */
export function statusForKind(kind: CreemEventKind): SubscriptionStatusValue | null {
  switch (kind) {
    case 'activate':
    case 'renew':
      return 'ACTIVE'
    case 'trial':
      return 'TRIALING'
    case 'cancel':
      return 'CANCELLED'
    case 'cancel_scheduled':
      // 期末取消：期内仍是有效订阅。没有 cancelAtPeriodEnd 字段，
      // 因此保持 ACTIVE，由 expiresAt/periodEnd 决定何时真正失效。
      return 'ACTIVE'
    case 'past_due':
    case 'unpaid':
    case 'pause':
      return 'PAST_DUE'
    case 'expire':
      return 'EXPIRED'
    case 'refund':
    case 'ignored':
    case 'unknown':
      return null
    default:
      return null
  }
}

/** 是否属于"会动钱"的事件（需要落 Payment 行）。 */
export function isMonetaryKind(kind: CreemEventKind): boolean {
  return kind === 'activate' || kind === 'renew' || kind === 'refund'
}

type CreemObject = Record<string, unknown>

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

function dateOf(v: unknown): Date | null {
  if (typeof v === 'number' && Number.isFinite(v)) return new Date(v)
  if (typeof v === 'string') {
    const d = new Date(v)
    if (!Number.isNaN(d.getTime())) return d
  }
  return null
}

export function creemObjectOf(event: unknown): CreemObject {
  if (!event || typeof event !== 'object') return {}
  const obj = (event as { object?: unknown }).object
  return obj && typeof obj === 'object' ? (obj as CreemObject) : {}
}

/** 订阅 id：`sub_xxx`。 */
export function subscriptionIdOf(obj: CreemObject): string | null {
  return str(obj.id) ?? str(obj.subscription_id)
}

export function customerIdOf(obj: CreemObject): string | null {
  const c = obj.customer
  if (typeof c === 'string') return c
  if (c && typeof c === 'object') return str((c as CreemObject).id)
  return str(obj.customer_id)
}

/** 计费周期结束时间：优先 `current_period_end_date`，回落 `next_transaction_date`。 */
export function periodEndOf(obj: CreemObject): Date | null {
  return dateOf(obj.current_period_end_date) ?? dateOf(obj.next_transaction_date)
}

/** 本次扣款的交易 id（`tran_xxx`）—— 续费幂等的天然键。 */
export function transactionIdOf(obj: CreemObject): string | null {
  return str(obj.last_transaction_id) ?? str(obj.transaction_id)
}

export function userIdOf(obj: CreemObject): string | null {
  const meta = obj.metadata
  if (!meta || typeof meta !== 'object') return null
  return str((meta as CreemObject).userId)
}

export function planOf(obj: CreemObject): string | null {
  const meta = obj.metadata
  if (!meta || typeof meta !== 'object') return null
  return str((meta as CreemObject).plan)
}

/**
 * 幂等键（写入 `Payment.stripePaymentIntentId`，该列唯一）。
 *
 * 🔴 这是本文件最关键的一个决定：
 *   - 续费必须用**交易 id**，不能用订阅 id —— 否则第二期与首期同键，被当成重复事件吞掉；
 *   - 退款用**退款对象 id**，不能复用原交易的键 —— 否则退款会被判成"重复的首购"；
 *   - 开通用 checkout 对象 id。
 *
 * 返回 null 表示该事件不该落 Payment（例如订阅状态变更）。
 */
export function idempotencyKeyOf(kind: CreemEventKind, event: unknown, obj: CreemObject): string | null {
  const eventId = str((event as { id?: unknown }).id)
  switch (kind) {
    case 'renew': {
      const tran = transactionIdOf(obj)
      if (tran) return `creem:tran:${tran}`
      // 没有交易 id 时退化到事件 id：至少保证同一事件重放不会重复入账。
      return eventId ? `creem:evt:${eventId}` : null
    }
    case 'activate': {
      const checkout = str(obj.id)
      return checkout ? `creem:checkout:${checkout}` : eventId ? `creem:evt:${eventId}` : null
    }
    case 'refund': {
      const refundId = str(obj.id) ?? eventId
      return refundId ? `creem:refund:${refundId}` : null
    }
    default:
      return null
  }
}

/**
 * 乱序保护。
 *
 * 场景：`subscription.paid`（已推进到 12 月）之后，迟到的 `past_due`（属于 11 月）到达。
 * 若直接套用状态，会把已经付过钱的订阅打成逾期 —— 用户被停权，而钱已经收了。
 *
 * 判据：**周期结束时间是这条订阅的逻辑时钟**。降级类事件若其周期早于当前周期，视为陈旧。
 * 升级类事件（paid/activate）永远接受 —— 迟到的好消息不该被丢。
 */
export function isStaleDowngrade(
  kind: CreemEventKind,
  incomingPeriodEnd: Date | null,
  currentPeriodEnd: Date | null
): boolean {
  const downgrades: CreemEventKind[] = ['past_due', 'unpaid', 'expire']
  if (!downgrades.includes(kind)) return false
  if (!incomingPeriodEnd || !currentPeriodEnd) return false
  return incomingPeriodEnd.getTime() < currentPeriodEnd.getTime()
}

/** 状态是否仍然发放付费权益（供服务层判断，避免各处各写一遍）。 */
export function isEntitled(status: SubscriptionStatusValue): boolean {
  return status === 'ACTIVE' || status === 'TRIALING'
}

/**
 * 季度套餐的权益周期。
 *
 * `SubscriptionPlan` 枚举没有季度值，因此季度订阅在库里记 `PREMIUM_MONTHLY`
 * 但周期是 92 天。这里把"92"变成有名字的常量，避免散落的魔法数字。
 */
export const QUARTERLY_PERIOD_DAYS = 92

export function periodEndForPlan(plan: string, from: Date): Date {
  const days = plan === 'PREMIUM_YEARLY' ? 365 : plan === 'PREMIUM_QUARTERLY' ? QUARTERLY_PERIOD_DAYS : 30
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000)
}
