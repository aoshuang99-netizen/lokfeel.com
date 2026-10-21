#!/usr/bin/env node
/**
 * V16 · T03 —— 13 屏真实交互审计（生产站、真实登录态）
 *
 * 范围（取自真实路由，不猜）：
 *   /workspace 的 6 个屏（Now / Studio / Field / Consent / Outcomes / Agents，
 *   屏内 state 切换，URL 不变）
 *   /console 的 7 屏（首页 / missions / connections / agents / members / outcomes / settings）
 *
 * 每屏采集：
 *   · HTTP 状态与最终 URL（是否被踢回登录）
 *   · 标题、H1/H2、可见文本长度（识别"空壳"）
 *   · 可交互元素（按钮文本 / disabled / data-testid）、表单控件
 *   · console.error + pageerror + 失败请求（≥400）
 *   · 截图：桌面 1440×900 与移动 390×844
 *
 * 为什么打生产：本地依赖半装起不了 dev；生产才是用户看到的界面。
 * 本脚本**只读**：不点击任何写操作按钮，不提交表单。
 *
 * 用法：
 *   node scripts/qa/v16-ux-audit.mjs
 *   node scripts/qa/v16-ux-audit.mjs --only=desktop   # 只桌面
 *   node scripts/qa/v16-ux-audit.mjs --base=http://localhost:3099
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')

const argv = process.argv.slice(2)
const argOf = (k, d) => {
  const hit = argv.find((a) => a.startsWith(`--${k}=`))
  return hit ? hit.slice(k.length + 3) : d
}
// 输出目录可切：`--out=after` 采改版后的对照图，默认仍是改版前的 before。
const OUT = path.join(ROOT, 'docs/v16/screenshots/' + argOf('out', 'before'))
const REPORT = path.join(ROOT, 'docs/v16/' + argOf('report', '_audit-raw.json'))
const BASE = argOf('base', 'https://app.lokfeel.com').replace(/\/$/, '')
const DEVICE = argOf('only', 'both')

const ACCOUNT = {
  email: process.env.QA_ADMIN_EMAIL || 'admin@lokfeel.com',
  password: process.env.QA_ADMIN_PASSWORD || 'LokFeel@Admin2026!',
}

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
}

/** 13 屏：id / 路由 / 屏内导航按钮文本 / 期望看到的关键内容 */
const SCREENS = [
  { id: 'ws-now', route: '/workspace', nav: 'Now', expect: /今日|Now|待办/i },
  { id: 'ws-studio', route: '/workspace', nav: 'Studio', expect: /目标|编译|Studio/i },
  { id: 'ws-field', route: '/workspace', nav: 'Field', expect: /连接|Field/i },
  { id: 'ws-consent', route: '/workspace', nav: 'Consent', expect: /同意|披露|Consent/i },
  { id: 'ws-outcomes', route: '/workspace', nav: 'Outcomes', expect: /成果|指标|Outcome/i },
  { id: 'ws-agents', route: '/workspace', nav: 'Agents', expect: /Agent|审批|运行/i },
  { id: 'console-home', route: '/console', expect: /待办|队列|Console|运营/i },
  { id: 'console-missions', route: '/console/missions', expect: /Mission|使命/i },
  { id: 'console-connections', route: '/console/connections', expect: /连接|Connection/i },
  { id: 'console-agents', route: '/console/agents', expect: /Agent/i },
  { id: 'console-members', route: '/console/members', expect: /成员|角色|Member/i },
  { id: 'console-outcomes', route: '/console/outcomes', expect: /成果|核算|Outcome/i },
  { id: 'console-settings', route: '/console/settings', expect: /设置|Settings/i },
]

async function loadPlaywright() {
  try {
    return (await import('playwright')).chromium
  } catch {
    const root =
      process.env.PLAYWRIGHT_ROOT ||
      '/Users/frankzhao/.workbuddy/binaries/node/workspace/node_modules/'
    const require = createRequire(path.join(root, 'noop.js'))
    return require('playwright').chromium
  }
}

const chromium = await loadPlaywright()

