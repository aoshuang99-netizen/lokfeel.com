import assert from 'node:assert/strict'
import test from 'node:test'

import { judgeHotfixHttpProof } from './s02-hotfix-http-proof.mjs'

const good = () => ({
  health: { channels: { 'dodo.checkout': true } },
  plans: {
    checkoutReady: false,
    environment: 'live_mode',
    commercialApproval: { status: 'PENDING_APPROVAL', ref: null },
    missing: [],
  },
  checkout: { status: 401 },
})

test('P1 · 真实关闭状态 ⇒ PASS', () => {
  const r = judgeHotfixHttpProof(good())
  assert.equal(r.verdict, 'PASS')
  assert.deepEqual(r.reasons, [])
})

test('P2 · checkoutReady=true ⇒ FAIL（收银台还开着，止损没生效）', () => {
  const ev = good()
  ev.plans.checkoutReady = true
  const r = judgeHotfixHttpProof(ev)
  assert.equal(r.verdict, 'FAIL')
  assert.ok(r.reasons.includes('checkout_still_ready'))
})

test('P3 · 没有 commercialApproval 字段 ⇒ FAIL（分不清"门关了"还是"没配凭据"）', () => {
  const ev = good()
  ev.plans.commercialApproval = undefined
  ev.plans.missing = ['DODO_PAYMENTS_API_KEY'] // 技术门也为假
  const r = judgeHotfixHttpProof(ev)
  assert.equal(r.verdict, 'FAIL')
  assert.ok(r.reasons.includes('commercial_approval_field_missing'))
})

test('P4 · 凭据已就绪却报 missing ⇒ FAIL（说明是技术门挡的，商业门未被验证）', () => {
  const ev = good()
  ev.plans.missing = ['DODO_PAYMENTS_API_KEY']
  const r = judgeHotfixHttpProof(ev)
  assert.equal(r.verdict, 'FAIL')
  assert.ok(r.reasons.includes('missing_nonempty_while_credentials_ready'))
})

test('P5 · 匿名 checkout 不是 401 ⇒ FAIL（守卫顺序被"未接入/未批准"打乱）', () => {
  const ev = good()
  ev.checkout.status = 503
  const r = judgeHotfixHttpProof(ev)
  assert.equal(r.verdict, 'FAIL')
  assert.ok(r.reasons.some((x) => x.startsWith('anonymous_checkout_not_401')))
})

test('P6 · 未经人工批准却带 approvalRef ⇒ FAIL（实现者自批的痕迹）', () => {
  const ev = good()
  ev.plans.commercialApproval = { status: 'PENDING_APPROVAL', ref: 'SELF-APPROVED' }
  const r = judgeHotfixHttpProof(ev)
  assert.equal(r.verdict, 'FAIL')
  assert.ok(r.reasons.includes('approval_ref_present_without_human_approval'))
})

test('P7 · plans 不可解析 ⇒ ERROR（不是 PASS）', () => {
  const r = judgeHotfixHttpProof({ plans: null })
  assert.equal(r.verdict, 'ERROR')
})
