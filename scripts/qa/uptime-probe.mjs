#!/usr/bin/env node
/**
 * V17 · WB17-05 —— 生产存活探针（零成本告警通道的执行体）
 *
 * ## 为什么要有这个东西
 *
 * 现状是：没有任何存活监控。`/api/health` 存在，但**没人定时看它**。
 * 一次真实的故障（函数 502 / Turso 不可达 / 部署把站点打挂）可以一直持续到
 * 用户来投诉 —— 对一个"1 人 + AI、每周 20h"的项目，这是最不能接受的失效模式，
 * 因为它把"发现问题"的延迟从分钟级拖到小时/天级，而修复成本随时间指数上升。
 *
 * ## 告警通道的选择（预算 ≈ 0）
 *
 * 用 GitHub Actions 的定时 workflow 跑本脚本：失败即 job 失败，GitHub 默认会给
 * 仓库 owner 发**失败邮件**。不需要 uptime 服务、不需要付费、不需要新的凭据。
 * 代价与限制写在 `docs/implementation/v17/05_MONITORING_ALERTS.md` §3，不藏。
 *
 * ## 判据为什么长这样
 *
 * 实测（2026-10-21，Netlify 免费计划 + Cloudflare 代理）：
 *   · 冷启动 `/api/health` TTFB **13.2s**，`dbLatency` 5053ms；
 *   · 暖机 TTFB 1.8–2.3s，`dbLatency` 10–282ms。
 * 所以：
 *   1. **必须重试**。单次探测会把冷启动误判成宕机 —— 那种告警发三次就没人看了。
 *   2. 超时放到 20s。宁可慢一点才发现真宕机，也不要每 30 分钟误报一次。
 *   3. 冷启动**只记 WARN 不判红**。它是真实缺陷（但要靠预热/付费计划解决），
 *      不是"站点挂了"。把两者混在一起会让告警失去意义。
 *   4. `dbLatency` 门槛取 3000ms —— 与 `/api/health` 自身对"慢"的语义一致。
 *
 * ## 用法
 *
 *   node scripts/qa/uptime-probe.mjs                # 打生产
 *   node scripts/qa/uptime-probe.mjs --json         # 机器可读（CI artifact）
 *   UPTIME_BASE_URL=http://127.0.0.1:3000 node scripts/qa/uptime-probe.mjs
 *   node scripts/qa/uptime-probe.mjs --self-test    # 自证：证明"该红时会红"
 *
 * 退出码：0 = 全部通过（可含 WARN）；1 = 有 CRITICAL 失败。
 */

import http from 'node:http'

const BASE = (process.env.UPTIME_BASE_URL || 'https://app.lokfeel.com').replace(/\/$/, '')
/** 每次调用时读 env —— 否则 `--self-test` 里临时调小超时会无效（常量已固化）。 */
const timeoutMs = () => Number(process.env.UPTIME_TIMEOUT_MS || 20_000)
const attempts = () => Math.max(1, Number(process.env.UPTIME_ATTEMPTS || 2))
const RETRY_GAP_MS = Number(process.env.UPTIME_RETRY_GAP_MS || 4_000)
const DB_LATENCY_BUDGET_MS = Number(process.env.UPTIME_DB_BUDGET_MS || 3_000)
/** 超过这个值记为"冷启动"WARN（实测冷启动 13.2s，暖机 1.8–2.3s）。 */
const COLD_START_MS = Number(process.env.UPTIME_COLD_START_MS || 5_000)

const skipTlsHint = (err) => String(err?.message ?? err)

// ═══════════════════════════════════════════════════════════
// 单次请求
// ═══════════════════════════════════════════════════════════

async function fetchOnce(path, base) {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs())
  const started = Date.now()
  // cache-buster：`/api/health` 现在是 no-store，但**曾经**被边缘缓存过 60s
  // （见 scripts/qa/verify-health-live.mjs 的记录）。缓存回归时，一个不带
  // cache-buster 的探针会对着旧的 healthy 响应一直绿 —— 正是那种"会撒谎的绿"。
  const url = `${base}${path}${path.includes('?') ? '&' : '?'}probe=${started}`
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      redirect: 'manual',
      headers: { 'user-agent': 'lokfeel-uptime-probe/1.0' },
    })
    const text = await res.text()
    let json = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      json = null
    }
    return { ok: true, status: res.status, ms: Date.now() - started, text, json, error: null }
  } catch (err) {
    return {
      ok: false,
      status: 0,
      ms: Date.now() - started,
      text: '',
      json: null,
      error: err?.name === 'AbortError' ? `timeout>${timeoutMs()}ms` : skipTlsHint(err),
    }
  } finally {
    clearTimeout(timer)
  }
}

