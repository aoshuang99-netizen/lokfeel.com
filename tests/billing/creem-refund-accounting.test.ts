/**
 * B-8（P1）退款对账断裂 —— 回归测试
 *
 * 背景：`refund.created` 的事件对象只带 `last_transaction_id`（tran_xxx），
 * 而**首购**入账用的幂等键是 `creem:checkout:<checkout id>`（见 `idempotencyKeyOf`）。
 * 两个键族不同 ⇒ 首购退款永远匹配不到原账单，只打一条 warn 就 200 返回：
 *   钱退出去了，账本仍是 SUCCEEDED，管理员报表照样把这笔算成收入。
 *
 * 另外 `isMonetaryKind('refund') === true`、`idempotencyKeyOf('refund')` 也有实现，
 * 但路由在退款分支提前 return，这两段**是死代码** ⇒ 退款自身从不落账，重放无法去重。
 *
 * 本测试锁住三件事：
 *   1. 键族不同也能追到原账单（回落：该用户最近一笔同币种 SUCCEEDED 且金额可覆盖）；
 *   2. 原账单翻 REFUNDED（报表随之剔除）；
 *   3. 退款自身以 `creem:refund:<id>` 落账（负数），重放只落一次。
 */

jest.mock('@/lib/db', () => ({
  db: {
    payment: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    subscription: { findFirst: jest.fn(), update: jest.fn(), create: jest.fn() },
  },
}))

jest.mock('@/lib/creem', () => ({ verifyCreemWebhookSignature: jest.fn(() => true) }))

jest.mock('@/lib/payments/availability', () => ({
  isPaymentChannelReady: jest.fn(() => false),
  missingForChannel: jest.fn(() => ['CREEM_WEBHOOK_SECRET']),
}))

jest.mock('@/lib/payments/not-configured', () => ({
  paymentNotConfigured: jest.fn(() =>
    new Response(JSON.stringify({ error: 'PAYMENT_NOT_CONFIGURED' }), { status: 503 })
  ),
}))

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { POST } from '@/app/api/webhooks/creem/route'

const paymentFindFirst = db.payment.findFirst as unknown as jest.Mock
const paymentCreate = db.payment.create as unknown as jest.Mock
const paymentUpdate = db.payment.update as unknown as jest.Mock
const subFindFirst = db.subscription.findFirst as unknown as jest.Mock

function post(body: unknown) {
  return POST(
    new NextRequest(new URL('/api/webhooks/creem', 'http://localhost'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'creem-signature': 'mock_signature_for_testing' },
      body: JSON.stringify(body),
    })
  )
}

/** 首购账单：键族是 checkout，不是 tran。 */
const CHECKOUT_PAYMENT = {
  id: 'p_checkout',
  userId: 'u_1',
  stripePaymentIntentId: 'creem:checkout:chk_9',
  amount: 29,
  currency: 'usd',
  status: 'SUCCEEDED',
  description: 'Creem checkout: PREMIUM_MONTHLY',
}

beforeEach(() => {
  jest.clearAllMocks()
  // 没有本地订阅也要能走到退款分支：退款只认 userId
  subFindFirst.mockResolvedValue(null)
})

describe('B-8 首购退款对账', () => {
  it('退款只带 tran 键时，仍能追到 checkout 键的原账单并翻 REFUNDED', async () => {
    paymentFindFirst.mockImplementation(async ({ where }: { where: Record<string, any> }) => {
      if (where.stripePaymentIntentId === 'creem:refund:ref_9') return null
      if (where.stripePaymentIntentId === 'creem:tran:tran_9') return null // 键族不匹配
      if (where.userId === 'u_1') return CHECKOUT_PAYMENT // 回落命中
      return null
    })

    const res = await post({
      id: 'evt_refund_9',
      eventType: 'refund.created',
      object: {
        id: 'ref_9',
        amount: 2900, // 分
        currency: 'usd',
        last_transaction_id: 'tran_9',
        metadata: { userId: 'u_1' },
      },
    })

    expect(res.status).toBe(200)
    const updated = paymentUpdate.mock.calls.map((c) => c[0])
    const flipped = updated.find((u) => u.where?.id === 'p_checkout')
    expect(flipped).toBeDefined()
    expect(flipped!.data.status).toBe('REFUNDED')
  })

  it('退款自身落账：键 creem:refund:<id>、状态 REFUNDED、金额为负', async () => {
    paymentFindFirst.mockImplementation(async ({ where }: { where: Record<string, any> }) => {
      if (where.stripePaymentIntentId === 'creem:refund:ref_9') return null
      if (where.stripePaymentIntentId === 'creem:tran:tran_9') return CHECKOUT_PAYMENT
      if (where.userId === 'u_1') return CHECKOUT_PAYMENT
      return null
    })

    const res = await post({
      id: 'evt_refund_9',
      eventType: 'refund.created',
      object: {
        id: 'ref_9',
        amount: 2900,
        currency: 'usd',
        last_transaction_id: 'tran_9',
        metadata: { userId: 'u_1' },
      },
    })

    expect(res.status).toBe(200)
    expect(paymentCreate).toHaveBeenCalledTimes(1)
    const row = paymentCreate.mock.calls[0][0].data
    expect(row.stripePaymentIntentId).toBe('creem:refund:ref_9')
    expect(row.status).toBe('REFUNDED')
    expect(Number(row.amount)).toBeLessThan(0)
  })

  it('同一退款重放：不二次落账、不二次翻单', async () => {
    paymentFindFirst.mockImplementation(async ({ where }: { where: Record<string, any> }) => {
      if (where.stripePaymentIntentId === 'creem:refund:ref_9') {
        return { id: 'p_refund', status: 'REFUNDED' }
      }
      return CHECKOUT_PAYMENT
    })

    const res = await post({
      id: 'evt_refund_9',
      eventType: 'refund.created',
      object: {
        id: 'ref_9',
        amount: 2900,
        currency: 'usd',
        last_transaction_id: 'tran_9',
        metadata: { userId: 'u_1' },
      },
    })

    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.duplicate).toBe(true)
    expect(paymentCreate).not.toHaveBeenCalled()
    expect(paymentUpdate).not.toHaveBeenCalled()
  })
})
