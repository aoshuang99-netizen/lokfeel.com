#!/usr/bin/env node
/**
 * Release Agent · 从真实证据生成 STATUS.json 与 RELEASE_MANIFEST.json
 *
 * 原则：只从 git / GATES.csv / 已落盘 evidence 读事实，**不填任何占位值当实值**。
 * 缺的东西（人工批准、可回滚 deploy ID、生产复验）一律 null / false，
 * 交给 scripts/check-release-manifest.mjs 判成 NO_GO —— 那个失败清单就是最短关键路径。
 *
 * 用法：node scripts/qa/build-release-status.mjs   （在候选功能提交之后运行）
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const DIR = path.join(ROOT, 'docs/release/lokfeel-final-20261110')
const E = path.join(DIR, 'evidence')

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'))
const headSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const remote = execFileSync('git', ['ls-remote', 'origin', 'refs/heads/main'], { encoding: 'utf8' }).trim().split(/\s+/)[0]
const risk = readJson(path.join(E, 'p0-01-production-risk.json'))
const g4 = readJson(path.join(E, 'g4-public-matrix.json'))

// 发布候选 SHA 必须锁定：后续纯文档/证据提交不改变运行时代码，不能让 HEAD 把 rcSha 悄悄漂走。
// 默认沿用 manifest 中已冻结的值；只有明确更换候选时才允许显式 --rc-sha=<40hex>。
const manifestPath = path.join(DIR, 'RELEASE_MANIFEST.json')
let frozenRcSha = null
if (existsSync(manifestPath)) {
  try { frozenRcSha = readJson(manifestPath).rcSha } catch { frozenRcSha = null }
}
const explicitRcSha = process.argv.find((a) => a.startsWith('--rc-sha='))?.slice('--rc-sha='.length) ?? null
const sha = explicitRcSha || (typeof frozenRcSha === 'string' && /^[0-9a-f]{40}$/.test(frozenRcSha) ? frozenRcSha : headSha)

// 门禁状态取自 GATES.csv（唯一表），不在这里另写一套结论
const gateRows = readFileSync(path.join(DIR, 'GATES.csv'), 'utf8').trim().split(/\r?\n/).slice(1)
const gates = {}
const gateEvidence = {}
for (const line of gateRows) {
  const [gate, verdict, , , , evidencePath] = line.split(',')
  gates[gate.split('-')[0]] = verdict
  gateEvidence[gate.split('-')[0]] = evidencePath || null
}

// 严格口径：只有字面 PASS 计完成。PASS_CODE_ONLY / PARTIAL / BLOCKED / NOT_TESTED / N/A 一律不计。
// 计数由 GATES.csv 动态算出，禁止在文档里手填「N PASS」。
const tally = {}
for (const verdict of Object.values(gates)) tally[verdict] = (tally[verdict] || 0) + 1
const strictDenominator = Object.keys(gates).filter((g) => g !== 'G13').length
const strictPass = tally.PASS || 0
const notCounted = Object.entries(gates)
  .filter(([g, verdict]) => g !== 'G13' && verdict !== 'PASS')
  .map(([g, verdict]) => `${g}=${verdict}`)

const status = {
  timestamp: new Date().toISOString(),
  releaseName: 'lokfeel-v20.7-rc-final',
  rcSha: sha,
  headSha,
  remoteMainSha: remote,
  gateTally: tally,
  strictPass,
  strictDenominator,
  productionCommit: risk.evidence.health.commit,
  shaDrift: risk.traceability.shaDrift,
  command: 'node scripts/qa/build-release-status.mjs',
  exitCode: 0,
  source: 'git + GATES.csv + evidence/p0-01-production-risk.json + evidence/g4-public-matrix.json',
  verdict: 'NO_GO',
  evidencePath: 'docs/release/lokfeel-final-20261110/RELEASE_MANIFEST.json',
  gates,
  g4Summary: g4.summary,
  notes: [
    `严格口径：仅字面 PASS 计完成（G0–G12 共 ${strictDenominator} 项）⇒ ${strictPass}/${strictDenominator} PASS，未达 100%`,
    `不计完成：${notCounted.join(' / ')}；PASS_CODE_ONLY 不是 PASS（检查器仍判 G7_not_PASS）`,
    '生产收银台仍为 RISK_OPEN（D2 未决）；哨兵告警不等于止损',
    'G13 是发布后动作，本状态不得提前判 PASS',
    headSha !== sha ? `当前 HEAD ${headSha.slice(0, 7)} 为后续纯文档/证据提交；发布候选 rcSha 锁定为 ${sha.slice(0, 7)}` : '当前 HEAD 即发布候选 rcSha',
  ],
}

const manifest = {
  schemaVersion: '1.0',
  releaseName: 'lokfeel-v20.7-rc-final',
  status: 'NO_GO',
  rcSha: sha,
  productionBeforeSha: risk.evidence.health.commit,
  // 可回滚 deploy ID 不可得：本机无 netlify CLI / API token / site id；
  // x-nf-request-id 是请求 ID，不能冒充 deploy ID。如实留 null。
  productionBeforeDeployId: null,
  runtime: 'cloudflare-proxy-netlify-origin',
  baseUrl: 'https://app.lokfeel.com',
  generatedAt: new Date().toISOString(),
  humanDecisions: Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`D${i + 1}`, null])),
  releaseAuthorization: { approvedRcSha: null, approver: null, approvalEvidence: null },
  gates: Object.fromEntries(Array.from({ length: 14 }, (_, i) => [`G${i}`, gates[`G${i}`] ?? 'NOT_TESTED'])),
  evidence: Object.fromEntries(
    Array.from({ length: 13 }, (_, i) => [`G${i}`, gateEvidence[`G${i}`] ?? null]),
  ),
  rollback: { deployId: null, dryRunVerified: false, dataCompatibilityVerified: false },
  integrity: {
    source: 'GATES.csv + evidence/*（由本脚本只读组装，无手填结论）',
    g4: g4.summary,
    productionRiskVerdict: risk.verdict,
    caveat: '本 manifest 描述的是未获批准的候选；check-release-manifest.mjs 必须返回 NO_GO，其错误清单即剩余关键路径。',
  },
}

writeFileSync(path.join(DIR, 'STATUS.json'), `${JSON.stringify(status, null, 2)}\n`, 'utf8')
writeFileSync(path.join(DIR, 'RELEASE_MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

// 立刻用作战包的 fail-closed 检查器验证：必须 NO_GO，且列出全部缺口
let checkReport
try {
  execFileSync('node', ['scripts/check-release-manifest.mjs', path.join(DIR, 'RELEASE_MANIFEST.json')], { encoding: 'utf8' })
  checkReport = { verdict: 'METADATA_READY_FOR_HUMAN_REVIEW', errors: [] }
} catch (e) {
  const stdout = String(e?.stdout ?? '')
  try { checkReport = JSON.parse(stdout) } catch { checkReport = { verdict: 'NO_GO', errors: ['checker_output_unparseable'] } }
}
const gaps = {
  checkedAt: new Date().toISOString(),
  rcSha: sha,
  command: 'node scripts/check-release-manifest.mjs RELEASE_MANIFEST.json',
  exitCode: checkReport.verdict === 'NO_GO' ? 1 : 0,
  source: 'scripts/check-release-manifest.mjs（作战包原件，sha 与 ZIP 一致）',
  verdict: checkReport.verdict,
  evidencePath: 'docs/release/lokfeel-final-20261110/evidence/release-manifest-gaps.json',
  totalGaps: (checkReport.errors || []).length,
  errors: checkReport.errors || [],
  note: '这个 NO_GO 是预期且正确的：manifest 结构真实，但 G0-G12 未全 PASS、D1-D8 无批准证据、无发布授权、无回滚目标。不得通过填假值让它变绿。',
}
writeFileSync(path.join(E, 'release-manifest-gaps.json'), `${JSON.stringify(gaps, null, 2)}\n`, 'utf8')

console.log(JSON.stringify({
  rcSha: sha,
  statusWritten: existsSync(path.join(DIR, 'STATUS.json')),
  manifestWritten: existsSync(path.join(DIR, 'RELEASE_MANIFEST.json')),
  manifestVerdict: gaps.verdict,
  totalGaps: gaps.totalGaps,
}, null, 2))
