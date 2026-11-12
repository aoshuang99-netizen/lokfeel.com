import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'

/**
 * 发布状态口径守卫（V20.7 复盘补强）
 *
 * 背景：G7 在结构化证据里是 PASS_CODE_ONLY，检查器判 G7_not_PASS，
 * 但三份人类可读文档曾把它计入「6 PASS」。严格口径下只有字面 PASS 计完成。
 * 另：build-release-status.mjs 曾用 git HEAD 当 rcSha，纯文档提交会让发布候选 SHA 漂移。
 */
const ROOT = process.cwd()
const DIR = path.join(ROOT, 'docs/release/lokfeel-final-20261110')
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'))

const status = readJson(path.join(DIR, 'STATUS.json'))
const manifest = readJson(path.join(DIR, 'RELEASE_MANIFEST.json'))
const gaps = readJson(path.join(DIR, 'evidence/release-manifest-gaps.json'))

const gateRows = readFileSync(path.join(DIR, 'GATES.csv'), 'utf8')
  .replace(/^\uFEFF/, '')
  .trim()
  .split(/\r?\n/)
  .slice(1)
  .filter(Boolean)
const gates = Object.fromEntries(gateRows.map((line) => {
  const cells = line.split(',')
  return [cells[0].split('-')[0], cells[1]]
}))

test('R1 · 严格完成率只数字面 PASS，且由 GATES.csv 动态算出', () => {
  const literalPass = Object.values(gates).filter((v) => v === 'PASS').length
  assert.equal(status.strictPass, literalPass)
  assert.equal(status.strictPass, 4)
  assert.equal(status.strictDenominator, 13)
  assert.equal(status.gateTally.PASS, 4)
  assert.equal(status.verdict, 'NO_GO')
})

test('R2 · PASS_CODE_ONLY 不是 PASS：G7 必须被检查器判 not_PASS', () => {
  assert.equal(gates.G7, 'PASS_CODE_ONLY')
  assert.equal(manifest.gates.G7, 'PASS_CODE_ONLY')
  assert.equal(status.gateTally.PASS_CODE_ONLY, 1)
  assert.ok(gaps.errors.includes('G7_not_PASS'))
  assert.ok(!status.notes.join(' ').includes('6 PASS'))
})

test('R3 · 负控：把 G7 篡改成 PASS 后 G7_not_PASS 必须消失（证明确能抓到回潮）', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'lf-manifest-'))
  try {
    const forged = { ...manifest, gates: { ...manifest.gates, G7: 'PASS' } }
    const file = path.join(tmp, 'manifest.json')
    writeFileSync(file, JSON.stringify(forged, null, 2), 'utf8')
    const r = spawnSync(process.execPath, ['scripts/check-release-manifest.mjs', file], {
      cwd: ROOT,
      encoding: 'utf8',
    })
    assert.equal(r.status, 1)
    const report = JSON.parse(r.stdout)
    assert.ok(!report.errors.includes('G7_not_PASS'))
    assert.equal(report.verdict, 'NO_GO')
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('R4 · 发布候选 SHA 锁定：不随后续纯文档提交漂移', () => {
  assert.match(manifest.rcSha, /^[0-9a-f]{40}$/)
  assert.match(status.headSha, /^[0-9a-f]{40}$/)
  assert.equal(status.rcSha, manifest.rcSha)
  assert.equal(gaps.rcSha, manifest.rcSha)
  assert.equal(manifest.rcSha, '2b52ce04480dc8df53d260ec43fbe81f917e3650')
  assert.notEqual(status.headSha, manifest.rcSha)
  assert.ok(status.notes.some((n) => n.includes('锁定')))
})

test('R5 · 三份人类可读状态文档不得回潮写旧完成率（6 PASS / 5 PASS 均为旧口径）', () => {
  // 用带词边界的正则：能抓到「13 门禁中 6 PASS」，但不会把门禁编号「G6 PASS」误判成旧口径。
  const stale6 = /\b6 PASS\b/
  const stale5 = /\b5 PASS\b/
  assert.equal(stale6.test('13 门禁中 6 PASS（G0/G1/...）'), true, '守卫必须能抓到 6 PASS 旧写法')
  assert.equal(stale5.test('13 门禁中 5 PASS（G0/G1/...）'), true, '守卫必须能抓到 5 PASS 旧写法')
  assert.equal(stale6.test('G6 PASS（候选）'), false, '门禁编号不得被误判')
  const docs = ['RELEASE_STATUS.md', '09_GO_NO_GO.md', '12_RC_FINAL_GO_NO_GO.md']
  for (const name of docs) {
    const text = readFileSync(path.join(DIR, name), 'utf8')
    assert.ok(!stale6.test(text), `${name} 仍写 6 PASS`)
    assert.ok(!stale5.test(text), `${name} 仍写 5 PASS（G11 已下调为 PARTIAL，应为 4 PASS）`)
    assert.ok(text.includes('4 PASS'), `${name} 未写 4 PASS`)
  }
})

test('R6 · manifest 仍 fail-closed：NO_GO、D1–D8 与发布授权全空、无回滚目标', () => {
  assert.equal(manifest.status, 'NO_GO')
  assert.equal(gaps.verdict, 'NO_GO')
  assert.ok(gaps.totalGaps >= 21)
  assert.ok(Object.values(manifest.humanDecisions).every((v) => v === null))
  assert.ok(Object.values(manifest.releaseAuthorization).every((v) => v === null))
  assert.equal(manifest.productionBeforeDeployId, null)
  assert.equal(manifest.rollback.dryRunVerified, false)
})

test('R7 · 实时复采证据存在且与归档风险结论一致', () => {
  const recheck = readJson(path.join(DIR, 'evidence/p0-01-production-risk-recheck-2026-11-12.json'))
  const original = readJson(path.join(DIR, 'evidence/p0-01-production-risk.json'))
  assert.equal(recheck.readOnly, true)
  assert.equal(recheck.verdict, 'RISK_OPEN')
  assert.equal(original.verdict, 'RISK_OPEN')
  assert.equal(recheck.evidence.health.commit, original.evidence.health.commit)
  assert.equal(recheck.evidence.plans.checkoutReady, true)
  assert.equal(recheck.evidence.plans.environment, 'live_mode')
  assert.equal(recheck.evidence.plans.commercialApproval, null)
  assert.ok(recheck.evidence.pricing.bytes > 0)
})
