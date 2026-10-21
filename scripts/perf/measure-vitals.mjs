#!/usr/bin/env node
/**
 * V17 · WB17-08 —— 真实浏览器里的首屏指标（移动端 + 4G 节流）
 *
 * ── 它回答什么 ────────────────────────────────────────────────────────
 *   「手机上第一次打开到底要等多久」——LCP / FCP / CLS / TTFB / 传输量。
 *   不是估算，是 Chromium 在 iPhone 视口 + 4G 节流 + 4× CPU 降速下跑出来的数。
 *
 * ── 为什么不能只看 `/api/health` 的 TTFB ──────────────────────────────
 *   探针量的是**服务器**反应，用户等的是**首屏画出来**。两者差了：
 *   JS 下载/解析/执行、字体、首图解码。`05` 记的"冷启动 13.2s"是 TTFB，
 *   而首访者实际盯屏的时间只会更长 —— 本脚本量的正是后者。
 *
 * ── 为什么不做成 CI 硬门禁 ────────────────────────────────────────────
 *   与 `slo-check.mjs` 同一个取舍：生产指标受跨境链路、Netlify 冷启、
 *   共享 runner 抖动影响，塞进 push 门禁会退化成恒红（然后被人 `|| true`）。
 *   所以它是**发版前/手动**的对账工具。WARN 不判退，只有 FAIL 才 exit 1。
 *
 * ── 它自己的失效条件（先说清楚）────────────────────────────────────────
 *   ① 只测**公开页**。需要登录的十三屏用不了它（无 QA 账号），
 *      所以 UX-12 的 LCP 仍是 BLOCKED，别拿首页的数去代表工作区。
 *   ② 节流参数是 Lighthouse 移动端的常规档位，不是"某一次真实 4G"。
 *      它的意义是**可比**，不是"精确复现某用户"。
 *   ③ 冷启动只影响第一次。默认 3 轮取中位数 = **暖机值**；
 *      首轮的冷启动值单独列出，不与中位数混算。
 *
 * 用法：
 *   node scripts/perf/measure-vitals.mjs                       # 生产 3 页 × 3 轮
 *   node scripts/perf/measure-vitals.mjs --runs=5
 *   node scripts/perf/measure-vitals.mjs --urls=https://app.lokfeel.com/pay.html
 *   node scripts/perf/measure-vitals.mjs --tap                  # 附带触控目标检查
 *   node scripts/perf/measure-vitals.mjs --json=out.json        # 落盘
 *   node scripts/perf/measure-vitals.mjs --self-test            # 变异自证
 */
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

// `playwright` 只有 CJS 入口，ESM `import` 解析不到（ERR_MODULE_NOT_FOUND）。
// 与 `scripts/qa/v16-release-audit.mjs` 用同一种取法，避免"换个 Node 版本就崩"。
const require = createRequire(import.meta.url)
const { chromium } = require('playwright')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')

// ══════════════════════════════════════════════════════════════════════
// 阈值（先行确定，**不按实测反推** —— 反推会让 SLO 永远达标）
// 来源：Core Web Vitals 官方分档（good / needs improvement / poor）
// ══════════════════════════════════════════════════════════════════════

const BUDGET = {
  lcp: { good: 2500, poor: 4000 },
  cls: { good: 0.1, poor: 0.25 },
  ttfb: { good: 800, poor: 1800 },
  // 首屏 JS 超过 300KB 时，中端机执行成本已明显可见
  jsKB: { good: 300, poor: 600 },
}

/** 移动端档位：iPhone 视口 + 4G + 4× CPU 降速（与 Lighthouse 移动档同源思路） */
const MOBILE = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 ' +
    '(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
}
const THROTTLE = { latency: 150, downloadBps: (1.6 * 1024 * 1024) / 8, uploadBps: (750 * 1024) / 8, cpuRate: 4 }

const DEFAULT_URLS = [
  'https://app.lokfeel.com/',
  'https://app.lokfeel.com/pay.html',
  'https://app.lokfeel.com/login',
]

// ══════════════════════════════════════════════════════════════════════
// 采集
// ══════════════════════════════════════════════════════════════════════

/**
 * 注入到页面里的采集器（必须在任何脚本之前执行，否则 buffered 观察会漏）。
 * 只读 Performance API，不改页面、不注入任何业务逻辑。
 */
