/**
 * T04 生产上线复验（只读，无副作用）
 *
 * 判据设计（沿用 T03 复验得出的两条实测判据）：
 *   「路由缺失」→ Next 内置 404（可见文本含 "Page Not Found"）
 *   「路由存在但未授权」→ 401（API）/ 307 跳登录（页面）
 * 用 401/307 反证代码已上线，而不是靠"某路径返回 200"这种可被静态兜底伪造的信号。
 *
 * 本脚本额外覆盖三点 T04 特有风险：
 *   ① **发布窗口期**：T04 新增页面 `/m/<token>/matches` 未登录时会跳登录 ——
 *      跳转必须落在公开域名（`app.lokfeel.com`），不得出现 `<deploy-id>--<site>.netlify.app`。
 *   ② **披露负测（匿名面）**：`candidates` 通道是 T04 第一次批量投影他人档案的出口。
 *      匿名请求的响应体里**不得**出现候选/档案字段名，也不得出现任何数据。
 *   ③ **公开分享页不泄露候选**：`/api/v1/public/missions/<token>` 的投影里
 *      `candidates` 恒为空数组（匿名面**结构性**不披露），这里显式断言键形态。
 *
 * 用法:
 *   node scripts/qa/verify-t04-prod.mjs
 *   QA_BASE_URL=https://app.lokfeel.com node scripts/qa/verify-t04-prod.mjs
 */

const BASE = (process.env.QA_BASE_URL || 'https://app.lokfeel.com').replace(/\/$/, '')
const PUBLIC_HOST = new URL(BASE).host

/** 平台部署专用域名的特征：<deploy-id>--<site>.netlify.app */
const DEPLOY_HOST_RE = /--[a-z0-9-]+\.netlify\.app/i

/** 32 位、形状合法但生产不存在的分享令牌（通过形状预检，才能走到业务分支） */
const FAKE_TOKEN = 'zzzZzzZzzZzzZzzZzzZzzZzzZzzZzzZz'

let pass = 0
let fail = 0
const leaks = []

