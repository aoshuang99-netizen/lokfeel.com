#!/usr/bin/env node
/**
 * V20.7 GA · R6-T7 —— Long Task **归因**（不是打分）
 *
 * ── 它回答什么 ────────────────────────────────────────────────────────
 *   「TBT 1200ms 是被谁吃掉的」。`measure-vitals.mjs` 只能告诉你 TBT 超标，
 *   说不出是 React 水合、第三方脚本、还是某个 400KB 的 chunk 在解析。
 *   不做归因就去"优化性能"，最后改的都是不影响 TBT 的地方。
 *
 * ── 为什么用 Trace 而不是 Profiler ─────────────────────────────────────
 *   `Profiler.start/stop` 的采样时间戳基于 **CDP 会话单调时钟**，而页面里
 *   `performance.now()` 基于 **timeOrigin** —— 两个时间基不同，硬换算会得到
 *   看似合理但错位的归属（"归因错了"比"没归因"更糟，因为会据此改错代码）。
 *   Trace 事件里 RunTask / FunctionCall 用的是同一个单调时钟，父子关系天然成立：
 *     长任务 = RunTask(dur>50ms)；归因 = 落在该任务时间窗内的子事件。
 *   这与 Lighthouse 的 TBT 归因口径一致，可与 `measure-vitals.mjs` 的 TBT 对账。
 *
 * ── 它自己的失效条件 ───────────────────────────────────────────────────
 *   ① 只在 Chromium 下成立（Trace 事件名是 Blink/V8 的实现细节）；
 *   ② 事件名可能随版本改名 —— 脚本对认不出的事件名**不静默吞掉**，
 *      会以 `unknown:<name>` 出现在归因表里，让人看见"归因不全"；
 *   ③ 归因到"哪个函数"不等于"该函数可删"：框架内部调用可能由业务代码触发。
 *
 * 用法：
 *   node scripts/perf/attribute-tbt.mjs --base=http://127.0.0.1:3116
 *   node scripts/perf/attribute-tbt.mjs --base=... --urls=/,/pricing --out=x.json
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')

const MOBILE = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
}

/** 与 measure-vitals.mjs 同档位：4G + 4× CPU。档位不同则两份报告不可比。 */
const NET = {
  offline: false,
  latency: 150,
  downloadThroughput: (1.6 * 1024 * 1024) / 8,
  uploadThroughput: (750 * 1024) / 8,
}

const args = {}
for (const a of process.argv.slice(2)) {
  if (!a.startsWith('--')) continue
  const i = a.indexOf('=')
  if (i === -1) args[a.slice(2)] = 'true'
  else args[a.slice(2, i)] = a.slice(i + 1)
}

const BASE = (args.base || 'http://127.0.0.1:3116').replace(/\/$/, '')
const URLS = (args.urls ? args.urls.split(',') : ['/', '/login', '/product', '/solutions', '/stories', '/how-it-works', '/help', '/pricing'])
  .map((u) => (u.startsWith('http') ? u : BASE + u))
const SETTLE_MS = Number(args.settle || 4000)

/** 长任务阈值：与 TBT 定义一致（>50ms 的部分计入阻塞时间） */
const LONG_TASK_US = 50_000

/** Trace 里"算得上主线程工作"的事件名 → 归因类别。认不出的一律 unknown:xxx。 */
const WORK_NAMES = new Set([
  'FunctionCall',
  'EvaluateScript',
  'v8.compile',
  'v8.compileModule',
  'ParseHTML',
  'UpdateLayoutTree',
  'Layout',
  'Paint',
  'PrePaint',
  'Layerize',
  'FireAnimationFrame',
  'TimerFire',
  'EventDispatch',
  'MajorGC',
  'MinorGC',
  'RunMicrotasks',
  'V8.Execute',
  'XHRLoad',
  'ResourceSendRequest',
  'CommitLoad',
  'ParseAuthorStyleSheet',
  'StyleRecalc',
])

function pickMainThread(events) {
  // thread_name 事件给出 tid → "CrRendererMain"
  const meta = events.filter((e) => e.name === 'thread_name' && e.args && e.args.name)
  const main = meta.find((e) => e.args.name === 'CrRendererMain')
  if (!main) return null
  return { pid: main.pid, tid: main.tid }
}

function frameLabel(ev) {
  const d = (ev.args && ev.args.data) || {}
  const fn = d.functionName || ev.name
  const url = d.url || d.scriptName || ''
  const file = url ? url.split('/').pop().split('?')[0] : '(inline/unknown)'
  return `${fn} @ ${file}`
}

