/**
 * Admin 订阅列表：API 响应 → 视图行（纯函数，可单测）
 *
 * ── 背景（V16 · T01）────────────────────────────────────────────────────────
 * 修复前 `admin/subscriptions/page.tsx` 直接渲染 `{sub.amount} {sub.currency.toUpperCase()}`。
 * 但 `/api/admin/subscriptions` **不返回 amount / currency**（`Subscription` 模型也没有
 * 这两个字段），于是运行时 `undefined.toUpperCase()` 抛 TypeError → 整页白屏。
 *
 * 同时还有一处更隐蔽的错位：DB 枚举是大写（`ACTIVE` / `CANCELLED` / `EXPIRED` /
 * `PAST_DUE` / `TRIALING`），而页面按小写 key 查表并 `|| config.active` 兜底 ——
 * 结果是**所有订阅都显示成"活跃"**，且 `status === "active"` 恒为假，
 * 退款按钮永远不会出现。
 *
 * ── 本模块的职责 ────────────────────────────────────────────────────────────
 * 把「归一化」从渲染里剥离出来：
 *   1. 入参一律按 `unknown` 接收 —— 后端字段漂移不会变成前端崩溃；
 *   2. 金额与周期从单一配置源 `src/config/plans.ts` 派生，绝不伪造字段；
 *   3. 未知状态显式降级为 `unknown`（显示"未知"），**不冒充活跃**。
 */

import { PLANS, isPlanId, centsToAmount, type PlanId } from '@/config/plans'

export type SubscriptionStatusKey =
  | 'active'
  | 'cancelled'
  | 'expired'
  | 'past_due'
  | 'trialing'
  | 'unknown'

export interface SubscriptionRowView {
  id: string
  userLabel: string
  planLabel: string
  status: SubscriptionStatusKey
  amountLabel: string
  periodLabel: string
  refundable: boolean
}

/** 状态别名 → 归一化 key。大小写、连字符、下划线都接受。 */
const STATUS_ALIASES: Record<string, SubscriptionStatusKey> = {
  active: 'active',
  cancelled: 'cancelled',
  canceled: 'cancelled',
  expired: 'expired',
  past_due: 'past_due',
  pastdue: 'past_due',
  trialing: 'trialing',
  trial: 'trialing',
}

const STATUS_LABELS: Record<SubscriptionStatusKey, string> = {
  active: '活跃',
  cancelled: '已取消',
  expired: '已过期',
  past_due: '逾期',
  trialing: '试用中',
  unknown: '未知',
}

export function statusLabel(status: SubscriptionStatusKey): string {
  return STATUS_LABELS[status]
}

/** 只有"仍在计费周期内"的状态才允许发起退款。 */
const REFUNDABLE: ReadonlySet<SubscriptionStatusKey> = new Set<SubscriptionStatusKey>([
  'active',
  'past_due',
])

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function normalizeStatus(value: unknown): SubscriptionStatusKey {
  const raw = asString(value).toLowerCase().replace(/[\s-]+/g, '_')
  return STATUS_ALIASES[raw] ?? 'unknown'
}

/**
 * 金额展示：走 PLANS 派生。
 * 不在售（FREE / LADY_FREE / LIFETIME 或未知档）一律显示 "—"，不编造 $0.00。
 */
export function formatPlanAmount(plan: unknown): string {
  if (!isPlanId(plan)) return '—'
  const def = PLANS[plan as PlanId]
  if (def.notForSale) return '—'

  const monthly = def.priceCents.monthly
  const yearly = def.priceCents.yearly
  if (monthly > 0) return `$${centsToAmount(monthly)} / 月`
  if (yearly > 0) return `$${centsToAmount(yearly)} / 年`
  return '—'
}

/** ISO 字符串 / Date → `YYYY-MM-DD`；无效或缺失返回空串（绝不产生 Invalid Date）。 */
export function formatDay(value: unknown): string {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10)
  }
  const raw = asString(value)
  if (!raw) return ''
  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10)
}

/**
 * 周期展示：优先 startsAt → endsAt；endsAt 缺失时退回 Stripe 的当前周期结束时间。
 * 两端都拿不到就返回 "—"，而不是 "1970-01-01"。
 */
export function formatPeriod(row: {
  startsAt?: unknown
  endsAt?: unknown
  stripeCurrentPeriodEnd?: unknown
}): string {
  const start = formatDay(row.startsAt)
  const end = formatDay(row.endsAt) || formatDay(row.stripeCurrentPeriodEnd)
  if (!start && !end) return '—'
  if (!end) return `${start} 起`
  if (!start) return `至 ${end}`
  return `${start} → ${end}`
}

/**
 * 单行归一化。
 *
 * 入参故意声明为 `Record<string, unknown>`：调用方传什么形状都能进来，
 * 由这里决定哪些字段可信 —— 这就是"类型安全缺省"的落点。
 */
export function toSubscriptionRow(raw: Record<string, unknown>): SubscriptionRowView {
  const id = asString(raw.id)
  const status = normalizeStatus(raw.status)

  const userName = asString(raw.userName)
  const userId = asString(raw.userId)
  const userLabel = userName || userId || '—'

  const plan = asString(raw.plan)
  const planLabel = isPlanId(plan) ? PLANS[plan as PlanId].name : plan || '—'

  return {
    id,
    userLabel,
    planLabel,
    status,
    amountLabel: formatPlanAmount(plan),
    periodLabel: formatPeriod(raw),
    refundable: REFUNDABLE.has(status),
  }
}

/** 列表归一化：非数组、空数组、含非对象项都能安全通过。 */
export function toSubscriptionRows(payload: unknown): SubscriptionRowView[] {
  if (!Array.isArray(payload)) return []
  const rows: SubscriptionRowView[] = []
  for (const item of payload) {
    if (!item || typeof item !== 'object') continue
    const row = toSubscriptionRow(item as Record<string, unknown>)
    // 没有 id 的行无法退款也无法定位，直接丢弃比渲染出无法操作的行更诚实
    if (row.id) rows.push(row)
  }
  return rows
}
