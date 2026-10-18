#!/usr/bin/env node
/**
 * Google OAuth 授权端点体检（不需要人点同意页）
 *
 * ## 能自动化到什么程度（说清楚边界，别假装能代替真人）
 * 「真人用 Google 账号登录一次」里有一步是**无法**脚本化的：Google 的账号选择与
 * 同意页需要真人身份。但这一步**之前**的所有配置错误 —— 也就是真正会让人登不进来的
 * 那些 —— 都可以自动化抓出来：
 *   ① client_id 不存在 / 被删（`invalid_client`）
 *   ② redirect_uri 没在 Google 侧登记（`redirect_uri_mismatch`）← 最常见
 *   ③ scope 未申请 / 应用未通过验证
 *   ④ 应用侧回调地址与生产域名不一致（`/api/auth/providers` 里的 callbackUrl）
 * 做法：直接拿**生产在用的 client_id** 去请求 Google 的 authorize 端点 ——
 * 配置错的话 Google 会当场回错误页；配对了则是登录页/302。
 *
 * 所以本脚本的定位是：把「人工确认」压缩成「只剩点一下同意」。
 *
 * ## 退出码
 *   0 = 配置正确 · 1 = 配置有错 · 2 = 拿不到 client_id（无法取证）
 *
 * ## 用法
 *   node scripts/qa/verify-oauth-authorize.mjs
 *   node scripts/qa/verify-oauth-authorize.mjs --base=https://app.lokfeel.com
 */
import { loadEnv } from './lib/turso-http.mjs'
import { readNetlifyEnv } from './lib/netlify-env.mjs'

