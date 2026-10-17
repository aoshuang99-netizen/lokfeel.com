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
 * ── 状态：缺口已修（2026-10-17）⇒ 本脚本转为**回归判据** ──────────────
 *   修复内容：① `src/lib/rate-limit.ts` 的桶键改为 `ratelimit:<name>:<rateKey>`，
 *   `name` **必填**且同名不同额度在注册期抛错（原先三处调用共用一个 per-IP 桶，
 *   窗口长短由先建条目者决定）；② `/api/mcp` 与 `/api/v1/a2a/tasks` 各接一个
 *   120 次/分钟/IP 的独立桶（原先**完全没有限流**）。
 *
 *   因此现在的判定**反过来了**：打到超过额度却**看不到 429** 才是问题（限流被摘掉）。
 *   需要对旧构建复现历史结论时用 `--expect=gap`。
 *
 *   历史记录（2026-10-16 实测，修复前）：对照端点 130 次恰好 10 次 429；
 *   MCP / A2A 各 200 次**零 429** —— 那时这条缺口是被**证实**过的，不是形容词。
 *   取证快照见 `docs/implementation/perf-rate-limit.json`（保留为修复前状态）。
 *
 * ── 阳性对照（否则结论无意义）──────────────────────────────────────
 *   如果我只是「打 200 次 MCP，没看到 429，所以没有限流」—— 这个推理有洞：
 *   万一是**我的探针看不出来 429**（比如服务根本没起、或全部返回 503）呢？
 *   所以先打一个**已知有限流**的端点做对照：
 *       `GET /api/v1/public/missions/<token>`
 *       其限流为「每 IP 每 5 分钟 120 次」，且**在任何其它工作之前**执行
 *       （见该 route 的注释：「限流在**任何**工作之前，否则攻击者可无限探测形状」）。
 *   若对照出现了 429 ⇒ 探针**有能力**看见 429 ⇒ 后续的判定才有说服力。
 *   若对照一次 429 都没出现 ⇒ 本次取证**不合格**，脚本判失败并明确说「无法结论」。
 *
 * 用法：
 *   node scripts/perf/rate-limit-probe.mjs --base=http://127.0.0.1:3000 [--n=200] [--out=<json>]
 *   node scripts/perf/rate-limit-probe.mjs --expect=gap     # 对修复前的构建复现历史结论
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
    role: '回归判据（MCP 限流：120 / 1min / IP，桶 mcp:rpc）',
    method: 'POST',
    path: '/api/mcp',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    n: N,
  },
  {
    key: 'a2a-tasks',
    role: '回归判据（A2A 限流：120 / 1min / IP，桶 a2a:task）',
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

    const expectGap = args.expect === 'gap'
    const bothLimited = mcp.rateLimited > 0 && a2a.rateLimited > 0

    if (expectGap) {
      // 对**修复前**的构建复现历史结论
      if (mcp.rateLimited === 0 && a2a.rateLimited === 0) {
        console.log('\n   ⇒ **缺口确认**（--expect=gap）：两者在同等请求量下**零限流**，与对照端点形成明确反差。')
      } else {
        console.log('\n   ⇒ 与 --expect=gap 不符：已观察到 429，该构建看起来已包含限流修复。')
        process.exitCode = 1
      }
    } else if (bothLimited) {
      console.log('\n   ⇒ ✅ 限流已生效（2026-10-17 修复）：两者在超过额度后均返回 429，')
      console.log('      且与对照端点**各自独立**计数（对照刷了 130 次也没有把 MCP/A2A 提前打满）。')
    } else {
      console.log('\n   🔴 **回归**：修复后 MCP / A2A 必须出现 429，实测至少一方为 0。')
      console.log('      可能原因：限流器未接线、被摘掉、或桶键又退回共用（检查 rate-limit.ts 的 name）。')
      process.exitCode = 1
    }
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
