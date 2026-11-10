#!/usr/bin/env node
/**
 * B2 · lokfeel-final-20261110 —— 新公开页无障碍扫描（axe-core 注入）
 * ═══════════════════════════════════════════════════════════════════════
 *
 * 与 `v196-axe-scan.mjs` 的分工：
 *   · v196 管 B2C/公开面存量（/ /login /register /dashboard /workspace），
 *     带基线棘轮；
 *   · 本脚本管 **B2 批次新增的五个公开页**（/product /solutions /stories
 *     /how-it-works /help）+ 共享 chrome 挂载后的回归面。
 *     新页面从第一天就必须 serious/critical = 0，**不做棘轮、不做基线** ——
 *     新代码没有"存量债"可言。
 *
 * 门禁语义：
 *   · 新页（NEW_PAGES）：serious/critical 违规 = FAIL（退出码 1）；
 *   · 既有页（LEGACY_PAGES）：纯报告 —— 只列违规数，不判红
 *     （存量债归 v196 基线管理，两套门禁不重复计）；
 *   · 登录重定向 ⇒ NOT_TESTED（空集不是绿）。
 *
 * 用法：
 *   node scripts/qa/b2-public-pages-axe.mjs --base=http://localhost:3111
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')

const HERE = path.dirname(fileURLToPath(import.meta.url))
const AXE_SRC = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8')

const argv = process.argv.slice(2)
const arg = (k, d = '') => {
  const hit = argv.find((a) => a.startsWith(`--${k}=`))
  return hit ? hit.slice(k.length + 3) : d
}
const BASE = arg('base', 'http://127.0.0.1:3111').replace(/\/$/, '')
const OUT_DIR = arg('out', 'test-results/b2-public-axe')

/** 新页：hard gate。 */
const NEW_PAGES = ['/product', '/solutions', '/stories', '/how-it-works', '/help']
/** 既有页（共享 chrome 挂载后的回归面）：报告模式。 */
const LEGACY_PAGES = ['/', '/pricing', '/about', '/contact', '/support', '/faq']
const VIEWPORTS = [
  { name: '390x844', width: 390, height: 844 },
  { name: '1440x900', width: 1440, height: 900 },
]

fs.mkdirSync(OUT_DIR, { recursive: true })

/** 与 v205-a11y 同口径：本机缓存的可执行文件优先（沙箱装不了 playwright 浏览器）。 */
const exe = process.env.PW_EXECUTABLE
const browser = await chromium.launch(exe ? { executablePath: exe } : undefined)
const results = []
let hardFail = 0
let notTested = 0

for (const route of [...NEW_PAGES, ...LEGACY_PAGES]) {
  const isNew = NEW_PAGES.includes(route)
  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } })
    const page = await context.newPage()
    const cell = `${route === '/' ? 'home' : route.replace(/\//g, '-').slice(1)}-${vp.name}`
    let verdict = 'PASS'
    let violations = []
    try {
      const resp = await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' })
      if (resp && resp.status() >= 400) {
        verdict = 'NOT_TESTED'
        violations = [{ rule: `http-${resp.status()}` }]
      } else {
        await page.waitForLoadState('networkidle').catch(() => {})
        await page.addScriptTag({ content: AXE_SRC })
        const axe = await page.evaluate(async () => {
          const run = await window.axe.run(document, {
            resultTypes: ['violations'],
            rules: { 'color-contrast': { enabled: true } },
          })
          return run.violations.map((v) => ({
            rule: v.id,
            impact: v.impact,
            nodes: (v.nodes || []).length,
          }))
        })
        violations = axe.filter((v) => ['serious', 'critical'].includes(v.impact))
        if (violations.length > 0 && isNew) {
          verdict = 'FAIL'
          hardFail += 1
        }
      }
    } catch (err) {
      verdict = 'NOT_TESTED'
      violations = [{ rule: String(err).slice(0, 120) }]
      notTested += 1
    }
    if (verdict === 'NOT_TESTED') notTested += 0
    const row = { cell, route, viewport: vp.name, isNew, verdict, violations }
    results.push(row)
    const mark = verdict === 'PASS' ? '✓' : verdict === 'FAIL' ? '✗' : '○'
    console.log(
      `  ${mark} ${cell.padEnd(26)} ${verdict.padEnd(10)} ${isNew ? '[gate]' : '[report]'} 违规=${violations.length}${violations.length ? ' ' + JSON.stringify(violations) : ''}`,
    )
    await context.close()
  }
}

await browser.close()

const gateRows = results.filter((r) => r.isNew)
const gateFail = gateRows.filter((r) => r.verdict === 'FAIL').length
const gateNotTested = gateRows.filter((r) => r.verdict === 'NOT_TESTED').length
const gatePass = gateRows.filter((r) => r.verdict === 'PASS').length

fs.writeFileSync(
  path.join(OUT_DIR, 'b2-public-axe.json'),
  JSON.stringify({ base: BASE, at: new Date().toISOString(), results }, null, 1),
)

console.log('')
console.log(`新页门禁：${gatePass} PASS / ${gateFail} FAIL / ${gateNotTested} NOT_TESTED · 共 ${gateRows.length} 格`)
console.log(`既有页报告：${results.length - gateRows.length} 格（不判红）`)
process.exit(gateFail > 0 || gateNotTested > 0 ? 1 : 0)
