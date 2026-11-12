import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluateProductionRisk, buildP001Plan } from './p0-01-production-risk.mjs'

const SHA = 'f6576db95ea475887a942df0b851f345f9b18f6f'
const baseEvidence = () => ({
  health: {
    httpStatus: 200, elapsedMs: 9000, status: 'healthy', commit: '5a161c4',
    charging: true, dodoCheckoutChannel: true,
  },
  plans: {
    httpStatus: 200, elapsedMs: 1600, environment: 'live_mode', checkoutReady: true,
    approvedAt: '2026-11-10', catalogVersion: '2026-11-10.1',
  },
  pricing: { httpStatus: 200, elapsedMs: 3700, bytes: 48222, hasCheckoutCta: true },
  headers: { server: 'cloudflare' },
  git: { remoteMainSha: SHA },
})

test('B1 · 线上 live 收银台开放 ⇒ RISK_OPEN，且理由点名 R-15 与可见 CTA', () => {
  const r = evaluateProductionRisk(baseEvidence())
  assert.equal(r.verdict, 'RISK_OPEN')
  assert.ok(r.reasons.some((x) => x.includes('R15')))
  assert.ok(r.reasons.some((x) => x.includes('pricing_page')))
  assert.equal(r.traceability.pricingCtaVisible, true)
})

test('B2 · 收银台关闭 ⇒ CLOSED（且仍保留可追溯字段）', () => {
  const e = baseEvidence()
  e.plans.checkoutReady = false
  const r = evaluateProductionRisk(e)
  assert.equal(r.verdict, 'CLOSED')
  assert.equal(r.traceability.productionCommit, '5a161c4')
})

test('B3 · 缺任一必需证据块 ⇒ ERROR（不得静默判 CLOSED）', () => {
  for (const key of ['health', 'plans', 'pricing', 'headers', 'git']) {
    const e = baseEvidence()
    delete e[key]
    assert.equal(evaluateProductionRisk(e).verdict, 'ERROR', `缺 ${key} 被放行`)
  }
  assert.equal(evaluateProductionRisk(null).verdict, 'ERROR')
})

test('B4 · 任一接口非 200 ⇒ ERROR（不得用 404 页面当"已关闭"）', () => {
  for (const key of ['health', 'plans', 'pricing']) {
    const e = baseEvidence()
    e[key].httpStatus = 503
    assert.equal(evaluateProductionRisk(e).verdict, 'ERROR', `${key} 503 被放行`)
  }
})

test('B5 · 关键字段缺失或非布尔 ⇒ ERROR', () => {
  const mutations = [
    (e) => { delete e.health.commit },
    (e) => { e.health.charging = undefined },
    (e) => { e.plans.checkoutReady = 'true' },
    (e) => { delete e.plans.environment },
    (e) => { e.pricing.hasCheckoutCta = 'yes' },
    (e) => { e.git.remoteMainSha = 'nope' },
    (e) => { delete e.headers.server },
  ]
  for (const [i, mutate] of mutations.entries()) {
    const e = baseEvidence()
    mutate(e)
    assert.equal(evaluateProductionRisk(e).verdict, 'ERROR', `第 ${i + 1} 个畸形证据被放行`)
  }
})

test('B6 · /pricing 返回 200 但空 body ⇒ ERROR（防止"页面取证"空集恒真）', () => {
  const e = baseEvidence()
  e.pricing.bytes = 0
  e.pricing.hasCheckoutCta = false
  assert.equal(evaluateProductionRisk(e).verdict, 'ERROR')
})

test('B7 · 取证计划全为只读，网络请求全部 GET 且无请求体', () => {
  const plan = buildP001Plan('https://app.lokfeel.com/')
  assert.equal(plan.length, 4)
  const http = plan.filter((r) => r.url.startsWith('https://'))
  assert.equal(http.length, 3)
  for (const req of http) {
    assert.equal(req.method, 'GET')
    assert.equal(Object.hasOwn(req, 'body'), false)
  }
  assert.ok(http.every((r) => r.url.startsWith('https://app.lokfeel.com/')))
})

test('B8 · SHA 可追溯：生产与远端不同 ⇒ drift=true；同源前缀 ⇒ false', () => {
  const drift = evaluateProductionRisk(baseEvidence())
  assert.equal(drift.traceability.shaDrift, true)
  const same = baseEvidence()
  same.git.remoteMainSha = '5a161c4' + '0'.repeat(33)
  same.plans.checkoutReady = false
  assert.equal(evaluateProductionRisk(same).traceability.shaDrift, false)
})
