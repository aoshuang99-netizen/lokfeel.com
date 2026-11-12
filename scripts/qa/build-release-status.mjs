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
const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const remote = execFileSync('git', ['ls-remote', 'origin', 'refs/heads/main'], { encoding: 'utf8' }).trim().split(/\s+/)[0]
const risk = readJson(path.join(E, 'p0-01-production-risk.json'))
const g4 = readJson(path.join(E, 'g4-public-matrix.json'))

// 门禁状态取自 GATES.csv（唯一表），不在这里另写一套结论
const gateRows = readFileSync(path.join(DIR, 'GATES.csv'), 'utf8').trim().split(/\r?\n/).slice(1)
const gates = {}
const gateEvidence = {}
for (const line of gateRows) {
  const [gate, verdict, , , , evidencePath] = line.split(',')
  gates[gate.split('-')[0]] = verdict
  gateEvidence[gate.split('-')[0]] = evidencePath || null
}

const status = {
  timestamp: new Date().toISOString(),
  releaseName: 'lokfeel-v20.7-rc-final',
  rcSha: sha,
  remoteMainSha: remote,
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
    'PARTIAL / BLOCKED / NOT_TESTED 不计完成 ⇒ 13 门禁中 6 PASS，未达 100%',
    '生产收银台仍为 RISK_OPEN（D2 未决）；哨兵告警不等于止损',
    'G13 是发布后动作，本状态不得提前判 PASS',
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
