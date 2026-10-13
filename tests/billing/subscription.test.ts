/**
 * T08 · 订阅/账单状态机内核测试（AC-21）
 *
 * 这个套件的定位是**穷举迁移表**，而不是只跑一条 happy path：
 * AC-21 的判据是「退款/失败/升级/降级**状态一致**」，而"一致"的可证伪形式就是
 * 「每一条非法迁移都被拒、每一条合法迁移都到达预期状态」。
 *
 * 🔴 其中**必须**通过的一条：`REFUNDED → SUCCEEDED` 失败（AC-21 点名）。
 */

import { ConflictError, ValidationError } from '@/lib/errors'
import {
  compareBillingEvents,
  hasPendingCharge,
  initialBillingState,
  isSubscriptionLive,
  latestChargeOf,
  reduceBillingEvents,
  type BillingEventLike,
} from '@/lib/billing/subscription'

// ── 造事件的辅助（默认值让用例只写关心的字段）──
//
// ⚠️ 自动时间戳必须**等宽且单调**：早先版本用 `2026-10-${10 + seq}` 拼日期，当 seq 让
//    日号达到 100 时 `padStart(2)` 不再等宽 → 字符串序反转（`'...-100' < '...-99'`）→
//    事件被排错序，表现为"订阅处于 NONE 时不允许 PLAN_CHANGED"这种莫名其妙的报错。
//    改用"固定基准 + seq 分钟"的 ISO 串，既等宽又单调。
// 基准取 2026-10-02，**晚于** `startedAndPaid()` 里的显式时间戳（2026-10-01），
// 这样"标准前置 + 后续事件"的拼装顺序天然正确。
const AUTO_BASE = Date.UTC(2026, 9, 2)
let seq = 0
function ev(partial: Partial<BillingEventLike> & Pick<BillingEventLike, 'type'>): BillingEventLike {
  seq += 1
  const auto = new Date(AUTO_BASE + seq * 60_000).toISOString()
  return {
    id: partial.id ?? `be_${String(seq).padStart(4, '0')}`,
    type: partial.type,
    plan: partial.plan ?? null,
    chargeId: partial.chargeId ?? null,
    amountCents: partial.amountCents ?? null,
    currency: partial.currency ?? 'USD',
    gatewayStatus: partial.gatewayStatus ?? null,
    reason: partial.reason ?? null,
    occurredAt: partial.occurredAt ?? auto,
    createdAt: partial.createdAt ?? auto,
  }
}

/** 走到"已订阅且首笔款项已成功"的标准前置。 */
function startedAndPaid(plan: 'STARTER' | 'GROWTH' | 'SCALE' = 'STARTER', amount = 9900) {
  return [
    ev({ type: 'SUBSCRIPTION_STARTED', plan, occurredAt: '2026-10-01T00:00:00.000Z' }),
    ev({ type: 'CHARGE_CREATED', chargeId: 'ch_1', amountCents: amount, occurredAt: '2026-10-01T00:01:00.000Z' }),
    ev({
      type: 'CHARGE_SUCCEEDED',
      chargeId: 'ch_1',
      amountCents: amount,
      gatewayStatus: 'CAPTURED',
      occurredAt: '2026-10-01T00:02:00.000Z',
    }),
  ]
}

describe('空事件集', () => {
  it('无任何事件 → FREE / NONE / 0 元 / 无款项', () => {
    const s = reduceBillingEvents([])
    expect(s.plan).toBe('FREE')
    expect(s.status).toBe('NONE')
    expect(s.paidTotalCents).toBe(0)
    expect(s.refundedTotalCents).toBe(0)
    expect(s.netPaidCents).toBe(0)
    expect(s.eventCount).toBe(0)
    expect(s.charges).toEqual([])
    expect(s.lastEventAt).toBeNull()
    expect(latestChargeOf(s)).toBeNull()
  })

  it('initialBillingState() 与 reduceBillingEvents([]) 等价', () => {
    expect(reduceBillingEvents([])).toEqual(initialBillingState())
  })
})

