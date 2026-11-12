/**
 * P0-02 · 支付事件 → 账本内核的端到端折叠验证（V20.7 作战包 §1）
 *
 * 既有测试各守一段：dodo-events.test.ts 只验「翻译出的命令/键」，
 * subscription.test.ts 只验「内核对人造事件序列的迁移表」。
 * 中间那段——webhook 按 dedupeKey 去重后，把命令按 offsetMs 定序喂进
 * reduceBillingEvents——此前没有串联覆盖。R-15 恰恰发生在这段接缝里：
 * 失败与成功共用结算键 ⇒ 后到的成功命令被去重静默丢弃 ⇒ 收钱不开通。
 *
 * 本套件把接缝显式实现成 applyWebhook()，并保留一个「缺陷注入」开关，
 * 用来证明测试有牙齿：把结算键折叠回旧形态，必须复现静默吞单。
 */
import {
  translateDodoEvent,
  type DodoWebhookEvent,
  type LedgerCommand,
  type LedgerSnapshot,
} from '@/lib/payments/dodo/events'
import { reduceBillingEvents, type BillingEventLike } from '@/lib/billing/subscription'
import { BILLING_INTERVALS, DODO_PRODUCT_ENV, SELLABLE_PLAN_IDS } from '@/config/subscription-plans'

const ENV: Record<string, string> = (() => {
  const env: Record<string, string> = {}
  for (const plan of SELLABLE_PLAN_IDS) {
    for (const interval of BILLING_INTERVALS) {
      env[DODO_PRODUCT_ENV[plan][interval]] = `pdt_${plan.toLowerCase()}_${interval}`
    }
  }
  return env
})()

const ACTIVE_GROWTH: LedgerSnapshot = { plan: 'GROWTH', status: 'ACTIVE' }
const META = { organizationId: 'org_1', plan: 'GROWTH', interval: 'monthly' }
const BASE_TS = Date.UTC(2026, 10, 12, 8, 0, 0)

const payment = (type: 'payment.succeeded' | 'payment.failed', paymentId: string): DodoWebhookEvent => ({
  type,
  data: {
    payment_id: paymentId,
    subscription_id: 'sub_1',
    product_id: 'pdt_growth_monthly',
    total_amount: 14900,
    currency: 'usd',
    metadata: META,
  },
})

const renewal = (paymentId: string): DodoWebhookEvent => ({
  type: 'subscription.renewed',
  data: {
    subscription_id: 'sub_1',
    payment_id: paymentId,
    product_id: 'pdt_growth_monthly',
    recurring_pre_tax_amount: 14900,
    currency: 'usd',
    metadata: META,
  },
})

interface ApplyOptions {
  /** 缺陷注入：把 succeeded/failed 的结算键折叠成同一个（= 生产 5a161c4 的旧形态）。 */
  collapseSettlementKeys?: boolean
}

/**
 * 复刻 webhook 落地路径：翻译 → 按 dedupeKey 去重 → 按 offsetMs 定序 → 内核折叠。
 * 只做内存模拟，不碰数据库、不发网络请求、不做真实扣款。
 */
function applyWebhook(events: DodoWebhookEvent[], opts: ApplyOptions = {}) {
  const seen = new Set<string>()
  const commands: LedgerCommand[] = []
  for (const event of events) {
    const outcome = translateDodoEvent(event, ACTIVE_GROWTH, ENV)
    if (outcome.kind !== 'apply') throw new Error(`unexpected ${outcome.kind}: ${'reason' in outcome ? outcome.reason : ''}`)
    for (const cmd of outcome.commands) {
      const key = opts.collapseSettlementKeys
        ? cmd.dedupeKey.replace(/:(succeeded|failed)$/, ':settled')
        : cmd.dedupeKey
      if (seen.has(key)) continue
      seen.add(key)
      commands.push(cmd)
    }
  }
  const billing: BillingEventLike[] = commands.map((c, i) => {
    const ts = new Date(BASE_TS + i * 1000 + c.offsetMs).toISOString()
    return {
      id: `be_p0_${String(i).padStart(3, '0')}`,
      type: c.type,
      plan: c.plan ?? null,
      chargeId: c.chargeId ?? null,
      amountCents: c.amountCents ?? null,
      currency: c.currency ?? 'USD',
      gatewayStatus: c.gatewayStatus ?? null,
      reason: c.reason ?? null,
      occurredAt: ts,
      createdAt: ts,
    }
  })
  // 翻译层收到的快照是 ACTIVE_GROWTH，账本内核却从 initialBillingState()（NONE）折叠。
  // 补一条更早的 SUBSCRIPTION_STARTED 作为真实账本前置，否则 CHARGE_CREATED 会在
  // NONE 状态被内核拒绝 —— 那是测试夹具与快照不一致，不是产品缺陷。
  const openedTs = new Date(BASE_TS - 60_000).toISOString()
  const opened: BillingEventLike = {
    id: 'be_p0_open',
    type: 'SUBSCRIPTION_STARTED',
    plan: 'GROWTH',
    chargeId: null,
    amountCents: null,
    currency: 'USD',
    gatewayStatus: null,
    reason: null,
    occurredAt: openedTs,
    createdAt: openedTs,
  }
  return { commands, state: reduceBillingEvents([opened, ...billing]) }
}

