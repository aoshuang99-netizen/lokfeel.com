#!/usr/bin/env node
/**
 * 探活新鲜度门禁 —— 防止「/api/health 被缓存」这类**会撒谎的绿**
 *
 * 背景（2026-10-20 线上实测）：
 *   `/api/health` 曾连续三次返回完全相同的 `dbLatency=5615ms`。看起来像"数据库很稳"，
 *   实际是 Netlify 边缘按 60s 缓存的同一份响应。更糟的是坏发布期间它照样喊 healthy。
 *
 * 两个独立成因，缺一不可：
 *   ① 源站自己写了 `Cache-Control: public, max-age=60`；
 *   ② 路由缺 `export const dynamic = 'force-dynamic'`，App Router 把「只导出 GET、
 *      不接收 request」的 handler **默认预渲染**，Next 用自己的 `Surrogate-Control`
 *      覆盖源站头 —— 所以只改 ① 是没用的，线上依旧 max-age=60。
 *
 * 本门禁用**行为**而不是头来判定：连续两次请求，`timestamp` 必须不同。
 * 头可以骗人（代理会改写），执行时刻骗不了人。
 *
 * 用法：
 *   node scripts/qa/verify-health-live.mjs [--base https://app.lokfeel.com] [--samples 3]
 *   node scripts/qa/verify-health-live.mjs --self-test      # 引擎自证（含变异）
 */
import { createServer } from 'node:http'

const argv = process.argv.slice(2)
const arg = (k, d) => {
  const i = argv.indexOf(`--${k}`)
  return i >= 0 ? argv[i + 1] : d
}
const SELF_TEST = argv.includes('--self-test')
const BASE = (arg('base', 'https://app.lokfeel.com') || '').replace(/\/$/, '')
const SAMPLES = Math.max(2, Number(arg('samples', '3')) || 3)

/** 拉一次探活；带随机查询串，避免我们自己命中边缘缓存 */
async function probe(base, n) {
  const url = `${base}/api/health?gate=${Date.now()}-${n}-${Math.random().toString(36).slice(2, 8)}`
  const res = await fetch(url, {
    // 模拟监控：明确要求新鲜
    headers: { 'cache-control': 'no-cache', pragma: 'no-cache' },
    redirect: 'follow',
  })
  const text = await res.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    /* 非 JSON：留给断言去判 */
  }
  return { status: res.status, headers: res.headers, json, text }
}

function analyze(samples) {
  const out = []
  const first = samples[0]

  out.push([
    'H1',
    '/api/health 返回 200',
    first.status === 200 ? 'PASS' : 'FAIL',
    `HTTP ${first.status}`,
  ])

  // 头层面：允许 no-store / max-age=0；不允许可缓存
  const cc = (first.headers.get('cache-control') || '').toLowerCase()
  const ttl = Number((cc.match(/max-age=(\d+)/) || [])[1] || 0)
  const cacheable = /public/.test(cc) && ttl > 0
  out.push([
    'H2',
    '响应头不可缓存（no-store / max-age=0）',
    cc ? (cacheable ? 'FAIL' : 'PASS') : 'FAIL',
    cc || '(缺少 cache-control)',
  ])

  // Next 的静态化层会用 Surrogate-Control 覆盖源站头，单独判一条
  const sc = (first.headers.get('surrogate-control') || '').toLowerCase()
  const scTtl = Number((sc.match(/max-age=(\d+)/) || [])[1] || 0)
  out.push([
    'H3',
    '无 Surrogate-Control 缓存指令（路由未被子静态化）',
    sc && scTtl > 0 ? 'FAIL' : 'PASS',
    sc || '(无)',
  ])

  // 行为层面：timestamp 必须变 —— 这是唯一骗不了的判据
  const stamps = samples.map((s) => s.json?.timestamp).filter(Boolean)
  const unique = new Set(stamps)
  out.push([
    'H4',
    `${samples.length} 次请求的 timestamp 各不相同（真执行，不是缓存）`,
    stamps.length === samples.length && unique.size === samples.length ? 'PASS' : 'FAIL',
    `${unique.size}/${samples.length} 个不同值`,
  ])

  // dbLatency 是"被缓存"最先出卖的地方：同一个数重复出现且 timestamp 也相同 ⇒ 同一次执行
  const lats = samples.map((s) => s.json?.dbLatency)
  const same = lats.every((x) => x === lats[0])
  out.push([
    'H5',
    'dbLatency 有变化（或 timestamp 已证明新鲜）',
    same && unique.size === 1 ? 'FAIL' : 'PASS',
    `latencies=${JSON.stringify(lats)}`,
  ])

  return out
}

