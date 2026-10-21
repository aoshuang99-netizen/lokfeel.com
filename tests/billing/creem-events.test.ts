/**
 * V17 · Creem 事件映射（WB17-02 / PAY-04 ~ PAY-06）
 *
 * 纯函数测试：不起 DB、不联网。重点是**穷举**官方 17 个事件类型，
 * 证明"已知的都被处理、未知的显式落 unknown"，而不是靠 default 吞掉。
 */

import {
  CREEM_KNOWN_EVENTS,
  QUARTERLY_PERIOD_DAYS,
  classifyCreemEvent,
  creemObjectOf,
  customerIdOf,
  idempotencyKeyOf,
  isEntitled,
  isMonetaryKind,
  isStaleDowngrade,
  periodEndForPlan,
  periodEndOf,
  planOf,
  statusForKind,
  subscriptionIdOf,
  transactionIdOf,
  userIdOf,
} from '@/lib/payments/creem-events'

describe('事件目录完整性', () => {
  it('前置非空：官方事件清单至少 15 条（空集会让下面的断言恒真）', () => {
    expect(CREEM_KNOWN_EVENTS.length).toBeGreaterThanOrEqual(15)
  })

  it('每一个官方事件都能被分类（不得落到 unknown）', () => {
    for (const eventType of CREEM_KNOWN_EVENTS) {
      expect({ eventType, kind: classifyCreemEvent(eventType) }).not.toEqual({
        eventType,
        kind: 'unknown',
      })
    }
  })

  it('原实现里的四个死分支现在被识别为 unknown（它们是 Stripe 词汇）', () => {
    for (const dead of [
      'subscription.created',
      'subscription.cancelled',
      'payment.succeeded',
      'payment.failed',
    ]) {
      expect(classifyCreemEvent(dead)).toBe('unknown')
    }
  })

  it('续费由 subscription.paid 承担（不存在 subscription.renewal）', () => {
    expect(classifyCreemEvent('subscription.paid')).toBe('renew')
    expect(classifyCreemEvent('subscription.renewal')).toBe('unknown')
  })
})

describe('事件 → 状态', () => {
  it('开通与续费都归 ACTIVE', () => {
    expect(statusForKind('activate')).toBe('ACTIVE')
    expect(statusForKind('renew')).toBe('ACTIVE')
  })

  it('期末取消仍保持 ACTIVE（期内还有权）', () => {
    expect(statusForKind('cancel_scheduled')).toBe('ACTIVE')
  })

  it('取消/过期/逾期/暂停各自落到对应状态', () => {
    expect(statusForKind('cancel')).toBe('CANCELLED')
    expect(statusForKind('expire')).toBe('EXPIRED')
    expect(statusForKind('past_due')).toBe('PAST_DUE')
    expect(statusForKind('unpaid')).toBe('PAST_DUE')
    // 枚举无 PAUSED，有损映射到 PAST_DUE（宁可停权也不能继续白送）
    expect(statusForKind('pause')).toBe('PAST_DUE')
  })

  it('退款不改订阅状态（退一期 ≠ 退订）', () => {
    expect(statusForKind('refund')).toBeNull()
  })

  it('只有开通/续费/退款动钱', () => {
    const monetary = ['activate', 'renew', 'refund']
    for (const kind of ['trial', 'cancel', 'past_due', 'expire', 'pause', 'ignored'] as const) {
      expect({ kind, monetary: isMonetaryKind(kind) }).toEqual({ kind, monetary: false })
    }
    for (const kind of monetary) {
      expect(isMonetaryKind(kind as 'activate' | 'renew' | 'refund')).toBe(true)
    }
  })

  it('权益判定：只有 ACTIVE / TRIALING 发权益', () => {
    expect(isEntitled('ACTIVE')).toBe(true)
    expect(isEntitled('TRIALING')).toBe(true)
    expect(isEntitled('PAST_DUE')).toBe(false)
    expect(isEntitled('CANCELLED')).toBe(false)
    expect(isEntitled('EXPIRED')).toBe(false)
  })
})

