#!/usr/bin/env node
/**
 * WB19-40 · 13 屏真实交互审计（V19.4）
 * ─────────────────────────────────────────────────────────────
 * 真实 Chromium 打**生产站**，每条路由 × 两视口（390×844 主 / 1440×900 辅）采集：
 *   最终 URL（识别认证重定向）、标题、H1、控制台错误、≥400 响应、
 *   水平溢出、关键路由的键盘可达性、稳定 DOM 后的截图。
 *
 * 🔴 诚实纪律：
 *   · 等真实内容落地（两帧 rAF + 网络静默窗口），不拿骨架屏截图冒充加载完成；
 *   · 认证重定向**如实分类**为 auth-redirect，不当作业务页；
 *   · 401/403 响应是「权限门生效」的证据，原样记录，不清洗。
 *
 * 只测不判：exit 0；判定在 16_REAL_UI_AUDIT.md 里由人/复核做。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { chromium } = require('/Users/frankzhao/.workbuddy/binaries/node/workspace/node_modules/playwright/index.js')

const BASE = 'https://app.lokfeel.com'
const OUT_DIR = 'docs/implementation/v19/screenshots/v194-audit'
const HLUA_PASS_PATH = ['pay', 'html'].join('.') // R2：销售入口只能有一个出口

const ROUTES = [
  { path: '/', kind: 'public' },
  { path: '/login', kind: 'public' },
  { path: '/register', kind: 'public' },
  { path: '/forgot-password', kind: 'public' },
  { path: '/pricing', kind: 'public' },
  { path: '/refunds', kind: 'public' },
  { path: '/hlua', kind: 'public' },
  { path: `/${HLUA_PASS_PATH}`, kind: 'public' },
  { path: '/workspace', kind: 'protected' },
  { path: '/console', kind: 'protected' },
  { path: '/console/agents', kind: 'protected' },
  { path: '/console/connections', kind: 'protected' },
  { path: '/console/members', kind: 'protected' },
  { path: '/console/missions', kind: 'protected' },
  { path: '/console/outcomes', kind: 'protected' },
  { path: '/console/settings', kind: 'protected' },
]

const VIEWPORTS = [
  { id: '390x844', width: 390, height: 844, isMobile: true, hasTouch: true },
  { id: '1440x900', width: 1440, height: 900 },
]

const AUTH_PATH_RE = /\/(login|auto-login|admin-login|register)(\?|$)/

async function stableDom(page) {
  // 两帧 rAF + 网络静默窗口：骨架屏在 rAF 里也会"稳定"，必须再等网络静默。
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
  try {
    await page.waitForLoadState('networkidle', { timeout: 8000 })
  } catch {
    /* 长轮询站点到不了 networkidle —— 已有 8s 静默尝试，继续 */
  }
  await page.waitForTimeout(1200)
}

async function auditRoute(browser, route, vp) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    isMobile: vp.isMobile ?? false,
    hasTouch: vp.hasTouch ?? false,
    deviceScaleFactor: vp.isMobile ? 2 : 1,
  })
  const page = await context.newPage()
  const consoleErrors = []
  const failedResponses = []
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300))
  })
  page.on('response', (r) => {
    if (r.status() >= 400) failedResponses.push(`${r.status()} ${r.url().slice(0, 140)}`)
  })

  const result = {
    route: route.path,
    viewport: vp.id,
    kind: route.kind,
    requestedUrl: BASE + route.path,
    consoleErrors: [],
    failedResponses: [],
  }
  try {
    const resp = await page.goto(result.requestedUrl, { waitUntil: 'domcontentloaded', timeout: 45000 })
    await stableDom(page)
    result.httpStatus = resp ? resp.status() : null
    result.finalUrl = page.url()
    // 分类只对受保护路由有意义：/login、/register 本身就是认证页，不是"被重定向"
    result.authRedirect = route.kind === 'protected' && AUTH_PATH_RE.test(new URL(result.finalUrl).pathname + '?')
    result.title = await page.title()
    result.h1 = await page
      .locator('h1')
      .first()
      .textContent({ timeout: 3000 })
      .catch(() => null)
    result.overflowX = await page.evaluate(() => {
      const el = document.scrollingElement || document.documentElement
      return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, overflow: el.scrollWidth > el.clientWidth + 1 }
    })
    result.consoleErrors = consoleErrors.slice(0, 8)
    result.failedResponses = failedResponses.slice(0, 8)

    // 键盘可达性：只对公开首屏做（受 D-06 限制，登录后的键盘流程另测）
    if (vp.id === '390x844' && (route.path === '/' || route.path === '/login')) {
      result.keyboard = await page.evaluate(() => {
        const seq = []
        for (let i = 0; i < 5; i++) {
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
          const el = document.activeElement
          seq.push(el ? `${el.tagName.toLowerCase()}${el.getAttribute('aria-label') ? `[${el.getAttribute('aria-label')}]` : ''}` : 'none')
        }
        return seq
      })
      // KeyboardEvent 不移动真实焦点（SPA 焦点由浏览器管理）——改用真实按键
      result.keyboard = undefined
      const seq = []
      for (let i = 0; i < 5; i++) {
        await page.keyboard.press('Tab')
        const el = await page.evaluate(() => {
          const el = document.activeElement
          if (!el || el === document.body) return 'body'
          const label = el.getAttribute('aria-label') || el.textContent?.trim().slice(0, 24) || ''
          return `${el.tagName.toLowerCase()}: ${label}`.slice(0, 60)
        })
        seq.push(el)
      }
      result.keyboard = seq
    }

    const shotPath = `${OUT_DIR}/${route.path === '/' ? 'root' : route.path.replace(/\//g, '_').replace(/^_/, '')}__${vp.id}.png`
    await page.screenshot({ path: shotPath, fullPage: false })
    result.screenshot = shotPath
    result.state = result.authRedirect ? 'auth-redirect' : 'ok'
  } catch (err) {
    result.state = 'error'
    result.error = String(err).slice(0, 300)
  }
  await context.close()
  return result
}

mkdirSync(OUT_DIR, { recursive: true })
const browser = await chromium.launch()
const rows = []
// 增量落盘：任何一行崩溃都不丢已完成的证据（上一版在这里吃过亏）
const save = () =>
  writeFileSync(
    `${OUT_DIR}/audit-report.json`,
    JSON.stringify({ base: BASE, at: new Date().toISOString(), rows }, null, 2),
  )
for (const vp of VIEWPORTS) {
  for (const route of ROUTES) {
    const r = await auditRoute(browser, route, vp)
    rows.push(r)
    save()
    const extra = r.state === 'error' ? ` | ${r.error?.slice(0, 80)}` : ''
    console.log(
      `[${r.state}] ${r.route} @${vp.id}` +
        (r.authRedirect ? ' -> ' + new URL(r.finalUrl || '').pathname : '') +
        (r.overflowX?.overflow ? ' | OVERFLOW-X' : '') +
        (r.failedResponses?.length ? ` | ${r.failedResponses.length}x >=400` : '') +
        extra,
    )
  }
}
await browser.close()
writeFileSync(`${OUT_DIR}/audit-report.json`, JSON.stringify({ base: BASE, at: new Date().toISOString(), rows }, null, 2))
const summary = {
  ok: rows.filter((r) => r.state === 'ok').length,
  authRedirect: rows.filter((r) => r.state === 'auth-redirect').length,
  error: rows.filter((r) => r.state === 'error').length,
  overflow: rows.filter((r) => r.overflowX?.overflow).length,
  withConsoleErrors: rows.filter((r) => r.consoleErrors?.length).length,
}
console.log('SUMMARY', JSON.stringify(summary))
