#!/usr/bin/env node
/**
 * W3/W4 Staging 审计入口（方案 A 最小树）。
 *
 * 硬性护栏：
 *  1. 只接受 --base 为已部署 HTTPS Staging URL；拒绝 localhost / file: / 生产域名 app.lokfeel.com。
 *  2. 先做 Staging 身份断言（health 200 + healthy + commit 对齐 + DB 延迟有值），否则 abort。
 *  3. 支付门只读校验：plans 必须 pricingPublished=false、plans=[]。
 *  4. 八页浏览器审计 + 双账号业务闭环委托给已验证的脚本：
 *       - 只读/八页/CTA/登录态：scripts/qa/p03-preview-runtime-audit.mjs --base=<staging> --writes
 *       - A/B 邀请闭环：scripts/qa/p01-friend-invite-loop.mjs（需 staging-capable 改造，见下）
 *  5. 写操作必须显式 --writes；无此标志时只读，不向共享库写测试数据。
 *
 * 用法：
 *   node scripts/qa/staging-audit-runner.mjs \
 *     --base=https://lokfeel-app.netlify.app --commit=77bbb222 [--writes]
 *
 * 环境：QA 双账号经 AUDIT_EMAIL/AUDIT_PASSWORD（或 .qa-credentials.local.json）注入，
 *       Playwright 系统 Chrome 用 PW_CHANNEL=chrome。凭据不落盘、不进日志。
 *
 * 注意：本 runner 只做「身份+门禁+只读页」的强校验并给出明确 verdict。
 *       W3 的 20/20 消息与 DB 对账、W4 的移动端/axe，由委托脚本在 Staging 上产出证据后归档。
 *       任何一步不通过，verdict=BLOCKED/FAIL，绝不标 Staging PASS。
 */
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')
const argv = process.argv.slice(2)
const argOf = (k, d) => {
  const hit = argv.find((a) => a.startsWith(`--${k}=`))
  return hit ? hit.slice(k.length + 3) : d
}
const has = (k) => argv.includes(`--${k}`)

const BASE = argOf('base', '').replace(/\/$/, '')
const EXPECT_COMMIT = argOf('commit', '')
const ALLOW_WRITES = has('writes')
const OUT = path.resolve(ROOT, argOf('out', 'docs/release/s0-w1-w5-20261124/staging-audit'))

function fail(msg) {
  console.error(`STAGING_AUDIT_REFUSED: ${msg}`)
  process.exit(2)
}

// ── 护栏 1：base 必须是已部署 HTTPS Staging，且不是生产 ───────────────────
if (!/^https:\/\//i.test(BASE)) fail(`--base 必须是 HTTPS 部署 URL，收到: ${BASE || '(空)'}`)
if (/127\.0\.0\.1|localhost|0\.0\.0\.0|\[::1\]|file:/i.test(BASE)) fail('拒绝 localhost/file: —— 不得把本地 dev/build 冒充 Staging')
if (/app\.lokfeel\.com|(^|\.)lokfeel\.app$/i.test(BASE)) fail('拒绝生产域名 app.lokfeel.com —— W3/W4 测试写操作不得打生产')

await fs.promises.mkdir(OUT, { recursive: true })

const result = {
  verdict: 'BLOCKED',
  base: BASE,
  expectCommit: EXPECT_COMMIT,
  allowWrites: ALLOW_WRITES,
  checkedAt: new Date().toISOString(),
  checks: {},
  delegated: [],
  notes: [],
}

// ── 护栏 2：Staging 身份断言（health） ─────────────────────────────────────
async function getJson(url, timeoutMs = 20000) {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: ac.signal, headers: { accept: 'application/json' } })
    const text = await res.text()
    let body = null
    try { body = JSON.parse(text) } catch { /* 非 JSON 保留原文 */ }
    return { status: res.status, body, raw: text.slice(0, 500) }
  } finally {
    clearTimeout(t)
  }
}

const health = await getJson(`${BASE}/api/health`)
result.checks.health = { status: health.status, statusText: health.body?.status ?? null, commit: health.body?.commit ?? null, dbLatency: health.body?.dbLatency ?? null }

let identityOk = health.status === 200 && health.body?.status === 'healthy' && typeof health.body?.dbLatency === 'number'
if (!identityOk) {
  result.notes.push(`health 未达 healthy/200，或 DB 延迟非数值：${JSON.stringify(result.checks.health)}`)
} else if (EXPECT_COMMIT && health.body?.commit && health.body.commit !== EXPECT_COMMIT && !health.body.commit.startsWith(EXPECT_COMMIT)) {
  result.notes.push(`health commit=${health.body.commit} 与期望 ${EXPECT_COMMIT} 不一致`)
  identityOk = false
} else {
  result.checks.identity = 'PASS'
}

// ── 护栏 3：支付门 fail-closed（只读） ────────────────────────────────────
const plans = await getJson(`${BASE}/api/payments/dodo/plans`)
const plansOk = plans.status === 200 && plans.body?.pricingPublished === false && Array.isArray(plans.body?.plans) && plans.body.plans.length === 0
result.checks.paymentGate = { status: plans.status, pricingPublished: plans.body?.pricingPublished ?? null, plansCount: Array.isArray(plans.body?.plans) ? plans.body.plans.length : null, pass: plansOk }
if (!plansOk) result.notes.push(`支付门未 fail-closed：${JSON.stringify(result.checks.paymentGate)}`)

// ── 护栏 4：非法邀请码 4xx（不得 500） ────────────────────────────────────
let inviteStatus = 0
try {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), 20000)
  const res = await fetch(`${BASE}/api/v1/invitations/accept`, {
    method: 'POST',
    signal: ac.signal,
    headers: { 'content-type': 'application/json', origin: new URL(BASE).origin },
    body: JSON.stringify({ token: '__staging_probe_invalid__' }),
  })
  inviteStatus = res.status
  clearTimeout(t)
} catch (e) {
  result.notes.push(`邀请码探针请求失败：${String(e)}`)
}
result.checks.invalidInvite = { status: inviteStatus, pass: inviteStatus >= 400 && inviteStatus < 500 }
if (!result.checks.invalidInvite.pass) result.notes.push(`非法邀请码未返回 4xx：${inviteStatus}`)

// ── 委托脚本（存在才登记，不在本 runner 内伪造其证据） ───────────────────
const delegates = [
  'scripts/qa/p03-preview-runtime-audit.mjs',
  'scripts/qa/p01-friend-invite-loop.mjs',
  'scripts/qa/v256-two-browser-chat-e2e-full.mjs',
]
for (const rel of delegates) {
  result.delegated.push({ script: rel, present: fs.existsSync(path.resolve(ROOT, rel)), executedByRunner: false })
}

const allOk = identityOk && plansOk && result.checks.invalidInvite.pass
result.verdict = allOk ? (ALLOW_WRITES ? 'GATES_PASS_AWAIT_DELEGATED_EVIDENCE' : 'GATES_PASS_READONLY') : 'FAIL'
result.summary = allOk
  ? '身份/支付门/邀请码三道只读门禁通过；W3 双账号闭环与 W4 八页/移动端/axe 证据须由委托脚本在 Staging 产出后归档，本 runner 不代其宣称 PASS。'
  : '存在未通过的只读门禁，Staging 不得标记 PASS。'

const outFile = path.join(OUT, 'runner-result.json')
await fs.promises.writeFile(outFile, JSON.stringify(result, null, 2), 'utf8')
console.log(JSON.stringify(result, null, 2))
console.log(`\n证据写入：${outFile}`)

process.exit(allOk ? 0 : 1)
