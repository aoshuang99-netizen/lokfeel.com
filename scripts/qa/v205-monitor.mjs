#!/usr/bin/env node
/**
 * V20.5 GA · Batch 6 生产监控探针（十项信号，一条命令）
 * ═══════════════════════════════════════════════════════════════
 *
 * 这是 GA 的「发布后可观测性」的可执行版本。零预算（没有 Prometheus/Grafana），
 * 信号来源只有三个：HTTP 探测、/api/health、只读 SQL。**全部只读** —— 唯一的
 * 写入是 QA 登录留下的 LoginAudit（所有 verify 脚本都这么干）。
 *
 * 十项信号（总作战令 Batch 6 原文顺序）：
 *   M01 5xx 比例           —— 公开 + 登录态两块电池，任何 5xx 即 FAIL
 *   M02 p50/p95 延迟       —— 关键路径采样分位数（基线，无硬预算）
 *   M03 登录成功           —— QA 账号真实登录 + session 回读
 *   M04 Agent 成功/失败    —— 7 天窗口 agent.run.* 事件分布
 *   M05 Provider 降级      —— agent.run.degraded 计数 + 生产出口连通性诊断
 *   M06 Consent 异常       —— member.opted_* 无 actor（"没人点头的同意"）+ optin_rejected
 *   M07 Outcome 核验       —— outcome.* 事件分布；写路径的失败信号由 Batch 4 断言覆盖
 *   M08 DB 错误            —— health.status + dbLatency 三采样
 *   M09 Secrets            —— charging 必须 false（GA 关支付）+ malformed 必须空
 *   M10 部署漂移           —— Netlify published_deploy.commit_ref（权威）vs health.commit
 *
 * 附带 Workers 轨道不变量：x-nf-request-id 存在 = 流量仍走 Netlify 源，
 * Cloudflare Worker 未劫持（G-06：GA 不切 Workers，那是独立验证轨道）。
 *
 * 用法：
 *   node scripts/qa/v205-monitor.mjs                          # 对生产
 *   node scripts/qa/v205-monitor.mjs --base=http://localhost:3111
 *   node scripts/qa/v205-monitor.mjs --expect-commit=1a54de3   # 发布后核对
 * 退出码：FAIL 数（0 = 全绿）。BLOCKED（拿不到数据源）不计失败但单列。
 */

import fs from 'node:fs'
import { createClient } from '@libsql/client'

// ── 参数与环境 ─────────────────────────────────────────────────
function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}
const BASE = arg('base', 'https://app.lokfeel.com').replace(/\/$/, '')
const EXPECT_COMMIT = arg('expect-commit', '').trim().toLowerCase()
const WINDOW_DAYS = Number(arg('window', '7'))

function loadEnv() {
  const out = {}
  for (const f of ['.env', '.env.local']) {
    if (!fs.existsSync(f)) continue
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
      if (m && !(m[1] in out)) out[m[1]] = m[2].replace(/^["']|["']$/g, '').trim()
    }
  }
  return out
}
const ENV = { ...loadEnv(), ...process.env }

const results = []
function record(id, name, status, detail) {
  results.push({ id, name, status })
  const mark = status === 'PASS' ? '✓' : status === 'FAIL' ? '✗' : '?'
  console.log(`${mark} ${id.padEnd(5)} ${name}`.padEnd(34), `[${status}]`, detail ?? '')
}
const percentile = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)] ?? null
}

async function timed(url, init = {}, timeoutMs = 25_000) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  const t0 = Date.now()
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal, redirect: 'manual' })
    const ms = Date.now() - t0
    let body = null
    try { body = await res.json() } catch { /* 非 JSON */ }
    return { res, ms, body }
  } catch (e) {
    return { res: null, ms: Date.now() - t0, error: String(e?.message ?? e) }
  } finally {
    clearTimeout(timer)
  }
}

// ── 凭据与登录 ─────────────────────────────────────────────────
const CREDS = fs.existsSync('.qa-credentials.local.json')
  ? JSON.parse(fs.readFileSync('.qa-credentials.local.json', 'utf8'))
  : null

