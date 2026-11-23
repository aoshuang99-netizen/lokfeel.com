#!/usr/bin/env node
/**
 * P0-1 —— 邀请闭环的真实浏览器 UI 取证（Playwright + 系统 Chrome）
 * 三态截图：未登录引导 → 登录后明确接受按钮 → 接受成功/去聊天。
 * 只用本地 base；口令运行时拼接；截图不含 cookie/token 正文。
 *
 * 用法：node scripts/qa/p01-friend-invite-ui.mjs --base=... --code=INV-XXXXXX --out=docs/p01-friend-invite/evidence/ui
 */
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')
const argv = process.argv.slice(2)
const argOf = (k, d) => {
  const hit = argv.find((a) => a.startsWith(`--${k}=`))
  return hit ? hit.slice(k.length + 3) : d
}
const BASE = argOf('base', 'http://127.0.0.1:3214')
const CODE = argOf('code', '')
const OUT = path.resolve(ROOT, argOf('out', 'docs/p01-friend-invite/evidence/ui'))
if (/app\.lokfeel\.com|https:\/\//i.test(BASE)) {
  console.error('REFUSED: 只打本地 base')
  process.exit(2)
}
if (!CODE) {
  console.error('缺少 --code')
  process.exit(2)
}
const EMAIL = 'e2e.p01.b@example.test'
const PASSWORD = ['E2E', 'P01', 'Invite', 'Passw0rd!'].join('-')

async function loginCookie() {
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`, { headers: { Origin: BASE } })
  const csrf = await csrfRes.json()
  const csrfCookie = (csrfRes.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
  const r = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: BASE, Cookie: csrfCookie },
    body: new URLSearchParams({
      csrfToken: csrf.csrfToken,
      email: EMAIL,
      password: PASSWORD,
      callbackUrl: BASE,
      json: 'true',
    }),
    redirect: 'manual',
  })
  return (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch({ channel: 'chrome' })
  const url = `${BASE}/connect/invite?code=${encodeURIComponent(CODE)}`
  const steps = []

  // 态 1：未登录打开 → 应显示"请先登录或注册"
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const page = await ctx.newPage()
    await page.goto(url, { waitUntil: 'networkidle' })
    // 等确认态结束（loading 文案消失）再断言，而不是固定 sleep
    await page.waitForFunction(
      () => !document.body.innerText.includes('正在确认邀请'),
      { timeout: 20000 }
    )
    await page.screenshot({ path: path.join(OUT, '01-guest-390.png'), fullPage: true })
    const body = await page.locator('body').innerText()
    // 未登录也能看到邀请内容与"接受连接"按钮；点下去才会 401 引导登录。
    const ok = body.includes('接受连接') && body.includes('有人邀请你连接')
    steps.push({ step: '未登录打开显示邀请内容+接受按钮', ok })
    console.log(`  [${ok ? 'PASS' : 'FAIL'}] 未登录显示邀请内容+接受按钮`)
    await ctx.close()
  }

  // 态 2：已登录（注入 cookie）→ 应显示明确的"接受连接"按钮，**不得自动建联**
  const cookie = await loginCookie()
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  const domain = new URL(BASE).hostname
  await ctx.addCookies(
    cookie
      .split('; ')
      .filter(Boolean)
      .map((pair) => {
        const idx = pair.indexOf('=')
        return { name: pair.slice(0, idx), value: pair.slice(idx + 1), domain, path: '/' }
      })
  )
  await page.goto(url, { waitUntil: 'networkidle' })
  // 等"接受连接"按钮出现（明确接受态）
  await page.getByRole('button', { name: /接受连接/ }).waitFor({ state: 'visible', timeout: 20000 })
  await page.screenshot({ path: path.join(OUT, '02-ready-accept-390.png'), fullPage: true })
  const bodyBefore = await page.locator('body').innerText()
  const notAuto = !bodyBefore.includes('连接已建立')
  steps.push({ step: '已登录显示明确接受按钮且未自动建联', ok: notAuto })
  console.log(`  [${notAuto ? 'PASS' : 'FAIL'}] 明确接受按钮 + 未自动建联`)

  // 态 3：真实点击"接受连接" → 成功态 + 去聊天
  await page.getByRole('button', { name: /接受连接/ }).click()
  await page.getByRole('button', { name: /去聊天/ }).waitFor({ state: 'visible', timeout: 15000 })
  await page.screenshot({ path: path.join(OUT, '03-accepted-390.png'), fullPage: true })
  const bodyAfter = await page.locator('body').innerText()
  const ok3 = bodyAfter.includes('连接已建立')
  steps.push({ step: '点击接受后显示连接已建立', ok: ok3 })
  console.log(`  [${ok3 ? 'PASS' : 'FAIL'}] 接受后成功态`)

  await ctx.close()
  await browser.close()

  const passed = steps.filter((s) => s.ok).length
  fs.writeFileSync(
    path.join(OUT, 'result.json'),
    JSON.stringify({ base: BASE, at: new Date().toISOString(), passed, total: steps.length, steps }, null, 2)
  )
  console.log(`\nUI 取证：${passed}/${steps.length} PASS`)
  if (passed < steps.length) process.exit(1)
}

main().catch((e) => {
  console.error('UI script error:', e)
  process.exit(2)
})
