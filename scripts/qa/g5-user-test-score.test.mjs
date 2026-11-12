import test from 'node:test'
import assert from 'node:assert/strict'
import { scoreG5, G5_MIN_PARTICIPANTS, G5_MIN_PASS } from './g5-user-test-score.mjs'

const participant = (over = {}) => ({
  participantId: 'p',
  understood: true,
  taskCompleted: true,
  taskSeconds: 90,
  hintsNeeded: 0,
  consent: true,
  ...over,
})
const five = () => Array.from({ length: 5 }, (_, i) => participant({ participantId: `p${i + 1}` }))

test('U1 · 5 人且 5/5 双判据达标 ⇒ PASS', () => {
  const r = scoreG5(five())
  assert.equal(r.verdict, 'PASS')
  assert.equal(r.stats.understood, 5)
  assert.equal(r.stats.completed, 5)
  assert.equal(r.stats.threshold, '4/5')
})

test('U2 · 恰好 4/5 双判据达标 ⇒ PASS（阈值就是 4/5，不是 5/5）', () => {
  const rows = five()
  rows[4] = participant({ participantId: 'p5', understood: false, taskCompleted: false })
  assert.equal(scoreG5(rows).verdict, 'PASS')
})

test('U3 · 只有 4 人且全部达标 ⇒ NOT_TESTED（人数不够绝不放行）', () => {
  const r = scoreG5(five().slice(0, 4))
  assert.equal(r.verdict, 'NOT_TESTED')
  assert.match(r.reasons.join(' '), /only_4_participants/)
})

test('U4 · 空记录 ⇒ NOT_TESTED（素材齐备不等于测试发生）', () => {
  assert.equal(scoreG5([]).verdict, 'NOT_TESTED')
})

test('U5 · 3/5 理解达标 ⇒ FAIL（不得按实测下调阈值）', () => {
  const rows = five()
  rows[2].understood = false
  rows[3].understood = false
  const r = scoreG5(rows)
  assert.equal(r.verdict, 'FAIL')
  assert.equal(r.stats.understood, 3)
  assert.equal(G5_MIN_PASS, 4, '阈值常量被改动会让门禁失真')
  assert.equal(G5_MIN_PARTICIPANTS, 5)
})

test('U6 · 缺知情同意 / 缺字段 / 类型错误 ⇒ ERROR 而非静默计入', () => {
  const noConsent = five(); noConsent[1].consent = false
  assert.equal(scoreG5(noConsent).verdict, 'ERROR')
  const missing = five(); delete missing[2].taskSeconds
  assert.equal(scoreG5(missing).verdict, 'ERROR')
  const wrongType = five(); wrongType[0].understood = 'yes'
  assert.equal(scoreG5(wrongType).verdict, 'ERROR')
  assert.equal(scoreG5(null).verdict, 'ERROR')
})

test('U7 · 统计口径：中位数耗时与零提示人数可核', () => {
  const rows = five()
  rows[0].taskSeconds = 60; rows[1].taskSeconds = 80; rows[2].taskSeconds = 100
  rows[3].taskSeconds = 120; rows[4].taskSeconds = 300
  rows[4].hintsNeeded = 2
  const r = scoreG5(rows)
  assert.equal(r.stats.medianTaskSeconds, 100)
  assert.equal(r.stats.maxTaskSeconds, 300)
  assert.equal(r.stats.noHints, 4)
})