const argv = process.argv.slice(2)
const argOf = (n, d) => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`))
  return hit ? hit.slice(n.length + 3) : d
}
const BASE = argOf('base', 'https://app.lokfeel.com').replace(/\/$/, '')
const HOST = new URL(BASE).host

const results = []
const ck = (label, ok, detail = '') => {
  results.push({ label, ok, detail })
  console.log(`  ${ok ? '✅' : '❌'} ${label}${detail ? '  → ' + detail : ''}`)
}

const ERROR_MARKERS = [
  'redirect_uri_mismatch',
  'invalid_client',
  'invalid_request',
  'unauthorized_client',
  'Error 400',
  'Error 401',
]

/**
 * 解析 Google 的授权错误。
 *
 * 实测：配置错时 Google **不返回 4xx**，而是 302 到
 *   https://accounts.google.com/signin/oauth/error?authError=<base64>&…
 * 错误码藏在 base64 里（如 `Cg5pbnZhbGlkX2NsaWVudB…` → `invalid_client`），
 * 所以只扫 body/URL 文本会**漏判**。这里按 base64 解出来再比。
 */
function authErrorOf(location) {
  if (!location || !/\/signin\/oauth\/error/.test(location)) return null
  try {
    const u = new URL(location)
    const raw = u.searchParams.get('authError') || ''
    const decoded = Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    return decoded || 'unknown-auth-error'
  } catch {
    return 'unknown-auth-error'
  }
}

const CLIENT_ID_RE = /^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/

/**
 * 带代理的 GET（自动挑选**能通**的那个代理）。
 *
 * WHY 不直接用 fetch：本机**直连** accounts.google.com 不通（10s 超时）。
 * 而 Node 的 fetch 不吃 `HTTPS_PROXY`（除非装 undici 挂 dispatcher），curl 天然支持 `-x`。
 *
 * 🔴 为什么不能直接用 `process.env.HTTPS_PROXY`：
 * 沙箱/IDE 会注入一个自己的代理（实测 :61108），它对 accounts.google.com 回 **502**；
 * 真正能出去的是本机代理 :10808。所以这里按候选顺序**逐个试**，谁先给出非 5xx
 * 的响应就用谁 —— 把「哪个代理能通」这件事交给事实，而不是交给环境变量。
 */
const PROXY_CANDIDATES = () => {
  const list = []
  if (process.env.QA_PROXY) list.push(process.env.QA_PROXY)
  list.push('http://127.0.0.1:10808')
  for (const k of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy']) {
    if (process.env[k]) list.push(process.env[k])
  }
  list.push('') // 直连
  return [...new Set(list)]
}

async function runCurl(args, timeoutSec) {
  const { execFile } = await import('node:child_process')
  return new Promise((resolve) => {
    execFile('curl', args, { maxBuffer: 4 * 1024 * 1024, timeout: timeoutSec * 1000 }, (err, stdout) => {
      resolve(err && !stdout ? null : stdout)
    })
  })
}

function parseCurlOutput(out) {
  if (out === null) return null
  // 走代理时 curl -i 会先输出 `HTTP/1.1 200 Connection established`（隧道建立），
  // 真正的响应状态在**最后**一条 `HTTP/` 行上。
  const lines = out.split('\n')
  const statusLines = lines.filter((l) => /^HTTP\/[\d.]+\s+\d{3}/.test(l))
  const last = statusLines[statusLines.length - 1] || ''
  const m = last.match(/^HTTP\/[\d.]+\s+(\d{3})/)
  const loc = (out.match(/^location:\s*(.+)$/im) || [])[1] || ''
  return { status: m ? Number(m[1]) : 0, text: out, location: loc.trim() }
}

async function curlGet(url, { timeoutSec = 20 } = {}) {
  const base = ['-sS', '-i', '--max-time', String(timeoutSec), '-A', 'Mozilla/5.0 (compatible; LokFeelLaunchProbe/1.0)']
  let fallback = null

  for (const proxy of PROXY_CANDIDATES()) {
    const args = proxy ? [...base, '-x', proxy, url] : [...base, url]
    const parsed = parseCurlOutput(await runCurl(args, timeoutSec))
    if (!parsed) continue
    // 4xx 是「对方明确拒绝」→ 有判别力，直接采用
    // 2xx/3xx 是成功
    if (parsed.status > 0 && parsed.status < 500) return parsed
    fallback = fallback || parsed // 5xx 先留着，继续试下一个出口
  }
  return fallback
}

/**
 * 带重试：把「代理抖动」与「配置错误」分开。
 * 5xx 既不是成功也不是配置结论，只能重试后再下判断。
 */
async function curlGetRetry(url, attempts = 3) {
  let last = null
  for (let i = 0; i < attempts; i++) {
    last = await curlGet(url)
    if (last && last.status > 0 && last.status < 500) return last
    await new Promise((r) => setTimeout(r, 1200 * (i + 1)))
  }
  return last
}

async function main() {
  console.log(`\n━━━ Google OAuth 配置体检 ━━━\n目标   : ${BASE}\n`)

  const env = loadEnv(['.env', '.env.local', '.env.production'])

  // ① 应用侧：providers 端点必须列出 google，且 callbackUrl 落在生产域名
  const prov = await fetch(`${BASE}/api/auth/providers`, { signal: AbortSignal.timeout(20_000) })
  const providers = await prov.json().catch(() => null)
  ck('应用侧：/api/auth/providers 可读', prov.status === 200 && Boolean(providers), `HTTP ${prov.status}`)
  const google = providers?.google
  ck('应用侧：已注册 google provider', Boolean(google), google ? google.name : '(缺失)')
  const callbackUrl = String(google?.callbackUrl || '')
  ck(
    '应用侧：callbackUrl 指向公开域名（不是部署专用域名）',
    callbackUrl.includes(HOST) && !/--[a-z0-9-]+\.netlify\.app/i.test(callbackUrl),
    callbackUrl || '(空)',
  )

  // ② 取生产在用的 client_id
  //    NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID 是**公开**变量，Netlify 会返回真值；
  //    GOOGLE_CLIENT_ID 可能被标成 secret 而被掩码（`******.com`），必须过一遍格式校验。
  const candidates = [
    (env.NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID || '').trim(),
    (env.GOOGLE_CLIENT_ID || '').trim(),
  ]
  for (const key of ['NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_CLIENT_ID']) {
    const v = await readNetlifyEnv(key, { env }).catch(() => null)
    if (v) candidates.push(String(v).trim())
  }
  const clientId = candidates.find((v) => CLIENT_ID_RE.test(v)) || ''
  if (!clientId) {
    results.push({ label: '拿不到生产 client_id', ok: false, detail: candidates.filter(Boolean).length ? '候选值都被掩码/格式不符' : '无候选' })
    return
  }
  ck('凭据：拿到生产 client_id（未被掩码）', true, '…' + clientId.slice(-24))

  // ③ 直接问 Google：这个 client_id + 这个 redirect_uri 配不配
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  authUrl.searchParams.set('client_id', clientId)
  authUrl.searchParams.set('redirect_uri', callbackUrl || `${BASE}/api/auth/callback/google`)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('scope', 'openid email profile')
  authUrl.searchParams.set('state', 'launch-probe')
  authUrl.searchParams.set('prompt', 'none')

  const googleRes = await curlGetRetry(authUrl.toString())
  if (!googleRes || googleRes.status === 0 || googleRes.status >= 500) {
    // 5xx 是**代理/网络**的问题，不是 Google 的配置判定 —— 不能拿它当失败证据
    results.push({
      label: 'Google 端点不可达（5xx/超时）',
      ok: false,
      detail: googleRes ? `HTTP ${googleRes.status}` : 'curl 与直连都失败',
    })
    return
  }
  const authErr = authErrorOf(googleRes.location)
  const hit = authErr ? ERROR_MARKERS.filter((m) => authErr.includes(m)) : []

  ck(
    'Google：authorize 端点没报配置错误（未被 redirect_uri_mismatch / invalid_client 拒绝）',
    !authErr,
    authErr ? `authError=${authErr.slice(0, 80)}` : `HTTP ${googleRes.status}`,
  )
  ck(
    'Google：返回的是登录/同意流程（200/302 且不是 /signin/oauth/error）',
    (googleRes.status === 200 || (googleRes.status >= 300 && googleRes.status < 400)) && !authErr,
    `HTTP ${googleRes.status}`,
  )

  // ④ 反向对照：故意用一个畸形 client_id，必须被 Google 判错
  //    —— 证明 ③ 的"没报错"不是因为它对什么都说不报错
  const bogus = new URL(authUrl)
  bogus.searchParams.set('client_id', '000000000000-launchprobe.apps.googleusercontent.com')
  const bogusRes = await curlGetRetry(bogus.toString())
  const bogusErr = bogusRes ? authErrorOf(bogusRes.location) : null
  const bogusRejected = Boolean(bogusErr)
  if (bogusRes && bogusRes.status >= 500) {
    // 对照没跑成（网络问题）时**不能**判绿 —— 否则等于没做对照
    results.push({ label: '反向对照未完成（代理 5xx）', ok: false, detail: `HTTP ${bogusRes.status}` })
  } else {
    ck(
      '反向对照：畸形 client_id 被判 invalid_client（说明这个探针有判别力）',
      bogusRejected,
      bogusErr ? `authError=${bogusErr.slice(0, 60)}` : `HTTP ${bogusRes?.status} ${bogusRes?.location?.slice(0, 60) || ''}`,
    )
  }
}

;(async () => {
  let exitCode = 0
  try {
    await main()
  } catch (e) {
    results.push({ label: '未预期异常', ok: false, detail: e.message })
  }
  const failed = results.filter((r) => !r.ok)
  console.log('')
  if (failed.length) {
    console.log(`结论：${failed.length} 项失败（共 ${results.length} 项）`)
    for (const f of failed) console.log(`   ❌ ${f.label}${f.detail ? ' → ' + f.detail : ''}`)
    exitCode = 1
  } else {
    console.log(`结论：${results.length}/${results.length} 通过（含反向对照）`)
  }
  console.log('')
  process.exit(exitCode)
})()
