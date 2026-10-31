/**
 * B-16 / B-17 / B-18 回归测试
 *
 * 修的是三个「只有真实收钱那天才会显现」的缺陷：
 *   B-16 年付被记成月付（metadata.plan="dynamic" 落不进白名单）
 *   B-17 幂等键含时间戳 ⇒ 判重永久失效
 *   B-18 zod .refine 回调返回对象 ⇒ 约束从未生效
 */

import {
  CHECKOUT_IDEMPOTENCY_WINDOW_MS,
  checkoutRequestId,
  planFromProductId,
  productIdForPlan,
  resolveCheckoutTarget,
  resolveWebhookPlan,
} from '@/lib/payments/creem-plan-resolve'

const ENV = {
  CREEM_MONTHLY_PRODUCT_ID: 'prod_month_123',
  CREEM_YEARLY_PRODUCT_ID: 'prod_year_456',
}

describe('planFromProductId', () => {
  it('maps the registered monthly / yearly products', () => {
    expect(planFromProductId('prod_month_123', ENV)).toBe('PREMIUM_MONTHLY')
    expect(planFromProductId('prod_year_456', ENV)).toBe('PREMIUM_YEARLY')
  })

  it('trims whitespace instead of silently failing', () => {
    expect(planFromProductId('  prod_year_456  ', ENV)).toBe('PREMIUM_YEARLY')
  })

  it('returns null for unknown products (never guesses a plan)', () => {
    expect(planFromProductId('prod_attacker_999', ENV)).toBeNull()
    expect(planFromProductId('', ENV)).toBeNull()
    expect(planFromProductId(null, ENV)).toBeNull()
    expect(planFromProductId(undefined, ENV)).toBeNull()
    expect(planFromProductId(42, ENV)).toBeNull()
  })

  it('returns null when env is not configured at all', () => {
    expect(planFromProductId('prod_year_456', {})).toBeNull()
  })

  it('prefers yearly when both env vars accidentally point at the same product', () => {
    expect(
      planFromProductId('prod_same', {
        CREEM_MONTHLY_PRODUCT_ID: 'prod_same',
        CREEM_YEARLY_PRODUCT_ID: 'prod_same',
      }),
    ).toBe('PREMIUM_YEARLY')
  })
})

describe('productIdForPlan', () => {
  it('resolves each plan to its env product id', () => {
    expect(productIdForPlan('PREMIUM_MONTHLY', ENV)).toBe('prod_month_123')
    expect(productIdForPlan('PREMIUM_YEARLY', ENV)).toBe('prod_year_456')
  })

  it('returns null when the plan has no configured product', () => {
    expect(productIdForPlan('PREMIUM_MONTHLY', {})).toBeNull()
    expect(productIdForPlan('PREMIUM_YEARLY', { CREEM_MONTHLY_PRODUCT_ID: 'x' })).toBeNull()
  })
})

describe('resolveCheckoutTarget (B-16 核心)', () => {
  it('accepts plan-only and resolves the product from env', () => {
    expect(resolveCheckoutTarget({ plan: 'PREMIUM_YEARLY' }, ENV)).toEqual({
      ok: true,
      plan: 'PREMIUM_YEARLY',
      productId: 'prod_year_456',
    })
  })

  it('accepts productId-only and derives the plan locally (no "dynamic")', () => {
    expect(resolveCheckoutTarget({ productId: 'prod_year_456' }, ENV)).toEqual({
      ok: true,
      plan: 'PREMIUM_YEARLY',
      productId: 'prod_year_456',
    })
  })

  it('accepts a consistent plan + productId pair', () => {
    const r = resolveCheckoutTarget({ plan: 'PREMIUM_MONTHLY', productId: 'prod_month_123' }, ENV)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.plan).toBe('PREMIUM_MONTHLY')
  })

  it('rejects a plan/product mismatch (前端不能拿月付价买年付商品)', () => {
    const r = resolveCheckoutTarget({ plan: 'PREMIUM_MONTHLY', productId: 'prod_year_456' }, ENV)
    expect(r).toEqual({
      ok: false,
      reason: 'plan_mismatch',
      message: expect.stringContaining('does not match'),
    })
  })

  it('rejects unknown productIds instead of forwarding them to Creem', () => {
    const r = resolveCheckoutTarget({ productId: 'prod_attacker_999' }, ENV)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('unknown_product')
  })

  it('rejects unsupported plan values (FREE / LIFETIME / garbage)', () => {
    for (const plan of ['FREE', 'LADY_FREE', 'LIFETIME', 'premium_monthly', '']) {
      const r = resolveCheckoutTarget({ plan }, ENV)
      expect(r.ok).toBe(false)
    }
  })

  it('rejects self-reported premium without any input (B-18 行为面)', () => {
    expect(resolveCheckoutTarget({}, ENV)).toEqual({
      ok: false,
      reason: 'missing_input',
      message: expect.stringContaining('Must provide'),
    })
  })

  it('reports config gap distinctly from user error', () => {
    const r = resolveCheckoutTarget({ plan: 'PREMIUM_YEARLY' }, {})
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toBe('unknown_product')
      expect(r.message).toContain('CREEM_YEARLY_PRODUCT_ID is not configured')
    }
  })
})

