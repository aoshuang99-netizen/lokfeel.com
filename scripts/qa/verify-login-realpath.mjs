/**
 * 生产真实登录路径复验 —— 补上一个长期盲区
 *
 * WHY 需要单独一个脚本：
 *   `verify-login.mjs` 走的是 NextAuth 的 `/api/auth/callback/credentials`，
 *   而用户在登录页实际提交的是**自定义端点** `/api/auth/login`。
 *   两者是不同的代码路径（自定义端点还带同源守卫），前者通过不代表后者可用。
 *   发版窗口期最典型的故障正是「登录成功后立刻又变回未登录」（cookie 落在
 *   部署专用域名上），而它恰好只在真实登录路径上暴露。
 *
 * 判据：
 *   ① 自定义端点返回 200 且下发会话 cookie
 *   ② cookie 不下发到部署专用域名（host-only 落公开域名）
 *   ③ 带上该 cookie 请求 /api/auth/session → 拿得到 user.id（会话确实成立）
 *   ④ T03 受保护端点：401 = 会话没带上（失败）；403/200 = 会话有效（通过）
 *
 * 用法: node scripts/qa/verify-login-realpath.mjs
 *       QA_BASE=https://app.lokfeel.com node scripts/qa/verify-login-realpath.mjs
 */
import { QA_PASSWORD } from './qa-credentials.mjs'

const BASE = (process.env.QA_BASE || 'https://app.lokfeel.com').replace(/\/$/, '')
const PUBLIC_HOST = new URL(BASE).host
const DEPLOY_HOST_RE = /--[a-z0-9-]+\.netlify\.app/i

const ACCOUNTS = [
  { email: 'qa.male@lokfeel.com', tag: 'male' },
  { email: 'qa.female@lokfeel.com', tag: 'female' },
]

let pass = 0
let fail = 0
const ck = (label, ok, extra = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${label}${extra ? '  ' + extra : ''}`)
  ok ? pass++ : fail++
}

const cookieHeader = (res) => {
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : []
  return raw.map((c) => c.split(';')[0]).join('; ')
}

/** 真实登录端点（与登录页完全一致：同源守卫要求的 Origin/Referer 一并带上） */
async function realLogin(email) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Origin: BASE,
      Referer: `${BASE}/login`,
    },
    body: JSON.stringify({ email, password: QA_PASSWORD }),
    redirect: 'manual',
    signal: AbortSignal.timeout(25000),
  })
  const text = await res.text()
  return { res, text, cookie: cookieHeader(res), setCookie: res.headers.getSetCookie?.() || [] }
}

console.log(`\n生产真实登录复验  目标 ${BASE}\n`)

for (const acc of ACCOUNTS) {
  console.log(`── ${acc.email} ──`)
  let login
  try {
    login = await realLogin(acc.email)
  } catch (e) {
    ck('自定义登录端点可达', false, `${e.name}: ${e.message}`)
    continue
  }

  ck('POST /api/auth/login → 200', login.res.status === 200, `status=${login.res.status} ${login.text.slice(0, 120).replace(/\s+/g, ' ')}`)

  // cookie 不得落在部署专用域名上
  const badCookie = login.setCookie.find((c) => DEPLOY_HOST_RE.test(c))
  ck('会话 cookie 未指向部署专用域名', !badCookie, badCookie ? badCookie.slice(0, 80) : `Host-only @ ${PUBLIC_HOST}`)
  const hasSessionCookie = /session-token|next-auth\.session-token/i.test(login.cookie)
  ck('下发了会话 cookie', hasSessionCookie, login.cookie.split('; ').map((c) => c.split('=')[0]).join(', ').slice(0, 90))

  // 会话确实成立（这一步就是「登录后又变回未登录」的探测器）
  const sres = await fetch(`${BASE}/api/auth/session`, {
    headers: { cookie: login.cookie },
    redirect: 'manual',
    signal: AbortSignal.timeout(20000),
  })
  const sjson = await sres.json().catch(() => ({}))
  ck('带 cookie 取会话 → 有 user.id（会话成立）', !!sjson?.user?.id, `user=${JSON.stringify(sjson?.user?.email || sjson?.user || null)}`)

  // T03 受保护端点：401 = 没带上会话；403/200 = 会话有效
  for (const p of ['/api/v1/intents', '/api/v1/intents/fields', '/api/profile']) {
    const r = await fetch(`${BASE}${p}`, {
      headers: { cookie: login.cookie },
      redirect: 'manual',
      signal: AbortSignal.timeout(20000),
    })
    ck(`${p} 会话已生效（非 401）`, r.status !== 401, `status=${r.status}`)
  }
  console.log()
}

console.log(`═══ 结果：${pass} 通过 / ${fail} 失败 ═══\n`)
process.exit(fail === 0 ? 0 : 1)