describe('开通与方案变更', () => {
  it('SUBSCRIPTION_STARTED → ACTIVE，并记录 startedAt', () => {
    const s = reduceBillingEvents([ev({ type: 'SUBSCRIPTION_STARTED', plan: 'STARTER' })])
    expect(s.plan).toBe('STARTER')
    expect(s.status).toBe('ACTIVE')
    expect(s.startedAt).not.toBeNull()
  })

  it('🔴 开通**不算**升降级：STARTED 后 lastPlanChangeDirection 仍为 null', () => {
    // 若把 FREE → STARTER 记成 UPGRADE，"升降级"这条事实就有了两个来源：
    // 一次开通会被界面读成一次升级。
    const s = reduceBillingEvents([ev({ type: 'SUBSCRIPTION_STARTED', plan: 'GROWTH' })])
    expect(s.lastPlanChangeDirection).toBeNull()
    // 只有 PLAN_CHANGED 才置位
    const changed = reduceBillingEvents([
      ev({ type: 'SUBSCRIPTION_STARTED', plan: 'STARTER' }),
      ev({ type: 'PLAN_CHANGED', plan: 'GROWTH' }),
    ])
    expect(changed.lastPlanChangeDirection).toBe('UPGRADE')
  })

  it('已 ACTIVE 时再 STARTED → 409（应走 PLAN_CHANGED）', () => {
    const events = [ev({ type: 'SUBSCRIPTION_STARTED', plan: 'STARTER' }), ev({ type: 'SUBSCRIPTION_STARTED', plan: 'GROWTH' })]
    expect(() => reduceBillingEvents(events)).toThrow(ConflictError)
  })

  it('升降级**由方案序推导**，不由调用方声明', () => {
    const up = reduceBillingEvents([
      ev({ type: 'SUBSCRIPTION_STARTED', plan: 'STARTER' }),
      ev({ type: 'PLAN_CHANGED', plan: 'SCALE' }),
    ])
    expect(up.lastPlanChangeDirection).toBe('UPGRADE')
    expect(up.plan).toBe('SCALE')

    const down = reduceBillingEvents([
      ev({ type: 'SUBSCRIPTION_STARTED', plan: 'SCALE' }),
      ev({ type: 'PLAN_CHANGED', plan: 'STARTER' }),
    ])
    expect(down.lastPlanChangeDirection).toBe('DOWNGRADE')
    expect(down.plan).toBe('STARTER')
  })

  it('未订阅时 PLAN_CHANGED → 409（没有东西可改）', () => {
    expect(() => reduceBillingEvents([ev({ type: 'PLAN_CHANGED', plan: 'GROWTH' })])).toThrow(ConflictError)
  })

  it('降级**不动** status：PAST_DUE 的租户降级自救后不应被洗白成 ACTIVE', () => {
    const events = [
      ...startedAndPaid('GROWTH'),
      ev({ type: 'CHARGE_CREATED', chargeId: 'ch_2', amountCents: 100 }),
      ev({ type: 'CHARGE_FAILED', chargeId: 'ch_2', reason: 'card_declined' }),
      ev({ type: 'PLAN_CHANGED', plan: 'STARTER' }),
    ]
    const s = reduceBillingEvents(events)
    expect(s.status).toBe('PAST_DUE')
    expect(s.plan).toBe('STARTER')
  })
})

