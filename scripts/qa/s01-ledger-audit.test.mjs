/**
 * S-01 账本审计判定层 —— 负控测试
 *
 * 为什么必须有这份测试：
 *   「0 条流水 ⇒ 没问题」是空集恒真的典型假绿。本测试第 1 条就钉住
 *   **零样本必须 NO_SAMPLE，绝不能 PASS**。其余各条各自钉住一个真实缺陷形态，
 *   避免审计脚本变成"永远通过"的装饰品。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { auditLedger, LEGACY_SETTLED_KEY } from './s01-ledger-audit.mjs'

const charge = (chargeId, type, extra = {}) => ({
  id: `${chargeId}-${type}`,
  organizationId: 'org_1',
  type,
  chargeId,
  amountCents: 4900,
  dedupeKey: `dodo:charge-created:${chargeId}`,
  occurredAt: '2026-11-01T00:00:00.000Z',
  ...extra,
})

test('L1 · 零样本必须是 NO_SAMPLE，不得判 PASS（空集恒真是假绿）', () => {
  const r = auditLedger({ typeCounts: [], chargeRows: [] })
  assert.equal(r.zeroSample, true)
  assert.equal(r.verdict, 'NO_SAMPLE')
  assert.notEqual(r.verdict, 'PASS')
})

test('L2 · 同一 chargeId 出现 SUCCEEDED 与 FAILED 共存 ⇒ FAIL', () => {
  const r = auditLedger({
    chargeRows: [charge('pay_1', 'CHARGE_CREATED'), charge('pay_1', 'CHARGE_SUCCEEDED'), charge('pay_1', 'CHARGE_FAILED')],
    orgPlanRows: [{ organizationId: 'org_1', plan: 'GROWTH' }],
  })
  assert.equal(r.verdict, 'FAIL')
  assert.ok(r.invariantViolations.some((v) => v.code === 'succeeded_and_failed_coexist'))
})

test('L3 · 旧 :settled 结算键 + 仅 FAILED ⇒ 命中 R-15 嫌疑并阻断', () => {
  const evs = [
    charge('pay_2', 'CHARGE_CREATED'),
    charge('pay_2', 'CHARGE_FAILED', { dedupeKey: 'dodo:charge-settled:pay_2' }),
  ]
  const r = auditLedger({ chargeRows: evs, orgPlanRows: [] })
  assert.equal(r.verdict, 'FAIL')
  assert.ok(r.blockers.includes('legacy_settled_key_present'))
  assert.equal(r.r15Suspects[0].code, 'failed_only_with_legacy_settled_key')
  assert.ok(LEGACY_SETTLED_KEY.test('dodo:charge-settled:pay_2'))
  // 分态后的新键不得被误判为旧键
  assert.equal(LEGACY_SETTLED_KEY.test('dodo:charge-settled:pay_2:failed'), false)
})

test('L4 · 付款成功但组织无有效订阅 ⇒ paid_without_active_subscription', () => {
  const r = auditLedger({
    chargeRows: [charge('pay_3', 'CHARGE_CREATED'), charge('pay_3', 'CHARGE_SUCCEEDED')],
    orgPlanRows: [{ organizationId: 'org_1', plan: null }],
  })
  assert.equal(r.verdict, 'FAIL')
  assert.ok(r.blockers.includes('paid_without_active_subscription'))
  assert.equal(r.paidNotProvisioned.length, 1)
})

test('L5 · 干净账本（有一笔成功且有有效订阅）才判 PASS', () => {
  const r = auditLedger({
    chargeRows: [
      charge('pay_4', 'CHARGE_CREATED'),
      charge('pay_4', 'CHARGE_SUCCEEDED', { dedupeKey: 'dodo:charge-settled:pay_4:succeeded' }),
    ],
    orgPlanRows: [{ organizationId: 'org_1', plan: 'GROWTH' }],
  })
  assert.equal(r.verdict, 'PASS')
  assert.equal(r.zeroSample, false)
  assert.deepEqual(r.blockers, [])
})

test('L6 · 免费档不得被算成付费订阅（防止 2226 条 ACTIVE 被误读）', () => {
  const r = auditLedger({
    subscriptionRows: [
      { id: 's1', status: 'ACTIVE', plan: 'LADY_FREE' },
      { id: 's2', status: 'ACTIVE', plan: 'LADY_FREE' },
      { id: 's3', status: 'ACTIVE', plan: 'PREMIUM_MONTHLY' },
    ],
  })
  assert.equal(r.counts.b2cSubscriptions, 3)
  assert.equal(r.counts.b2cPaidSubscriptions, 1)
})

test('L7 · B2C 付款成功但无 ACTIVE 订阅 ⇒ 阻断（与组织账本同等对待）', () => {
  const r = auditLedger({ b2cPaidWithoutSub: [{ id: 'p1', userId: 'u1' }] })
  assert.equal(r.verdict, 'FAIL')
  assert.ok(r.blockers.includes('b2c_paid_without_active_subscription'))
})

test('L8 · 缺 chargeId 的款项事件必须被显式记为 findings，不得静默跳过', () => {
  const r = auditLedger({ chargeRows: [{ id: 'x', type: 'CHARGE_SUCCEEDED', chargeId: null }] })
  assert.ok(
    r.findings.some((f) => f.code === 'charge_event_without_chargeId'),
    '缺 chargeId 的事件必须出现在 findings 里，否则它会在审计里凭空消失',
  )
})
