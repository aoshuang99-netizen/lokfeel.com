#!/usr/bin/env node
/**
 * V16 · T10 —— 响应式 / 性能 / 无障碍的**真实测量**（生产站，真实登录态）
 *
 * 与 T03 的 `v16-ux-audit.mjs` 分工：
 *   · T03 回答「这一屏长什么样、有没有坏」→ 截图 + 标题 + 错误；
 *   · 本脚本回答「在目标视口下会不会溢出、LCP/CLS 多少、触控目标够不够大、
 *     `prefers-reduced-motion` 是否真的生效」→ 数字，不是观感。
 *
 * 全部指标都是浏览器里跑出来的，脚本不改任何数据（只导航 + 读 DOM）。
 *
 * ⚠️ 本脚本**不测颜色对比度**：那需要 axe-core（本机未安装）。对比度由
 *    `scripts/qa/contrast-tokens.mjs` 直接对设计令牌做 WCAG 计算 —— 两个脚本
 *    合起来才是完整的无障碍证据，任何一方缺失都必须在报告里标 UNKNOWN。
 *
 * 用法：
 *   node scripts/qa/v16-release-audit.mjs
 *   node scripts/qa/v16-release-audit.mjs --only=mobile
 *   node scripts/qa/v16-release-audit.mjs --base=http://localhost:3099
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')
const REPORT = path.join(ROOT, 'docs/v16/_release-raw.json')

const argv = process.argv.slice(2)
const argOf = (k, d) => {
  const hit = argv.find((a) => a.startsWith(`--${k}=`))
  return hit ? hit.slice(k.length + 3) : d
}
const BASE = argOf('base', 'https://app.lokfeel.com').replace(/\/$/, '')
const ONLY = argOf('only', 'both')

const ACCOUNT = {
  email: process.env.QA_ADMIN_EMAIL || 'admin@lokfeel.com',
  password: process.env.QA_ADMIN_PASSWORD || 'LokFeel@Admin2026!',
}

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  laptop: { width: 1280, height: 800 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 390, height: 844 },
  small: { width: 360, height: 800 },
}

const SCREENS = [
  { id: 'ws-now', route: '/workspace', nav: 'Now' },
  { id: 'ws-studio', route: '/workspace', nav: 'Studio' },
  { id: 'ws-field', route: '/workspace', nav: 'Field' },
  { id: 'ws-consent', route: '/workspace', nav: 'Consent' },
  { id: 'ws-outcomes', route: '/workspace', nav: 'Outcomes' },
  { id: 'ws-agents', route: '/workspace', nav: 'Agents' },
  { id: 'console-home', route: '/console' },
  { id: 'console-missions', route: '/console/missions' },
  { id: 'console-connections', route: '/console/connections' },
  { id: 'console-agents', route: '/console/agents' },
  { id: 'console-members', route: '/console/members' },
  { id: 'console-outcomes', route: '/console/outcomes' },
  { id: 'console-settings', route: '/console/settings' },
]

/** 性能取样点：公开首页 + 两个主工作台（登录态）。 */
const PERF_TARGETS = [
  { id: 'landing', route: '/', auth: false },
  { id: 'workspace', route: '/workspace', auth: true },
  { id: 'console', route: '/console', auth: true },
]

/** 目标（任务书 §14）：LCP ≤ 2500ms、CLS ≤ 0.1、INP ≤ 200ms（INP 需真实交互，标 UNKNOWN）。 */
const BUDGET = { lcp: 2500, cls: 0.1 }

async function loadPlaywright() {
  try {
    return (await import('playwright')).chromium
  } catch {
    const root =
      process.env.PLAYWRIGHT_ROOT ||
      '/Users/frankzhao/.workbuddy/binaries/node/workspace/node_modules/'
    const require = createRequire(root + 'noop.js')
    return require('playwright').chromium
  }
}

const chromium = await loadPlaywright()

/** 在页面里量横向溢出、触控目标、减少动效是否生效。 */
async function measureLayout(page) {
  return page.evaluate(() => {
    const de = document.documentElement
    const overflow = Math.max(0, de.scrollWidth - de.clientWidth)

    const sel = 'a[href], button, [role="button"], input, select, textarea, summary'
    const small = []
    let interactive = 0
    for (const el of Array.from(document.querySelectorAll(sel))) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      const style = window.getComputedStyle(el)
      if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') continue
      interactive += 1
      if (r.width < 44 || r.height < 44) {
        const label = (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40)
        small.push({
          tag: el.tagName.toLowerCase(),
          label,
          w: Math.round(r.width),
          h: Math.round(r.height),
        })
      }
    }

    // reduced-motion：取主内容区一个真实节点的过渡时长（0ms = 降级生效）。
    const sample = document.querySelector('main') || document.body
    const dur = window.getComputedStyle(sample).transitionDuration

    return { overflow, interactive, small: small.slice(0, 12), smallTotal: small.length, sampleDuration: dur }
  })
}

