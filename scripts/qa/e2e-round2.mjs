/**
 * P0 登录态 E2E（第二轮）：
 *  A. 卡片验证墙复核（证明规则2确实由 cardVerified 控制）
 *  B. Pusher 私有频道鉴权 —— 验证 WebRTC 频道前缀不一致
 *  C. Google OAuth 发起流程（不需浏览器）
 *
 * 用法: node scripts/qa/e2e-round2.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@libsql/client'

const BASE = process.env.QA_BASE || 'https://app.lokfeel.com'
// 凭据统一从 scripts/qa/qa-credentials.mjs 解析（public 仓库不入库）
import { QA_PASSWORD } from './qa-credentials.mjs'
const PASSWORD = QA_PASSWORD
const MALE = 'dade3176-a40f-4fe4-8ea3-a5fa368e85c0'
const FEMALE = '8ea3bebc-fe58-442b-b679-43fc3286d383'
const CONV = 'cmupjcwau000109l7dcc8avag'

const root = path.resolve(import.meta.dirname, '../..')
function parseEnv(f) {
  const o = {}
  if (!fs.existsSync(f)) return o
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (m) o[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return o
}
const env = { ...parseEnv(path.join(root, '.env')), ...parseEnv(path.join(root, '.env.local')) }
const db = createClient({ url: env.DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN })

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
  jar.setFrom(r)
  return jar
}
async function api(jar, method, p, body, form) {
  const headers = { cookie: jar.header() }
  let payload
  if (form) { headers['content-type'] = 'application/x-www-form-urlencoded'; payload = new URLSearchParams(form) }
  else if (body) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body) }
  const res = await fetch(`${BASE}${p}`, { method, headers, body: payload, redirect: 'manual' })
  const text = await res.text()
  let json = null; try { json = JSON.parse(text) } catch { json = text }
  return { status: res.status, json, loc: res.headers.get('location') }
}

console.log('================ A. 卡片验证墙复核 ================')
console.log('  设置两个 QA 账号 cardVerified = 1（QA 启用步骤）')
await db.execute({ sql: 'UPDATE User SET cardVerified=1, cardVerifiedAt=? WHERE id IN (?,?)', args: [new Date().toISOString(), MALE, FEMALE] })

const female = await login('qa.female@lokfeel.com')
const male = await login('qa.male@lokfeel.com')

let okCount = 0, failMsg = ''
for (let i = 4; i <= 9; i++) {
  const r = await api(female, 'POST', '/api/im/send', { conversationId: CONV, content: `QA female reply #${i}`, msgType: 'TEXT' })
  if (r.status === 200) okCount++
  else failMsg = `${r.status} ${JSON.stringify(r.json).slice(0, 120)}`
}
check('cardVerified=1 后女性恢复发送（连发 6 条）', okCount === 6, okCount === 6 ? `全 6 条 200` : `成功 ${okCount}/6, ${failMsg}`)

const m2 = await api(male, 'POST', '/api/im/send', { conversationId: CONV, content: 'male retry after card verify', msgType: 'TEXT' })
check('免费男仍需遵守每会话 2 条（规则1独立于卡片验证）', m2.status === 403 && m2.json?.code === 'UPGRADE_REQUIRED', `${m2.status} ${m2.json?.code || ''}`)

console.log('\n================ B. Pusher 私有频道鉴权 ================')
const p1 = await api(male, 'POST', '/api/im/pusher/auth', null, { socket_id: '1234.5678', channel_name: `private-im-${MALE}` })
console.log(`  自己的 private-im- 频道 → ${p1.status} ${JSON.stringify(p1.json).slice(0, 160)}`)
check('鉴权放行自己的 private-im- 频道', p1.status === 200 || p1.status === 404, String(p1.status))

const p2 = await api(male, 'POST', '/api/im/pusher/auth', null, { socket_id: '1234.5678', channel_name: `private-im-${FEMALE}` })
console.log(`  他人的 private-im- 频道 → ${p2.status} ${JSON.stringify(p2.json).slice(0, 160)}`)
check('鉴权拒绝他人的 private-im- 频道', p2.status === 403, String(p2.status))

const p3 = await api(male, 'POST', '/api/im/pusher/auth', null, { socket_id: '1234.5678', channel_name: `private-user-${MALE}` })
console.log(`  通话频道 private-user-{自己} → ${p3.status} ${JSON.stringify(p3.json).slice(0, 200)}`)
check('★ 通话频道前缀 private-user- 被鉴权拒绝（印证 P0-2 ③）', p3.status === 403 || p3.status === 400, `${p3.status} ${p3.json?.error || ''}`)

console.log('\n================ C. Google OAuth 发起 ================')
const cj = new Jar()
const cres = await fetch(`${BASE}/api/auth/csrf`, { headers: { cookie: cj.header() } }); cj.setFrom(cres)
const { csrfToken } = await cres.json()
const oauthRes = await fetch(`${BASE}/api/auth/signin/google`, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cj.header() },
  body: new URLSearchParams({ csrfToken, callbackUrl: `${BASE}/dashboard` }),
  redirect: 'manual',
})
const loc = oauthRes.headers.get('location') || ''
console.log(`  HTTP ${oauthRes.status}`)
console.log(`  Location: ${loc.slice(0, 240)}`)
check('Google 登录跳转成功（302 → accounts.google.com）', oauthRes.status === 302 && loc.includes('accounts.google.com'), String(oauthRes.status))
let redirectUri = ''
try { redirectUri = new URL(loc).searchParams.get('redirect_uri') || '' } catch {}
console.log(`  redirect_uri = ${redirectUri}`)
check('redirect_uri 指向生产回调地址（已注册白名单）', redirectUri === `${BASE}/api/auth/callback/google`, redirectUri)
check('OAuth 带 PKCE（code_challenge）', (() => { try { return !!new URL(loc).searchParams.get('code_challenge') } catch { return false } })())

console.log('\n================ 汇总 ================')
const pass = results.filter(r => r.ok).length
console.log(`通过 ${pass}/${results.length}`)
for (const r of results) if (!r.ok) console.log(`  ❌ ${r.n}`)

await db.close()