describe('幂等键（PAY-03 的核心）', () => {
  const renew = {
    id: 'evt_2',
    object: { id: 'sub_1', last_transaction_id: 'tran_2' },
  }

  it('续费以交易 id 为键 —— 不同期的续费必须是不同的键', () => {
    const first = idempotencyKeyOf('renew', { id: 'evt_1' }, { id: 'sub_1', last_transaction_id: 'tran_1' })
    const second = idempotencyKeyOf('renew', renew, renew.object)
    expect(first).toBe('creem:tran:tran_1')
    expect(second).toBe('creem:tran:tran_2')
    expect(first).not.toBe(second)
  })

  it('同一事件重放 → 同一个键（PAY-03：只入账一次）', () => {
    expect(idempotencyKeyOf('renew', renew, renew.object)).toBe(
      idempotencyKeyOf('renew', renew, renew.object)
    )
  })

  it('🔴 反例对照：若用订阅 id 当键（旧实现），两期续费会撞键', () => {
    const legacyKey = renew.object.id // sub_1
    const secondLegacyKey = 'sub_1'
    expect(legacyKey).toBe(secondLegacyKey) // 这正是"第二期被当重复"的机制
  })

  it('开通以 checkout 对象 id 为键；缺 id 时退化到事件 id', () => {
    expect(idempotencyKeyOf('activate', { id: 'evt_9' }, { id: 'ch_1' })).toBe('creem:checkout:ch_1')
    expect(idempotencyKeyOf('activate', { id: 'evt_9' }, {})).toBe('creem:evt:evt_9')
  })

  it('退款以退款对象 id 为键，绝不复用原交易键', () => {
    const key = idempotencyKeyOf('refund', { id: 'evt_r' }, { id: 'ref_1' })
    expect(key).toBe('creem:refund:ref_1')
    expect(key).not.toBe('creem:tran:tran_1')
  })
})

describe('乱序保护（PAY-04）', () => {
  const jan = new Date('2026-01-01T00:00:00Z')
  const dec = new Date('2026-12-01T00:00:00Z')

  it('迟到的 past_due（周期更早）→ 判为陈旧', () => {
    expect(isStaleDowngrade('past_due', jan, dec)).toBe(true)
    expect(isStaleDowngrade('unpaid', jan, dec)).toBe(true)
    expect(isStaleDowngrade('expire', jan, dec)).toBe(true)
  })

  it('升级类事件永远接受（迟到的好消息不该丢）', () => {
    expect(isStaleDowngrade('renew', jan, dec)).toBe(false)
    expect(isStaleDowngrade('activate', jan, dec)).toBe(false)
  })

  it('缺任一侧时间 → 不做乱序推断（不能凭猜测拦截）', () => {
    expect(isStaleDowngrade('past_due', null, dec)).toBe(false)
    expect(isStaleDowngrade('past_due', jan, null)).toBe(false)
  })
})

describe('载荷字段提取', () => {
  const event = {
    id: 'evt_1',
    eventType: 'subscription.paid',
    object: {
      id: 'sub_1',
      customer: { id: 'cus_1' },
      last_transaction_id: 'tran_1',
      current_period_end_date: '2026-11-21T00:00:00.000Z',
      metadata: { userId: 'u_1', plan: 'PREMIUM_MONTHLY' },
    },
  }
  const obj = creemObjectOf(event)

  it('customer 既可能是对象也可能是字符串', () => {
    expect(customerIdOf(obj)).toBe('cus_1')
    expect(customerIdOf({ customer: 'cus_2' })).toBe('cus_2')
  })

  it('订阅/交易/用户/套餐都能取出', () => {
    expect(subscriptionIdOf(obj)).toBe('sub_1')
    expect(transactionIdOf(obj)).toBe('tran_1')
    expect(userIdOf(obj)).toBe('u_1')
    expect(planOf(obj)).toBe('PREMIUM_MONTHLY')
  })

  it('周期结束时间兼容 ISO 字符串与毫秒时间戳', () => {
    expect(periodEndOf(obj)?.toISOString()).toBe('2026-11-21T00:00:00.000Z')
    expect(periodEndOf({ current_period_end_date: 1763683200000 })?.getTime()).toBe(1763683200000)
  })

  it('缺字段一律返回 null，不抛异常（webhook 不能被脏载荷打挂）', () => {
    expect(subscriptionIdOf({})).toBeNull()
    expect(customerIdOf({})).toBeNull()
    expect(periodEndOf({})).toBeNull()
    expect(creemObjectOf(null)).toEqual({})
    expect(creemObjectOf({ object: 'not-an-object' })).toEqual({})
  })
})

describe('季度套餐周期', () => {
  it('季度按 92 天计算（枚举无季度值，周期单独表达）', () => {
    const from = new Date('2026-01-01T00:00:00Z')
    const end = periodEndForPlan('PREMIUM_QUARTERLY', from)
    expect(end.getTime() - from.getTime()).toBe(QUARTERLY_PERIOD_DAYS * 24 * 60 * 60 * 1000)
  })

  it('月付 30 天 / 年付 365 天', () => {
    const from = new Date('2026-01-01T00:00:00Z')
    expect(periodEndForPlan('PREMIUM_MONTHLY', from).getTime() - from.getTime()).toBe(30 * 86400000)
    expect(periodEndForPlan('PREMIUM_YEARLY', from).getTime() - from.getTime()).toBe(365 * 86400000)
  })
})
