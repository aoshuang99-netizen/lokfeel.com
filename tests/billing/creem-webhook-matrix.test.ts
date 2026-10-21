/**
 * V17 · Creem Webhook 路由矩阵（WB17-02 / PAY-03 ~ PAY-06）
 *
 * 这里验证的是**路由层的行为**：状态迁移、幂等、乱序、未知事件不重试。
 * 纯映射规则另见 `tests/billing/creem-events.test.ts`。
 *
 * 使用 mock 签名旁路（`mock_signature_for_testing`）：只在 `NODE_ENV !== production`
 * 且**未配置**真实 secret 时生效 —— 这条安全闸本身也有一条断言。
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
const subUpdate = db.subscription.update as unknown as jest.Mock
const subCreate = db.subscription.create as unknown as jest.Mock

const OLD_END = new Date('2026-10-21T00:00:00Z')
const NEW_END = new Date('2026-11-21T00:00:00Z')

function post(body: unknown, signature: string | null = 'mock_signature_for_testing') {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (signature) headers['creem-signature'] = signature
  return POST(
    new NextRequest(new URL('/api/webhooks/creem', 'http://localhost'), {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })
  )
}

function existingSub(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub_row',
    userId: 'u_1',
    plan: 'PREMIUM_MONTHLY',
    status: 'ACTIVE',
    stripeSubscriptionId: 'sub_1',
    stripeCurrentPeriodEnd: OLD_END,
    ...overrides,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  delete process.env.CREEM_WEBHOOK_SECRET
  paymentFindFirst.mockResolvedValue(null)
  paymentCreate.mockResolvedValue({ id: 'p_1' })
  paymentUpdate.mockResolvedValue({ id: 'p_1' })
  subFindFirst.mockResolvedValue(existingSub())
  subUpdate.mockResolvedValue({ id: 'sub_row' })
  subCreate.mockResolvedValue({ id: 'sub_row' })
})

afterAll(() => {
  delete process.env.CREEM_WEBHOOK_SECRET
})

describe('安全闸', () => {
  it('配置了真实 secret 后，mock 签名必须被拒（401）', async () => {
    process.env.CREEM_WEBHOOK_SECRET = 'whsec_real'
    const res = await post({ id: 'evt_1', eventType: 'subscription.paid', object: {} })
    expect(res.status).toBe(401)
    expect(paymentCreate).not.toHaveBeenCalled()
  })

  it('通道未配置 → 503（未接入语义，不是 500）', async () => {
    // ⚠️ 想测到 503 必须**先关掉 mock 旁路**：`allowMock = !isProd && !secret`，
    //    只要 secret 为空，mock 旁路就是开的，请求根本走不到 channel 判定那一步
    //    （无签名会先被 400 拦下）。这里给一个非 mock 签名 + 真实 secret，
    //    签名校验本身被 mock 成恒真，于是唯一剩下的拦截点就是 channel 未就绪。
    process.env.CREEM_WEBHOOK_SECRET = 'whsec_real'
    const res = await post({ id: 'evt_1', eventType: 'subscription.paid', object: {} }, 'sha256=deadbeef')
    expect(res.status).toBe(503)
    expect(paymentCreate).not.toHaveBeenCalled()
  })

  it('无签名 → 400（mock 旁路只放行 mock 签名，不会放过"没有签名"）', async () => {
    const res = await post({ id: 'evt_1', eventType: 'subscription.paid', object: {} }, null)
    expect(res.status).toBe(400)
  })
})

describe('续费：subscription.paid（原实现完全没处理）', () => {
  const renewal = {
    id: 'evt_renew_2',
    eventType: 'subscription.paid',
    object: {
      id: 'sub_1',
      last_transaction_id: 'tran_2',
      amount: 1299,
      currency: 'usd',
      current_period_end_date: NEW_END.toISOString(),
      metadata: { userId: 'u_1', plan: 'PREMIUM_MONTHLY' },
    },
  }

  it('入账 + 推进周期 + 保持 ACTIVE', async () => {
    const res = await post(renewal)
    expect(res.status).toBe(200)

    const payment = paymentCreate.mock.calls[0][0].data
    expect(payment.stripePaymentIntentId).toBe('creem:tran:tran_2')
    expect(payment.amount).toBe(12.99) // 1299 分 → 12.99 元
    expect(payment.status).toBe('SUCCEEDED')

    const update = subUpdate.mock.calls[0][0]
    expect(update.where.id).toBe('sub_row')
    expect(update.data.status).toBe('ACTIVE')
    expect(update.data.stripeCurrentPeriodEnd).toEqual(NEW_END)
  })

  it('🔴 同一交易重放 → 不重复入账、不改状态（PAY-03）', async () => {
    paymentFindFirst.mockResolvedValueOnce({ id: 'p_existing' })

    const res = await post(renewal)
    const body = (await res.json()) as { duplicate?: boolean }

    expect(body.duplicate).toBe(true)
    expect(paymentCreate).not.toHaveBeenCalled()
    expect(subUpdate).not.toHaveBeenCalled()
  })

  it('第二阶段续费（tran_3）不会被当成 tran_2 的重复', async () => {
    paymentFindFirst.mockResolvedValue(null)
    await post(renewal)
    await post({
      ...renewal,
      id: 'evt_renew_3',
      object: { ...renewal.object, last_transaction_id: 'tran_3' },
    })

    const keys = paymentCreate.mock.calls.map((c) => c[0].data.stripePaymentIntentId)
    expect(keys).toEqual(['creem:tran:tran_2', 'creem:tran:tran_3'])
  })
})

describe('乱序保护', () => {
  it('迟到的 past_due（周期早于当前）→ 忽略，不降级（PAY-04）', async () => {
    subFindFirst.mockResolvedValue(existingSub({ stripeCurrentPeriodEnd: NEW_END }))

    const res = await post({
      id: 'evt_late',
      eventType: 'subscription.past_due',
      object: {
        id: 'sub_1',
        current_period_end_date: OLD_END.toISOString(),
        metadata: { userId: 'u_1' },
      },
    })
    const body = (await res.json()) as { ignored?: string }

    expect(body.ignored).toBe('stale')
    expect(subUpdate).not.toHaveBeenCalled()
  })

  it('同周期的 past_due 正常降级（乱序保护不能顺手吞掉真事件）', async () => {
    subFindFirst.mockResolvedValue(existingSub({ stripeCurrentPeriodEnd: OLD_END }))

    await post({
      id: 'evt_pd',
      eventType: 'subscription.past_due',
      object: {
        id: 'sub_1',
        current_period_end_date: OLD_END.toISOString(),
        metadata: { userId: 'u_1' },
      },
    })

    expect(subUpdate.mock.calls[0][0].data.status).toBe('PAST_DUE')
  })
})

describe('取消 / 过期', () => {
  it('subscription.canceled → CANCELLED 且写 cancelledAt', async () => {
    await post({
      id: 'evt_cancel',
      eventType: 'subscription.canceled',
      object: { id: 'sub_1', metadata: { userId: 'u_1' } },
    })

    const data = subUpdate.mock.calls[0][0].data
    expect(data.status).toBe('CANCELLED')
    expect(data.cancelledAt).toBeInstanceOf(Date)
  })

  it('subscription.expired → EXPIRED', async () => {
    await post({
      id: 'evt_exp',
      eventType: 'subscription.expired',
      object: { id: 'sub_1', metadata: { userId: 'u_1' } },
    })
    expect(subUpdate.mock.calls[0][0].data.status).toBe('EXPIRED')
  })

  it('subscription.scheduled_cancel → 仍为 ACTIVE（期内还有权）', async () => {
    await post({
      id: 'evt_sc',
      eventType: 'subscription.scheduled_cancel',
      object: { id: 'sub_1', metadata: { userId: 'u_1' } },
    })
    expect(subUpdate.mock.calls[0][0].data.status).toBe('ACTIVE')
  })
})

describe('退款', () => {
  it('refund.created → 原账单翻 REFUNDED，订阅状态不动', async () => {
    paymentFindFirst.mockResolvedValueOnce({ id: 'p_1', description: 'Creem checkout' })

    const res = await post({
      id: 'evt_refund',
      eventType: 'refund.created',
      object: { id: 'ref_1', last_transaction_id: 'tran_2', metadata: { userId: 'u_1' } },
    })

    expect(res.status).toBe(200)
    const update = paymentUpdate.mock.calls[0][0]
    expect(update.where.id).toBe('p_1')
    expect(update.data.status).toBe('REFUNDED')
    expect(subUpdate).not.toHaveBeenCalled()
  })
})

describe('死分支与未知事件', () => {
  it('旧实现里的 payment.succeeded 属于未知事件 → 200 忽略，绝不重试（PAY-01 相关）', async () => {
    const res = await post({
      id: 'evt_dead',
      eventType: 'payment.succeeded',
      object: { id: 'x', metadata: { userId: 'u_1' } },
    })
    const body = (await res.json()) as { ignored?: string }

    expect(res.status).toBe(200)
    expect(body.ignored).toBe('unknown_event')
    expect(paymentCreate).not.toHaveBeenCalled()
    expect(subUpdate).not.toHaveBeenCalled()
  })

  it('无法归属到本地账号 → 200 忽略（避免 Creem 重试风暴）', async () => {
    subFindFirst.mockResolvedValue(null)
    const res = await post({
      id: 'evt_orphan',
      eventType: 'subscription.paid',
      object: { id: 'sub_unknown', last_transaction_id: 'tran_x' },
    })
    const body = (await res.json()) as { ignored?: string }

    expect(res.status).toBe(200)
    expect(body.ignored).toBe('no_user')
    expect(paymentCreate).not.toHaveBeenCalled()
  })

  it('credits.granted 明确忽略（属于已知但不动订阅）', async () => {
    const res = await post({
      id: 'evt_credits',
      eventType: 'credits.granted',
      object: { metadata: { userId: 'u_1' } },
    })
    const body = (await res.json()) as { ignored?: string }
    expect(body.ignored).toBe('credits.granted')
    expect(subUpdate).not.toHaveBeenCalled()
  })
})
