/**
 * 生产登录验证：用真实 NextAuth credentials 流程登录两个 QA 账号，
 * 并调用受保护接口，确认会话有效。输出可复用的 cookie 文件。
 *
 * 用法: node scripts/qa/verify-login.mjs
 */
import fs from 'node:fs'
import path from 'node:path'

const BASE = process.env.QA_BASE || 'https://app.lokfeel.com'
// 凭据统一从 scripts/qa/qa-credentials.mjs 解析（public 仓库不入库）
import { QA_PASSWORD } from './qa-credentials.mjs'
const PASSWORD = QA_PASSWORD
const OUT_DIR = '/tmp/qa-sessions'
fs.mkdirSync(OUT_DIR, { recursive: true })

class Jar {
  constructor() { this.m = new Map() }
  setFrom(res) {
    const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : []
    for (const c of raw) {
      const [pair] = c.split(';')
      const i = pair.indexOf('=')
      if (i > 0) this.m.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim())
    }
  }
  header() { return [...this.m.entries()].map(([k, v]) => `${k}=${v}`).join('; ') }
  dump() { return JSON.stringify([...this.m.entries()], null, 2) }
}

async function login(email) {
  const jar = new Jar()

  const csrfRes = await fetch(`${BASE}/api/auth/csrf`, {
    headers: { cookie: jar.header() },
    redirect: 'manual',
  })
  jar.setFrom(csrfRes)
  const csrfJson = await csrfRes.json()
  const csrfToken = csrfJson.csrfToken
  if (!csrfToken) throw new Error('未取到 csrfToken: ' + JSON.stringify(csrfJson))

  const body = new URLSearchParams({
    csrfToken,
    email,
    password: PASSWORD,
    callbackUrl: `${BASE}/dashboard`,
    json: 'true',
  })

  const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie: jar.header(),
      'x-auth-return-redirect': '1',
    },
    body,
    redirect: 'manual',
  })
  jar.setFrom(res)

  const sessionRes = await fetch(`${BASE}/api/auth/session`, {
    headers: { cookie: jar.header() },
    redirect: 'manual',
  })
  const session = await sessionRes.json()

  return { jar, csrfToken, status: res.status, session }
}

const ACCOUNTS = [
  { email: 'qa.male@lokfeel.com', tag: 'male' },
  { email: 'qa.female@lokfeel.com', tag: 'female' },
]

const summary = []

for (const acc of ACCOUNTS) {
  console.log(`\n================ ${acc.email} ================`)
  let r
  try {
    r = await login(acc.email)
  } catch (e) {
    console.log('  ✗ 登录请求失败:', e.message)
    summary.push({ email: acc.email, ok: false, err: e.message })
    continue
  }

  console.log('  callback HTTP:', r.status)
  console.log('  session.user:', JSON.stringify(r.session?.user ?? r.session))
  const hasSession = !!r.session?.user?.id
  console.log('  会话有效:', hasSession ? '✅ 是' : '❌ 否')

  if (!hasSession) { summary.push({ email: acc.email, ok: false }); continue }

  const cookieFile = path.join(OUT_DIR, `${acc.tag}.cookie`)
  fs.writeFileSync(cookieFile, r.jar.header(), 'utf8')
  console.log('  cookie 已存:', cookieFile)

  const probes = [
    '/api/user/limits',
    '/api/im/conversations',
    '/api/matches/inbox',
    '/api/matches',
    '/api/profile',
    '/api/discover',
  ]
  for (const p of probes) {
    try {
      const res = await fetch(`${BASE}${p}`, {
        headers: { cookie: r.jar.header() },
        redirect: 'manual',
      })
      const text = await res.text()
      console.log(`  ${p.padEnd(26)} ${res.status}  ${text.slice(0, 150).replace(/\s+/g, ' ')}`)
    } catch (e) {
      console.log(`  ${p.padEnd(26)} ERR ${e.message}`)
    }
  }

  summary.push({ email: acc.email, ok: true, userId: r.session.user.id })
}

console.log('\n================ 汇总 ================')
console.log(JSON.stringify(summary, null, 2))
