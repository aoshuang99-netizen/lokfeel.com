/**
 * V22-G10 RED→GREEN：公开 JSON 端点在 D1 定价未批准时不得下发金额。
 *
 * 背景：/pricing 页面已 fail-closed，但 /api/payments/dodo/plans 曾无条件
 * 把 $89/$199/$449 与 trialDays/savingsPercent 返回给匿名请求 —— 同一份
 * 未批准价格从另一个门出去。本测试把「页面绿 ≠ JSON 绿」钉死。
 */

import { GET } from '@/app/api/payments/dodo/plans/route'
import { PRICING_APPROVED } from '@/config/pricing-gate'

describe('V22-G10 · public pricing JSON is fail-closed', () => {
  it('the approval switch is actually closed (guard against accidental flip)', () => {
    expect(PRICING_APPROVED).toBe(false)
  })

  it('returns no plan and no amount while approval is pending', async () => {
    const res = await GET()
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.pricingPublished).toBe(false)
    expect(body.reason).toBe('pricing_approval_pending')

    // 前置非空检查：空数组恒真会造出假绿，先证明我们检查的是有内容的对象。
    expect(Object.keys(body).length).toBeGreaterThan(3)
    expect(Array.isArray(body.plans)).toBe(true)
    expect(body.plans).toHaveLength(0)

    // 负例：任何金额/套餐价/试用/折扣字眼都不允许出现在响应里。
    const raw = JSON.stringify(body)
    expect(raw).not.toMatch(/\$\s?\d/)
    expect(raw).not.toMatch(/amountCents|display|trialDays|savingsPercent|perMonthDisplay/)
    expect(raw).not.toMatch(/89|199|449/)
    expect(raw).not.toMatch(/Starter|Growth|Scale/)
  })

  it('is not served from a shared cache', async () => {
    const res = await GET()
    expect(res.headers.get('cache-control')).toMatch(/no-store/)
  })
})
