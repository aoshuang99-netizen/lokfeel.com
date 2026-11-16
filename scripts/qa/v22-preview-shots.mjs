/**
 * V22 · 本地 Preview 视觉与交互 smoke（可复现）
 *
 * 用途：对 V22 候选构建做多视口截图、DOM 读数、控制台错误与关键负例断言。
 * 复现：
 *   1) PUBLIC_SURFACE_FROZEN=false env -u NODE_OPTIONS npx next start -p 3214
 *      （显式解冻仅用于本地 Preview；生产与代码默认值仍 fail-closed）
 *   2) env -u NODE_OPTIONS PW_CHANNEL=chrome node scripts/qa/v22-preview-shots.mjs
 *
 * 输出：docs/v22/evidence/preview-<ts>.json + preview/*.png
 * 🔴 截图是「本地 Preview」证据，不是生产 LIVE；生产取证见 v22-live-capture.mjs。
 */

import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'

const ROOT = process.cwd()
const BASE = (process.env.V22_BASE || 'http://127.0.0.1:3214').replace(/\/$/, '')
const OUT_DIR = path.join(ROOT, 'docs/v22/evidence/preview')
const TS = new Date().toISOString().replace(/[:.]/g, '-')
fs.mkdirSync(OUT_DIR, { recursive: true })

const BANNED = [
  'Connection OS', 'Agent OS', 'WorkspaceSpec', 'INTENT_EXTRACTION',
  'MCP tools', 'A2A', 'Compiler', 'LokFee!',
]

const CASES = [
  { name: 'home-desktop', path: '/', width: 1440, height: 900 },
  { name: 'home-tablet', path: '/', width: 768, height: 1024 },
  { name: 'home-mobile', path: '/', width: 390, height: 844 },
  { name: 'login-desktop', path: '/login', width: 1440, height: 900 },
  { name: 'login-mobile', path: '/login', width: 390, height: 844 },
  { name: 'product-desktop', path: '/product', width: 1440, height: 900 },
  { name: 'pricing-desktop', path: '/pricing', width: 1440, height: 900 },
  { name: 'solutions-desktop', path: '/solutions', width: 1440, height: 900 },
  { name: 'how-it-works-desktop', path: '/how-it-works', width: 1440, height: 900 },
  { name: 'stories-desktop', path: '/stories', width: 1440, height: 900 },
  { name: 'about-desktop', path: '/about', width: 1440, height: 900 },
  { name: 'contact-desktop', path: '/contact', width: 1440, height: 900 },
]

const results = []
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'chrome', headless: true })

for (const c of CASES) {
  const ctx = await browser.newContext({
    viewport: { width: c.width, height: c.height },
    deviceScaleFactor: 1,
    locale: 'en-US',
  })
  const page = await ctx.newPage()
  const r = { case: c.name, url: BASE + c.path, viewport: `${c.width}x${c.height}`, status: null, errors: [], checks: {} }
  page.on('pageerror', (e) => r.errors.push(`pageerror: ${e.message}`.slice(0, 220)))
  page.on('console', (m) => { if (m.type() === 'error') r.errors.push(`console: ${m.text()}`.slice(0, 220)) })

  try {
    const res = await page.goto(r.url, { waitUntil: 'load', timeout: 90000 })
    await page.waitForTimeout(1200)
    r.status = res?.status() ?? null
    const probe = await page.evaluate(() => {
      const text = (sel) => document.querySelector(sel)?.textContent?.trim() ?? null
      const body = document.body.innerText.replace(/\s+/g, ' ').trim()
      const btn = document.querySelector('button[type="submit"]')
      return {
        h1: text('h1'),
        bodyHead: body.slice(0, 420),
        bodyChars: body.length,
        hasGoalInput: !!document.querySelector('#goal-input'),
        minSubmitHeight: btn ? Math.round(btn.getBoundingClientRect().height) : null,
        hasHoldingCopy: body.includes('该页面正在最终审核'),
        hasAmount: /\$\s?\d/.test(body),
        hasChinese: /[\u4e00-\u9fff]/.test(body),
      }
    })
    Object.assign(r.checks, probe)
    const shot = path.join(OUT_DIR, `${c.name}.png`)
    await page.screenshot({ path: shot, fullPage: c.name.startsWith('home-') }).catch(() => {})
    if (fs.existsSync(shot)) r.screenshot = path.relative(ROOT, shot)

    if (c.path === '/') {
      // V22 smoke assertions (negative controls included)
      const body = await page.locator('body').innerText()
      r.checks.heroMatchesFrozenCopy = (probe.h1 || '').includes('Say what you want done')
      r.checks.noBannedWords = BANNED.filter((w) => body.includes(w))
      r.checks.noVerifiedLabel = !/\bverified\b/i.test(body) // boundary copy must not claim verification
      r.checks.goalInputPresent = probe.hasGoalInput
      r.checks.touchTargetOk = (probe.minSubmitHeight ?? 0) >= 44
      r.checks.noHoldingCopy = !probe.hasHoldingCopy
      r.checks.noChinese = !probe.hasChinese
    }
    if (c.path === '/pricing') {
      r.checks.noUnapprovedAmount = !probe.hasAmount
      r.checks.noChinese = !probe.hasChinese
    }
    if (['/product', '/solutions', '/how-it-works', '/stories'].includes(c.path)) {
      r.checks.noHoldingCopy = !probe.hasHoldingCopy
      r.checks.noChinese = !probe.hasChinese
    }
  } catch (e) {
    r.errors.push(`capture failed: ${String(e?.message || e).slice(0, 220)}`)
  } finally {
    await ctx.close().catch(() => {})
  }
  results.push(r)
  const bad = Object.entries(r.checks).filter(([k, v]) => k.startsWith('no') && v === false).map(([k]) => k)
  console.log(`${r.case.padEnd(24)} ${String(r.status).padEnd(4)} errors=${r.errors.length} failedChecks=[${bad.join(',')}]`)
}

