#!/usr/bin/env node
/**
 * V20.7 GA · R6-T2 —— 四视口 + 无障碍复测（公开面）
 *
 * ── 它回答什么 ────────────────────────────────────────────────────────
 *   上一轮 T2 只做了"HTML 文本里没有未批准金额"，那是**内容**维度。
 *   发布门禁还要求：小屏不横向溢出、指针目标 ≥24×24 CSS px（WCAG 2.2 AA 2.5.8）、
 *   键盘可达且焦点可见、axe 无 serious/critical 违规。
 *   这四件事在 12pt 的断言里都看不见，只能在真浏览器里量。
 *
 * ── 判据来源（不自行发明）─────────────────────────────────────────────
 *   · 目标尺寸：WCAG 2.2 SC 2.5.8 Minimum —— 24×24 CSS px（AAA 2.5.5 才是 44×44）；
 *     本脚本按 24 判 FAIL，另把 <44 的"重要 CTA"记为 WARN，不混算。
 *   · 溢出：`scrollWidth > clientWidth + 1`（1px 容差吸收子像素舍入）。
 *   · 焦点：Tab 到第一个可交互元素后，`outline-width` 或 `box-shadow` 必须非零。
 *
 * ── 它自己的失效条件 ───────────────────────────────────────────────────
 *   ① axe 只报"规则命中"，不判业务语义；`serious/critical` 为 0 不等于"无障碍优秀"；
 *   ② headless 下 `:focus-visible` 的启发式与真机不同，焦点检查是必要条件不是充分条件；
 *   ③ 页面若在测量期仍在动画/懒加载，溢出与目标尺寸可能抖动 —— 每页固定等待 800ms。
 *
 * 用法：
 *   node scripts/qa/r6-t2-viewports-axe.mjs --base=http://127.0.0.1:3116 --out=x.json
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')

const args = {}
for (const a of process.argv.slice(2)) {
  if (!a.startsWith('--')) continue
  const i = a.indexOf('=')
  if (i === -1) args[a.slice(2)] = 'true'
  else args[a.slice(2, i)] = a.slice(i + 1)
}
const BASE = (args.base || 'http://127.0.0.1:3116').replace(/\/$/, '')

const ROUTES = ['/', '/pricing', '/product', '/solutions', '/stories', '/how-it-works', '/help', '/about']
const VIEWPORTS = [
  { name: 'mobile-360', width: 360, height: 640, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  { name: 'mobile-390', width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 3 },
  { name: 'tablet-768', width: 768, height: 1024, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  { name: 'desktop-1440', width: 1440, height: 900, isMobile: false, hasTouch: false, deviceScaleFactor: 1 },
]

async function auditPage(page) {
  return page.evaluate(() => {
    const doc = document.documentElement
    const overflow = {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      overflowX: doc.scrollWidth - doc.clientWidth,
    }

    const targets = [...document.querySelectorAll('a[href], button, [role="button"], input, select, textarea')]
      .filter((el) => {
        const r = el.getBoundingClientRect()
        const s = getComputedStyle(el)
        return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'
      })
      .map((el) => {
        const r = el.getBoundingClientRect()
        const s = getComputedStyle(el)
        // WCAG 2.2 SC 2.5.8 的 **Inline 例外**：位于句子/连续文本中的行内链接不适用尺寸要求。
        // 判据（可复算）：display:inline，且父元素里除它之外还有 ≥ 同等长度的可见文本。
        // 不加这条，"句子里的「退款政策」"会被判违规 —— 那是把标准读窄了，
        // 结果是为了过门禁把行内链接撑成块，反而破坏排版。
        const siblingsText = (el.parentElement?.textContent || '').trim()
        const selfText = (el.textContent || '').trim()
        const inlineInProse =
          s.display === 'inline' &&
          selfText.length > 0 &&
          siblingsText.length >= selfText.length * 2
        return {
          tag: el.tagName.toLowerCase(),
          label: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 40),
          w: Math.round(r.width),
          h: Math.round(r.height),
          inlineInProse,
        }
      })

    const sized = targets.filter((t) => !t.inlineInProse)
    const under24 = sized.filter((t) => t.w < 24 || t.h < 24)
    const under44 = sized.filter((t) => t.w < 44 || t.h < 44)
    return {
      overflow,
      targetCount: targets.length,
      inlineExempt: targets.length - sized.length,
      under24,
      under44,
      url: location.href,
      title: document.title,
    }
  })
}

async function focusCheck(page) {
  await page.keyboard.press('Tab')
  return page.evaluate(() => {
    const el = document.activeElement
    if (!el || el === document.body) return { focused: null, visible: false, reason: 'Tab 后焦点仍在 body' }
    const s = getComputedStyle(el)
    const outline = parseFloat(s.outlineWidth || '0') || 0
    const shadow = s.boxShadow && s.boxShadow !== 'none'
    const visible = (outline > 0 && s.outlineStyle !== 'none') || shadow
    return {
      focused: `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}`,
      outlineWidth: outline,
      outlineStyle: s.outlineStyle,
      boxShadow: shadow,
      visible,
    }
  })
}

async function main() {
  const axePath = require.resolve('axe-core/axe.min.js')
  const axeSource = fs.readFileSync(axePath, 'utf8')
  const report = { checkedAt: new Date().toISOString(), base: BASE, axeVersion: null, cells: [], findings: [] }

  const browser = await chromium.launch({
    executablePath: process.env.PW_EXECUTABLE || undefined,
    channel: process.env.PW_CHANNEL || undefined,
  })

  try {
    for (const vp of VIEWPORTS) {
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        deviceScaleFactor: vp.deviceScaleFactor,
        isMobile: vp.isMobile,
        hasTouch: vp.hasTouch,
      })
      for (const route of ROUTES) {
        const page = await context.newPage()
        const issues = []
        let cell = { viewport: vp.name, route }
        try {
          const res = await page.goto(BASE + route, { waitUntil: 'load', timeout: 40_000 })
          await page.waitForTimeout(800)
          const base = await auditPage(page)
          await page.addScriptTag({ content: axeSource })
          const axe = await page.evaluate(async () => {
            const r = await window.axe.run(document, {
              runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] },
            })
            return {
              violations: r.violations.map((v) => ({
                id: v.id,
                impact: v.impact,
                nodes: v.nodes.length,
                help: v.help,
              })),
            }
          })
          if (!report.axeVersion) {
            const v = await page.evaluate(() => window.axe && window.axe.version)
            report.axeVersion = v || null
          }
          const focus = await focusCheck(page)

          const serious = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')

          cell = {
            ...cell,
            status: res ? res.status() : 0,
            title: base.title,
            scrollWidth: base.overflow.scrollWidth,
            clientWidth: base.overflow.clientWidth,
            overflowX: base.overflow.overflowX,
            targets: base.targetCount,
            inlineExempt: base.inlineExempt,
            under24: base.under24.length,
            under44: base.under44.length,
            under24Samples: base.under24.slice(0, 5),
            axeViolations: axe.violations.length,
            axeSerious: serious.length,
            axeSeriousIds: serious.map((v) => `${v.id}(${v.nodes})`),
            focus,
          }

          if (cell.status !== 200) issues.push(`HTTP ${cell.status}`)
          if (cell.overflowX > 1) issues.push(`横向溢出 ${cell.overflowX}px`)
          if (cell.under24 > 0) issues.push(`${cell.under24} 个指针目标 <24px`)
          if (serious.length) issues.push(`axe serious/critical：${cell.axeSeriousIds.join(',')}`)
          if (!focus.visible) issues.push(`焦点不可见（${focus.reason || focus.focused}）`)
        } catch (e) {
          cell.error = String((e && e.message) || e)
          issues.push(`测量失败：${cell.error.slice(0, 120)}`)
        } finally {
          await page.close()
        }
        cell.issues = issues
        if (issues.length) report.findings.push({ viewport: vp.name, route, issues })
        report.cells.push(cell)
      }
      await context.close()
    }
  } finally {
    await browser.close()
  }

  const total = report.cells.length
  const bad = report.cells.filter((c) => c.issues && c.issues.length).length
  report.summary = { cells: total, failedCells: bad, axeVersion: report.axeVersion }
  report.verdict = bad === 0 ? 'PASS' : 'FAIL'

  console.log(`\nT2 四视口：${report.verdict}（${total - bad}/${total} 单元格通过，axe ${report.axeVersion || '?'}）`)
  for (const f of report.findings.slice(0, 20)) console.log(`  FAIL ${f.viewport} ${f.route} — ${f.issues.join(' / ')}`)

  if (args.out) {
    fs.mkdirSync(path.dirname(args.out), { recursive: true })
    fs.writeFileSync(args.out, JSON.stringify(report, null, 2) + '\n')
    console.log(`写出 ${args.out}`)
  }
  process.exit(bad === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('FATAL', e)
  process.exit(3)
})
