/**
 * T03 生产上线复验（只读，无副作用）
 *
 * 判据设计：
 *   「路由缺失」→ Next 内置 404
 *   「路由存在但未授权」→ 401 / 307
 * 用 401/307 反证代码已上线。同时全量扫描响应体与 Location，
 * 任何 `--*.netlify.app` 形式的部署专用域名都算泄漏。
 */
const BASE = (process.env.QA_BASE_URL || 'https://app.lokfeel.com').replace(/\/$/, '')
const DEPLOY_HOST_RE = /--[a-z0-9-]+\.netlify\.app/i
// 32 位、形状合法但生产不存在的分享令牌（通过形状预检，才能走到鉴权分支）
const FAKE_TOKEN = 'zzzZzzZzzZzzZzzZzzZzzZzzZzzZzzZz'

let pass = 0
let fail = 0
const leaks = []

const ck = (label, ok, extra = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${label}${extra ? '  ' + extra : ''}`)
  ok ? pass++ : fail++
}

async function req(method, path, { body, headers = {}, timeout = 20000 } = {}) {
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      redirect: 'manual',
      headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeout),
    })
    const text = await res.text()
    const loc = res.headers.get('location') || ''
    if (DEPLOY_HOST_RE.test(loc) || DEPLOY_HOST_RE.test(text)) {
      leaks.push(`${method} ${path} → ${loc || '(body)'}`)
    }
    return { status: res.status, loc, text, ctype: res.headers.get('content-type') || '' }
  } catch (e) {
    return { status: 0, loc: '', text: '', ctype: '', err: `${e.name}: ${e.message}` }
  }
}

/**
 * 区分「路由不存在」与「业务 404」—— 实测得出的判据（2026-10-11 生产对照）：
 *   未注册路由 → 落到应用自定义 404 页，可见文本含 "Page Not Found"（约 200 字）
 *   动态路由内 notFound() → 只渲染裸壳，可见文本仅剩页面标题（约 40 字）
 * 因此：404 + 含 "Page Not Found" = 路由**不存在**；其余 404 = 路由存在但业务判定不存在。
 */
const visibleText = (html) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** true = 这个 404 来自「未注册路由」，即该路由根本不存在 */
const isUnregisteredRoute404 = (res) =>
  res.status === 404 && /Page Not Found/i.test(visibleText(res.text))

/** API 路由：未注册会返回 HTML 404 页；已注册会返回 JSON（哪怕是错误信封） */
const isJson = (res) => /application\/json/i.test(res.ctype || '')

const main = async () => {
  console.log(`\n目标 ${BASE}   （T03 上线复验 · 只读）\n`)

  console.log('── 1) 存活与数据库 ──')
  {
    const r = await req('GET', '/api/health')
    ck('GET /api/health → 200', r.status === 200, `status=${r.status}`)
    try {
      const j = JSON.parse(r.text)
      ck('health.status = healthy', j.status === 'healthy', `dbLatency=${j.dbLatency}ms`)
    } catch {
      ck('health 返回可解析 JSON', false)
    }
  }

  console.log('\n── 2) T03 新路由是否已上线（401 = 存在且鉴权正常；404 = 未上线）──')
  for (const [method, path] of [
    ['GET', '/api/v1/intents'],
    ['POST', '/api/v1/intents'],
    ['GET', '/api/v1/intents/fields'],
    ['GET', `/api/v1/missions/does-not-matter/intents`],
  ]) {
    const r = await req(method, path, { body: method === 'POST' ? {} : undefined })
    ck(`${method} ${path} → 401（路由已注册）`, r.status === 401, `status=${r.status}`)
  }

  console.log('\n── 3) T03 页面是否已上线（匿名 → 307 跳登录；404 = 未上线）──')
  {
    const r = await req('GET', `/m/${FAKE_TOKEN}/intent`)
    const redirectedToLogin = r.status === 307 || r.status === 302
    ck('GET /m/<token>/intent → 跳转登录', redirectedToLogin, `status=${r.status} loc=${r.loc.slice(0, 80)}`)
    ck('回跳地址保留在原路径', r.loc.includes('/intent') || r.loc.includes('callbackUrl'), `loc=${r.loc.slice(0, 100)}`)
  }

  console.log('\n── 4) 判据自证 + T02 分享页无回归 ──')
  {
    // 先自证判据：一个确定不存在的路径，必须落到「未注册 404」形态
    const bogus = await req('GET', '/definitely-not-a-real-route-xyz')
    ck('判据自证：不存在的路径 → 应用 404 页（含 Page Not Found）', isUnregisteredRoute404(bogus), `status=${bogus.status}`)

    // API 端点：已注册则返回 JSON（不是 HTML 404 页）
    const api = await req('GET', `/api/v1/public/missions/${FAKE_TOKEN}`)
    ck('公开分享端点已注册（返回 JSON 而非 HTML 404）', api.status !== 0 && !isUnregisteredRoute404(api) && isJson(api), `status=${api.status} ctype=${api.ctype.split(';')[0]}`)

    // 分享页：未知令牌应为「业务 404」（动态路由已执行），而非「未注册 404」
    const page = await req('GET', `/m/${FAKE_TOKEN}`)
    ck('分享页路由已注册（未知令牌走业务 404，非未注册 404）', page.status !== 0 && !isUnregisteredRoute404(page), `status=${page.status}`)
  }

  console.log('\n── 5) 登录路径可用（自定义端点 + 同源守卫）──')
  {
    const r = await req('POST', '/api/auth/login', {
      body: { email: 'no-such-user@example.invalid', password: 'definitely-wrong' },
      headers: { Origin: BASE, Referer: `${BASE}/login` },
    })
    // 期望：凭据错误 → 401；被同源守卫拦 → 403；端点缺失 → 404
    ck('错误凭据 → 401（未被 403 同源守卫拦截、端点存在）', r.status === 401, `status=${r.status}`)
    ck('未出现 404（自定义登录端点存在）', r.status !== 404, `status=${r.status}`)
  }

  console.log('\n── 6) 部署专用域名泄漏总扫描 ──')
  ck('无泄漏', leaks.length === 0, leaks.length ? leaks.join(' | ') : '扫描 0 处')

  console.log(`\n═══ 结果：${pass} 通过 / ${fail} 失败 ═══\n`)
  process.exit(fail === 0 ? 0 : 1)
}

main()