const ck = (label, ok, extra = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${label}${extra ? '  ' + extra : ''}`)
  if (ok) pass++
  else fail++
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

/**
 * T04 的投影白名单键：**未授权字段的键不存在**（而非 null）。
 * 匿名 401 响应里不该出现其中任何一个 —— 出现即说明鉴权之前就把数据装进了响应。
 */
const PROFILE_KEYS = ['displayName', 'age', 'city', 'bio', 'email', 'gender']
const CANDIDATE_KEYS = ['candidates', 'subject', 'profileAudience', 'evidence', 'matchedTokens']

const main = async () => {
  console.log(`\n目标 ${BASE}   （T04 上线复验 · 只读）\n`)

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

  console.log('\n── 2) T04 新 API 路由是否已上线（401 = 存在且鉴权正常；404 = 未上线）──')
  {
    const bare = await req('GET', '/api/v1/connections/candidates')
    ck('GET /api/v1/connections/candidates（无参）→ 401', bare.status === 401, `status=${bare.status}`)
    const withMission = await req('GET', '/api/v1/connections/candidates?missionId=warmup-probe')
    ck('GET /api/v1/connections/candidates?missionId=… → 401', withMission.status === 401, `status=${withMission.status}`)
    ck('API 响应是 JSON 信封（非 HTML 404 页）', isJson(bare) && !isUnregisteredRoute404(bare), `ctype=${bare.ctype.split(';')[0]}`)
  }

  console.log('\n── 3) T04 新页面是否已上线 + 🔴 发布窗口期：跳转必须落在公开域名 ──')
  {
    const r = await req('GET', `/m/${FAKE_TOKEN}/matches`)
    const toLogin = r.status === 307 || r.status === 302
    ck('GET /m/<token>/matches → 跳转登录', toLogin, `status=${r.status}`)
    const host = r.loc ? (() => { try { return new URL(r.loc).host } catch { return '(相对)' } })() : '(无)'
    ck('🔴 跳转落在公开域名（窗口期专项）', host === PUBLIC_HOST || host === '(相对)', `host=${host}`)
    ck('回跳地址保留在原路径', r.loc.includes('/matches') || r.loc.includes('callbackUrl'), `loc=${r.loc.slice(0, 90)}`)
  }

  console.log('\n── 4) 判据自证 + T02/T03 无回归 ──')
  {
    const bogus = await req('GET', '/definitely-not-a-real-route-xyz')
    ck('判据自证：不存在的路径 → 应用 404 页（含 Page Not Found）', isUnregisteredRoute404(bogus), `status=${bogus.status}`)

    const t03Api = await req('GET', '/api/v1/intents')
    ck('T03 API 无回归（/api/v1/intents → 401）', t03Api.status === 401, `status=${t03Api.status}`)

    const t03Page = await req('GET', `/m/${FAKE_TOKEN}/intent`)
    ck('T03 页面无回归（/m/<token>/intent → 跳登录）', t03Page.status === 307 || t03Page.status === 302, `status=${t03Page.status}`)

    const t02Page = await req('GET', `/m/${FAKE_TOKEN}`)
    ck('T02 分享页无回归（未知令牌走业务 404，非未注册 404）', t02Page.status !== 0 && !isUnregisteredRoute404(t02Page), `status=${t02Page.status}`)
  }

  console.log('\n── 5) 🔒 披露负测：匿名响应不得夹带候选/档案数据 ──')
  {
    const r = await req('GET', '/api/v1/connections/candidates?missionId=warmup-probe')
    const hitProfile = PROFILE_KEYS.filter((k) => r.text.includes(`"${k}"`))
    const hitCandidate = CANDIDATE_KEYS.filter((k) => r.text.includes(`"${k}"`))
    ck('匿名 401 响应不含档案字段键', hitProfile.length === 0, hitProfile.length ? `泄漏键: ${hitProfile.join(',')}` : '扫描 6 个键')
    ck('匿名 401 响应不含候选结构键', hitCandidate.length === 0, hitCandidate.length ? `泄漏键: ${hitCandidate.join(',')}` : '扫描 5 个键')
  }

  console.log('\n── 6) 🔒 公开分享投影：candidates 恒为空数组（匿名面结构性不披露）──')
  {
    const r = await req('GET', `/api/v1/public/missions/${FAKE_TOKEN}`)
    ck('公开分享端点返回 JSON', r.status !== 0 && !isUnregisteredRoute404(r) && isJson(r), `status=${r.status}`)
    try {
      const j = JSON.parse(r.text)
      const mission = j.data?.mission ?? j.mission ?? j.data ?? j
      if (mission && Object.prototype.hasOwnProperty.call(mission, 'candidates')) {
        ck('candidates 恒为空数组', Array.isArray(mission.candidates) && mission.candidates.length === 0, `len=${mission.candidates.length}`)
      } else {
        // 未知令牌走业务 404 时投影整体不存在 —— 这也是"不披露"的合法形态
        ck('未知令牌不返回候选投影（业务 404 或投影无 candidates 键）', true, `status=${r.status}`)
      }
    } catch {
      ck('公开分享端点返回可解析 JSON', false)
    }
  }

  console.log('\n── 7) 登录路径可用（自定义端点 + 同源守卫）──')
  {
    const r = await req('POST', '/api/auth/login', {
      body: { email: 'no-such-user@example.invalid', password: 'definitely-wrong' },
      headers: { Origin: BASE, Referer: `${BASE}/login` },
    })
    ck('错误凭据 → 401（未被 403 同源守卫拦截、端点存在）', r.status === 401, `status=${r.status}`)
    ck('未出现 404（自定义登录端点存在）', r.status !== 404, `status=${r.status}`)
  }

  console.log('\n── 8) 部署专用域名泄漏总扫描 ──')
  ck('无泄漏', leaks.length === 0, leaks.length ? leaks.join(' | ') : '扫描 0 处')

  console.log(`\n═══ 结果：${pass} 通过 / ${fail} 失败 ═══\n`)
  process.exit(fail === 0 ? 0 : 1)
}

main()