describe('checkoutRequestId (B-17)', () => {
  // 分桶按**绝对时间**取整，所以基准确对齐到窗口边界，否则 "+14min" 可能跨桶。
  const T0 =
    Math.floor(1_700_000_000_000 / CHECKOUT_IDEMPOTENCY_WINDOW_MS) * CHECKOUT_IDEMPOTENCY_WINDOW_MS

  it('never embeds a raw timestamp (old bug: order_<user>_<Date.now()>)', () => {
    const id = checkoutRequestId('u1', 'PREMIUM_MONTHLY', T0)
    expect(id).not.toContain(String(T0))
    expect(id).toBe('order_u1_PREMIUM_MONTHLY_' + Math.floor(T0 / CHECKOUT_IDEMPOTENCY_WINDOW_MS))
  })

  it('is stable inside the same window (double click reuses one checkout)', () => {
    const a = checkoutRequestId('u1', 'PREMIUM_MONTHLY', T0)
    const b = checkoutRequestId('u1', 'PREMIUM_MONTHLY', T0 + 60_000)
    const c = checkoutRequestId('u1', 'PREMIUM_MONTHLY', T0 + 14 * 60_000)
    expect(a).toBe(b)
    expect(a).toBe(c)
  })

  it('changes across windows so an abandoned checkout can be retried', () => {
    const a = checkoutRequestId('u1', 'PREMIUM_MONTHLY', T0)
    const b = checkoutRequestId('u1', 'PREMIUM_MONTHLY', T0 + CHECKOUT_IDEMPOTENCY_WINDOW_MS)
    expect(a).not.toBe(b)
  })

  it('separates users and plans', () => {
    const base = checkoutRequestId('u1', 'PREMIUM_MONTHLY', T0)
    expect(checkoutRequestId('u2', 'PREMIUM_MONTHLY', T0)).not.toBe(base)
    expect(checkoutRequestId('u1', 'PREMIUM_YEARLY', T0)).not.toBe(base)
  })

  it('falls back to the default window when given a bogus window', () => {
    expect(checkoutRequestId('u1', 'PREMIUM_MONTHLY', T0, 0)).toBe(
      checkoutRequestId('u1', 'PREMIUM_MONTHLY', T0),
    )
    expect(checkoutRequestId('u1', 'PREMIUM_MONTHLY', T0, Number.NaN)).toBe(
      checkoutRequestId('u1', 'PREMIUM_MONTHLY', T0),
    )
  })
})

describe('resolveWebhookPlan (B-16 webhook 侧)', () => {
  it('uses a supported metadata.plan as-is', () => {
    expect(
      resolveWebhookPlan({ rawPlan: 'PREMIUM_YEARLY', productId: null, env: ENV }),
    ).toEqual({ plan: 'PREMIUM_YEARLY', degraded: false, source: 'metadata' })
  })

  it('keeps non-checkout plans untouched (LIFETIME / FREE / LADY_FREE)', () => {
    for (const plan of ['LIFETIME', 'FREE', 'LADY_FREE']) {
      expect(resolveWebhookPlan({ rawPlan: plan, productId: null, env: ENV })).toEqual({
        plan,
        degraded: false,
        source: 'metadata',
      })
    }
  })

  it('resolves the legacy "dynamic" placeholder via productId (年付不再记成月付)', () => {
    expect(
      resolveWebhookPlan({ rawPlan: 'dynamic', productId: 'prod_year_456', env: ENV }),
    ).toEqual({ plan: 'PREMIUM_YEARLY', degraded: false, source: 'product' })
  })

  it('prefers productId over an unusable metadata.plan', () => {
    expect(
      resolveWebhookPlan({ rawPlan: 'dynamic', productId: 'prod_month_123', env: ENV }).plan,
    ).toBe('PREMIUM_MONTHLY')
  })

  it('falls back to the existing plan and flags the degradation', () => {
    expect(
      resolveWebhookPlan({
        rawPlan: 'dynamic',
        productId: 'prod_unknown',
        env: ENV,
        fallbackPlan: 'PREMIUM_YEARLY',
      }),
    ).toEqual({ plan: 'PREMIUM_YEARLY', degraded: true, source: 'existing' })
  })

  it('last resort is monthly but flagged degraded (never silent)', () => {
    expect(
      resolveWebhookPlan({ rawPlan: null, productId: null, env: ENV, fallbackPlan: null }),
    ).toEqual({ plan: 'PREMIUM_MONTHLY', degraded: true, source: 'default' })
  })

  it('ignores blank / whitespace plans', () => {
    expect(
      resolveWebhookPlan({ rawPlan: '   ', productId: 'prod_year_456', env: ENV }).source,
    ).toBe('product')
  })
})