describe('P0-02 · 失败后成功（R-15 真实链路）', () => {
  it('同 payment_id 先 failed 后 succeeded：分态键让成功命令不被吞，内核显式拒绝且不静默', () => {
    // 关键：不是"没有报错就算好"。旧代码在这里会静默结束（收钱不开通）；
    // 新代码必须因为 FAILED→SUCCEEDED 非法迁移而抛错，webhook 才能转 deferred + 告警。
    expect(() => applyWebhook([payment('payment.failed', 'pay_r15'), payment('payment.succeeded', 'pay_r15')])).toThrow(
      /不允许变为/,
    )
  })

  it('负控 · 注入旧结算键（失败与成功共键）⇒ 必须复现"静默吞单、款项停在 FAILED"', () => {
    // 若这条断言失败，说明测试根本没有能力区分新旧代码，前面那条 GREEN 就是假绿。
    const { state, commands } = applyWebhook(
      [payment('payment.failed', 'pay_r15'), payment('payment.succeeded', 'pay_r15')],
      { collapseSettlementKeys: true },
    )
    expect(commands.some((c) => c.type === 'CHARGE_SUCCEEDED')).toBe(false)
    const byId = new Map(state.charges.map((c) => [c.chargeId, c.status]))
    expect(byId.get('pay_r15')).toBe('FAILED')
  })

  it('失败后用新 payment_id 重试成功：合法入账（不是"失败后永远收不了钱"）', () => {
    const { state } = applyWebhook([payment('payment.failed', 'pay_old'), payment('payment.succeeded', 'pay_new')])
    const byId = new Map(state.charges.map((c) => [c.chargeId, c.status]))
    expect(byId.get('pay_old')).toBe('FAILED')
    expect(byId.get('pay_new')).toBe('SUCCEEDED')
  })
})

describe('P0-02 · 成对事件与乱序（R-14 / 重放 / 逆序）', () => {
  it('subscription.renewed + payment.succeeded 同 payment_id 成对到达 ⇒ 只记一笔', () => {
    const { state } = applyWebhook([renewal('pay_renew'), payment('payment.succeeded', 'pay_renew')])
    expect(state.charges).toHaveLength(1)
    expect(state.charges[0].chargeId).toBe('pay_renew')
    expect(state.charges[0].status).toBe('SUCCEEDED')
  })

  it('逆序（success 先到、后到 failed）⇒ 不允许把已确认成功回退', () => {
    expect(() => applyWebhook([payment('payment.succeeded', 'pay_rev'), payment('payment.failed', 'pay_rev')])).toThrow(
      /不允许变为/,
    )
  })

  it('同一事件重放两次 ⇒ 状态与一次投递等价（幂等）', () => {
    const once = applyWebhook([payment('payment.succeeded', 'pay_replay')])
    const twice = applyWebhook([payment('payment.succeeded', 'pay_replay'), payment('payment.succeeded', 'pay_replay')])
    expect(twice.state).toEqual(once.state)
  })

  it('乱序传入同一批命令（内核定序）⇒ 结果稳定', () => {
    const a = applyWebhook([renewal('pay_order'), payment('payment.succeeded', 'pay_order')])
    const b = applyWebhook([payment('payment.succeeded', 'pay_order'), renewal('pay_order')])
    expect(b.state).toEqual(a.state)
  })
})