// ═══════════════════════════════════════════════════════════
// 检查定义
// ═══════════════════════════════════════════════════════════
//
// 每条检查返回 `{ critical: boolean, problems: string[] }`。
// critical=false 的问题记 WARN（例如支付未接入），不判红 ——
// "未接入"与"坏了"必须分开，否则真正的故障会被已知缺口淹没。

const CHECKS = [
  {
    name: 'health',
    path: '/api/health',
    /**
     * `payments.configured=false` 是**已知缺口**（缺 4 个凭据），
     * 记 WARN 不记 FAIL。但它必须被**显式汇报**：如果哪天 `configured=true`
     * 而 `charging=false`，那才是必须查的矛盾状态。
     */
    assert(r) {
      const problems = []
      const warns = []
      if (r.status !== 200) problems.push(`HTTP ${r.status}（期望 200）`)
      const body = r.json
      if (!body || typeof body !== 'object') {
        problems.push('响应不是 JSON 对象')
        return { problems, warns }
      }
      if (body.status !== 'healthy') problems.push(`status=${String(body.status)}（期望 healthy）`)
      if (typeof body.dbLatency !== 'number') {
        problems.push('缺 dbLatency（无法判断数据库延迟）')
      } else if (body.dbLatency > DB_LATENCY_BUDGET_MS) {
        problems.push(`dbLatency=${body.dbLatency}ms > 预算 ${DB_LATENCY_BUDGET_MS}ms`)
      }
      // Redis 降级意味着限流与在线状态正在弱化 —— 这是**真故障**，不是容量问题。
      if (body.redis && body.redis.configured === true && body.redis.degraded === true) {
        problems.push(`redis 已配置但降级（backend=${String(body.redis.backend)}）`)
      }
      const pay = body.payments
      if (!pay || typeof pay !== 'object') {
        problems.push('缺 payments 字段（无法判断支付通道状态）')
      } else if (pay.configured === false) {
        warns.push(`支付未接入（缺 ${Array.isArray(pay.missing) ? pay.missing.length : '?'} 个凭据）`)
      } else if (pay.configured === true && pay.charging === false) {
        problems.push('configured=true 但 charging=false（矛盾状态）')
      }
      return { problems, warns }
    },
  },
  {
    name: 'landing',
    path: '/',
    assert(r) {
      const problems = []
      if (r.status !== 200) problems.push(`HTTP ${r.status}（期望 200）`)
      if (r.text.length < 2_000) problems.push(`HTML 仅 ${r.text.length} 字节（疑似错误页）`)
      if (!/<html/i.test(r.text)) problems.push('响应不含 <html>')
      return { problems, warns: [] }
    },
  },
  {
    name: 'pay-surface',
    // 客户实际下单的店面页。它挂了 = 收不到钱，且**不会**有任何应用日志。
    path: '/pay.html',
    assert(r) {
      const problems = []
      if (r.status !== 200) problems.push(`HTTP ${r.status}（期望 200）`)
      if (!/Pass|refund/i.test(r.text)) problems.push('页面内容不含套餐/退款关键词（疑似非预期页面）')
      return { problems, warns: [] }
    },
  },
  {
    name: 'auth-guard',
    // 受保护页面**必须**是 307/302 跳登录，而不是 200（200 = 未登录也能进）
    // 也不是 500（500 = 鉴权链路炸了）。
    path: '/workspace',
    assert(r) {
      const problems = []
      if (r.status !== 307 && r.status !== 302) {
        problems.push(`HTTP ${r.status}（期望 307/302 跳登录）`)
      }
      return { problems, warns: [] }
    },
  },
]

// ═══════════════════════════════════════════════════════════
// 执行
// ═══════════════════════════════════════════════════════════

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function runCheck(check, base) {
  const tries = []
  let last = null
  const maxTries = attempts()
  for (let i = 0; i < maxTries; i += 1) {
    const r = await fetchOnce(check.path, base)
    const verdict = check.assert(r)
    const passed = r.ok && verdict.problems.length === 0
    tries.push({ ms: r.ms, status: r.status, passed, error: r.error })
    last = { r, verdict, passed }
    if (passed) break
    if (i < maxTries - 1) await sleep(RETRY_GAP_MS)
  }
  const first = tries[0]
  return {
    name: check.name,
    path: check.path,
    passed: last.passed,
    status: last.r.status,
    ms: last.r.ms,
    attempts: tries,
    problems: last.passed ? [] : last.verdict.problems,
    warns: last.verdict.warns,
    coldStart: first.ms >= COLD_START_MS,
  }
}

