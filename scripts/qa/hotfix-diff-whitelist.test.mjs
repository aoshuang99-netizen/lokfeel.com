import assert from 'node:assert/strict'
import test from 'node:test'

import { classify, evaluateDiff } from './hotfix-diff-whitelist.mjs'

test('W1 · 只有支付修复文件 ⇒ PASS', () => {
  const r = evaluateDiff([
    'src/lib/payments/commercial-gate.ts',
    'src/lib/payments/dodo/events.ts',
    'src/config/products.ts',
    'src/app/api/payments/dodo/plans/route.ts',
    'src/app/api/payments/dodo/checkout/route.ts',
    'tests/billing/hotfix-checkout-gate-closed.test.ts',
  ])
  assert.equal(r.verdict, 'PASS')
  assert.deepEqual(r.violations, [])
})

test('W2 · 夹带新公开页 ⇒ FAIL（这是任务书点名禁止的）', () => {
  const r = evaluateDiff(['src/lib/payments/dodo/events.ts', 'src/app/(public)/product/page.tsx'])
  assert.equal(r.verdict, 'FAIL')
  assert.equal(r.violations[0].verdict, 'forbidden')
})

test('W3 · 夹带落地页改版 ⇒ FAIL', () => {
  assert.equal(classify('src/app/(landing)/page.tsx'), 'forbidden')
  assert.equal(classify('src/components/layout/footer.tsx'), 'forbidden')
})

test('W4 · 夹带 prisma 迁移 ⇒ FAIL（hotfix 不允许有 schema 变更）', () => {
  assert.equal(classify('prisma/migrations/20261112_x/migration.sql'), 'forbidden')
  assert.equal(classify('prisma/schema/billing.prisma'), 'forbidden')
})

test('W5 · 依赖变更 ⇒ FAIL（供应链需独立评审）', () => {
  assert.equal(classify('package.json'), 'forbidden')
  assert.equal(classify('package-lock.json'), 'forbidden')
})

test('W6 · 白名单之外的新源码文件 ⇒ unlisted ⇒ FAIL（不是静默放行）', () => {
  const r = evaluateDiff(['src/lib/payments/refund-policy.ts'])
  assert.equal(r.verdict, 'FAIL')
  assert.equal(r.rows[0].verdict, 'unlisted')
})

test('W7 · 空 diff 不得判 PASS（否则"没改动"会冒充"最小改动"）', () => {
  const r = evaluateDiff([])
  assert.equal(r.verdict, 'EMPTY_DIFF')
  assert.notEqual(r.verdict, 'PASS')
})

test('W8 · products 目录断言是同一改动的另一半，必须在白名单内', () => {
  assert.equal(classify('tests/commercial/products.test.ts'), 'allowed')
  // 但同目录下的其他文件不得借道放行（避免"开一个口子变成开一片"）
  assert.notEqual(classify('tests/commercial/other.test.ts'), 'allowed')
})
