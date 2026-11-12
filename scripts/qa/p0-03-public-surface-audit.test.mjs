import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluatePublicSurface, CORE_ROUTES, EIGHT_QUESTIONS } from './p0-03-public-surface-audit.mjs'

const ALL_TEXT = [
  'LokFeel', 'Connection OS', 'team', 'community', 'intent', 'outcome',
  'chat', 'CRM', 'approve', 'consent', 'step', 'workflow',
  'STARTER', 'GROWTH', 'SCALE', 'contact', 'email', 'hello@',
  'Terms', 'Dodo', 'refund',
].join(' ')

const fullPages = () =>
  CORE_ROUTES.map((route) => ({
    route, httpStatus: 200, bytes: 50_000, html: ALL_TEXT, internalLinks: ['/', '/product'],
  }))

test('C1 · 12 页全 200 且八问均有可见证据 ⇒ PASS，分母为 8', () => {
  const r = evaluatePublicSurface(fullPages())
  assert.equal(r.verdict, 'PASS', r.errors.join('; '))
  assert.equal(r.totalQuestions, 8)
  assert.equal(r.coveredQuestions, 8)
})

test('C2 · 缺一个核心页 ⇒ ERROR（不得因剩余页面全绿而放行）', () => {
  const pages = fullPages().filter((p) => p.route !== '/pricing')
  assert.equal(evaluatePublicSurface(pages).verdict, 'ERROR')
})

test('C3 · 某页 HTTP 200 但 body 为空 ⇒ ERROR（防空集恒真）', () => {
  const pages = fullPages()
  pages.find((p) => p.route === '/terms').bytes = 0
  const r = evaluatePublicSurface(pages)
  assert.equal(r.verdict, 'ERROR')
  assert.ok(r.errors.some((e) => e.includes('empty_body')))
})

test('C4 · 页面可见但八问文案全缺失 ⇒ FAIL，不冒充理解达标', () => {
  const pages = fullPages().map((p) => ({ ...p, html: '<html><body>placeholder</body></html>' }))
  const r = evaluatePublicSurface(pages)
  assert.equal(r.verdict, 'FAIL')
  assert.equal(r.coveredQuestions, 0)
  assert.ok(r.errors.some((e) => e.includes('no_visible_evidence')))
})

test('C5 · 八问定义本身覆盖 8 个不同编号且路由都在核心清单内', () => {
  assert.equal(new Set(EIGHT_QUESTIONS.map((q) => q.id)).size, 8)
  for (const q of EIGHT_QUESTIONS) assert.ok(CORE_ROUTES.includes(q.route), `${q.id} 路由越界`)
})
