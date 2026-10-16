#!/usr/bin/env node
/**
 * AC-24 · 性能基线压测器（零依赖 · 可复跑）
 *
 * ── 这是干什么的 ────────────────────────────────────────────────────
 *   对**本地构建产物**（`next start`）按固定并发档位打真实 HTTP 请求，
 *   产出每个目标端点的 p50/p90/p95/p99 延迟与错误率，写成 JSON 基线快照。
 *
 * ── 三条设计取舍（都不是随手定的）─────────────────────────────────
 *   ① **不打生产。** 生产是跨境 Netlify 共享 serverless，测出来的是网络抖动
 *      与平台限流，**不是本仓代码的成本**；且对生产开并发本身就是攻击。
 *      ⇒ 一律打 127.0.0.1 上的构建产物。
 *   ② **零新依赖。** 不引 autocannon/k6/artillery：多一个依赖就多一条供应链
 *      风险与一处版本漂移（本仓正被依赖高危困扰，见 DEPENDENCY_RISK.md）。
 *      Node 22 自带 `fetch`，够用。
 *   ③ **只测「读」与「被拒」路径，绝不写库。** 压测若写库，就把「性能」与
 *      「数据污染」耦在一起，跑完还得清库。这里全部是匿名可复现请求：
 *      健康检查（读 1 次 count）、SSR 页面、以及**匿名授权拒绝路径**（401）。
 *
 * ── 指标口径（写进 SLO 的必须与这里一致）───────────────────────────
 *   · latency：`fetch` 发起 → **响应体读完**（`arrayBuffer()`）为止的毫秒数。
 *     不读完就计时会漏掉传输与反序列化成本，那是自欺。
 *   · `ok`            状态码 ∈ expect
 *   · `unexpected`    拿到状态码但不在 expect（例如 500、意外 200）
 *   · `failed`        请求抛异常（连接失败 / 超时）
 *   · `errorRate`     (unexpected + failed) / count
 *   · 百分位用**最近秩法**（nearest-rank）—— 与大多数 SLO 工具一致。
 *
 * 用法：
 *   node scripts/perf/load-baseline.mjs --base=http://127.0.0.1:3000 \
 *        [--levels=1,10,50] [--duration=10] [--warmup=3] [--out=<json>]
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import { performance } from 'node:perf_hooks'

// ══════════════════════════════════════════════════════════════════════
// 目标端点
// ══════════════════════════════════════════════════════════════════════

/**
 * 为什么是这几个：
 *   · health        —— 唯一会**真的往返一次数据库**（`db.user.count()`）的端点，
 *                       是「应用 + Prisma + libSQL」这条链的最小探针。
 *   · home / login  —— SSR/RSC 页面，覆盖 Next 渲染成本（无缓存命中时最重）。
 *   · org / members —— REST 授权面：匿名应 401。测的是「拒绝路径」不能被绕过、
 *                       也不能慢到成为拒绝服务（拒绝本该**比接受更快**）。
 *   · mcp / a2a     —— T11 交接的「**无速率限制**」端点，必须被看见（见 AC-24 报告）。
 */
const TARGETS = [
  {
    name: 'health',
    path: '/api/health',
    method: 'GET',
    expect: [200],
    note: 'DB 往返（user.count）+ Redis 状态',
  },
  {
    name: 'home',
    path: '/',
    method: 'GET',
    expect: [200, 307, 308],
    note: 'SSR 首页（可能重定向到登录）',
  },
  {
    name: 'login',
    path: '/login',
    method: 'GET',
    expect: [200],
    note: 'SSR 登录页',
  },
  {
    name: 'org-anon',
    path: '/api/v1/org',
    method: 'GET',
    expect: [401],
    note: 'REST 授权面：匿名必须 401',
  },
  {
    name: 'members-anon',
    path: '/api/v1/members',
    method: 'GET',
    expect: [401],
    note: 'REST 授权面：匿名必须 401',
  },
  {
    name: 'mcp-discover',
    path: '/api/mcp',
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    expect: [200],
    note: 'MCP 发现面（公开、**无速率限制**）',
  },
  {
    name: 'mcp-call-anon',
    path: '/api/mcp',
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'list_bridges', arguments: {} },
    }),
    expect: [401],
    note: 'MCP 授权面：匿名必须 401',
  },
  {
    name: 'a2a-anon',
    path: '/api/v1/a2a/tasks',
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ skillId: 'list_bridges', input: {} }),
    expect: [401],
    note: 'A2A（**无速率限制**）授权面：匿名必须 401',
  },
]

// ══════════════════════════════════════════════════════════════════════
// 参数
// ══════════════════════════════════════════════════════════════════════

