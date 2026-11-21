#!/usr/bin/env node
/**
 * V25.6 UI 整改 · 真实 API 回执取证（本地 HTTP / 登录夹具 / 非生产）
 * 对每个改动页面的主 CTA 背后的真实端点发起请求，落盘状态码与响应摘要，
 * 证明"按钮有真实业务结果、数字来自有权限的后端"。
 *
 * 用法：node scripts/qa/ui-remediation-api-proof.mjs --base=http://127.0.0.1:3104 \
 *   --out=docs/v25.6/ga-closure/ui-remediation/api-proofs.json
 */
import fs from 'node:fs/promises'
import path from 'node:path'

const ROOT = process.cwd()
const arg = (name, fallback) => {
  const v = process.argv.slice(2).find((x) => x.startsWith(`--${name}=`))
  return v ? v.slice(name.length + 3) : fallback
}
const BASE = arg('base', 'http://127.0.0.1:3104')
const OUT = path.resolve(ROOT, arg('out', 'docs/v25.6/ga-closure/ui-remediation/api-proofs.json'))
const PASSWORD = ['E2E', 'Test', 'Passw0rd!'].join('-')

let cookie = ''
async function call(p, { method = 'GET', body, auth = true } = {}) {
  const headers = { Accept: 'application/json', Origin: BASE, Referer: BASE + '/' }
  if (auth && cookie) headers.cookie = cookie
  if (body) headers['Content-Type'] = 'application/json'
  const res = await fetch(BASE + p, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual', signal: AbortSignal.timeout(20000),
  })
  const setCookie = res.headers.get('set-cookie')
  const json = await res.json().catch(() => ({}))
  return { path: p, method, status: res.status, json, setCookie: setCookie ? setCookie.split(',').map(s => s.trim().split(';')[0]) : [] }
}

const proofs = []
try {
  // 真实登录（复用 E2E 夹具账号）
  const login = await call('/api/auth/login', {
    method: 'POST', auth: false,
    body: { email: 'e2e.owner@example.test', password: PASSWORD },
  })
  const loginOk = login.status === 200 && login.json?.success === true
  if (login.setCookie.length) cookie = login.setCookie.join('; ')
  proofs.push({
    capability: '登录（个人/企业/聊天页的会话前置）',
    endpoint: 'POST /api/auth/login', status: login.status,
    ok: loginOk, evidence: { success: login.json?.success ?? null },
  })
  if (!loginOk) throw new Error('login failed; cannot take authenticated proofs')

  // Dashboard 的三个真实数字源
  for (const [capability, p] of [
    ['Dashboard · Chats 数字源（会话列表）', '/api/im/conversations'],
    ['Dashboard · Chats 未读数字源', '/api/chats/unread-count'],
    ['Dashboard · Spaces 数字源（组织列表）', '/api/v1/organizations'],
    ['Chats/Connections · 邀请码真实来源', '/api/invites'],
    ['Connections · 真实连接数据', '/api/matches?limit=50'],
    ['Console · 待我确认/队列数据源', '/api/v1/workflow/overview'],
    ['Console · 任务数据源', '/api/v1/missions?page=1&pageSize=1'],
    ['Workspace · 通知数据源', '/api/notifications'],
  ]) {
    const r = await call(p)
    const ok = r.status >= 200 && r.status < 300
    proofs.push({
      capability, endpoint: `${r.method} ${p}`, status: r.status, ok,
      evidence: summarize(r.json),
    })
  }

  // 负例：匿名访问需鉴权的端点必须被拒（证明权限边界真实，不是假数据）
  const anon = await call('/api/im/conversations', { auth: false })
  proofs.push({
    capability: '权限负例 · 匿名读会话必须被拒',
    endpoint: 'GET /api/im/conversations (no cookie)', status: anon.status,
    ok: anon.status === 401, evidence: { error: anon.json?.error ?? null },
  })
} catch (e) {
  proofs.push({ capability: 'FATAL', ok: false, evidence: String(e).slice(0, 200) })
}

function summarize(json) {
  if (!json || typeof json !== 'object') return { type: typeof json }
  const keys = Object.keys(json)
  const out = { topLevelKeys: keys.slice(0, 12) }
  for (const k of ['count', 'unreadCount', 'totalChats', 'success']) {
    if (k in json) out[k] = json[k]
  }
  for (const k of ['conversations', 'organizations', 'invites', 'jobs', 'needsAttention', 'stalled', 'deliveries', 'notifications', 'items', 'matches']) {
    if (Array.isArray(json[k])) out[`${k}Length`] = json[k].length
  }
  if (json.data && typeof json.data === 'object') out.dataKeys = Object.keys(json.data).slice(0, 12)
  return out
}

const allOk = proofs.every((p) => p.ok !== false)
const report = {
  task: 'V25.6 UI 整改 · 真实 API 回执',
  generatedAt: new Date().toISOString(),
  base: BASE,
  evidenceType: 'REAL_HTTP (local service, logged-in fixture, non-production)',
  honestBoundary: '本地隔离库回执，不是生产数据；证明端点真实可调用与数据量，不证明生产发布。',
  proofs,
  verdict: allOk ? 'PASS' : 'FAIL',
}
await fs.mkdir(path.dirname(OUT), { recursive: true })
await fs.writeFile(OUT, JSON.stringify(report, null, 2))
console.log(JSON.stringify({ verdict: report.verdict, count: proofs.length, out: path.relative(ROOT, OUT) }, null, 2))
process.exit(allOk ? 0 : 1)
