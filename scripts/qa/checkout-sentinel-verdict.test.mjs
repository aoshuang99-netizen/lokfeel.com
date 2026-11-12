import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluateCheckoutSentinel } from './checkout-sentinel-verdict.mjs'

const COMPLETE_PLANS = {
  checkoutReady: true,
  environment: 'live_mode',
  approvedAt: '2026-11-10',
  catalogVersion: '2026-11-10.1',
}

test('B1 · 收银台开放且未获止损授权 → RISK_OPEN，并提示 R-15', () => {
  const result = evaluateCheckoutSentinel({
    httpStatus: 200,
    plans: COMPLETE_PLANS,
    remoteSha: 'eaf2ca1',
    stopLossAuthorized: false,
  })
  assert.equal(result?.verdict, 'RISK_OPEN')
  assert.match(result.reasons.join(' '), /R-15/)
})

test('B2 · 收银台关闭 → CLOSED', () => {
  const result = evaluateCheckoutSentinel({
    httpStatus: 200,
    plans: { ...COMPLETE_PLANS, checkoutReady: false },
    remoteSha: 'eaf2ca1',
    stopLossAuthorized: false,
  })
  assert.equal(result.verdict, 'CLOSED')
})

test('B3 · 非 200 / 响应为空 / 取数超时 / 关键字段缺失 → ERROR', () => {
  const badInputs = [
    { httpStatus: 502, plans: COMPLETE_PLANS },
    { httpStatus: 200, plans: null },
    { httpStatus: 200, plans: { environment: 'live_mode' } },
    { httpStatus: 200, plans: COMPLETE_PLANS, fetchError: 'timeout' },
  ]
  for (const [i, input] of badInputs.entries()) {
    const result = evaluateCheckoutSentinel({
      remoteSha: 'eaf2ca1',
      stopLossAuthorized: false,
      ...input,
    })
    assert.equal(result.verdict, 'ERROR', `第 ${i + 1} 个异常输入被误判为 ${result.verdict}`)
  }
})

test('B4 · 证据字段任一缺失 → ERROR（防「有结论没证据」）', () => {
  const base = {
    httpStatus: 200,
    plans: COMPLETE_PLANS,
    remoteSha: 'eaf2ca1',
    stopLossAuthorized: false,
  }
  for (const field of ['environment', 'approvedAt', 'catalogVersion']) {
    const plans = { ...COMPLETE_PLANS }
    delete plans[field]
    assert.equal(evaluateCheckoutSentinel({ ...base, plans }).verdict, 'ERROR', `缺 ${field}`)
  }
  assert.equal(evaluateCheckoutSentinel({ ...base, remoteSha: '' }).verdict, 'ERROR', '缺 remoteSha')
})

test('B5 · 取证计划全部只读 GET 且无请求体', async () => {
  const { buildSentinelPlan } = await import('./checkout-sentinel-verdict.mjs')
  const plan = buildSentinelPlan('https://app.lokfeel.com')
  assert.ok(plan.length >= 2, '至少覆盖 plans 与 health 两个端点')
  for (const req of plan) {
    assert.equal(req.method, 'GET')
    assert.equal(req.body, undefined)
    assert.ok(req.url.startsWith('https://app.lokfeel.com/'))
  }
})

test('B6 · 真实生产响应形态（environment=live_mode，无 live_mode 键）→ RISK_OPEN', () => {
  const realPlans = {
    ok: true,
    provider: 'dodo',
    currency: 'USD',
    catalogVersion: '2026-11-10.1',
    approvedAt: '2026-11-10',
    checkoutReady: true,
    environment: 'live_mode',
    plans: [],
  }
  const result = evaluateCheckoutSentinel({
    httpStatus: 200,
    plans: realPlans,
    remoteSha: 'eaf2ca1',
    stopLossAuthorized: false,
  })
  assert.equal(result.verdict, 'RISK_OPEN')
  assert.equal(result.evidence.environment, 'live_mode')
})