/** LCP / CLS / TTFB。CLS 只累计到取样结束（不是整段会话）。 */
async function measurePerf(page) {
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        const out = { lcp: 0, lcpElement: '', cls: 0, ttfb: 0, dcl: 0 }
        try {
          new PerformanceObserver((list) => {
            for (const e of list.getEntries()) {
              if (e.startTime > out.lcp) {
                out.lcp = e.startTime
                out.lcpElement = (e.element && e.element.tagName ? e.element.tagName : '') + ''
              }
            }
          }).observe({ type: 'largest-contentful-paint', buffered: true })
        } catch {
          /* 浏览器不支持 → 保持 0，报告里标 UNKNOWN */
        }
        try {
          new PerformanceObserver((list) => {
            for (const e of list.getEntries()) if (!e.hadRecentInput) out.cls += e.value
          }).observe({ type: 'layout-shift', buffered: true })
        } catch {
          /* 同上 */
        }
        const nav = performance.getEntriesByType('navigation')[0]
        if (nav) {
          out.ttfb = Math.round(nav.responseStart)
          out.dcl = Math.round(nav.domContentLoadedEventEnd)
        }
        setTimeout(() => resolve(out), 600)
      }),
  )
}

function hydrationErrors(messages) {
  return messages.filter((m) => /hydrat|#418|#423|did not match/i.test(m))
}

async function run() {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: VIEWPORTS.desktop })
  const page = await context.newPage()

  const errors = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 200)}`)
  })

  const login = await page.request.post(`${BASE}/api/auth/login`, {
    data: ACCOUNT,
    headers: { Origin: BASE, Referer: `${BASE}/login` },
  })
  const loginBody = await login.json().catch(() => ({}))
  console.log(`登录 ${ACCOUNT.email} → HTTP ${login.status()} · success=${loginBody?.success}`)

  const result = {
    base: BASE,
    generatedAt: new Date().toISOString(),
    login: { status: login.status(), success: loginBody?.success === true },
    layout: [],
    perf: [],
    reducedMotion: [],
  }

  const devices = ONLY === 'both' ? ['mobile', 'desktop'] : [ONLY]
  for (const device of devices) {
    await page.setViewportSize(VIEWPORTS[device])
    console.log(`\n── ${device} ${VIEWPORTS[device].width}×${VIEWPORTS[device].height} ──`)
    for (const screen of SCREENS) {
      errors.length = 0
      const res = await page.goto(`${BASE}${screen.route}`, { waitUntil: 'domcontentloaded', timeout: 45000 })
      if (screen.nav) {
        const btn = page.getByRole('button', { name: screen.nav, exact: false }).first()
        if (await btn.count()) {
          await btn.click().catch(() => {})
          await page.waitForTimeout(350)
        }
      }
      await page.waitForTimeout(500)
      const m = await measureLayout(page)
      const rec = {
        id: screen.id,
        device,
        status: res ? res.status() : 0,
        finalUrl: page.url(),
        ...m,
        hydration: hydrationErrors(errors),
        errors: [...errors],
      }
      result.layout.push(rec)
      const flags = []
      if (rec.overflow > 0) flags.push(`横向溢出 ${rec.overflow}px`)
      if (rec.smallTotal > 0) flags.push(`小触控目标 ${rec.smallTotal}/${rec.interactive}`)
      if (rec.hydration.length) flags.push(`hydration×${rec.hydration.length}`)
      console.log(
        `  ${rec.id.padEnd(20)} ${String(rec.status).padEnd(4)} overflow=${String(rec.overflow).padStart(3)} tapOK=${
          rec.interactive - rec.smallTotal
        }/${rec.interactive}  ${flags.join(' · ') || 'ok'}`,
      )
    }
  }

  for (const vp of ['desktop', 'mobile']) {
    await page.setViewportSize(VIEWPORTS[vp])
    for (const target of PERF_TARGETS) {
      errors.length = 0
      await page.goto(`${BASE}${target.route}`, { waitUntil: 'load', timeout: 45000 }).catch(() => {})
      const perf = await measurePerf(page)
      const rec = { ...target, device: vp, ...perf, hydration: hydrationErrors(errors) }
      result.perf.push(rec)
      const ok = perf.lcp > 0 && perf.lcp <= BUDGET.lcp && perf.cls <= BUDGET.cls
      console.log(
        `  perf ${target.id.padEnd(10)} ${vp.padEnd(8)} LCP=${Math.round(perf.lcp)}ms CLS=${perf.cls.toFixed(
          3,
        )} TTFB=${perf.ttfb}ms ${ok ? 'ok' : 'ABOVE-BUDGET'}`,
      )
    }
  }

  // reduced-motion：模拟系统偏好后，主内容区的过渡时长必须为 0ms。
  await page.emulateMedia({ reducedMotion: 'reduce' })
  for (const route of ['/', '/workspace']) {
    await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {})
    await page.waitForTimeout(300)
    const m = await measureLayout(page)
    result.reducedMotion.push({ route, transition: m.sampleDuration })
    console.log(`  reduced-motion ${route.padEnd(12)} main transition-duration=${m.sampleDuration}`)
  }

  await browser.close()
  await fs.mkdir(path.dirname(REPORT), { recursive: true })
  await fs.writeFile(REPORT, JSON.stringify(result, null, 2))

  const overflow = result.layout.filter((r) => r.overflow > 0)
  const hydration = result.layout.filter((r) => r.hydration.length > 0)
  const perfBad = result.perf.filter((p) => p.lcp === 0 || p.lcp > BUDGET.lcp || p.cls > BUDGET.cls)
  console.log(`\n汇总：横向溢出 ${overflow.length} / hydration ${hydration.length} / 性能超预算 ${perfBad.length}`)
  console.log(`原始数据：${path.relative(ROOT, REPORT)}`)
}

await run()
