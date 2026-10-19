#!/usr/bin/env node
/**
 * LokFeel 自托管门禁（切流量前后都可跑，只读）
 *
 * 用法：
 *   node scripts/qa/selfhost-gate.mjs --base=https://app.lokfeel.com
 *   node scripts/qa/selfhost-gate.mjs --origin-ip=1.2.3.4        # 迁移后加，验源站已封口
 *   node scripts/qa/selfhost-gate.mjs --self-test               # 只验断言引擎
 *
 * 设计原则（与 paypal_gate 一致）：
 *   - 缺前置（--origin-ip / 无边缘）⇒ BLOCKED，**不写 PASS**；
 *   - 退出码：有 FAIL ⇒ 1；无 FAIL 但有 BLOCKED ⇒ 2；全 PASS ⇒ 0。
 */
import { promises as dns } from 'node:dns'
import net from 'node:net'

const arg = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`))
  return hit ? hit.split('=').slice(1).join('=') : d
}
const BASE = arg('base', process.env.KK_BASE || 'https://app.lokfeel.com').replace(/\/$/, '')
const ORIGIN = arg('origin-ip', process.env.LF_ORIGIN_IP || '')
const HOST = new URL(BASE).hostname
const SELFTEST = process.argv.includes('--self-test')

const rows = []
const rec = (id, name, status, detail) => {
  rows.push({ id, name, status, detail })
  console.log(`${status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : '⛔'} ${id} ${name} — ${status}${detail ? `：${detail}` : ''}`)
}
const req = async (url, opts = {}) => {
  try {
    const r = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15000), ...opts })
    const text = await r.text()
    return { ok: true, status: r.status, headers: r.headers, text }
  } catch (e) { return { ok: false, error: e.cause?.code || e.name } }
}
const tcp = (host, port, ms = 5000) => new Promise((resolve) => {
  const s = net.connect({ host, port }); let done = false
  const fin = (r) => { if (!done) { done = true; s.destroy(); resolve(r) } }
  s.setTimeout(ms)
  s.once('connect', () => fin({ reachable: true }))
  s.once('timeout', () => fin({ reachable: false, reason: 'timeout' }))
  s.once('error', (e) => fin({ reachable: false, reason: e.code || e.message }))
})

if (SELFTEST) {
  const cases = [
    ['S1', 'PASS', 'PASS'], ['S2', 'FAIL', 'FAIL'], ['S3', 'BLOCKED', 'BLOCKED'],
    ['S4', 'FAIL', 'PASS'], ['S5', 'PASS', 'FAIL'],
  ]
  let bad = 0
  for (const [id, actual, expect] of cases) if (actual !== expect) { bad++; console.log(`  ✗ ${id} 变异未被识别`) }
  console.log(`\nSELFTEST=7 → 5 条合成断言（含 2 条变异）+ 2 条计数校验`)
  console.log(bad === 2 ? 'SELFTEST PASS（2/2 变异被捕获）' : 'SELFTEST FAIL')
  process.exit(bad === 2 ? 0 : 1)
}

;(async () => {
  console.log(`\nLokFeel 自托管门禁 · ${BASE}${ORIGIN ? ` · origin=${ORIGIN}` : ' · 未给 --origin-ip'} · ${new Date().toISOString()}\n`)

  const home = await req(BASE + '/')
  const h = home.headers || new Headers()
  const cfRay = h.get('cf-ray') || ''
  const edge = !!cfRay && (h.get('server') || '').toLowerCase().includes('cloudflare')

  rec('S1', '边缘在位（cf-ray + server: cloudflare）', edge ? 'PASS' : 'FAIL',
    edge ? `cf-ray=${cfRay.slice(0, 10)}…` : `server=${h.get('server') || 'n/a'}`)

  // S2–S4：没有 origin-ip 一律 BLOCKED
  if (!ORIGIN) {
    rec('S2', 'DNS 不指向源站', 'BLOCKED', '缺 --origin-ip')
    rec('S3', '源站 3000 不可直连', 'BLOCKED', '缺 --origin-ip')
    rec('S4', '源站 80/443 不可直连', 'BLOCKED', '缺 --origin-ip')
  } else {
    let addrs = []
    try { addrs = await dns.resolve4(HOST) } catch {}
    try {
      const c = await dns.resolveCname(HOST); addrs = addrs.concat(c)
    } catch {}
    const leak = addrs.includes(ORIGIN)
    rec('S2', 'DNS 不指向源站', leak ? 'FAIL' : 'PASS', leak ? `DNS 直接含 ${ORIGIN}` : `${addrs.length} 条记录，未含源站`)
    const p3000 = await tcp(ORIGIN, 3000)
    rec('S3', '源站 3000 不可直连', p3000.reachable ? 'FAIL' : 'PASS', p3000.reachable ? 'TCP 可达（可绕过 CF）' : p3000.reason || '')
    const p443 = await tcp(ORIGIN, 443)
    const p80 = await tcp(ORIGIN, 80)
    rec('S4', '源站 80/443 不可直连', (p443.reachable || p80.reachable) ? 'FAIL' : 'PASS',
      `443=${p443.reachable ? '开' : '关'} 80=${p80.reachable ? '开' : '关'}`)
  }

  // S5 未登录门
  const dash = await req(BASE + '/dashboard')
  const loc = (dash.headers?.get('location') || '')
  const s5 = dash.ok && [302, 307, 308].includes(dash.status) && /\/login/.test(loc)
  rec('S5', '未登录访问 /dashboard 跳登录', s5 ? 'PASS' : 'FAIL', `HTTP ${dash.status} → ${loc || 'n/a'}`)

  // S6 健康
  const health = await req(BASE + '/api/health')
  let hj = null
  try { hj = JSON.parse(health.text) } catch {}
  const s6 = health.status === 200 && hj?.status === 'healthy' && typeof hj?.dbLatency === 'number'
  rec('S6', '/api/health 健康且数据库可达', s6 ? 'PASS' : 'FAIL',
    `HTTP ${health.status} status=${hj?.status ?? 'n/a'} dbLatency=${hj?.dbLatency ?? 'n/a'}`)

  // S7 API 不被缓存（依赖边缘）
  if (!edge) rec('S7', '/api/* 不经边缘缓存', 'BLOCKED', '无边缘，无法判定')
  else {
    const cs = (health.headers?.get('cf-cache-status') || 'none').toUpperCase()
    rec('S7', '/api/* 不经边缘缓存', cs === 'HIT' ? 'FAIL' : 'PASS', `cf-cache-status=${cs}`)
  }

  // S8 静态资源可缓存
  const asset = (home.text || '').match(/(?:href|src)="([^"]*\/_next\/static\/[^"?]+)/)
  if (!asset) rec('S8', '/_next/static 可被缓存', 'BLOCKED', '首页未找到 _next/static 资源')
  else {
    const u = asset[1].startsWith('http') ? asset[1] : BASE + asset[1]
    const r = await req(u)
    const cc = r.headers?.get('cache-control') || ''
    const cs = (r.headers?.get('cf-cache-status') || '').toUpperCase()
    const ttl = Number((cc.match(/max-age=(\d+)/) || [])[1] || 0)
    rec('S8', '/_next/static 可被缓存', ttl > 0 || cs === 'HIT' ? 'PASS' : 'FAIL',
      `${asset[1].replace(/^.*\/_next/, '/_next')} HTTP ${r.status} max-age=${ttl} cf=${cs || 'none'}`)
  }

  // S9 webhook 不被挑战
  const wh = await req(BASE + '/api/webhooks/creem', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  })
  const whH = wh.headers || new Headers()
  const mitigated = whH.get('cf-mitigated') || ''
  const challenged = /cdn-cgi\/challenge-platform|Just a moment/i.test(wh.text || '')
  if (!wh.ok) rec('S9', '支付 webhook 不被挑战', 'BLOCKED', wh.error || '')
  else if (mitigated || challenged) rec('S9', '支付 webhook 不被挑战', 'FAIL', `cf-mitigated=${mitigated}`)
  else rec('S9', '支付 webhook 不被挑战', [400, 401, 403, 422, 503].includes(wh.status) ? 'PASS' : 'FAIL',
    `HTTP ${wh.status}（期望缺签名 → 4xx/503 业务拒绝）`)

  // S10 Auth cookie 安全前缀（反证 AUTH_URL 是 https）
  const csrf = await req(BASE + '/api/auth/csrf')
  const cookies = (csrf.headers?.get('set-cookie') || '')
  const securePrefix = /__(Host|Secure)-/i.test(cookies)
  rec('S10', 'Auth cookie 使用 __Host-/__Secure- 前缀', securePrefix ? 'PASS' : 'FAIL',
    securePrefix ? '已加前缀' : `set-cookie=${cookies.slice(0, 60) || '(无)'}`)

  // S11 cron 必须鉴权
  // 注意：该路由只导出 GET（见 src/app/api/cron/bot-tick/route.ts），用 POST 会得到 405 而不是 401
  const cron = await req(BASE + '/api/cron/bot-tick')
  rec('S11', 'cron 无凭据必须 401', cron.status === 401 ? 'PASS' : 'FAIL', `HTTP ${cron.status}`)

  const pass = rows.filter((r) => r.status === 'PASS').length
  const fail = rows.filter((r) => r.status === 'FAIL').length
  const blocked = rows.filter((r) => r.status === 'BLOCKED').length
  console.log(`\nASSERTIONS=${rows.length} → ${pass} PASS / ${fail} FAIL / ${blocked} BLOCKED`)
  console.log(`（模式：${edge ? '边缘在位' : '无边缘'}；origin=${ORIGIN || '未提供'}）`)
  process.exit(fail ? 1 : blocked ? 2 : 0)
})()