async function probeAll(base = BASE) {
  const results = []
  for (const check of CHECKS) results.push(await runCheck(check, base))
  return {
    base,
    at: new Date().toISOString(),
    ok: results.every((r) => r.passed),
    warned: results.some((r) => r.warns.length > 0 || r.coldStart),
    results,
  }
}

function print(report) {
  console.log(`\n探针目标：${report.base}    ${report.at}\n`)
  const pad = (s, n) => String(s).padEnd(n)
  console.log(`${pad('CHECK', 14)}${pad('VERDICT', 9)}${pad('HTTP', 6)}${pad('TTFB', 9)}ATTEMPTS`)
  console.log('─'.repeat(64))
  for (const r of report.results) {
    const verdict = r.passed ? (r.warns.length || r.coldStart ? 'WARN' : 'PASS') : 'FAIL'
    const tries = r.attempts.map((a) => `${a.ms}ms`).join(' → ')
    console.log(`${pad(r.name, 14)}${pad(verdict, 9)}${pad(r.status, 6)}${pad(`${r.ms}ms`, 9)}${tries}`)
    for (const p of r.problems) console.log(`   ✗ ${p}`)
    for (const w of r.warns) console.log(`   ! ${w}`)
    if (r.coldStart) {
      console.log(`   ! 首次 ${r.attempts[0].ms}ms ≥ ${COLD_START_MS}ms —— 冷启动（记 WARN，不判宕机）`)
    }
  }
  console.log('─'.repeat(64))
  console.log(report.ok ? '结论：存活（可含 WARN）' : '结论：**不可用**')
  if (report.ok && report.warned) console.log('注意：存在 WARN —— 不是故障，但需要人看。')
  console.log('')
}

// ═══════════════════════════════════════════════════════════
// 自证：证明"该红时会红"
// ═══════════════════════════════════════════════════════════

/**
 * 一个探针最坏的失效方式不是"抓不到故障"，而是**永远绿**。
 * 所以自证必须包含"喂给它一个坏站点，它必须红"。
 */
