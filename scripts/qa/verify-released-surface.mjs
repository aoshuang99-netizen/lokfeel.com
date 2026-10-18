#!/usr/bin/env node
/**
 * 只读 QA：**免凭据**证明「发版已生效」—— 生产上确实能看到这些路由
 * ═══════════════════════════════════════════════════════════════════════
 * 由来：本脚本替换了发版前使用的 `verify-no-release-surface.mjs`（**已删除**）——
 * 后者断言"新路由仍 404"，发版生效后该断言永久失效；换个断言而不是删掉脚本，
 * 是为了不让「发版面」出现无人看守的空窗。
 *
 * 语义对照（同一探针、两种断言）：
 *
 *   · 旧脚本（发版前）：断言新路由**仍 404** ⇒ 证明「未发版」。**已随本次发版删除**。
 *   · 本脚本（发版后）：断言这些路由**已可达** ⇒ 证明「发版生效」。
 *
 *   为什么不是"把旧脚本的清单清空"：
 *     清空后它就**没有任何断言**了 —— 一个恒绿的脚本比没有脚本更危险，
 *     因为它会让人以为"验过了"。所以发版后必须把清单**从「应缺席」
 *     改成「应在场」**，判别力才不丢。
 *
 *   它还有一层价值：**防回滚**。若某天有人 rollback 或构建失败退化到旧版本，
 *   这些路由会重新变回 404 ⇒ 本脚本立刻判红。
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 判据设计的关键：**必须有正向对照**（沿用旧脚本的铁律）
 * ═══════════════════════════════════════════════════════════════════════
 *   「新路由可达」单独看是**弱证据** —— 一个"什么都返回 401"的坏网关也会让它成立。
 *   所以每轮先打**已知基线**：
 *     · `/api/health` → 200          （公开探活，必须真 200）
 *     · `/api/v1/org` → 401/403      （存在但被守卫拦下 —— 证明探针能区分 404 与 401）
 *   对照不成立 ⇒ 判 **BLOCKED**（探针不可信），而不是 PASS。
 *
 * 用法：
 *   node scripts/qa/verify-released-surface.mjs [--base=https://app.lokfeel.com]
 *   QA_BASE_URL=https://app.lokfeel.com node scripts/qa/verify-released-surface.mjs
 * 退出码：
 *   0 = 发版生效成立 · 1 = 🔴 清单内路由仍 404（未生效 / 被回滚）· 2 = 探针不可信（BLOCKED）
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
  { path: '/api/health', expect: [200], note: '公开探活（必须真 200）' },
  { path: '/api/v1/org', expect: [401, 403], note: '存在但需登录 —— 证明探针能区分 404 与 401' },
]

/**
 * 🔴 已发版清单：这些路由**在生产必须可达**。
 *
 * 期望值说明：
 *   · 匿名打一个「需登录」的端点，正确表现是 **401**（不是 200、更不是 404）。
 *   · `/api/mcp` 是 Streamable HTTP，**GET 不被允许** ⇒ **405** 才是"路由在"的证据。
 *   · agent-card 是 A2A 的公开发现面 ⇒ **200**。
 *
 * ⚠️ 将来若有**新的**发版批次：把新路由加到这里；同时为"还要 404"的那批
 *    重新起一个发版前探针（旧版 `verify-no-release-surface.mjs` 已随本次发版删除，
 *    但其代码即本文件的反向断言，恢复成本很低）。
 */
const RELEASED = [
  { path: '/api/v1/bridges', expect: [401, 403], since: '47e1dac', what: 'T10 Community Bridge' },
  { path: '/api/v1/agents/runs', expect: [401, 403], since: 'c2ae31a', what: 'T09 Agent 运行' },
  { path: '/api/mcp', expect: [405], since: '8419f50', what: 'T11 MCP（Streamable HTTP · GET 不允许）' },
  {
    path: '/.well-known/agent-card.json',
    expect: [200],
    since: '8419f50',
    what: 'T11 A2A agent card（公开发现面）',
  },
  { path: '/api/v1/me/export', expect: [401, 403], since: '6d63bd2', what: 'AC-10 数据导出' },
  { path: '/api/v1/me/erasure', expect: [401, 403], since: '6d63bd2', what: 'AC-10 删除请求' },
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
      `\n🔴 BLOCKED：没有任何对照命中期望状态码。此时"新路由可达"可能只是全站异常造成的假绿，` +
        `不能据此判定发版生效。`,
    )
    process.exit(2)
  }

  // ── ② 已发版清单 ──
  console.log('\n── ② 已发版清单（应全部可达）──')
  const missing = []
  const unknown = []
  for (const r of RELEASED) {
    const { status, error } = await probe(r.path)
    if (status === 0) {
      unknown.push(r)
      console.log(`  ⚠️ ${r.path.padEnd(32)} 无响应（${error ?? ''}）—— 无法判定`)
      continue
    }
    const present = r.expect.includes(status)
    if (!present) missing.push({ ...r, status })
    console.log(
      `  ${present ? '✅' : '🔴'} ${r.path.padEnd(32)} status=${status} 期望=${r.expect.join('/')}  [${r.what} · ${r.since}]`,
    )
  }

  console.log('\n═══════════════ 判定 ═══════════════')
  if (missing.length > 0) {
    console.log(`🔴 **发版生效不成立**：以下路由未达期望状态（404 = 未生效或被回滚）：`)
    for (const m of missing) console.log(`   · ${m.path} → ${m.status}（期望 ${m.expect.join('/')}；${m.what}）`)
    console.log('   ⇒ 检查 Netlify 构建是否成功、是否发生 rollback。')
    process.exit(1)
  }
  console.log(
    `✅ 发版生效成立：清单内 ${RELEASED.length} 条路由全部达期望状态，且 ${controlsOk}/${CONTROLS.length} 条正向对照命中` +
      `（证明探针能区分 404 与 401）。`,
  )
  if (unknown.length > 0) {
    console.log(`⚠️ 另有 ${unknown.length} 条无响应、未纳入判定（见上）。`)
  }
  console.log('   注：本结论基于**公开 HTTP 面**（验的是实际生效的代码面）。')
  // 机器可读的自报断言数：编排器（launch-check）优先采信它，而不是数输出行。
  console.log(`ASSERTIONS=${RELEASED.length + controlsOk}`)
}

main().catch((err) => {
  console.error('❌ 探针异常：', err?.message || err)
  process.exit(2)
})
