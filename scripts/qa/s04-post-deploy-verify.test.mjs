import assert from 'node:assert/strict'
import test from 'node:test'

import { B4_PUBLIC_ROUTES, PAYMENT_BLOBS, detectScopeDrift, evaluateS04 } from './s04-post-deploy-verify.mjs'

const deployedSha = '0e16959aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const good = () => ({
  health: { httpStatus: 200, commit: '0e16959' },
  deployed: { resolvedSha: deployedSha },
  plans: {
    httpStatus: 200,
    checkoutReady: false,
    environment: 'live_mode',
    commercialApproval: { status: 'PENDING_APPROVAL', ref: null },
    missing: [],
  },
  anonymousCheckout: { httpStatus: 401 },
  codeParity: Object.fromEntries(PAYMENT_BLOBS.map((f) => [f, true])),
})

test('P1 · 门禁关闭 + 支付源码等值 ⇒ PRODUCTION_RISK_CLOSED', () => {
  const r = evaluateS04(good())
  assert.equal(r.verdict, 'PRODUCTION_RISK_CLOSED')
  assert.deepEqual(r.reasons, [])
})

test('P2 · checkoutReady=true ⇒ RISK_OPEN（旧版本仍在跑）', () => {
  const ev = good()
  ev.plans.checkoutReady = true
  assert.equal(evaluateS04(ev).verdict, 'RISK_OPEN')
})

test('P3 · 商业批准被自填（APPROVED + ref）⇒ RISK_OPEN', () => {
  const ev = good()
  ev.plans.commercialApproval = { status: 'APPROVED', ref: 'SELF-APPROVED-2026' }
  const r = evaluateS04(ev)
  assert.equal(r.verdict, 'RISK_OPEN')
  assert.ok(r.reasons.includes('commercial_status_APPROVED_not_PENDING_APPROVAL'))
})

test('P4 · PENDING_APPROVAL 但 ref 非空 ⇒ RISK_OPEN（状态与引用必须同时为空）', () => {
  const ev = good()
  ev.plans.commercialApproval = { status: 'PENDING_APPROVAL', ref: 'ref-1' }
  assert.equal(evaluateS04(ev).verdict, 'RISK_OPEN')
})

test('P5 · 匿名 POST 未被拦住 ⇒ RISK_OPEN（哪怕 plans 说关闭）', () => {
  const ev = good()
  ev.anonymousCheckout = { httpStatus: 200 }
  const r = evaluateS04(ev)
  assert.equal(r.verdict, 'RISK_OPEN')
  assert.ok(r.reasons.some((x) => x.startsWith('anonymous_checkout_200')))
})

test('P6 · 支付源码与 RC 不等值 ⇒ CODE_PARITY_MISMATCH（部署的不是 RC）', () => {
  const ev = good()
  ev.codeParity[PAYMENT_BLOBS[2]] = false
  const r = evaluateS04(ev)
  assert.equal(r.verdict, 'CODE_PARITY_MISMATCH')
  assert.ok(r.reasons[0].includes('commercial-gate.ts'))
})

test('P7 · health.commit 与部署 SHA 不符 ⇒ TRACEABILITY_MISMATCH', () => {
  const ev = good()
  ev.health.commit = 'deadbee'
  assert.equal(evaluateS04(ev).verdict, 'TRACEABILITY_MISMATCH')
})

test('P8 · 证据缺失 ⇒ ERROR（不把取数失败当 PASS）', () => {
  const ev = good()
  delete ev.plans
  assert.equal(evaluateS04(ev).verdict, 'ERROR')
})

test('P9 · 五个 B4 页面上线 ⇒ 范围漂移被识别，但不影响支付判定', () => {
  const routes = Object.fromEntries(B4_PUBLIC_ROUTES.map((r) => [r, { httpStatus: 200 }]))
  const drift = detectScopeDrift(routes)
  assert.equal(drift.drifted, true)
  assert.equal(drift.liveRoutes.length, B4_PUBLIC_ROUTES.length)
  const ev = good()
  ev.routes = routes
  assert.equal(evaluateS04(ev).verdict, 'PRODUCTION_RISK_CLOSED')
})

test('P10 · 五页面全 404 ⇒ 无范围漂移（文档口径成立）', () => {
  const routes = Object.fromEntries(B4_PUBLIC_ROUTES.map((r) => [r, { httpStatus: 404 }]))
  assert.deepEqual(detectScopeDrift(routes), { drifted: false, liveRoutes: [] })
})