function parseArgs(argv) {
  const out = { levels: '1,10,50', duration: '10', warmup: '3', timeout: '15000' }
  for (const a of argv) {
    if (!a.startsWith('--')) continue
    const [k, v] = a.slice(2).split('=')
    out[k] = v === undefined ? 'true' : v
  }
  return out
}

const args = parseArgs(process.argv.slice(2))
const BASE = (args.base || 'http://127.0.0.1:3000').replace(/\/+$/, '')
const LEVELS = String(args.levels)
  .split(',')
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isFinite(n) && n > 0)
const DURATION_SEC = Number(args.duration)
const WARMUP_SEC = Number(args.warmup)
const TIMEOUT_MS = Number(args.timeout)
const REPEATS = Math.max(1, Number(args.repeats || 1))
const OUT = args.out || ''
const JSON_STDOUT = args.json === 'true'

// ══════════════════════════════════════════════════════════════════════
// 工具
// ══════════════════════════════════════════════════════════════════════

/** 最近秩法百分位（nearest-rank）。sorted 必须已升序。 */
function percentile(sorted, p) {
  if (sorted.length === 0) return null
  const rank = Math.ceil((p / 100) * sorted.length)
  const idx = Math.min(Math.max(rank - 1, 0), sorted.length - 1)
  return round(sorted[idx])
}

const round = (n) => Math.round(n * 100) / 100

const LATENCY_KEYS = ['min', 'p50', 'p90', 'p95', 'p99', 'max', 'mean']

/** 中位数 —— 用于把「同一档位的 N 次重复」收敛成一个可判定的数字。 */
function median(nums) {
  const s = nums.filter((n) => typeof n === 'number' && Number.isFinite(n)).sort((a, b) => a - b)
  if (s.length === 0) return null
  const mid = Math.floor(s.length / 2)
  return s.length % 2 === 1 ? round(s[mid]) : round((s[mid - 1] + s[mid]) / 2)
}

/**
 * 把同一档位的 N 次重复聚合成一个「基线值」。
 *
 * ⚠️ 为什么必须重复取中位数、且**保留每次原始值**：
 *   压测生成器与服务器**同机**（本机 / CI runner），高并发下两者争 CPU，
 *   单次测量不可重复 —— 首轮实测就出现过 `login@50` 的 p95 一次 3044ms，
 *   与 3s 阈值同量级，靠单次数字判 PASS/FAIL 等于在噪声上下结论。
 *   取中位数降低离群影响，**保留 repeats 原始值**则让「噪声有多大」可被复核 ——
 *   只报一个聚合值会让不可重复性被藏起来。
 */
function aggregateLevel(reps) {
  const first = reps[0]
  const base = new Map(first.targets.map((t) => [t.name, t]))

  const targets = first.targets.map((t0) => {
    const per = reps.map((r) => r.targets.find((t) => t.name === t0.name))
    const latencyMs = {}
    for (const m of LATENCY_KEYS) latencyMs[m] = median(per.map((t) => t.latencyMs[m]))
    const statuses = {}
    for (const t of per) {
      for (const [code, n] of Object.entries(t.statuses)) statuses[code] = (statuses[code] || 0) + n
    }
    const p95s = per.map((t) => t.latencyMs.p95).filter((v) => typeof v === 'number')
    return {
      name: t0.name,
      note: base.get(t0.name).note,
      expect: base.get(t0.name).expect,
      count: median(per.map((t) => t.count)),
      ok: median(per.map((t) => t.ok)),
      unexpected: median(per.map((t) => t.unexpected)),
      failed: median(per.map((t) => t.failed)),
      errorRate: median(per.map((t) => t.errorRate)),
      rps: median(per.map((t) => t.rps)),
      statuses,
      latencyMs,
      p95Spread: p95s.length > 1 ? { min: round(Math.min(...p95s)), max: round(Math.max(...p95s)) } : null,
    }
  })

  const totals = {
    requests: median(reps.map((r) => r.totals.requests)),
    unexpected: median(reps.map((r) => r.totals.unexpected)),
    failed: median(reps.map((r) => r.totals.failed)),
    errorRate: median(reps.map((r) => r.totals.errorRate)),
    rps: median(reps.map((r) => r.totals.rps)),
  }

  return {
    concurrency: first.concurrency,
    durationSec: first.durationSec,
    repeatCount: reps.length,
    totals,
    targets,
    repeats: reps,
  }
}

function emptyStats(target) {
  return {
    name: target.name,
    note: target.note,
    expect: target.expect,
    count: 0,
    ok: 0,
    unexpected: 0,
    failed: 0,
    statuses: {},
    _latencies: [],
  }
}