describe('款项生命周期', () => {
  it('CREATED → SUCCEEDED：累计已收款', () => {
    const s = reduceBillingEvents(startedAndPaid('STARTER', 9900))
    expect(s.paidTotalCents).toBe(9900)
    expect(s.netPaidCents).toBe(9900)
    expect(s.status).toBe('ACTIVE')
    expect(latestChargeOf(s)?.status).toBe('SUCCEEDED')
  })

  it('没有 CHARGE_CREATED 就 SUCCEEDED → 409（不许凭空造账）', () => {
    const events = [
      ev({ type: 'SUBSCRIPTION_STARTED', plan: 'STARTER' }),
      ev({ type: 'CHARGE_SUCCEEDED', chargeId: 'ch_ghost', amountCents: 100 }),
    ]
    expect(() => reduceBillingEvents(events)).toThrow(ConflictError)
  })

  it('同一 chargeId 重复 CREATED → 409', () => {
    const events = [
      ev({ type: 'SUBSCRIPTION_STARTED', plan: 'STARTER' }),
      ev({ type: 'CHARGE_CREATED', chargeId: 'ch_1', amountCents: 100 }),
      ev({ type: 'CHARGE_CREATED', chargeId: 'ch_1', amountCents: 100 }),
    ]
    expect(() => reduceBillingEvents(events)).toThrow(ConflictError)
  })

  it('🔴 REFUNDED → SUCCEEDED 必须失败（AC-21 点名的判据）', () => {
    const events = [
      ...startedAndPaid('STARTER', 9900),
      ev({ type: 'CHARGE_REFUNDED', chargeId: 'ch_1', amountCents: 9900 }),
      // 同一笔款项再被标记成功 —— 必须被拒
      ev({ type: 'CHARGE_SUCCEEDED', chargeId: 'ch_1', amountCents: 9900 }),
    ]
    expect(() => reduceBillingEvents(events)).toThrow(ConflictError)
    // 且报错必须指明是"非法迁移"而不是别的什么
    try {
      reduceBillingEvents(events)
    } catch (e) {
      expect((e as ConflictError).details).toMatchObject({ code: 'ILLEGAL_TRANSITION', chargeId: 'ch_1' })
    }
  })

  it('两层规则都必须承重：重新开通后，对**已退款的那笔款项**标记成功仍被拒（款项层）', () => {
    // 这一条专门证明「只做订阅层校验」是不够的：
    //   STARTED → ch_1 成功 → ch_1 退款（订阅进 REFUNDED 终态）
    //           → 重新 STARTED（订阅回到 ACTIVE，于是**订阅层会放行** CHARGE_SUCCEEDED）
    //           → 对 ch_1 再标记成功 ⇒ 只能靠**款项层**（ch_1 已是 REFUNDED 终态）拦住。
    const events = [
      ...startedAndPaid('STARTER', 9900),
      ev({ type: 'CHARGE_REFUNDED', chargeId: 'ch_1', amountCents: 9900 }),
      ev({ type: 'SUBSCRIPTION_STARTED', plan: 'STARTER' }),
      ev({ type: 'CHARGE_SUCCEEDED', chargeId: 'ch_1', amountCents: 9900 }),
    ]
    try {
      reduceBillingEvents(events)
      throw new Error('应当抛错但没有')
    } catch (e) {
      expect(e).toBeInstanceOf(ConflictError)
      expect((e as ConflictError).details).toMatchObject({
        code: 'ILLEGAL_TRANSITION',
        chargeId: 'ch_1',
        from: 'REFUNDED',
        to: 'SUCCEEDED',
      })
    }
  })

  it('FAILED → SUCCEEDED 必须失败（失败不可改判；重试要新建款项）', () => {
    const events = [
      ev({ type: 'SUBSCRIPTION_STARTED', plan: 'STARTER' }),
      ev({ type: 'CHARGE_CREATED', chargeId: 'ch_1', amountCents: 100 }),
      ev({ type: 'CHARGE_FAILED', chargeId: 'ch_1', reason: 'insufficient_funds' }),
      ev({ type: 'CHARGE_SUCCEEDED', chargeId: 'ch_1', amountCents: 100 }),
    ]
    expect(() => reduceBillingEvents(events)).toThrow(ConflictError)
  })

  it('PAST_DUE → 新款项成功 → 回到 ACTIVE（欠费可自救）', () => {
    const events = [
      ...startedAndPaid('STARTER', 9900),
      ev({ type: 'CHARGE_CREATED', chargeId: 'ch_2', amountCents: 9900 }),
      ev({ type: 'CHARGE_FAILED', chargeId: 'ch_2', reason: 'card_declined' }),
      ev({ type: 'CHARGE_CREATED', chargeId: 'ch_3', amountCents: 9900 }),
      ev({ type: 'CHARGE_SUCCEEDED', chargeId: 'ch_3', amountCents: 9900 }),
    ]
    const s = reduceBillingEvents(events)
    expect(s.status).toBe('ACTIVE')
    expect(s.paidTotalCents).toBe(19800)
    expect(s.charges.map((c) => c.status)).toEqual(['SUCCEEDED', 'FAILED', 'SUCCEEDED'])
  })

  it('退款：refunded 累计、净额回落、订阅进 REFUNDED 终态', () => {
    const events = [
      ...startedAndPaid('STARTER', 9900),
      ev({ type: 'CHARGE_REFUNDED', chargeId: 'ch_1', amountCents: 9900 }),
    ]
    const s = reduceBillingEvents(events)
    expect(s.status).toBe('REFUNDED')
    expect(s.refundedTotalCents).toBe(9900)
    expect(s.netPaidCents).toBe(0)
    expect(s.refundedAt).not.toBeNull()
  })

  it('退款后：CHARGE_CREATED 被拒（退订态不该产生新款项）', () => {
    const events = [
      ...startedAndPaid('STARTER', 9900),
      ev({ type: 'CHARGE_REFUNDED', chargeId: 'ch_1', amountCents: 9900 }),
      ev({ type: 'CHARGE_CREATED', chargeId: 'ch_9', amountCents: 100 }),
    ]
    expect(() => reduceBillingEvents(events)).toThrow(ConflictError)
  })

  it('退款后允许**重新开通**，且历史收退款总额不被清零', () => {
    const events = [
      ...startedAndPaid('STARTER', 9900),
      ev({ type: 'CHARGE_REFUNDED', chargeId: 'ch_1', amountCents: 9900 }),
      ev({ type: 'SUBSCRIPTION_STARTED', plan: 'GROWTH' }),
    ]
    const s = reduceBillingEvents(events)
    expect(s.status).toBe('ACTIVE')
    expect(s.plan).toBe('GROWTH')
    expect(s.paidTotalCents).toBe(9900)
    expect(s.refundedTotalCents).toBe(9900)
    expect(s.refundedAt).toBeNull() // 新一轮订阅不带着上一轮的终态时间戳
  })

  it('部分退款 → 400（本切片只支持全额退款，宁可明确拒绝也不模糊处理）', () => {
    const events = [
      ...startedAndPaid('STARTER', 9900),
      ev({ type: 'CHARGE_REFUNDED', chargeId: 'ch_1', amountCents: 500 }),
    ]
    expect(() => reduceBillingEvents(events)).toThrow(ValidationError)
  })
})

