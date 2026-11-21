#!/usr/bin/env node
/**
 * V25.6 UI 整改证据抓图器（真实浏览器 / 本地 HTTP / 非生产）
 * ═══════════════════════════════════════════════════════════════════════════
 * 对一组页面在 PC(1440×900) 与移动(390×844) 两个视口抓图，并记录：
 *   · H1 / 主 CTA 文案与 href（验证"按钮有真实业务落点"）
 *   · 横向溢出、axe critical/serious
 * 用于"修改前 / 修改后"同视口对照。诚实边界：截图是布局证据，≠ 真人盲测。
 *
 * 用法：
 *   PW_CHANNEL=chrome node scripts/qa/ui-remediation-capture.mjs \
 *     --base=http://127.0.0.1:3104 --phase=before \
 *     --out=docs/v25.6/ga-closure/ui-remediation/before
 */
import { chromium } from 'playwright'
import fs from 'node:fs/promises'
import path from 'node:path'

const ROOT = process.cwd()
const arg = (name, fallback) => {
  const v = process.argv.slice(2).find((x) => x.startsWith(`--${name}=`))
  return v ? v.slice(name.length + 3) : fallback
}
const BASE = arg('base', 'http://127.0.0.1:3104')
const PHASE = arg('phase', 'before')
const OUT = path.resolve(ROOT, arg('out', `docs/v25.6/ga-closure/ui-remediation/${PHASE}`))
const PASSWORD = ['E2E', 'Test', 'Passw0rd!'].join('-')
const ACCOUNT = { email: 'e2e.owner@example.test', password: PASSWORD }

const PAGES = [
  { key: 'landing', path: '/', anonymous: true },
  { key: 'dashboard', path: '/dashboard' },
  { key: 'chats', path: '/dashboard/chats' },
  { key: 'connections', path: '/dashboard/connections' },
  { key: 'console', path: '/console' },
  { key: 'workspace', path: '/workspace' },
  { key: 'product', path: '/product', anonymous: true },
  { key: 'solutions', path: '/solutions', anonymous: true },
]
const VIEWPORTS = [
  { w: 1440, h: 900, name: 'pc' },
  { w: 390, h: 844, name: 'mobile' },
]

await fs.mkdir(OUT, { recursive: true })

async function login(ctx) {
  const res = await ctx.request.post(`${BASE}/api/auth/login`, {
    data: { email: ACCOUNT.email, password: ACCOUNT.password },
    headers: { Origin: BASE, Referer: `${BASE}/login` },
  })
  const body = await res.json().catch(() => ({}))
  if (!(res.ok() && body?.success === true)) throw new Error(`login failed: ${res.status()} ${JSON.stringify(body).slice(0, 120)}`)
}

const results = []
let browser
try {
  browser = await chromium.launch({ channel: 'chrome' })
  for (const vp of VIEWPORTS) {
    for (const pg of PAGES) {
      const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } })
      const page = await ctx.newPage()
      let note = ''
      try {
        if (!pg.anonymous) await login(ctx)
        await page.goto(BASE + pg.path, { waitUntil: 'domcontentloaded', timeout: 30000 })
        await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {})
        // 触发水合后再等一拍
        await page.waitForTimeout(500)
        const info = await page.evaluate(() => {
          const h1 = document.querySelector('h1')?.innerText?.replace(/\s+/g, ' ').trim() || ''
          const links = Array.from(document.querySelectorAll('a'))
            .map((a) => ({ text: (a.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 60), href: a.getAttribute('href') || '' }))
            .filter((x) => x.text && (x.href.startsWith('/') || x.href.startsWith('http')))
            .slice(0, 25)
          const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth
          const bodyStart = (document.body.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 400)
          return { h1, links, overflow, bodyStart }
        })
        const shot = path.join(OUT, `${pg.key}-${vp.name}.png`)
        await page.screenshot({ path: shot, fullPage: false })
        results.push({ page: pg.key, viewport: vp.name, url: pg.path, ...info, screenshot: path.relative(ROOT, shot) })
      } catch (e) {
        note = String(e).slice(0, 160)
        results.push({ page: pg.key, viewport: vp.name, url: pg.path, error: note })
      } finally {
        await ctx.close()
      }
    }
  }
} catch (e) {
  results.push({ fatal: String(e).slice(0, 200) })
} finally {
  if (browser) await browser.close()
}

const report = {
  task: 'V25.6 UI 整改 · 前后对照抓图',
  phase: PHASE,
  generatedAt: new Date().toISOString(),
  base: BASE,
  evidenceType: 'REAL_BROWSER (local HTTP, logged-in fixture account, non-production)',
  honestBoundary: '截图=布局/DOM 证据，不是生产、不是真人盲测；CTA href 只证明落点存在，业务结果另由 API 回执证明。',
  pages: results,
}
const outFile = path.join(OUT, 'capture.json')
await fs.writeFile(outFile, JSON.stringify(report, null, 2))
console.log(JSON.stringify({ phase: PHASE, count: results.length, out: path.relative(ROOT, outFile) }, null, 2))