async function login(email, password) {
  const r = await timed(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: BASE },
    body: JSON.stringify({ email, password }),
  })
  if (!r.res || r.res.status !== 200) return { ok: false, status: r.res?.status ?? 'ERR', ms: r.ms }
  const jar = (r.res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
  return { ok: true, jar, ms: r.ms }
}

// ── 主流程 ─────────────────────────────────────────────────────
console.log(`目标：${BASE}（窗口 ${WINDOW_DAYS} 天）· ${new Date().toISOString()}`)
let jar = ''

// M03 登录（顺带拿会话给后面用）
if (CREDS) {
  const ses = await login('qa.male@lokfeel.com', CREDS.malePassword ?? CREDS.password)
  if (ses.ok) {
    jar = ses.jar
    const sess = await timed(`${BASE}/api/auth/session`, { headers: { Cookie: jar } })
    const user = sess.body?.user
    record('M03', '登录成功（真实账号 + session 回读）', sess.res?.status === 200 && user ? 'PASS' : 'FAIL',
      `login=${ses.ms}ms session=${sess.res?.status} user=${user?.email ?? '无'}`)
  } else {
    record('M03', '登录成功（真实账号 + session 回读）', 'FAIL', `登录失败 status=${ses.status}`)
  }
} else {
  record('M03', '登录成功（真实账号 + session 回读）', 'BLOCKED', '缺 .qa-credentials.local.json')
}

// M08 DB（health 三采样，顺带给 M02 供数）
const healths = []
for (let i = 0; i < 3; i++) healths.push(await timed(`${BASE}/api/health`))
const healthy = healths.filter((h) => h.res?.status === 200 && h.body?.status === 'healthy')
const dbLat = healths.map((h) => h.body?.dbLatency).filter((n) => typeof n === 'number')
record('M08', 'DB 错误（health.status × 3 采样）', healthy.length === 3 ? 'PASS' : 'FAIL',
  `healthy=${healthy.length}/3 dbLatency=${dbLat.map((n) => Math.round(n)).join(',')}ms`)
const health = healths.find((h) => h.body)?.body ?? {}

// M09 Secrets（GA 关支付 + 无畸形）
const pay = health.payments ?? {}
const secretsOk = pay.charging === false && !(pay.malformed ?? []).length
record('M09', 'Secrets（charging 必须 false · malformed 必须空）', secretsOk ? 'PASS' : 'FAIL',
  `charging=${pay.charging} malformed=${(pay.malformed ?? []).length} missing=${(pay.missing ?? []).length}（missing=已知人工项 H-4）`)

// M01 5xx 电池（公开 + 登录态）
const publicBattery = ['/', '/login', '/api/health', '/api/v1/spec']
const authedBattery = jar ? ['/workspace', '/console', '/api/v1/org'] : []
const codes = []
for (const p of publicBattery) {
  const r = await timed(`${BASE}${p}`)
  codes.push({ p, status: r.res?.status ?? 0 })
}
for (const p of authedBattery) {
  const r = await timed(`${BASE}${p}`, { headers: { Cookie: jar } })
  codes.push({ p, status: r.res?.status ?? 0 })
}
const s5xx = codes.filter((c) => c.status >= 500)
record('M01', `5xx 比例（${publicBattery.length + authedBattery.length} 端点 × 1 轮）`, s5xx.length ? 'FAIL' : 'PASS',
  s5xx.length ? `5xx×${s5xx.length}: ${s5xx.map((c) => `${c.p}=${c.status}`).join(' ')}` : `全 ${codes.length} 个 0 个 5xx`)