async function selfTest() {
  const results = []
  const check = (name, ok, detail = '') => {
    results.push({ name, ok })
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? ` — ${detail}` : ''}`)
  }

  const healthy = (over = {}) => ({
    status: 'healthy',
    dbLatency: 42,
    redis: { configured: true, degraded: false, backend: 'upstash' },
    payments: { configured: false, charging: false, missing: ['A', 'B', 'C', 'D'] },
    ...over,
  })

  /** 假站点：按 `__MODE__` 返回不同剧本，用来逐一触发判据。
   *  （模式走环境变量而不是查询串：查询串必须拼在**路径之后**，拼到 base 上会把
   *   `/api/health` 吃掉，变成 pathname=`/` —— 自证里踩过一次。） */
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x')
    const mode = process.env.__UPTIME_SELFTEST_MODE__ ?? 'ok'
    const send = (code, body, type = 'application/json') => {
      res.writeHead(code, { 'content-type': type })
      res.end(typeof body === 'string' ? body : JSON.stringify(body))
    }
    if (url.pathname === '/api/health') {
      if (mode === 'down') return send(503, { status: 'unhealthy' })
      if (mode === 'slowdb') return send(200, healthy({ dbLatency: 9_999 }))
      if (mode === 'badstatus') return send(200, healthy({ status: 'degraded' }))
      if (mode === 'redisdegraded')
        return send(200, healthy({ redis: { configured: true, degraded: true, backend: 'memory' } }))
      if (mode === 'paycontradiction')
        return send(200, healthy({ payments: { configured: true, charging: false } }))
      if (mode === 'notjson') return send(200, 'plain text', 'text/plain')
      if (mode === 'hang') return // 永不响应，触发超时
      return send(200, healthy())
    }
    if (url.pathname === '/') {
      if (mode === 'blank') return send(200, '<html></html>', 'text/html')
      return send(200, `<html>${'x'.repeat(3000)}</html>`, 'text/html')
    }
    if (url.pathname === '/pay.html') {
      if (mode === 'nopay') return send(200, '<html>hello</html>', 'text/html')
      return send(200, '<html>Pass · refund</html>', 'text/html')
    }
    if (url.pathname === '/workspace') {
      if (mode === 'open') return send(200, '<html>secret</html>', 'text/html')
      res.writeHead(307, { location: '/api/auth/signin' })
      return res.end()
    }
    return send(404, { error: 'nope' })
  })

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  const base = `http://127.0.0.1:${port}`

  const saved = { attempts: process.env.UPTIME_ATTEMPTS, timeout: process.env.UPTIME_TIMEOUT_MS }
  // 自证里只跑 1 次，避免重试把"坏站点"洗成绿
  process.env.UPTIME_ATTEMPTS = '1'
  process.env.UPTIME_TIMEOUT_MS = '1200'

  const run = async (mode) => {
    process.env.__UPTIME_SELFTEST_MODE__ = mode
    const report = await probeAll(base)
    return { ok: report.ok, fails: report.results.filter((r) => !r.passed).map((r) => r.name) }
  }

  try {
    process.env.__UPTIME_SELFTEST_MODE__ = 'ok'
    const allGood = await probeAll(base)
    check('健康站点 → 全绿', allGood.ok === true, JSON.stringify(allGood.results.map((r) => [r.name, r.passed])))

    const down = await run('down')
    check('health 503 → 红，且只红 health', down.ok === false && down.fails.join() === 'health', down.fails.join())

    const slowdb = await run('slowdb')
    check('dbLatency 超预算 → 红', slowdb.ok === false && slowdb.fails.includes('health'), slowdb.fails.join())

    const badstatus = await run('badstatus')
    check('status≠healthy → 红', badstatus.ok === false && badstatus.fails.includes('health'), badstatus.fails.join())

    const redis = await run('redisdegraded')
    check('redis 已配置却降级 → 红', redis.ok === false && redis.fails.includes('health'), redis.fails.join())

    const pay = await run('paycontradiction')
    check('configured=true 且 charging=false → 红', pay.ok === false && pay.fails.includes('health'), pay.fails.join())

    const notjson = await run('notjson')
    check('响应不是 JSON → 红', notjson.ok === false && notjson.fails.includes('health'), notjson.fails.join())

    const blank = await run('blank')
    check('落地页是空白 HTML → 红', blank.ok === false && blank.fails.includes('landing'), blank.fails.join())

    const open = await run('open')
    check('受保护页返回 200（未登录可进）→ 红', open.ok === false && open.fails.includes('auth-guard'), open.fails.join())

    const nopay = await run('nopay')
    check('店面页内容不对 → 红', nopay.ok === false && nopay.fails.includes('pay-surface'), nopay.fails.join())

    // 超时：反向对照的另一半 —— 挂住的站点必须被判定为不可用，而不是"慢慢等"
    const t0 = Date.now()
    const hang = await run('hang')
    const took = Date.now() - t0
    check(
      '站点挂住（不响应）→ 红，且被超时截断（不无限等）',
      hang.ok === false && hang.fails.includes('health') && took < 8_000,
      `fails=${hang.fails.join()} took=${took}ms`,
    )

    // 负数对照：WARN 不得被当成 FAIL
    process.env.__UPTIME_SELFTEST_MODE__ = 'ok'
    const warnOnly = await probeAll(base)
    check(
      '支付未接入只记 WARN，不判红（否则已知缺口会淹没真故障）',
      warnOnly.ok === true && warnOnly.results.some((r) => r.warns.length > 0),
      JSON.stringify(warnOnly.results.find((r) => r.warns.length)?.warns ?? []),
    )
  } finally {
    // 挂住的场景下连接还开着，`close()` 会一直等 —— 先强制断开。
    server.closeAllConnections()
    server.close()
    if (saved.attempts === undefined) delete process.env.UPTIME_ATTEMPTS
    else process.env.UPTIME_ATTEMPTS = saved.attempts
    if (saved.timeout === undefined) delete process.env.UPTIME_TIMEOUT_MS
    else process.env.UPTIME_TIMEOUT_MS = saved.timeout
  }

  const failed = results.filter((r) => !r.ok)
  console.log(`\n自证：${results.length - failed.length}/${results.length} 通过`)
  if (failed.length) process.exitCode = 1
}

// ═══════════════════════════════════════════════════════════

const argv = process.argv.slice(2)
if (argv.includes('--self-test')) {
  await selfTest()
} else {
  const report = await probeAll()
  if (argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    print(report)
  }
  if (!report.ok) process.exitCode = 1
}