describe('退订', () => {
  it('退订 → CANCELED，之后不接受新款项', () => {
    const events = [...startedAndPaid(), ev({ type: 'SUBSCRIPTION_CANCELED', reason: 'customer_request' })]
    const s = reduceBillingEvents(events)
    expect(s.status).toBe('CANCELED')
    expect(s.canceledAt).not.toBeNull()
    expect(() => reduceBillingEvents([...events, ev({ type: 'CHARGE_CREATED', chargeId: 'ch_x', amountCents: 1 })])).toThrow(
      ConflictError
    )
  })

  it('未订阅时退订 → 409', () => {
    expect(() => reduceBillingEvents([ev({ type: 'SUBSCRIPTION_CANCELED' })])).toThrow(ConflictError)
  })

  it('退订后重新开通 → ACTIVE（并且不再记得上一次的取消时间）', () => {
    const events = [
      ...startedAndPaid(),
      ev({ type: 'SUBSCRIPTION_CANCELED' }),
      ev({ type: 'SUBSCRIPTION_STARTED', plan: 'STARTER' }),
    ]
    const s = reduceBillingEvents(events)
    expect(s.status).toBe('ACTIVE')
    expect(s.canceledAt).toBeNull()
  })
})

describe('事件形状校验（400 与 409 必须分开）', () => {
  it('PLAN_CHANGED 缺 plan → 400', () => {
    const events = [ev({ type: 'SUBSCRIPTION_STARTED', plan: 'STARTER' }), ev({ type: 'PLAN_CHANGED' })]
    expect(() => reduceBillingEvents(events)).toThrow(ValidationError)
  })

  it('CHARGE_SUCCEEDED 缺 chargeId → 400', () => {
    const events = [ev({ type: 'SUBSCRIPTION_STARTED', plan: 'STARTER' }), ev({ type: 'CHARGE_SUCCEEDED' })]
    expect(() => reduceBillingEvents(events)).toThrow(ValidationError)
  })

  it('CHARGE_FAILED 缺 reason → 400（失败原因要留痕）', () => {
    const events = [
      ev({ type: 'SUBSCRIPTION_STARTED', plan: 'STARTER' }),
      ev({ type: 'CHARGE_CREATED', chargeId: 'ch_1', amountCents: 100 }),
      ev({ type: 'CHARGE_FAILED', chargeId: 'ch_1' }),
    ]
    expect(() => reduceBillingEvents(events)).toThrow(ValidationError)
  })

  it('CHARGE_CREATED 金额为负 → 400', () => {
    const events = [
      ev({ type: 'SUBSCRIPTION_STARTED', plan: 'STARTER' }),
      ev({ type: 'CHARGE_CREATED', chargeId: 'ch_1', amountCents: -1 }),
    ]
    expect(() => reduceBillingEvents(events)).toThrow(ValidationError)
  })

  it('未知事件类型 → 400', () => {
    const events = [ev({ type: 'NOT_A_REAL_TYPE' as never })]
    expect(() => reduceBillingEvents(events)).toThrow(ValidationError)
  })
})

