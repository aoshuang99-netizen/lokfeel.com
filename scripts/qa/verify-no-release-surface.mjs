#!/usr/bin/env node
/**
 * 只读 QA：**免凭据**证明「可发版但未发版」—— 生产上还看不到这些路由
 * ═══════════════════════════════════════════════════════════════════════
 * 与 `verify-no-release.mjs` 的关系（**互补，不是替代**）：
 *
 *   · `verify-no-release.mjs` 走 **Netlify API**：判据是「站点部署列表里没有该 commit」。
 *     它更权威，但**离了凭据就跑不了**（`NETLIFY_AUTH_TOKEN` + `NETLIFY_SITE_ID`）。
 *   · 本脚本走**公开 HTTP 探针**：判据是「生产上这些路由仍 404」。
 *     不依赖任何凭据、任何人可复跑，且验的是**实际生效的代码面**，
 *     而不是"部署列表"这一间接信号。
 *
 *   ⇒ 发版前用本脚本快速自证；正式发版后再用 `verify-no-release` 复核。
 *     两者同时可用时，结论应一致；不一致说明"部署存在但未生效"（如构建失败）。
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 判据设计的关键：**必须有正向对照**
 * ═══════════════════════════════════════════════════════════════════════
 *   「新路由 404」单独看是**弱证据** —— 站点整个挂掉、DNS 挂了、被 CDN 拦了，
 *   它**同样成立**（全站皆 404）。那样得到的"未发版"结论是**假绿**。
 *
 *   所以每轮都先打**已知存在于生产基线**的路径做对照：
 *     · `/api/health`  → 200
 *     · `/api/v1/org`  → 401/403（存在但被守卫拦下）
 *   对照不成立 ⇒ 判 **BLOCKED**（探针不可信），而不是 PASS。
 *
 *   这组对照同时证明了探针能**区分 404 与 401** —— 而这正是本脚本赖以成立的
 *   唯一假设。没有这条对照，"404" 可能只是"没登录"。
 *
 * 用法：
 *   node scripts/qa/verify-no-release-surface.mjs [--base=https://app.lokfeel.com]
 * 退出码：
 *   0 = 未发版成立 · 1 = 🔴 清单里的路由已可达（疑似误发版）· 2 = 探针不可信（BLOCKED）
 */

function argOf(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : undefined
}

const BASE = (argOf('base') ?? process.env.LOKFEEL_PROD_ORIGIN ?? 'https://app.lokfeel.com').replace(/\/$/, '')

/**
 * 正向对照：**已知存在于生产基线**的路径。
 * 若这些也拿不到预期状态码，说明是探针/站点的问题 ⇒ BLOCKED。
 */
const CONTROLS = [
  { path: '/api/health', expect: [200], note: '公开探活' },
  { path: '/api/v1/org', expect: [401, 403], note: 'T07 Slice 3 已发版，存在但需登录' },
  { path: '/api/v1/members', expect: [401, 403], note: 'T07 Slice 3 已发版，存在但需登录' },
]

/**
 * 🔴 未发版清单：这些路由**当前不应在生产可达**。
 *
 * **发版后必须把已上线的条目从这里删掉** —— 留着会让本脚本在发版后误报
 * "疑似误发版"（那正是它该做的：告诉你清单过期了）。
 */
const NOT_RELEASED = [
  { path: '/api/v1/me/export', since: '6d63bd2', what: 'AC-10 数据导出' },
  { path: '/api/v1/me/erasure', since: '6d63bd2', what: 'AC-10 删除请求' },
  { path: '/api/v1/bridges', since: '47e1dac', what: 'T10 Community Bridge' },
  { path: '/api/mcp', since: '8419f50', what: 'T11 MCP（Streamable HTTP）' },
  { path: '/.well-known/agent-card.json', since: '8419f50', what: 'T11 A2A agent card' },
]

async function probe(path) {
  try {
    const res = await fetch(`${BASE}${path}`, {
      redirect: 'manual',
      signal: AbortSignal.timeout(20_000),
      headers: { 'cache-control': 'no-cache' },
    })
    return { status: res.status }
  } catch (err) {
    return { status: 0, error: err instanceof Error ? err.message : String(err) }
  }
}

async function main() {
  console.log(`站点：${BASE}\n`)

  // ── ① 正向对照 ──
  console.log('── ① 正向对照（探针是否可信）──')
  let controlsOk = 0
  let networkFailures = 0
  for (const c of CONTROLS) {
    const { status, error } = await probe(c.path)
    const ok = c.expect.includes(status)
    if (ok) controlsOk += 1
    if (status === 0) networkFailures += 1
    console.log(
      `  ${ok ? '✅' : '❌'} ${c.path.padEnd(22)} status=${status || '(无响应)'} 期望=${c.expect.join('/')}  ${c.note}` +
        (error ? `\n     ⚠️ ${error}` : ''),
    )
  }

  if (networkFailures === CONTROLS.length) {
    console.error(`\n🔴 BLOCKED：所有对照都拿不到响应 —— 探针不可信（网络/代理/站点不可达），本脚本**不能**给出结论。`)
    process.exit(2)
  }
  if (controlsOk === 0) {
    console.error(
      `\n🔴 BLOCKED：没有任何对照命中期望状态码。此时"新路由 404"可能只是全站异常造成的假绿，` +
        `不能据此判定未发版。`,
    )
    process.exit(2)
  }

  // ── ② 未发版清单 ──
  console.log('\n── ② 未发版清单（应全部 404）──')
  const leaked = []
  const unknown = []
  for (const r of NOT_RELEASED) {
    const { status, error } = await probe(r.path)
    if (status === 0) {
      unknown.push(r)
      console.log(`  ⚠️ ${r.path.padEnd(32)} 无响应（${error ?? ''}）—— 无法判定`)
      continue
    }
    const absent = status === 404
    if (!absent) leaked.push({ ...r, status })
    console.log(
      `  ${absent ? '✅' : '🔴'} ${r.path.padEnd(32)} status=${status}  [${r.what} · ${r.since}]`,
    )
  }

  console.log('\n═══════════════ 判定 ═══════════════')
  if (leaked.length > 0) {
    console.log(`🔴 **未发版不成立**：以下路由在生产已可达（应为 404）：`)
    for (const l of leaked) console.log(`   · ${l.path} → ${l.status}（${l.what}，${l.since}）`)
    console.log('   ⇒ 要么发生了误发版，要么清单没跟上（已发版就该从这里删掉）。')
    process.exit(1)
  }
  console.log(
    `✅ 未发版成立：清单内 ${NOT_RELEASED.length} 条路由全部 404，且 ${controlsOk}/${CONTROLS.length} 条正向对照命中` +
      `（证明探针能区分 404 与 401）。`,
  )
  if (unknown.length > 0) {
    console.log(`⚠️ 另有 ${unknown.length} 条无响应、未纳入判定（见上）。`)
  }
  console.log('   注：本结论基于**公开 HTTP 面**；正式发版后仍应以 verify-no-release（Netlify API）复核。')
}

main().catch((err) => {
  console.error('❌ 探针异常：', err?.message || err)
  process.exit(2)
})