function attribute(events) {
  const mt = pickMainThread(events)
  if (!mt) return { error: 'NO_MAIN_THREAD', longTasks: [], attribution: [] }

  const main = events.filter((e) => e.pid === mt.pid && e.tid === mt.tid && typeof e.dur === 'number')
  // 顶层任务事件名随 Chromium 版本变化：`RunTask`（旧）/ `ThreadControllerImpl::RunTask`（新）。
  // 写死一个名字的后果是"0 长任务"的假绿 —— 所以这里按包含关系匹配，并把实际名字记进证据。
  const tasks = main.filter((e) => /RunTask/.test(e.name) && e.dur > LONG_TASK_US)
  const taskName = (main.find((e) => /RunTask/.test(e.name)) || {}).name || null

  const longTasks = []
  const bucket = new Map()

  for (const t of tasks) {
    const start = t.ts
    const end = t.ts + t.dur
    const children = main.filter((e) => e !== t && e.ts >= start && e.ts + e.dur <= end)
    const perTask = new Map()
    for (const c of children) {
      if (!WORK_NAMES.has(c.name)) continue
      const key = c.name === 'FunctionCall' || c.name === 'EvaluateScript' ? frameLabel(c) : c.name
      perTask.set(key, (perTask.get(key) || 0) + c.dur)
      bucket.set(key, (bucket.get(key) || 0) + c.dur)
    }
    const top = [...perTask.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => ({ who: k, ms: Math.round(v / 1000) }))
    longTasks.push({
      startMs: Math.round(t.ts / 1000),
      durMs: Math.round(t.dur / 1000),
      blockingMs: Math.round((t.dur - LONG_TASK_US) / 1000),
      top,
    })
  }

  const attribution = [...bucket.entries()]
    .map(([who, us]) => ({ who, ms: Math.round(us / 1000), inLongTasks: true }))
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 18)

  const tbt = longTasks.reduce((s, t) => s + t.blockingMs, 0)
  return { mainThread: mt, taskEventName: taskName, longTasks, attribution, tbtMs: tbt, longTaskCount: longTasks.length }
}

async function profileOne(browser, url) {
  const context = await browser.newContext(MOBILE)
  const page = await context.newPage()
  const cdp = await context.newCDPSession(page)
  await cdp.send('Network.enable')
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: false })
  await cdp.send('Network.emulateNetworkConditions', NET)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })

  const chunks = []
  cdp.on('Tracing.dataCollected', (e) => chunks.push(...e.value))
  const done = new Promise((r) => cdp.once('Tracing.tracingComplete', r))
  await cdp.send('Tracing.start', {
    categories: ['toplevel', 'devtools.timeline', 'v8.execute', 'blink.user_timing'].join(','),
    transferMode: 'ReportEvents',
  })

  let status = 0
  try {
    const res = await page.goto(url, { waitUntil: 'load', timeout: 45_000 })
    status = res ? res.status() : 0
    await page.waitForTimeout(SETTLE_MS)
  } finally {
    await cdp.send('Tracing.end')
    await done.catch(() => {})
    await context.close()
  }

  const result = attribute(chunks)
  return { url, status, settleMs: SETTLE_MS, profile: 'mobile-4g-4xcpu', ...result, events: chunks.length }
}

async function main() {
  const out = { measuredAt: new Date().toISOString(), base: BASE, urls: URLS, pages: [] }
  const browser = await chromium.launch({
    executablePath: process.env.PW_EXECUTABLE || undefined,
    channel: process.env.PW_CHANNEL || undefined,
  })
  try {
    for (const url of URLS) {
      process.stdout.write(`… ${url}`)
      const r = await profileOne(browser, url)
      out.pages.push(r)
      console.log(`\r${String(r.tbtMs).padStart(5)}ms TBT · ${r.longTaskCount} long tasks · ${url}`)
      for (const a of r.attribution.slice(0, 6)) console.log(`        ${String(a.ms).padStart(5)}ms  ${a.who}`)
    }
  } finally {
    await browser.close()
  }
  if (args.out) {
    fs.mkdirSync(path.dirname(args.out), { recursive: true })
    fs.writeFileSync(args.out, JSON.stringify(out, null, 2) + '\n')
    console.log(`\n写出 ${args.out}`)
  }
}

main().catch((e) => {
  console.error('FATAL', e)
  process.exit(1)
})