describe('定序与纯函数性', () => {
  it('乱序传入同一批事件 → 结果完全相同（定序是显式的）', () => {
    const events = startedAndPaid('STARTER', 9900)
    const a = reduceBillingEvents(events)
    const b = reduceBillingEvents([events[2], events[0], events[1]])
    expect(b).toEqual(a)
  })

  it('同一时间戳时用 id 兜底，保证全序稳定', () => {
    const t = '2026-10-01T00:00:00.000Z'
    const x = ev({ id: 'be_a', type: 'SUBSCRIPTION_STARTED', plan: 'STARTER', occurredAt: t, createdAt: t })
    const y = ev({ id: 'be_b', type: 'PLAN_CHANGED', plan: 'GROWTH', occurredAt: t, createdAt: t })
    expect(compareBillingEvents(x, y)).toBeLessThan(0)
    expect(compareBillingEvents(y, x)).toBeGreaterThan(0)
    // 两种传入顺序结果一致
    expect(reduceBillingEvents([y, x])).toEqual(reduceBillingEvents([x, y]))
  })

  it('不修改入参数组（纯函数）', () => {
    const events = [ev({ type: 'SUBSCRIPTION_STARTED', plan: 'STARTER' }), ev({ type: 'PLAN_CHANGED', plan: 'SCALE' })]
    const snapshot = JSON.stringify(events)
    reduceBillingEvents(events)
    expect(JSON.stringify(events)).toBe(snapshot)
  })

  it('同输入必同输出', () => {
    const events = startedAndPaid('GROWTH', 19900)
    expect(reduceBillingEvents(events)).toEqual(reduceBillingEvents(events))
  })

  it('非法事件不会被"写进去"：抛错后原始数组里没有新条目', () => {
    const events = [ev({ type: 'SUBSCRIPTION_STARTED', plan: 'STARTER' })]
    expect(() => reduceBillingEvents([...events, ev({ type: 'SUBSCRIPTION_STARTED', plan: 'GROWTH' })])).toThrow()
    expect(events).toHaveLength(1)
  })
})

describe('辅助判据', () => {
  it('isSubscriptionLive：ACTIVE 与 PAST_DUE 都算"订阅中"（宽限期），NONE/CANCELED/REFUNDED 不算', () => {
    expect(isSubscriptionLive('ACTIVE')).toBe(true)
    expect(isSubscriptionLive('PAST_DUE')).toBe(true)
    expect(isSubscriptionLive('NONE')).toBe(false)
    expect(isSubscriptionLive('CANCELED')).toBe(false)
    expect(isSubscriptionLive('REFUNDED')).toBe(false)
  })

  it('hasPendingCharge：有未结清款项时为 true', () => {
    const withPending = reduceBillingEvents([
      ev({ type: 'SUBSCRIPTION_STARTED', plan: 'STARTER' }),
      ev({ type: 'CHARGE_CREATED', chargeId: 'ch_1', amountCents: 100 }),
    ])
    expect(hasPendingCharge(withPending)).toBe(true)
    expect(hasPendingCharge(reduceBillingEvents(startedAndPaid()))).toBe(false)
  })
})