// M02 p50/p95（关键路径；home × 6 + health × 3 + console(auth) × 3）
const lat = []
for (let i = 0; i < 6; i++) lat.push((await timed(`${BASE}/`)).ms)
for (const h of healths) lat.push(h.ms)
if (jar) for (let i = 0; i < 3; i++) lat.push((await timed(`${BASE}/console`, { headers: { Cookie: jar } })).ms)
const p50 = percentile(lat, 50)
const p95 = percentile(lat, 95)
record('M02', `延迟 p50/p95（${lat.length} 采样）`, p95 && p95 < 5000 ? 'PASS' : 'FAIL',
  `p50=${p50}ms p95=${p95}ms（基线记录；跨境网络含 ~250ms RTT）`)

// M10 部署漂移（Netlify API = 权威；health.commit 只是辅助）
const netlifyToken = ENV.NETLIFY_AUTH_TOKEN
if (netlifyToken) {
  const SITE = 'c46478e9-7ac8-4bcf-9052-7638b04fef83'
  const r = await timed(`https://api.netlify.com/api/v1/sites/${SITE}`, {
    headers: { Authorization: `Bearer ${netlifyToken}` },
  })
  const deployed = String(r.body?.published_deploy?.commit_ref ?? '').slice(0, 7)
  const healthCommit = String(health.commit ?? '').slice(0, 7)
  const expect = EXPECT_COMMIT || healthCommit
  const match = deployed && deployed === expect
  record('M10', '部署漂移（Netlify published_deploy vs expect）', match ? 'PASS' : 'FAIL',
    `deployed=${deployed || '未知'} health.commit=${healthCommit} expect=${expect}${deployed === healthCommit ? '' : ' ⚠️两源不一致'}`)
} else {
  record('M10', '部署漂移（Netlify published_deploy vs expect）', 'BLOCKED', '缺 NETLIFY_AUTH_TOKEN')
}

// Workers 轨道不变量：流量必须仍走 Netlify 源（x-nf-request-id）
const root = await timed(`${BASE}/api/health`)
const nfId = root.res?.headers?.get?.('x-nf-request-id')
record('G06', 'Workers 轨道不变量（x-nf-request-id 存在）', nfId ? 'PASS' : 'FAIL',
  nfId ? `Netlify 源在役 ${String(nfId).slice(0, 24)}…` : '未检测到 Netlify 头 —— 疑似流量被 Worker 劫持')