function report(list) {
  const w = Math.max(...list.map((r) => r[0].length))
  for (const [id, title, status, detail] of list) {
    const mark = status === 'PASS' ? '✅' : '❌'
    console.log(`${mark} ${id.padEnd(w)}  ${title}  ——  ${detail}`)
  }
  const pass = list.filter((r) => r[2] === 'PASS').length
  const fail = list.filter((r) => r[2] === 'FAIL').length
  console.log(`\nRESULT: ${fail === 0 ? 'PASS' : 'FAIL'} · ${pass} PASS / ${fail} FAIL · ASSERTIONS=${list.length}`)
  return fail
}

async function selfTest() {
  // 用本地假服务端制造「缓存」与「新鲜」两种真实响应，验证判定会翻转
  const build = (mode) => {
    let frozen = null
    return createServer((req, res) => {
      if (mode === 'cached') {
        // 模拟边缘缓存：同一个 body 反复返回，且头可缓存 + 带 Surrogate-Control
        frozen ||= JSON.stringify({ status: 'healthy', dbLatency: 5615, timestamp: '2026-10-20T09:20:10.418Z' })
        res.writeHead(200, {
          'content-type': 'application/json',
          'cache-control': 'public, max-age=60',
          'surrogate-control': 'public, max-age=60',
        })
        res.end(frozen)
      } else {
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store, max-age=0' })
        res.end(JSON.stringify({ status: 'healthy', dbLatency: 120 + Math.floor(Math.random() * 50), timestamp: new Date().toISOString() }))
      }
    })
  }

  const listen = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv.address().port)))

  const s1 = build('cached'); const p1 = await listen(s1)
  const s2 = build('live'); const p2 = await listen(s2)

  const grab = async (port) => {
    const out = []
    for (let i = 0; i < SAMPLES; i++) out.push(await probe(`http://127.0.0.1:${port}`, i))
    return out
  }

  const cached = analyze(await grab(p1))
  const live = analyze(await grab(p2))
  s1.close(); s2.close()

  const t = []
  const get = (list, id) => list.find((r) => r[0] === id)[2]
  t.push(['H4 抓到缓存（timestamp 重复）', get(cached, 'H4') === 'FAIL'])
  t.push(['H2 抓到可缓存头', get(cached, 'H2') === 'FAIL'])
  t.push(['H3 抓到 Surrogate-Control', get(cached, 'H3') === 'FAIL'])
  t.push(['新鲜站点 H4 判 PASS', get(live, 'H4') === 'PASS'])
  t.push(['新鲜站点 H2 判 PASS', get(live, 'H2') === 'PASS'])
  t.push(['新鲜站点 H5 判 PASS', get(live, 'H5') === 'PASS'])
  // 变异：把"新鲜"服务端改成冻结时间戳，H4 必须转红
  const s3 = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store, max-age=0' })
    res.end(JSON.stringify({ status: 'healthy', dbLatency: 100, timestamp: '2026-10-20T00:00:00.000Z' }))
  })
  const p3 = await listen(s3)
  const mutated = analyze(await grab(p3))
  s3.close()
  t.push(['变异（冻结 timestamp）H4 必须转红', get(mutated, 'H4') === 'FAIL'])

  let fail = 0
  for (const [name, okv] of t) {
    console.log(`${okv ? '✅' : '❌'} ${name}`)
    if (!okv) fail++
  }
  console.log(`\nSELFTEST ASSERTIONS=${t.length} → ${t.length - fail} PASS / ${fail} FAIL`)
  process.exit(fail === 0 ? 0 : 1)
}

async function main() {
  if (SELF_TEST) return selfTest()

  console.log(`探活新鲜度门禁 · ${BASE} · samples=${SAMPLES}\n`)
  const samples = []
  for (let i = 0; i < SAMPLES; i++) {
    samples.push(await probe(BASE, i))
  }
  const fail = report(analyze(samples))
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(`\n🔴 门禁自身失败（不是站点失败）：${e.message}`)
  process.exit(3)
})
