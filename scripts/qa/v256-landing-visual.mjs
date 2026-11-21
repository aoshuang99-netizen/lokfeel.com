#!/usr/bin/env node
/**
 * V25.6 UX03/UX15 — 首页七档视口 + axe 可访问性本地验证（匿名 / 本地服务）
 * ═══════════════════════════════════════════════════════════════════════════
 * 证据类型：REAL_BROWSER（本地 HTTP，非生产、非登录态）
 * 诚实边界：
 *   · 只验证"布局无横向溢出 + 关键元素可见 + axe 严重/关键 0"，
 *     不等于"5 秒盲测通过"（那需要真人，标 NOT_TESTED）。
 *   · 截图是布局证据，不冒充 Figma 可编辑设计源。
 *
 * 用法：
 *   node scripts/qa/v256-landing-visual.mjs --base=http://127.0.0.1:3100 \
 *     --out=docs/v25.6/evidence/UX03_LANDING_VISUAL
 */
import { chromium } from 'playwright'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'

const ROOT = process.cwd()
const arg = (name, fallback) => {
  const v = process.argv.slice(2).find((x) => x.startsWith(`--${name}=`))
  return v ? v.slice(name.length + 3) : fallback
}
const BASE = arg('base', 'http://127.0.0.1:3100')
const OUT = path.resolve(ROOT, arg('out', 'docs/v25.6/evidence/UX03_LANDING_VISUAL'))

const VIEWPORTS = [
  { w: 320, h: 720, name: '320' },
  { w: 375, h: 812, name: '375' },
  { w: 390, h: 844, name: '390' },
  { w: 768, h: 1024, name: '768' },
  { w: 1024, h: 768, name: '1024' },
  { w: 1440, h: 900, name: '1440' },
  { w: 1920, h: 1080, name: '1920' },
]

// V25.6-GA：真实模型未验收，首屏用保守版 B 文案（copy deck §1）。
const EXPECTED_H1 = /Conversations belong to people/i
const results = []
const failures = []

await fs.mkdir(OUT, { recursive: true })
let browser
try {
  // 用系统 Chrome（沙箱内 Playwright 自带 headless shell 可能缺失，与记忆配方 PW_CHANNEL=chrome 一致）
  browser = await chromium.launch({ channel: 'chrome' })
  const axePath = path.join(ROOT, 'node_modules', 'axe-core', 'axe.min.js')
  const axeSource = await fs.readFile(axePath, 'utf8')
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } })
    const page = await ctx.newPage()
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {})
    const h1 = await page.locator('h1').first().innerText().catch(() => '')
    const metrics = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
      h1Size: (() => {
        const el = document.querySelector('h1')
        return el ? parseFloat(getComputedStyle(el).fontSize) : 0
      })(),
    }))
    const overflow = metrics.scrollW - metrics.clientW
    const h1Ok = EXPECTED_H1.test(h1)
    if (overflow > 2) failures.push(`${vp.name}px: horizontal overflow ${overflow}px`)
    if (!h1Ok) failures.push(`${vp.name}px: H1 value promise missing ("${h1.slice(0, 60)}")`)

    const shot = path.join(OUT, `landing-${vp.name}.png`)
    await page.screenshot({ path: shot, fullPage: false })

    // axe：仅首屏，检查严重/关键
    let axeViolations = []
    try {
      await page.addScriptTag({ content: axeSource })
      const r = await page.evaluate(async () => await window.axe.run(document, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] },
      }))
      axeViolations = r.violations
        .filter((v) => v.impact === 'critical' || v.impact === 'serious')
        .map((v) => ({
          id: v.id,
          impact: v.impact,
          nodes: v.nodes.length,
          targets: v.nodes.slice(0, 5).map((n) => n.target.join(' ')),
        }))
    } catch (e) {
      failures.push(`${vp.name}px: axe failed: ${String(e).slice(0, 80)}`)
    }
    if (axeViolations.length) failures.push(`${vp.name}px: axe ${axeViolations.map((v) => v.id).join(',')}`)

    results.push({
      viewport: vp.name,
      width: vp.w,
      height: vp.h,
      h1: h1.replace(/\s+/g, ' ').slice(0, 100),
      valuePromiseOk: h1Ok,
      overflowPx: overflow,
      h1FontSize: metrics.h1Size,
      axeCriticalSerious: axeViolations,
      screenshot: path.relative(ROOT, shot),
    })
    await ctx.close()
  }
} catch (e) {
  failures.push(`FATAL: ${String(e).slice(0, 200)}`)
} finally {
  if (browser) await browser.close()
}

const report = {
  task: 'UX03/UX15 首页七档视口 + axe',
  version: 'V25.6',
  generatedAt: new Date().toISOString(),
  base: BASE,
  evidenceType: 'REAL_BROWSER (local HTTP, anonymous, non-production)',
  honestBoundary: '布局/axe 证据 ≠ 5 秒真人盲测；截图 ≠ Figma 可编辑源',
  viewports: results,
  failures,
  verdict: failures.length === 0 ? 'PASS' : 'FAIL',
}
const outFile = path.join(OUT, 'report.json')
await fs.writeFile(outFile, JSON.stringify(report, null, 2))
console.log(JSON.stringify({
  verdict: report.verdict,
  viewports: results.length,
  failures,
  report: path.relative(ROOT, outFile),
  inputHash: 'sha256:' + createHash('sha256').update(JSON.stringify(results.map((r) => r.viewport + r.overflowPx))).digest('hex').slice(0, 16),
}, null, 2))
process.exit(failures.length === 0 ? 0 : 1)