function collector() {
  const v = { lcp: null, lcpEl: null, lcpUrl: null, cls: 0, clsShifts: 0, fcp: null }
  // @ts-ignore —— 页面上下文，无类型
  window.__lfVitals = v
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        v.lcp = e.startTime
        v.lcpEl = e.element ? e.element.tagName : null
        v.lcpUrl = e.url || null
      }
    }).observe({ type: 'largest-contentful-paint', buffered: true })
  } catch {
    /* 老内核不支持，lcp 保持 null —— 由调用方判红，不静默补 0 */
  }
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (!e.hadRecentInput) {
          v.cls += e.value
          v.clsShifts += 1
        }
      }
    }).observe({ type: 'layout-shift', buffered: true })
  } catch {
    /* 同上 */
  }
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if (e.name === 'first-contentful-paint') v.fcp = e.startTime
    }).observe({ type: 'paint', buffered: true })
  } catch {
    /* 同上 */
  }
}

async function measureOnce(browser, url, opts = {}) {
  const throttle = opts.throttle !== false
  const context = await browser.newContext(MOBILE)
  const page = await context.newPage()
  await page.addInitScript(collector)

  if (throttle) {
    const cdp = await context.newCDPSession(page)
    await cdp.send('Network.enable')
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: THROTTLE.latency,
      downloadThroughput: THROTTLE.downloadBps,
      uploadThroughput: THROTTLE.uploadBps,
    })
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE.cpuRate })
  }

  const started = Date.now()
  let status = 0
  try {
    const resp = await page.goto(url, { waitUntil: 'load', timeout: 60_000 })
    status = resp ? resp.status() : 0
  } catch (err) {
    await context.close()
    return { url, error: err instanceof Error ? err.message : String(err), wallMs: Date.now() - started }
  }

  // LCP 在"最后一次布局/绘制之后"才定稿：等网络安静 + 1.2s 静默，比固定 sleep 更稳
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {})
  await page.waitForTimeout(1200)

  const data = await page.evaluate(() => {
    const v = window.__lfVitals || {}
    const nav = performance.getEntriesByType('navigation')[0] || {}
    const res = performance.getEntriesByType('resource')
    let transfer = nav.transferSize || 0
    let js = 0
    let img = 0
    let font = 0
    for (const r of res) {
      const size = r.transferSize || 0
      transfer += size
      if (r.initiatorType === 'script') js += size
      else if (r.initiatorType === 'img') img += size
      else if (/\.(woff2?|ttf|otf)$/.test(r.name)) font += size
    }
    return {
      ttfb: nav.responseStart ?? null,
      domContentLoaded: nav.domContentLoadedEventEnd ?? null,
      loadEvent: nav.loadEventEnd ?? null,
      lcp: v.lcp ?? null,
      lcpEl: v.lcpEl ?? null,
      lcpUrl: v.lcpUrl ?? null,
      fcp: v.fcp ?? null,
      cls: typeof v.cls === 'number' ? v.cls : null,
      clsShifts: v.clsShifts ?? null,
      transferBytes: transfer,
      jsBytes: js,
      imgBytes: img,
      fontBytes: font,
      resources: res.length,
      docHeight: document.documentElement.scrollHeight,
      viewportWidth: window.innerWidth,
      overflowX: document.documentElement.scrollWidth - window.innerWidth,
      title: document.title,
    }
  })

  const tap = opts.tap ? await checkTapTargets(page) : null
  await context.close()
  return { url, status, wallMs: Date.now() - started, ...data, tap }
}

/**
 * 触控目标检查（移动端支付最实际的一条）。
 * WCAG 2.5.5 要求 44×44 CSS px；此处按 44 判，并列最小的 5 个。
 */
async function checkTapTargets(page) {
  return page.evaluate(() => {
    const sel = 'a,button,input,select,textarea,[role="button"],[onclick]'
    const bad = []
    let total = 0
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect()
      const style = getComputedStyle(el)
      if (r.width === 0 || r.height === 0) continue
      if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') continue
      total += 1
      if (r.width < 44 || r.height < 44) {
        bad.push({
          tag: el.tagName.toLowerCase(),
          text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 40),
          w: Math.round(r.width),
          h: Math.round(r.height),
        })
      }
    }
    bad.sort((a, b) => a.h - b.h || a.w - b.w)
    return { total, violations: bad.length, worst: bad.slice(0, 5) }
  })
}

// ══════════════════════════════════════════════════════════════════════
// 判定
// ══════════════════════════════════════════════════════════════════════