async function collect(page, screen, device) {
  const consoleErrors = []
  const pageErrors = []
  const failedRequests = []

  const onConsole = (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 300))
  }
  const onPageError = (err) => pageErrors.push(String(err).slice(0, 300))
  const onResponse = (res) => {
    const s = res.status()
    if (s >= 400) failedRequests.push(`${s} ${res.request().method()} ${res.url().slice(0, 160)}`)
  }

  page.on('console', onConsole)
  page.on('pageerror', onPageError)
  page.on('response', onResponse)

  const record = {
    id: screen.id,
    route: screen.route,
    device,
    viewport: VIEWPORTS[device],
    status: 0,
    finalUrl: '',
    title: '',
    headings: [],
    textLength: 0,
    buttons: [],
    links: 0,
    inputs: 0,
    consoleErrors: [],
    pageErrors: [],
    failedRequests: [],
    expectMatched: false,
    shot: '',
  }

  try {
    const resp = await page.goto(BASE + screen.route, {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    })
    record.status = resp?.status() ?? 0
    await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {})

    // 屏内导航（workspace 六屏）
    if (screen.nav) {
      try {
        await page.locator(`button:has-text("${screen.nav}")`).first().click({ timeout: 8000 })
        await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {})
      } catch (e) {
        pageErrors.push(`屏内导航 "${screen.nav}" 点击失败: ${String(e).slice(0, 120)}`)
      }
    }

    await page.waitForTimeout(2500)
    record.finalUrl = page.url()
    record.title = await page.title()

    const DOM = await page.evaluate(() => {
      const bodyText = (document.body?.innerText || '').replace(/\s+/g, ' ').trim()
      const headings = [...document.querySelectorAll('h1,h2')]
        .map((h) => (h.textContent || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .slice(0, 8)
      const buttons = [...document.querySelectorAll('button,[role="button"]')]
        .slice(0, 30)
        .map((b) => ({
          text: (b.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40),
          disabled: b.hasAttribute('disabled') || b.getAttribute('aria-disabled') === 'true',
          testId: b.getAttribute('data-testid') || '',
        }))
        .filter((b) => b.text || b.testId)
      return {
        text: bodyText.slice(0, 4000),
        textLength: bodyText.length,
        headings,
        buttons,
        links: document.querySelectorAll('a[href]').length,
        inputs: document.querySelectorAll('input,textarea,select').length,
      }
    })

    record.headings = DOM.headings
    record.textLength = DOM.textLength
    record.buttons = DOM.buttons
    record.links = DOM.links
    record.inputs = DOM.inputs
    record.expectMatched = screen.expect.test(DOM.text)
    record.textSample = DOM.text.slice(0, 600)

    const file = path.join(OUT, `${screen.id}-${device}.png`)
    await page.screenshot({ path: file })
    record.shot = path.relative(ROOT, file)
  } catch (e) {
    record.pageErrors.push(`采集失败: ${String(e).slice(0, 200)}`)
  } finally {
    record.consoleErrors = consoleErrors
    record.pageErrors = pageErrors
    record.failedRequests = failedRequests.slice(0, 10)
    page.off('console', onConsole)
    page.off('pageerror', onPageError)
    page.off('response', onResponse)
  }

  return record
}

async function main() {
  await fs.mkdir(OUT, { recursive: true })

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: VIEWPORTS.desktop })
  const page = await context.newPage()

  // 用站点自己的登录接口建会话（与浏览器同源，避免 CSRF 拦截）
  const res = await page.request.post(`${BASE}/api/auth/login`, {
    data: ACCOUNT,
    headers: { Origin: BASE, Referer: `${BASE}/login` },
  })
  const body = await res.json().catch(() => ({}))
  const loginOk = res.ok() && body?.success === true
  console.log(`登录 ${ACCOUNT.email} → HTTP ${res.status()} · success=${body?.success}`)
  if (!loginOk) {
    console.log('⚠ 登录失败，后续屏会被重定向到 /login —— 记录会体现这一点')
  }

  const devices = DEVICE === 'both' ? ['desktop', 'mobile'] : [DEVICE]
  const results = []

  for (const device of devices) {
    await page.setViewportSize(VIEWPORTS[device])
    console.log(`\n── ${device} ${VIEWPORTS[device].width}×${VIEWPORTS[device].height} ──`)
    for (const screen of SCREENS) {
      const rec = await collect(page, screen, device)
      results.push(rec)
      const flags = []
      if (rec.status !== 200) flags.push(`HTTP ${rec.status}`)
      if (/\/login/.test(rec.finalUrl)) flags.push('被踢到登录页')
      if (!rec.expectMatched) flags.push('未见预期内容')
      if (rec.pageErrors.length) flags.push(`pageerror×${rec.pageErrors.length}`)
      if (rec.consoleErrors.length) flags.push(`console×${rec.consoleErrors.length}`)
      if (rec.textLength < 200) flags.push(`文本仅 ${rec.textLength} 字`)
      console.log(
        `  ${rec.id.padEnd(20)} ${String(rec.status).padEnd(4)} 文本${String(rec.textLength).padStart(5)} 按钮${String(rec.buttons.length).padStart(2)} 链接${String(rec.links).padStart(3)}  ${flags.join(' · ') || 'ok'}`,
      )
    }
  }

  await browser.close()

  await fs.writeFile(
    REPORT,
    JSON.stringify({ base: BASE, account: ACCOUNT.email, at: new Date().toISOString(), results }, null, 2),
  )

  const bad = results.filter(
    (r) =>
      r.status !== 200 ||
      /\/login/.test(r.finalUrl) ||
      !r.expectMatched ||
      r.pageErrors.length > 0 ||
      r.textLength < 200,
  )
  console.log('')
  console.log(`采集 ${results.length} 屏次 · 异常 ${bad.length} · 原始数据 ${path.relative(ROOT, REPORT)}`)
  if (bad.length) {
    console.log('异常屏：' + bad.map((b) => `${b.id}/${b.device}`).join(', '))
  }
  process.exit(0)
}

main().catch((e) => {
  console.error('审计脚本异常：', e)
  process.exit(2)
})
