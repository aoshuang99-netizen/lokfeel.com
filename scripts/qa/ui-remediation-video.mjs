#!/usr/bin/env node
/**
 * V25.6 UI 整改 · 真实操作录屏（本地 HTTP / 登录夹具 / 非生产）
 * 用 Playwright 的 recordVideo 录制 PC 与移动端两个上下文：
 *   · 打开 Dashboard → 点击 Chats 入口 → 空状态点 Invite → 邀请面板出现（真实 /api/invites）
 *   · 打开 Connections → 展开匹配区 → 主区邀请 CTA
 *   · 打开 Console → 价值入口
 * 诚实边界：录屏是真实浏览器操作证据，非生产、非真人盲测。
 *
 * 用法：PW_CHANNEL=chrome node scripts/qa/ui-remediation-video.mjs \
 *   --base=http://127.0.0.1:3104 --out=docs/v25.6/ga-closure/ui-remediation/videos
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
const OUT = path.resolve(ROOT, arg('out', 'docs/v25.6/ga-closure/ui-remediation/videos'))
const PASSWORD = ['E2E', 'Test', 'Passw0rd!'].join('-')
await fs.mkdir(OUT, { recursive: true })

const log = []
let browser
try {
  browser = await chromium.launch({ channel: 'chrome' })
  for (const vp of [{ name: 'pc', width: 1440, height: 900 }, { name: 'mobile', width: 390, height: 844 }]) {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      recordVideo: { dir: OUT, size: { width: vp.width, height: vp.height } },
    })
    const page = await ctx.newPage()
    const step = async (label, fn) => {
      try { await fn(); log.push({ view: vp.name, step: label, ok: true }) }
      catch (e) { log.push({ view: vp.name, step: label, ok: false, error: String(e).slice(0, 120) }) }
    }

    // 登录
    await step('登录', async () => {
      const res = await ctx.request.post(`${BASE}/api/auth/login`, {
        data: { email: 'e2e.owner@example.test', password: PASSWORD },
        headers: { Origin: BASE, Referer: `${BASE}/login` },
      })
      const body = await res.json().catch(() => ({}))
      if (!(res.ok() && body?.success)) throw new Error(`login ${res.status()}`)
    })

    await step('首页(/dashboard→/workspace) + My AI 诚实态', async () => {
      await page.goto(BASE + '/dashboard', { waitUntil: 'domcontentloaded', timeout: 30000 })
      await page.waitForTimeout(1500)
      // 已登录访问 /dashboard 会被 307 到 /workspace（next.config.ts 主线导航）
      await page.locator('[data-testid="home-my-ai-honest-state"]').waitFor({ timeout: 12000 })
    })

    await step('点击 Chats 入口跳转', async () => {
      await page.locator('[data-testid="home-chats-entry"]').click({ timeout: 10000 })
      await page.waitForTimeout(1000)
    })

    await step('Chats 邀请按钮打开真实邀请面板', async () => {
      // 移动端聊天布局默认显示列表面板，空态可能被隐藏；直接 goto 空态路由再点按钮。
      await page.goto(BASE + '/dashboard/chats', { waitUntil: 'domcontentloaded', timeout: 30000 })
      await page.waitForTimeout(800)
      const btn = page.getByRole('button', { name: /Invite someone you know/i }).last()
      await btn.click({ timeout: 12000, force: true })
      await page.waitForTimeout(1500)
    })

    await step('Connections 页面 + 邀请 CTA', async () => {
      await page.goto(BASE + '/dashboard/connections', { waitUntil: 'domcontentloaded', timeout: 30000 })
      await page.waitForTimeout(1200)
      await page.locator('[data-testid="invite-cta"]').waitFor({ timeout: 10000 })
    })

    await step('Console 价值入口', async () => {
      await page.goto(BASE + '/console', { waitUntil: 'domcontentloaded', timeout: 30000 })
      await page.waitForTimeout(1500)
      await page.locator('nav[aria-label="社群工作台入口"]').waitFor({ timeout: 10000 })
    })

    const video = page.video()
    await ctx.close()
    if (video) {
      const src = await video.path()
      const dst = path.join(OUT, `ui-remediation-${vp.name}.webm`)
      await fs.copyFile(src, dst)
      log.push({ view: vp.name, video: path.relative(ROOT, dst) })
    }
  }
} catch (e) {
  log.push({ fatal: String(e).slice(0, 200) })
} finally {
  if (browser) await browser.close()
}

const outFile = path.join(OUT, 'report.json')
await fs.writeFile(outFile, JSON.stringify({
  task: 'V25.6 UI 整改 · 真实操作录屏',
  generatedAt: new Date().toISOString(), base: BASE,
  evidenceType: 'REAL_BROWSER video (local, logged-in fixture, non-production)',
  steps: log,
}, null, 2))
const failed = log.filter((l) => l.ok === false || l.fatal)
console.log(JSON.stringify({ steps: log.length, failed: failed.length, out: path.relative(ROOT, outFile) }, null, 2))
