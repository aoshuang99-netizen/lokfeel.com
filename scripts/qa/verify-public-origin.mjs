/**
 * P0-c 验证：对外跳转是否使用「公开 origin」（而非平台部署专用域名）
 *
 * WHY: 2026-10-01 在生产（Netlify）实测发现 route handler 里的 `request.url`
 * 指向的是**部署专用域名**（`<deploy-id>--<site>.netlify.app`）。凡是用
 * `new URL(path, request.url)` 构造的跳转，都会把用户送到那个内部域名：
 * 会话 cookie 是 host-only、存在公开域名下，跳过去就丢 → 用户「刚登录成功
 * 又变回未登录」。修复见 `src/lib/http/public-origin.ts`。
 *
 * 本脚本对生产发起真实请求，抓 `Location` 头做两件事：
 *   1) 断言跳转落在配置的公开域名上
 *   2) 全量扫描：任何响应都**不得**出现形如 `--xxx.netlify.app` 的部署专用域名
 *
 * 用法:
 *   node scripts/qa/verify-public-origin.mjs
 *   QA_BASE_URL=https://app.lokfeel.com node scripts/qa/verify-public-origin.mjs
 */

const BASE = (process.env.QA_BASE_URL || 'https://app.lokfeel.com').replace(/\/$/, '')
const PUBLIC_HOST = new URL(BASE).host

/** 平台部署专用域名的特征：<deploy-id>--<site>.netlify.app */
const DEPLOY_HOST_RE = /--[a-z0-9-]+\.netlify\.app$/i

let pass = 0
let fail = 0
const ck = (label, ok, extra = '') => {
  if (ok) {
    pass++
    console.log(`  ✅ ${label}${extra ? '  ' + extra : ''}`)
  } else {
    fail++
    console.log(`  ❌ ${label}${extra ? '  ' + extra : ''}`)
  }
}

const leaks = []

/** 不跟随跳转，只取 Location */
async function probe(path, headers = {}) {
  const res = await fetch(`${BASE}${path}`, { redirect: 'manual', headers })
  const location = res.headers.get('location') || ''
  if (location) {
    try {
      const host = new URL(location).host
      if (DEPLOY_HOST_RE.test(host)) leaks.push({ path, location })
    } catch {
      /* 相对 Location（也是安全的） */
    }
  }
  return { status: res.status, location }
}

console.log(`目标: ${BASE}   （公开 host = ${PUBLIC_HOST}）`)
console.log('\n════════ 1) OAuth 回调失败路径：必须回到公开域名的 /login ════════')
for (const [name, path] of [
  ['缺 state', '/api/auth/oauth/google/callback?code=fake'],
  ['state 不匹配', '/api/auth/oauth/google/callback?code=fake&state=WRONG'],
]) {
  const { location } = await probe(path, { Cookie: 'google-oauth-state=AAA; google-pkce-verifier=BBB' })
  const host = location ? new URL(location).host : '(无 Location)'
  console.log(`  ${name}: → ${location || '(无)'}`)
  ck(`${name} 跳转落在公开域名`, host === PUBLIC_HOST, `host=${host}`)
  ck(`${name} 跳转路径为 /login`, location.startsWith(`${BASE}/login`))
}

console.log('\n════════ 2) 缺失 PKCE / token 交换失败：同样必须回到公开域名 ════════')
{
  const { location } = await probe('/api/auth/oauth/google/callback?code=fake&state=GOOD', {
    Cookie: 'google-oauth-state=GOOD',
  })
  const host = location ? new URL(location).host : '(无 Location)'
  console.log(`  → ${location || '(无)'}`)
  ck('跳转落在公开域名', host === PUBLIC_HOST, `host=${host}`)
  ck('跳转路径为 /login', location.startsWith(`${BASE}/login`))
}

console.log('\n════════ 3) NextAuth 入口拦截：必须跳回本域的自定义 signin ════════')
{
  const { location } = await probe('/api/auth/signin/google?callbackUrl=%2Fdashboard')
  console.log(`  /api/auth/signin/google → ${location || '(无)'}`)
  ck('跳转落在公开域名', !!location && new URL(location).host === PUBLIC_HOST)
  ck('跳转到 /api/auth/oauth/google/signin', location.startsWith(`${BASE}/api/auth/oauth/google/signin`))
  ck('callbackUrl 被保留', location.includes('callbackUrl=%2Fdashboard') || location.includes('callbackUrl=/dashboard'))
}
{
  const { location } = await probe('/api/auth/signin/twitter?callbackUrl=%2Fdashboard')
  console.log(`  /api/auth/signin/twitter → ${location || '(无)'}`)
  ck('跳转落在公开域名', !!location && new URL(location).host === PUBLIC_HOST)
}

console.log('\n════════ 4) Google signin 的 redirect_uri 必须指向公开域名 ════════')
{
  const { location } = await probe('/api/auth/oauth/google/signin?callbackUrl=%2Fdashboard')
  const redirectUri = location ? new URL(location).searchParams.get('redirect_uri') : null
  console.log(`  redirect_uri = ${redirectUri || '(无)'}`)
  ck('signin 跳转到 Google', (location || '').startsWith('https://accounts.google.com/'))
  ck(
    'redirect_uri 使用公开域名',
    !!redirectUri && new URL(redirectUri).host === PUBLIC_HOST,
    `host=${redirectUri ? new URL(redirectUri).host : 'n/a'}`,
  )
}

console.log('\n════════ 5) 泄漏总扫描：任何 Location 都不得含部署专用域名 ════════')
console.log(`  扫描到 ${leaks.length} 处泄漏`)
for (const l of leaks) console.log(`    ⚠️  ${l.path} → ${l.location}`)
ck('无部署专用域名泄漏', leaks.length === 0)

console.log(`\n════════ 结果：${pass} 通过 / ${fail} 失败 ════════`)
process.exit(fail === 0 ? 0 : 1)