const median = (xs) => {
  const a = xs.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((x, y) => x - y)
  if (!a.length) return null
  const mid = Math.floor(a.length / 2)
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2
}

function grade(metric, value) {
  const b = BUDGET[metric]
  if (value === null || value === undefined) return 'NO_DATA'
  if (value <= b.good) return 'PASS'
  if (value <= b.poor) return 'WARN'
  return 'FAIL'
}

/** 汇总一次测量的多轮结果；冷启动（第一轮）单独留档，不混进中位数。 */
function summarize(samples) {
  const ok = samples.filter((s) => !s.error)
  if (!ok.length) {
    return { verdict: 'FAIL', reason: '全部轮次失败', samples }
  }
  const lcp = median(ok.map((s) => s.lcp))
  const cls = median(ok.map((s) => s.cls))
  const ttfb = median(ok.map((s) => s.ttfb))
  const jsKB = median(ok.map((s) => s.jsBytes)) / 1024
  const grades = { lcp: grade('lcp', lcp), cls: grade('cls', cls), ttfb: grade('ttfb', ttfb), jsKB: grade('jsKB', jsKB) }
  const values = Object.values(grades)
  const verdict = values.includes('FAIL') ? 'FAIL' : values.includes('NO_DATA') ? 'NO_DATA' : values.includes('WARN') ? 'WARN' : 'PASS'
  return {
    verdict,
    grades,
    lcp,
    cls,
    ttfb,
    jsKB,
    transferKB: median(ok.map((s) => s.transferBytes)) / 1024,
    coldStart: ok[0],
    samples: ok,
  }
}

// ══════════════════════════════════════════════════════════════════════
// 自证：一个"快"的页面必须 PASS，一个"慢"的页面必须 FAIL
// ══════════════════════════════════════════════════════════════════════
//
// 只证"能测出数"是不够的 —— 那得到一个恒绿的测量器。必须同时证明：
//   ① 慢页面被判红（检测器有牙齿）
//   ② 快页面不判红（不是恒红）
//   ③ 采不到数时判 NO_DATA/FAIL，而不是拿 0 顶替（0 会被当成"极快"）

async function selfTest() {
  const results = []
  const ok = (name, cond, detail = '') => {
    results.push({ name, pass: !!cond, detail })
  }

  const FAST = `<!doctype html><meta viewport="width=device-width"><title>fast</title>
    <h1 style="font:48px sans-serif">fast page</h1>`
  const SLOW_DELAY_MS = 3600 // > LCP poor 阈值 4000 的一半，叠加节流后必然破 4000
  const SLOW = `<!doctype html><meta viewport="width=device-width"><title>slow</title>
    <h1 style="font:48px sans-serif">slow page</h1>`

  const server = http.createServer((req, res) => {
    if (req.url === '/slow.html') {
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
        res.end(SLOW)
      }, SLOW_DELAY_MS)
      return
    }
    if (req.url === '/nolcp.html') {
      // 空白页：没有任何内容 ⇒ LCP 采不到 ⇒ 必须 NO_DATA，不许变成 0
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end('<!doctype html><title>blank</title>')
      return
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    res.end(FAST)
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}`

  const browser = await chromium.launch()
  try {
    const fast = summarize([await measureOnce(browser, `${base}/fast.html`, { throttle: false })])
    ok('快页面 → PASS（不是恒红）', fast.verdict === 'PASS', `verdict=${fast.verdict} lcp=${fast.lcp}`)
    ok('快页面采到了 LCP（采集器真的在跑）', typeof fast.lcp === 'number' && fast.lcp > 0, `lcp=${fast.lcp}`)

    const slow = summarize([await measureOnce(browser, `${base}/slow.html`, { throttle: false })])
    ok('慢页面 → FAIL（检测器有牙齿）', slow.verdict === 'FAIL', `verdict=${slow.verdict} lcp=${Math.round(slow.lcp || 0)}`)

    const blank = summarize([await measureOnce(browser, `${base}/nolcp.html`, { throttle: false })])
    ok(
      '空白页 → 不拿 0 冒充（NO_DATA 或 FAIL）',
      blank.verdict === 'NO_DATA' || blank.verdict === 'FAIL',
      `verdict=${blank.verdict} lcp=${blank.lcp}`,
    )

    const dead = summarize([await measureOnce(browser, 'http://127.0.0.1:1/')])
    ok('连不上的地址 → FAIL 而非静默跳过', dead.verdict === 'FAIL', `verdict=${dead.verdict}`)

    // 触控目标检查的负向/正向对照：44px 是判据，不是"看着小"
    const tapPage = await browser.newPage()
    await tapPage.setContent(
      '<button id="big" style="width:48px;height:48px">big</button>' +
        '<button id="small" style="width:20px;height:20px">tiny</button>',
    )
    const tap = await checkTapTargets(tapPage)
    await tapPage.close()
    ok('触控检查：20px 按钮被判违规', tap.violations === 1, `violations=${tap.violations}`)
    ok('触控检查：48px 按钮不被误报', tap.total === 2, `total=${tap.total}`)
  } finally {
    await browser.close()
    await new Promise((r) => server.close(r))
  }

  const failed = results.filter((r) => !r.pass)
  for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? ' — ' + r.detail : ''}`)
  console.log(`\n自证：${results.length - failed.length}/${results.length} 通过`)
  return failed.length === 0 ? 0 : 1
}