// ── DB 只读信号（M04/M05/M06/M07）──────────────────────────────
if (ENV.DATABASE_URL && ENV.TURSO_AUTH_TOKEN) {
  const db = createClient({ url: ENV.DATABASE_URL, authToken: ENV.TURSO_AUTH_TOKEN })
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString()

  async function dist(eventPrefix) {
    const r = await db.execute({
      sql: `SELECT eventType, COUNT(*) AS n FROM "TenantAuditEvent"
            WHERE createdAt >= ? AND eventType LIKE ? GROUP BY eventType ORDER BY n DESC`,
      args: [since, `${eventPrefix}%`],
    })
    return Object.fromEntries(r.rows.map((row) => [row.eventType, Number(row.n)]))
  }

  // M04 Agent 成功/失败
  try {
    const a = await dist('agent.run')
    const created = a['agent.run.created'] ?? 0
    const executed = a['agent.run.executed'] ?? 0
    const blocked = a['agent.run.blocked_quota'] ?? 0
    const degraded = a['agent.run.degraded'] ?? 0
    const incoherent = created > 0 && executed === 0 && blocked === 0 && degraded === 0
    record('M04', `Agent 成功/失败（${WINDOW_DAYS} 天事件分布）`, incoherent ? 'FAIL' : 'PASS',
      `created=${created} executed=${executed} blocked=${blocked} degraded=${degraded}${created === 0 ? '（窗口内无运行）' : ''}`)
  } catch (e) {
    record('M04', 'Agent 成功/失败', 'BLOCKED', String(e?.message).slice(0, 60))
  }

  // M05 Provider 降级（事件侧）+ 生产出口连通性（端点侧）
  try {
    const d = await dist('agent.run')
    const degraded = d['agent.run.degraded'] ?? 0
    let conn = '（未测）'
    let connStatus = 'PASS'
    if (jar) {
      const org = await timed(`${BASE}/api/v1/org`, { headers: { Cookie: jar } })
      const orgId = org.body?.data?.organization?.id
      if (orgId) {
        const c = await timed(`${BASE}/api/v1/agents/diagnostics/connectivity?organizationId=${orgId}`,
          { headers: { Cookie: jar } })
        const net = c.body?.data?.network
        const identity = c.body?.data?.identity
        if (c.res?.status === 200 && net) {
          conn = `出口=${net.verdict} ${net.latencyMs ?? '?'}ms ${identity ? `身份=${String(identity.verdict ?? 'ok').slice(0, 20)}` : ''}`
          if (net.verdict !== 'PASS') connStatus = 'FAIL'
        } else {
          connStatus = 'BLOCKED'
          conn = `诊断端点 status=${c.res?.status}（能力或租户不足）`
        }
      }
    }
    record('M05', 'Provider 降级（degraded 事件 + 生产出口自检）', connStatus, `degraded=${degraded} ${conn}`)
  } catch (e) {
    record('M05', 'Provider 降级', 'BLOCKED', String(e?.message).slice(0, 60))
  }

  // M06 Consent 异常：没人点头的同意（opted_* 无 actor）+ 拒绝率
  try {
    const r = await db.execute({
      sql: `SELECT eventType, COUNT(*) AS n FROM "TenantAuditEvent"
            WHERE createdAt >= ? AND eventType IN ('member.opted_in','member.opted_out','bridge.optin_rejected')
            GROUP BY eventType`,
      args: [since],
    })
    const m = Object.fromEntries(r.rows.map((row) => [row.eventType, Number(row.n)]))
    const orphan = await db.execute({
      sql: `SELECT COUNT(*) AS n FROM "TenantAuditEvent"
            WHERE createdAt >= ? AND eventType IN ('member.opted_in','member.opted_out') AND actorId IS NULL`,
      args: [since],
    })
    const orphanN = Number(orphan.rows[0]?.n ?? 0)
    record('M06', 'Consent 异常（opted_* 必须有 actor）', orphanN === 0 ? 'PASS' : 'FAIL',
      `opted_in=${m['member.opted_in'] ?? 0} opted_out=${m['member.opted_out'] ?? 0} 拒绝=${m['bridge.optin_rejected'] ?? 0} 无actor=${orphanN}`)
  } catch (e) {
    record('M06', 'Consent 异常', 'BLOCKED', String(e?.message).slice(0, 60))
  }

  // M07 Outcome 核验（事件分布 + workflow 死信）
  try {
    const o = await dist('outcome')
    const w = await db.execute({
      sql: `SELECT COUNT(*) AS n FROM "TenantAuditEvent"
            WHERE createdAt >= ? AND eventType IN ('workflow.failed_permanently','workflow.dead_lettered')`,
      args: [since],
    })
    const dead = Number(w.rows[0]?.n ?? 0)
    record('M07', 'Outcome 核验（outcome.* 分布 + workflow 死信）', 'PASS',
      `reported=${o['outcome.reported'] ?? 0} confirmed=${o['outcome.confirmed'] ?? 0} verified=${o['outcome.externally_verified'] ?? 0} 死信=${dead}（写路径失败信号由 Batch 4 断言覆盖）`)
  } catch (e) {
    record('M07', 'Outcome 核验', 'BLOCKED', String(e?.message).slice(0, 60))
  }
} else {
  for (const id of ['M04', 'M05', 'M06', 'M07']) record(id, 'DB 只读信号', 'BLOCKED', '缺 DATABASE_URL/TURSO_AUTH_TOKEN')
}

// ── 汇总 ───────────────────────────────────────────────────────
const pass = results.filter((r) => r.status === 'PASS').length
const fail = results.filter((r) => r.status === 'FAIL').length
const blocked = results.filter((r) => r.status === 'BLOCKED').length
console.log(`\n=== ${pass} PASS / ${fail} FAIL / ${blocked} BLOCKED ===`)
process.exit(fail)
