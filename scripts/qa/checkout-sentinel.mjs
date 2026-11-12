#!/usr/bin/env node
/**
 * A-01 · 生产收银台风险哨兵 · 只读取证（对生产零写入）。
 *
 * 用法：
 *   node scripts/qa/checkout-sentinel.mjs [--base=https://app.lokfeel.com]
 *   node scripts/qa/checkout-sentinel.mjs --stop-loss-authorized   # 仅在你明确授权止损后使用
 *
 * 行为：按 buildSentinelPlan() 发两个只读 GET → 注入判定层 → 追加 evidence 日志 → 打印结论。
 * 退出码：ERROR = 1（取证不完整，绝不判 PASS）；RISK_OPEN = 0 但打印风险提示（告警不等于已止损）。
 */
import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { evaluateCheckoutSentinel, buildSentinelPlan } from './checkout-sentinel-verdict.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '../..')
const EVIDENCE_DIR = path.join(REPO, 'docs/release/lokfeel-final-20261110/evidence')
const BASE = (
  process.argv.find((a) => a.startsWith('--base='))?.slice('--base='.length) ||
  'https://app.lokfeel.com'
).replace(/\/$/, '')
const AUTHORIZED = process.argv.includes('--stop-loss-authorized')

async function readGet(url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 12000)
  try {
    const res = await fetch(url, { method: 'GET', signal: controller.signal })
    const text = await res.text()
    let body = null
    try {
      body = JSON.parse(text)
    } catch {
      body = null
    }
    return { httpStatus: res.status, body }
  } finally {
    clearTimeout(timer)
  }
}

const plan = buildSentinelPlan(BASE)
const observation = { httpStatus: 0, plans: null }
try {
  const res = await readGet(plan[0].url)
  observation.httpStatus = res.httpStatus
  observation.plans = res.body
} catch (err) {
  observation.fetchError = String(err?.message ?? err).slice(0, 120)
}

let production = null
try {
  const res = await readGet(plan[1].url)
  production = {
    httpStatus: res.httpStatus,
    status: res.body?.status ?? null,
    commit: res.body?.commit ?? null,
  }
} catch (err) {
  production = { httpStatus: 0, error: String(err?.message ?? err).slice(0, 120) }
}

let remoteSha = ''
try {
  const out = execFileSync('git', ['ls-remote', 'origin', 'refs/heads/main'], {
    cwd: REPO,
    encoding: 'utf8',
    timeout: 15000,
  })
  remoteSha = out.trim().split(/\s+/)[0] || ''
} catch {
  remoteSha = ''
}

const result = evaluateCheckoutSentinel({ ...observation, remoteSha, stopLossAuthorized: AUTHORIZED })
const record = {
  at: new Date().toISOString(),
  base: BASE,
  requests: plan,
  verdict: result.verdict,
  reasons: result.reasons,
  evidence: result.evidence,
  production,
  stopLossAuthorized: AUTHORIZED,
}

mkdirSync(EVIDENCE_DIR, { recursive: true })
appendFileSync(
  path.join(EVIDENCE_DIR, `checkout-sentinel-${new Date().toISOString().slice(0, 10)}.log`),
  `${JSON.stringify(record)}\n`,
)
console.log(JSON.stringify(record, null, 2))

if (result.verdict === 'RISK_OPEN') {
  console.log('\n[RISK] 线上收银台仍开放 · R-15 风险未止损 · 请对 D2 表态（发布候选 / 摘除 DODO_PAYMENTS_API_KEY）')
}
if (result.verdict === 'ERROR') {
  console.error('\n[ERROR] 取证不完整，不得判 PASS')
  process.exitCode = 1
}