/** 把内部 _latencies 收敛成可序列化的分位数对象。 */
function finalise(stats, wallSec) {
  const lat = stats._latencies.slice().sort((a, b) => a - b)
  const sum = lat.reduce((a, b) => a + b, 0)
  const errorRate = stats.count === 0 ? null : round((stats.unexpected + stats.failed) / stats.count)
  return {
    name: stats.name,
    note: stats.note,
    expect: stats.expect,
    count: stats.count,
    ok: stats.ok,
    unexpected: stats.unexpected,
    failed: stats.failed,
    errorRate,
    rps: wallSec > 0 ? round(stats.count / wallSec) : null,
    statuses: stats.statuses,
    latencyMs: {
      min: lat.length ? round(lat[0]) : null,
      p50: percentile(lat, 50),
      p90: percentile(lat, 90),
      p95: percentile(lat, 95),
      p99: percentile(lat, 99),
      max: lat.length ? round(lat[lat.length - 1]) : null,
      mean: lat.length ? round(sum / lat.length) : null,
    },
  }
}

/** 先证前置成立：服务不健康就直接退出，别在坏前提上跑出一堆好看或难看的数字。 */
async function probe() {
  const url = `${BASE}/api/health`
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    const body = await res.json().catch(() => null)
    return {
      reachable: true,
      status: res.status,
      healthStatus: body?.status ?? null,
      dbLatency: typeof body?.dbLatency === 'number' ? body.dbLatency : null,
      redisBackend: body?.redis?.backend ?? null,
    }
  } catch (err) {
    return { reachable: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// ══════════════════════════════════════════════════════════════════════
// 单档位执行
// ══════════════════════════════════════════════════════════════════════

async function runLevel({ concurrency, durationSec, collect }) {
  const deadline = performance.now() + durationSec * 1000
  const stats = new Map()
  for (const t of TARGETS) stats.set(t.name, emptyStats(t))
  let cursor = 0

  const worker = async () => {
    while (performance.now() < deadline) {
      const target = TARGETS[cursor++ % TARGETS.length]
      const s = stats.get(target.name)
      const started = performance.now()
      try {
        const res = await fetch(BASE + target.path, {
          method: target.method,
          headers: target.headers,
          body: target.body,
          redirect: 'manual',
          signal: AbortSignal.timeout(TIMEOUT_MS),
        })
        // 读完响应体 —— 不读完就计时等于自欺（漏掉传输与反序列化）
        await res.arrayBuffer()
        const ms = performance.now() - started
        s.count++
        s._latencies.push(ms)
        s.statuses[res.status] = (s.statuses[res.status] || 0) + 1
        if (target.expect.includes(res.status)) s.ok++
        else s.unexpected++
      } catch {
        const ms = performance.now() - started
        s.count++
        s._latencies.push(ms)
        s.failed++
      }
    }
  }

  const t0 = performance.now()
  await Promise.all(Array.from({ length: concurrency }, worker))
  const wallSec = (performance.now() - t0) / 1000

  const targets = [...stats.values()].map((s) => finalise(s, wallSec))
  if (!collect) return { concurrency, durationSec, wallSec: round(wallSec), targets }

  const totals = targets.reduce(
    (acc, t) => {
      acc.requests += t.count
      acc.unexpected += t.unexpected
      acc.failed += t.failed
      return acc
    },
    { requests: 0, unexpected: 0, failed: 0 },
  )
  totals.errorRate =
    totals.requests === 0 ? null : round((totals.unexpected + totals.failed) / totals.requests)
  totals.rps = wallSec > 0 ? round(totals.requests / wallSec) : null

  return { concurrency, durationSec, wallSec: round(wallSec), totals, targets }
}

// ══════════════════════════════════════════════════════════════════════
// 主流程
// ══════════════════════════════════════════════════════════════════════

function printLevel(lv) {
  console.log(
    `\n── 并发 ${lv.concurrency} · ${lv.durationSec}s × ${lv.repeatCount} 次（表中为**中位数**）· ` +
      `共 ${lv.totals.requests} 请求 · ${lv.totals.rps} rps · ` +
      `错误率 ${lv.totals.errorRate === null ? 'n/a' : (lv.totals.errorRate * 100).toFixed(2) + '%'}`,
  )
  console.log(
    '   ' +
      '端点'.padEnd(16) +
      'p50'.padStart(9) +
      'p90'.padStart(9) +
      'p95'.padStart(9) +
      'p99'.padStart(9) +
      'max'.padStart(9) +
      'err'.padStart(9) +
      (lv.repeatCount > 1 ? '  p95 各次区间'.padEnd(18) : '') +
      '  状态',
  )
  for (const t of lv.targets) {
    const l = t.latencyMs
    const codes = Object.entries(t.statuses)
      .map(([code, n]) => `${code}×${n}`)
      .join(' ')
    const spread = t.p95Spread ? `  ${t.p95Spread.min} ~ ${t.p95Spread.max}`.padEnd(18) : ''
    console.log(
      '   ' +
        t.name.padEnd(16) +
        String(l.p50 ?? '-').padStart(9) +
        String(l.p90 ?? '-').padStart(9) +
        String(l.p95 ?? '-').padStart(9) +
        String(l.p99 ?? '-').padStart(9) +
        String(l.max ?? '-').padStart(9) +
        String(t.errorRate === null ? '-' : (t.errorRate * 100).toFixed(2) + '%').padStart(9) +
        spread +
        '  ' +
        codes,
    )
  }
}

/** 取当前提交，便于基线可追溯。取不到就如实留 null（不编造）。 */
function currentCommit() {
  if (process.env.GIT_COMMIT) return process.env.GIT_COMMIT
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return null
  }
}

async function main() {
  console.log('════════════════════════════════════════════════════════════')
  console.log(' AC-24 · 性能基线压测')
  console.log(` 目标：${BASE}`)
  console.log(` 档位：${LEVELS.join(' / ')} 并发 · 每档 ${DURATION_SEC}s × ${REPEATS} 次（暖机 ${WARMUP_SEC}s）`)
  console.log('════════════════════════════════════════════════════════════')

  // 前置：服务必须可达且健康
  const pre = await probe()
  if (!pre.reachable) {
    console.error(`\n🔴 前置不成立：${BASE}/api/health 不可达 —— ${pre.error}`)
    console.error('   先启动构建产物：DATABASE_URL="file:./perf-baseline.db" npm run start')
    process.exit(1)
  }
  if (pre.status !== 200) {
    console.error(`\n🔴 前置不成立：/api/health 返回 ${pre.status}（期望 200），健康状态 ${pre.healthStatus}`)
    console.error('   DB 可能未就绪（先跑 bash scripts/perf/prepare-env.sh）')
    process.exit(1)
  }
  console.log(
    `\n✅ 前置成立：/api/health 200 · status=${pre.healthStatus} · dbLatency=${pre.dbLatency}ms · redis=${pre.redisBackend}`,
  )

  if (WARMUP_SEC > 0) {
    console.log(`\n… 暖机 ${WARMUP_SEC}s（丢弃，不进基线）`)
    await runLevel({ concurrency: Math.min(4, LEVELS[0]), durationSec: WARMUP_SEC, collect: false })
  }

  const levels = []
  for (const c of LEVELS) {
    console.log(`\n… 执行并发 ${c}（${DURATION_SEC}s × ${REPEATS} 次）`)
    const reps = []
    for (let i = 0; i < REPEATS; i++) {
      const lv = await runLevel({ concurrency: c, durationSec: DURATION_SEC, collect: true })
      reps.push(lv)
      if (REPEATS > 1) {
        const login = lv.targets.find((t) => t.name === 'login')
        const health = lv.targets.find((t) => t.name === 'health')
        console.log(
          `   第 ${i + 1}/${REPEATS} 次：health p95=${health?.latencyMs.p95}ms · login p95=${login?.latencyMs.p95}ms`,
        )
      }
    }
    const lv = REPEATS > 1 ? aggregateLevel(reps) : reps[0]
    if (REPEATS === 1) lv.repeatCount = 1
    printLevel(lv)
    levels.push(lv)
  }

  const post = await probe()
  const doc = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    kind: 'local-build', // 明确标注：这是本地构建产物，不是生产
    note:
      '本地构建产物（next start）实测。生产为跨境 Netlify 共享 serverless，延迟含跨网络 RTT，' +
      '本基线**不含**该部分，故不可直接外推为生产 SLO 达标证据。',
    base: BASE,
    config: {
      levels: LEVELS,
      durationSec: DURATION_SEC,
      warmupSec: WARMUP_SEC,
      timeoutMs: TIMEOUT_MS,
      repeats: REPEATS,
      aggregation: REPEATS > 1 ? 'median-of-repeats（原始值保留在 levels[].repeats）' : 'single-run',
    },
    env: {
      node: process.version,
      platform: `${os.platform()} ${os.release()}`,
      cpuModel: os.cpus()[0]?.model ?? 'unknown',
      cpuCount: os.cpus().length,
      totalMemGB: round(os.totalmem() / 1024 ** 3),
      commit: currentCommit(),
    },
    health: { before: pre, after: post },
    levels,
  }

  console.log('\n════════════════════════════════════════════════════════════')
  if (OUT) {
    fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true })
    fs.writeFileSync(path.resolve(OUT), JSON.stringify(doc, null, 2) + '\n')
    console.log(`✅ 基线已写入：${OUT}`)
  } else {
    console.log('（未指定 --out，未写文件）')
  }
  if (JSON_STDOUT) console.log(JSON.stringify(doc, null, 2))
}

main().catch((err) => {
  console.error('🔴 压测失败：', err)
  process.exit(1)
})
