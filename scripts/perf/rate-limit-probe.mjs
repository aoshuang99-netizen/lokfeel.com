#!/usr/bin/env node
/**
 * AC-24 · 速率限制缺口取证（匿名可达面）
 *
 * ── 它回答什么问题 ──────────────────────────────────────────────────
 *   T11 交接了一句「**MCP / A2A 端点无独立速率限制**」。这句话要么被证实，
 *   要么被推翻 —— 不能只留在文档里当形容词。本脚本用**可复跑**的方式取证。
 *
 * ── 关键：阳性对照（否则结论无意义）────────────────────────────────
 *   如果我只是「打 200 次 MCP，没看到 429，所以没有限流」—— 这个推理有洞：
 *   万一是**我的探针看不出来 429**（比如服务根本没起、或全部返回 503）呢？
 *   所以先打一个**已知有限流**的端点做对照：
 *       `GET /api/v1/public/missions/<token>`
 *       其限流为「每 IP 每 5 分钟 120 次」，且**在任何其它工作之前**执行
 *       （见该 route 的注释：「限流在**任何**工作之前，否则攻击者可无限探测形状」）。
 *   若对照出现了 429 ⇒ 探针**有能力**看见 429 ⇒ 后续的「0 次 429」才有说服力。
 *   若对照一次 429 都没出现 ⇒ 本次取证**不合格**，脚本判失败并明确说「无法结论」，
 *   而不是含糊地报「没有限流」。
 *
 * ── 顺带暴露的既有缺陷 ──────────────────────────────────────────────
 *   `src/lib/rate-limit.ts` 的取键是 `options.key ? options.key(request) : ip`，
 *   而本仓三处调用**都没传 `key`** ⇒ 三个互不相关的功能**共用同一个 per-IP 桶**
 *   （`ratelimit:<ip>`），且**窗口长短由最先创建该条目的那次请求决定**。
 *   这是**代码级**结论；运行期复现需要「同一 IP 同时使用两个功能的已登录会话」，
 *   本次未实测 —— 报告中如实标注为「未实测」，见 PERFORMANCE_BASELINE.md §5。
 *
 * 用法：
 *   node scripts/perf/rate-limit-probe.mjs --base=http://127.0.0.1:3000 [--n=200] [--out=<json>]
 */

const args = {}
for (const a of process.argv.slice(2)) {
  if (!a.startsWith('--')) continue
  const [k, v] = a.slice(2).split('=')
  args[k] = v === undefined ? 'true' : v
}

const BASE = (args.base || 'http://127.0.0.1:3000').replace(/\/+$/, '')
const N = Number(args.n || 200)
const OUT = args.out || ''
const TIMEOUT_MS = 15000

const CONTROL_N = 130 // > 对照端点的上限 120，必须能触发 429

const targets = [
  {
    key: 'control-missions-preview',
    role: '对照（已知有限流：120 / 5min / IP）',
    method: 'GET',
    path: '/api/v1/public/missions/probe-token-00000000000000000000000000000000',
    body: null,
    headers: {},
    n: CONTROL_N,
  },
  {
    key: 'mcp-discovery',
    role: '缺口候选（MCP 发现面，无需会话）',
    method: 'POST',
    path: '/api/mcp',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    n: N,
  },
  {
    key: 'a2a-tasks',
    role: '缺口候选（A2A 任务端点）',
    method: 'POST',
    path: '/api/v1/a2a/tasks',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ skillId: 'list_bridges', input: {} }),
    n: N,
  },
]

async function burst(t) {
  const statuses = {}
  let failed = 0
  let rl = 0
  const t0 = Date.now()
  for (let i = 0; i < t.n; i++) {
    try {
      const res = await fetch(BASE + t.path, {
        method: t.method,
        headers: t.headers,
        body: t.body,
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      await res.arrayBuffer()
      statuses[res.status] = (statuses[res.status] || 0) + 1
      if (res.status === 429) rl++
    } catch {
      failed++
    }
  }
  return { ...t, requests: t.n, statuses, rateLimited: rl, failed, wallMs: Date.now() - t0 }
}

async function main() {
  console.log('════════════════════════════════════════════════════════════')
  console.log(' AC-24 · 速率限制缺口取证')
  console.log(` 目标：${BASE}`)
  console.log('════════════════════════════════════════════════════════════')

  const results = []
  for (const t of targets) {
    process.stdout.write(`\n… ${t.key}（${t.requests ?? t.n} 次）`)
    const r = await burst(t)
    results.push(r)
    const codes = Object.entries(r.statuses)
      .map(([c, n]) => `${c}×${n}`)
      .join('  ')
    console.log(`\n   ${t.role}\n   状态分布：${codes || '(全部连接失败)'}   429=${r.rateLimited}  失败=${r.failed}`)
  }

  const control = results[0]
  const mcp = results[1]
  const a2a = results[2]

  console.log('\n════════════════════════════════════════════════════════════')
  console.log(' 结论')
  console.log('════════════════════════════════════════════════════════════')

  if (control.rateLimited === 0) {
    console.log('🔴 **本次取证不合格**：阳性对照（已知 120/5min 限流的端点）')
    console.log(`   打了 ${control.n} 次却**一次 429 都没有** —— 说明探针看不到限流，`)
    console.log('   或该端点限流未生效。此时**不能**得出「MCP/A2A 无限制」的结论。')
    console.log('   请先排查：服务是否为本仓构建产物、限流中间件是否生效。')
    process.exitCode = 1
  } else {
    console.log(`✅ 阳性对照成立：对照端点出现 ${control.rateLimited} 次 429 —— 探针**能**看见限流。`)
    console.log('')
    console.log(`   MCP 发现面：${mcp.requests} 次请求，429 = ${mcp.rateLimited}`)
    console.log(`   A2A 任务面：${a2a.requests} 次请求，429 = ${a2a.rateLimited}`)
    if (mcp.rateLimited === 0 && a2a.rateLimited === 0) {
      console.log('\n   ⇒ **缺口确认**：两者在同等请求量下**零限流**，与对照端点形成明确反差。')
    } else {
      console.log('\n   ⇒ 观察到限流已生效（429 > 0）—— 缺口可能已被修复，请复核文档。')
    }
    process.exitCode = 0
  }

  const doc = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    base: BASE,
    control: {
      target: control.path,
      requests: control.requests,
      rateLimited: control.rateLimited,
      statuses: control.statuses,
      interpretation: '阳性对照：有 429 ⇒ 探针可信；无 429 ⇒ 取证不合格',
    },
    results: results.map((r) => ({
      key: r.key,
      role: r.role,
      path: r.path,
      method: r.method,
      requests: r.requests,
      statuses: r.statuses,
      rateLimited: r.rateLimited,
      failed: r.failed,
      wallMs: r.wallMs,
    })),
  }

  if (OUT) {
    const fs = await import('node:fs')
    const path = await import('node:path')
    fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true })
    fs.writeFileSync(path.resolve(OUT), JSON.stringify(doc, null, 2) + '\n')
    console.log(`\n✅ 取证结果已写入：${OUT}`)
  }
}

main().catch((err) => {
  console.error('🔴 取证失败：', err)
  process.exit(1)
})