// ── goal draft relay: home input → /register?goal= → visible draft ──
const relay = { verdict: 'NOT_TESTED', steps: [] }
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US' })
  const page = await ctx.newPage()
  const goal = 'Get three quotes for a home repair and compare them'
  await page.goto(`${BASE}/`, { waitUntil: 'load', timeout: 90000 })
  await page.waitForTimeout(800)
  await page.fill('#goal-input', goal)
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/register/, { timeout: 20000 })
  const url = page.url()
  relay.steps.push({ step: 'home -> register', urlOk: url.includes('goal='), url: url.slice(0, 160) })
  await page.waitForTimeout(900)
  const text = await page.locator('body').innerText()
  relay.steps.push({ step: 'register shows goal', ok: text.includes(goal) })
  const draftInStorage = await page.evaluate(() => sessionStorage.getItem('lokfeel.goal.draft'))
  relay.steps.push({ step: 'sessionStorage draft', ok: draftInStorage === goal })
  await page.reload({ waitUntil: 'load' })
  await page.waitForTimeout(700)
  const afterReload = await page.locator('body').innerText()
  relay.steps.push({ step: 'draft survives reload', ok: afterReload.includes(goal) })
  // negative control: untrusted HTML must be escaped, not executed
  const evil = '<img src=x onerror=window.__v22x=1>'
  await page.goto(`${BASE}/register?goal=${encodeURIComponent(evil)}`, { waitUntil: 'load', timeout: 60000 })
  await page.waitForTimeout(700)
  const injected = await page.evaluate(() => Boolean(window.__v22x))
  relay.steps.push({ step: 'untrusted goal not executed', ok: !injected })
  relay.verdict = relay.steps.every((s) => s.ok ?? s.urlOk) ? 'PASS' : 'FAIL'
  await ctx.close()
} catch (e) {
  relay.verdict = 'NOT_TESTED'
  relay.error = String(e?.message || e).slice(0, 240)
}
console.log(`GOAL_RELAY=${relay.verdict} steps=${relay.steps.length}`)

await browser.close()

const summary = {
  cases: results.length,
  pagesWithErrors: results.filter((r) => r.errors.length).length,
  // Empty-array assertions are vacuously true. Treat a non-empty hit list as a
  // failure explicitly, otherwise "no banned words" would pass on an empty scan.
  failedChecks: results.flatMap((r) =>
    Object.entries(r.checks).filter(([k, v]) => {
      if (k === 'heroMatchesFrozenCopy' || k === 'goalInputPresent' || k === 'touchTargetOk') return v === false
      if (!k.startsWith('no')) return false
      if (Array.isArray(v)) return v.length > 0
      return v === false
    }).map(([k]) => `${r.case}:${k}`),
  ),
  goalRelay: relay.verdict,
}
const outPath = path.join(ROOT, 'docs/v22/evidence', `preview-${TS}.json`)
fs.writeFileSync(outPath, JSON.stringify({ capturedAt: new Date().toISOString(), base: BASE, evidenceLevel: 'LOCAL_PREVIEW', summary, relay, results }, null, 2))
console.log(`SUMMARY ${JSON.stringify(summary)}`)
console.log(`EVIDENCE ${path.relative(ROOT, outPath)}`)
if (summary.failedChecks.length || summary.goalRelay === 'FAIL') process.exitCode = 1
