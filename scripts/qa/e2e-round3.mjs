/**
 * P0 登录态 E2E（第三轮）：修正契约后的 Pusher 鉴权 + Google OAuth 全链路
 * 用法: node scripts/qa/e2e-round3.mjs
 */
const BASE = process.env.QA_BASE || 'https://app.lokfeel.com'
// 凭据统一从 scripts/qa/qa-credentials.mjs 解析（public 仓库不入库）
import { QA_PASSWORD } from './qa-credentials.mjs'
const PASSWORD = QA_PASSWORD
const MALE = 'dade3176-a40f-4fe4-8ea3-a5fa368e85c0'
const FEMALE = '8ea3bebc-fe58-442b-b679-43fc3286d383'
const CONV = 'cmupjcwau000109l7dcc8avag'

const results = []
const check = (n, ok, d = '') => { results.push({ n, ok }); console.log(`  ${ok ? '✅' : '❌'} ${n}${d ? '  → ' + d : ''}`) }

class Jar {
  constructor() { this.m = new Map() }
  setFrom(res) {
    const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : []
    for (const c of raw) { const [p] = c.split(';'); const i = p.indexOf('='); if (i > 0) this.m.set(p.slice(0, i).trim(), p.slice(i + 1).trim()) }
  }
  header() { return [...this.m.entries()].map(([k, v]) => `${k}=${v}`).join('; ') }
}
async function login(email) {
  const jar = new Jar()
  const c = await fetch(`${BASE}/api/auth/csrf`, { headers: { cookie: jar.header() } }); jar.setFrom(c)
  const { csrfToken } = await c.json()
  const r = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: jar.header() },
    body: new URLSearchParams({ csrfToken, email, password: PASSWORD, callbackUrl: `${BASE}/dashboard`, json: 'true' }), redirect: 'manual',
  })
  jar.setFrom(r); return jar
}
async function pusherAuth(jar, channel) {
  const res = await fetch(`${BASE}/api/im/pusher/auth`, {
    method: 'POST', headers: { cookie: jar.header(), 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ socket_id: '1234.5678', channel_name: channel }), redirect: 'manual',
  })
  const text = await res.text(); let j = null; try { j = JSON.parse(text) } catch { j = text }
  return { status: res.status, json: j }
}

const male = await login('qa.male@lokfeel.com')
const female = await login('qa.female@lokfeel.com')

console.log('================ Pusher 私有频道鉴权（正确契约）================')
const cases = [
  [`private-im-user-${MALE}`, 200, '自己的用户频道'],
  [`private-im-user-${FEMALE}`, 200, '★越权：订阅他人用户频道（应拒绝）'],
  [`private-im-conv-${CONV}`, 200, '自己参与的会话频道'],
  ['private-im-conv-00000000-0000-0000-0000-000000000000', 403, '不存在的会话频道'],
  [`private-user-${MALE}`, 403, '★通话频道前缀（webrtc.config 使用）'],
]
for (const [ch, expect, desc] of cases) {
  const r = await pusherAuth(male, ch)
  const ok = r.status === expect
  console.log(`  ${ch.padEnd(48)} ${r.status} ${JSON.stringify(r.json).slice(0, 90)}   [${desc}]`)
  check(`${desc}: ${ch.slice(0, 34)}… → ${expect}`, ok, String(r.status))
}

console.log('\n================ Google OAuth 全链路 ================')
const sres = await fetch(`${BASE}/api/auth/oauth/google/signin?callbackUrl=${encodeURIComponent('/dashboard')}`, { redirect: 'manual' })
const loc = sres.headers.get('location') || ''
console.log(`  HTTP ${sres.status}`)
console.log(`  Location: ${loc.slice(0, 200)}`)
check('OAuth 入口 302 跳转 Google', sres.status === 302 && loc.includes('accounts.google.com'), String(sres.status))
let u = null; try { u = new URL(loc) } catch {}
if (u) {
  const ru = u.searchParams.get('redirect_uri')
  const cc = u.searchParams.get('code_challenge')
  const scope = u.searchParams.get('scope')
  const state = u.searchParams.get('state')
  console.log(`  client_id      = ${(u.searchParams.get('client_id') || '').slice(0, 22)}…`)
  console.log(`  redirect_uri   = ${ru}`)
  console.log(`  scope          = ${scope}`)
  console.log(`  code_challenge = ${cc ? cc.slice(0, 20) + '…' : '(无)'}`)
  console.log(`  state          = ${state ? state.slice(0, 16) + '…' : '(无)'}`)
  check('redirect_uri 指向生产回调（须与 Google 白名单一致）', ru === `${BASE}/api/auth/callback/google`, ru || '')
  check('使用 PKCE（code_challenge）', !!cc)
  check('携带 state（防 CSRF）', !!state)
  check('scope 仅 openid/email/profile', !!scope && !/drive|calendar|gmail/.test(scope), scope || '')
}

console.log('\n================ 汇总 ================')
const pass = results.filter(r => r.ok).length
console.log(`通过 ${pass}/${results.length}`)
for (const r of results) if (!r.ok) console.log(`  ❌ ${r.n}`)
