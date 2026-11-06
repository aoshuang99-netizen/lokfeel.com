/**
 * V20.4 · PingPong webhook 失败模式测试
 *
 * 🔴 本文件钉住四件事（全部来自一次真实生产探测）：
 *   1. **通道未配置 → 503，不是 500**。生产实测 `POST /api/webhooks/pingpong`
 *      曾返回 `500 {"error":"Webhook processing failed"}`，根因是 `createHmac`
 *      用 `undefined` 当密钥**在 try 之外同步抛 TypeError**。500 会让任何人
 *      构造一个 POST 就稳定触发异常，也让"没配"看起来像"坏了"。
 *   2. **验签函数不许有抛异常这种失败模式**：缺密钥 / 缺签名一律 `false`。
 *   3. **错签名 → 401，且不写库**。
 *   4. **日志不落完整报文**：回调包含金额、交易号、商户单号。
 *
 * ⚠️ 这些断言只在「生产确实是这个状态」时有意义，所以每条都带**反例**：
 *    配了密钥时不能继续返回 503（否则等于把通道阉割了还自测通过）。
 */

jest.mock('@/lib/db', () => ({
  db: {
    payment: { findFirst: jest.fn(), update: jest.fn() },
    subscription: { findFirst: jest.fn(), update: jest.fn() },
    refund: { findFirst: jest.fn(), update: jest.fn() },
  },
}))

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { PingPongClient } from '@/lib/pingpong'
import * as route from '@/app/api/webhooks/pingpong/route'

const BODY = JSON.stringify({
  eventType: 'PAYMENT_SUCCESS',
  merchantTransactionId: 'probe-invalid',
  transactionId: 'tx-1',
  amount: 1999,
  currency: 'USD',
  status: 'SUCCESS',
})

function post(signature?: string): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (signature !== undefined) headers['X-Signature'] = signature
  return new NextRequest('https://app.lokfeel.com/api/webhooks/pingpong', {
    method: 'POST',
    headers,
    body: BODY,
  })
}

describe('POST /api/webhooks/pingpong · 失败模式', () => {
  const saved = { ...process.env }
  let logSpy: jest.SpyInstance

  beforeEach(() => {
    jest.clearAllMocks()
    delete process.env.PINGPONG_WEBHOOK_SECRET
    delete process.env.PINGPONG_API_KEY
    delete process.env.PINGPONG_API_SECRET
    delete process.env.PINGPONG_MERCHANT_ID
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
    jest.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    process.env = { ...saved }
    logSpy.mockRestore()
    jest.restoreAllMocks()
  })

  it('缺 secret → 503（不是 500），且完全不碰数据库', async () => {
    const res = await route.POST(post('deadbeef'))

    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toEqual({ error: 'Payment channel disabled' })
    expect(db.payment.findFirst).not.toHaveBeenCalled()
    expect(db.payment.update).not.toHaveBeenCalled()
  })

  it('反例：配了 secret 就绝不能继续 503（否则等于通道被永久阉割还自测通过）', async () => {
    const { createHmac } = await import('crypto')
    process.env.PINGPONG_WEBHOOK_SECRET = 'test-webhook-secret'
    const good = createHmac('sha256', 'test-webhook-secret').update(BODY).digest('hex')

    const res = await route.POST(post(good))

    expect(res.status).not.toBe(503)
    expect(res.status).toBe(200)
  })

  it('错签名 → 401，且不写库', async () => {
    process.env.PINGPONG_WEBHOOK_SECRET = 'test-webhook-secret'

    const res = await route.POST(post('deadbeef'))

    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toEqual({ error: 'Invalid signature' })
    expect(db.payment.update).not.toHaveBeenCalled()
  })

  it('缺签名头 → 401（不能因为"没带"就跳过校验）', async () => {
    process.env.PINGPONG_WEBHOOK_SECRET = 'test-webhook-secret'

    const res = await route.POST(post(undefined))

    expect(res.status).toBe(401)
  })

  it('日志不落完整报文：金额/交易号不得出现在日志里', async () => {
    process.env.PINGPONG_WEBHOOK_SECRET = 'test-webhook-secret'

    await route.POST(post('deadbeef'))

    const logged = logSpy.mock.calls.map((c) => c.join(' ')).join('\n')
    expect(logged).not.toContain('probe-invalid')
    expect(logged).not.toContain('1999')
    // 但仍要能定位问题：长度与签名状态必须有
    expect(logged).toContain('signature=present')
  })
})

describe('PingPongClient.verifyWebhookSignature · 不许抛异常', () => {
  const saved = { ...process.env }

  afterEach(() => {
    process.env = { ...saved }
  })

  function client(): PingPongClient {
    process.env.PINGPONG_API_KEY = 'k'
    process.env.PINGPONG_API_SECRET = 's'
    process.env.PINGPONG_MERCHANT_ID = 'm'
    return new PingPongClient({
      apiKey: 'k',
      apiSecret: 's',
      merchantId: 'm',
      env: 'sandbox',
    })
  }

  it('缺 secret 时返回 false，而不是抛 TypeError', () => {
    delete process.env.PINGPONG_WEBHOOK_SECRET
    expect(() => client().verifyWebhookSignature('{}', 'abc')).not.toThrow()
    expect(client().verifyWebhookSignature('{}', 'abc')).toBe(false)
  })

  it('缺签名时返回 false', () => {
    process.env.PINGPONG_WEBHOOK_SECRET = 'test-webhook-secret'
    expect(client().verifyWebhookSignature('{}', '')).toBe(false)
  })

  it('长度不匹配的签名返回 false（timingSafeEqual 会抛，必须被吞掉）', () => {
    process.env.PINGPONG_WEBHOOK_SECRET = 'test-webhook-secret'
    expect(client().verifyWebhookSignature('{}', 'ab')).toBe(false)
  })

  it('正确签名返回 true（反例：不能为了"永远不抛"而永远返回 false）', async () => {
    const { createHmac } = await import('crypto')
    process.env.PINGPONG_WEBHOOK_SECRET = 'test-webhook-secret'
    const good = createHmac('sha256', 'test-webhook-secret').update('{}').digest('hex')
    expect(client().verifyWebhookSignature('{}', good)).toBe(true)
  })
})