// ══════════════════════════════════════════════════════════════════════
// main
// ══════════════════════════════════════════════════════════════════════

function parseArgs(argv) {
  const out = {}
  for (const a of argv) {
    if (!a.startsWith('--')) continue
    const [k, v] = a.slice(2).split('=')
    out[k] = v === undefined ? 'true' : v
  }
  return out
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args['self-test'] === 'true') return selfTest()

  const urls = args.urls ? args.urls.split(',').map((s) => s.trim()).filter(Boolean) : DEFAULT_URLS
  const runs = Math.max(1, Number(args.runs || 3))
  const tap = args.tap === 'true'
  const browser = await chromium.launch()

  const report = { measuredAt: new Date().toISOString(), profile: 'mobile-4g-4xcpu', runs, budget: BUDGET, pages: [] }
  let anyFail = false

  try {
    for (const url of urls) {
      const samples = []
      for (let i = 0; i < runs; i += 1) {
        samples.push(await measureOnce(browser, url, { tap }))
      }
      const s = summarize(samples)
      if (s.verdict === 'FAIL') anyFail = true
      report.pages.push({ url, ...s })
      const b = (v, unit = 'ms') => (v === null || v === undefined ? '—' : `${Math.round(v)}${unit}`)
      console.log(`\n${url}`)
      console.log(
        `  判定 ${s.verdict}  ·  LCP ${b(s.lcp)}  ·  FCP ${b(median(samples.map((x) => x.fcp)))}  ·  ` +
          `CLS ${s.cls === null ? '—' : s.cls.toFixed(3)}  ·  TTFB ${b(s.ttfb)}  ·  JS ${Math.round(s.jsKB)}KB  ·  ` +
          `传输 ${Math.round(s.transferKB)}KB`,
      )
      console.log(
        `  分项 LCP ${s.grades.lcp} / CLS ${s.grades.cls} / TTFB ${s.grades.ttfb} / JS ${s.grades.jsKB}` +
          (s.coldStart ? `  ·  首轮(冷) LCP ${b(s.coldStart.lcp)}` : ''),
      )
      const overflow = Math.max(...samples.map((x) => x.overflowX || 0))
      if (overflow > 0) console.log(`  ⚠️ 横向溢出 ${overflow}px —— 移动端会出现横向滚动条`)
      if (tap && samples[0].tap) {
        const t = samples[0].tap
        console.log(`  触控目标：${t.total} 个可交互元素，${t.violations} 个 < 44px`)
        for (const w of t.worst) console.log(`    · ${w.tag} "${w.text}" ${w.w}×${w.h}`)
      }
    }
  } finally {
    await browser.close()
  }

  if (args.json) {
    const abs = path.isAbsolute(args.json) ? args.json : path.join(ROOT, args.json)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, JSON.stringify(report, null, 2) + '\n', 'utf8')
    console.log(`\n报告已写入 ${path.relative(ROOT, abs)}`)
  }

  const fails = report.pages.filter((p) => p.verdict === 'FAIL').length
  const warns = report.pages.filter((p) => p.verdict === 'WARN').length
  const passes = report.pages.filter((p) => p.verdict === 'PASS').length
  console.log(`\n合计：${passes} PASS / ${warns} WARN / ${fails} FAIL（${report.pages.length} 页 × ${runs} 轮）`)
  if (warns) console.log('WARN 不判退：它是"该优化"，不是"不能上线"。只有 FAIL 才 exit 1。')
  return anyFail ? 1 : 0
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err)
    process.exit(1)
  },
)
