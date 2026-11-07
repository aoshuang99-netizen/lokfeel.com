#!/usr/bin/env node
/**
 * V20.5 · Batch 3 —— 新增两个控件的无障碍与可达性（独立于 13 屏的 39 格）
 *
 * 为什么不并进 `v205-a11y-13screens.mjs`：
 *   那 39 格的口径是「**单社群**账号看到的 13 屏」，已经冻结成基线（见 03 文档）。
 *   而社群切换器只在 **≥2 个社群**的账号上渲染 —— 若把它塞进同一批格子，
 *   要么让原来 39 格的账号变成多社群（口径漂移），要么让切换器永远扫不到。
 *   所以单独一格一类：**账号前置条件不同，证据就必须分开记**。
 *
 * 判据（四条，都是可失败的）：
 *   1. 到达 /console 而**不是**被重定向到 /login（否则记 NOT_TESTED，不当 0 违规）；
 *   2. 切换器存在、可见、有可访问名、选项数 == 服务端下发的租户数；
 *   3. 键盘可达：`focus()` 后 `document.activeElement` 就是它（WCAG 2.1.1 / 2.4.7）；
 *   4. axe serious/critical = 0。
 *
 * 同时验证两套骨架的登出按钮都存在且有可访问名（`data-lf-signout="1"`）。
 *
 * 用法：
 *   PW_EXECUTABLE=<chromium> node scripts/qa/v205-a11y-org-switcher.mjs \
 *     --base=http://localhost:3111 --email=admin@lokfeel.com --pwd-file=/tmp/v204_admin_pwd
 */

import fs from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')
const AXE_SRC = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8')

const argv = process.argv.slice(2)
const arg = (k, d = '') => {
  const hit = argv.find((a) => a.startsWith(`--${k}=`))
  return hit ? hit.slice(k.length + 3) : d
}

const BASE = arg('base', 'http://127.0.0.1:3111').replace(/\/$/, '')
const EMAIL = arg('email', 'admin@lokfeel.com')
const PWD_FILE = arg('pwd-file', '/tmp/v204_admin_pwd')
const PASSWORD = process.env.V205_ADMIN_PASSWORD ?? fs.readFileSync(PWD_FILE, 'utf8').trim()

const COMBOS = [
  { theme: 'field', viewport: { width: 1440, height: 900 }, tag: '1440-field' },
  { theme: 'paper', viewport: { width: 1440, height: 900 }, tag: '1440-paper' },
  { theme: 'field', viewport: { width: 390, height: 844 }, tag: '390-field' },
]

const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: BASE },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  redirect: 'manual',
})
if (!login.ok) {
  console.error(`✗ 登录失败 HTTP ${login.status}（${EMAIL}）`)
  process.exit(2)
}
const setCookie = login.headers.getSetCookie().find((x) => /session-token/i.test(x))
const [cookieName, ...rest] = setCookie.split(';')[0].split('=')
const cookieValue = rest.join('=')

// 服务端下发的租户数：切换器的选项数必须与它相等，否则"少一个社群"会被 UI 静默吞掉。
const orgsRes = await fetch(`${BASE}/api/v1/organizations`, {
  headers: { Cookie: `${cookieName}=${cookieValue}` },
})
const orgs = (await orgsRes.json())?.data?.organizations ?? []
console.log(`✓ 登录成功（${EMAIL}）· 服务端租户数=${orgs.length}\n`)

const browser = await chromium.launch({
  executablePath: process.env.PW_EXECUTABLE || undefined,
  args: ['--proxy-server=direct://', '--proxy-bypass-list=*'],
})

const results = []
const record = (cell, verdict, detail) => {
  results.push({ cell, verdict, detail })
  const mark = verdict === 'PASS' ? '✓' : verdict === 'NOT_TESTED' ? '–' : '✗'
  console.log(`  ${mark} ${cell.padEnd(34)} ${verdict.padEnd(10)} ${detail}`)
}

async function settle(page) {
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {})
  await page
    .waitForFunction(
      () => {
        const busy = document.querySelector('.animate-spin, [aria-busy="true"]')
        const hasH1 = [...document.querySelectorAll('h1')].some((e) => e.textContent.trim())
        return !busy && hasH1
      },
      { timeout: 15_000 },
    )
    .catch(() => {})
}

for (const combo of COMBOS) {
  const cell = `org-switcher-${combo.tag}`
  const ctx = await browser.newContext({
    viewport: combo.viewport,
    colorScheme: combo.theme === 'paper' ? 'light' : 'dark',
  })
  await ctx.addCookies([
    {
      name: cookieName.trim(),
      value: cookieValue,
      domain: new URL(BASE).hostname,
      path: '/',
      httpOnly: true,
      secure: new URL(BASE).protocol === 'https:',
      sameSite: 'Lax',
    },
  ])
  await ctx.addInitScript((t) => {
    try {
      window.localStorage.setItem('lf-theme', t)
    } catch {
      /* 隐私模式写不了 → 主题断言会体现 */
    }
  }, combo.theme)

  const page = await ctx.newPage()
  await page.goto(`${BASE}/console`, { waitUntil: 'domcontentloaded' })
  await settle(page)

  if (/\/login/.test(page.url())) {
    record(cell, 'NOT_TESTED', `被重定向到 ${page.url()}（该账号可能不是多社群）`)
    await ctx.close()
    continue
  }

  const probe = await page.evaluate(() => {
    const sel = document.querySelector('#lf-org-switcher')
    const label = document.querySelector('label[for="lf-org-switcher"]')
    const signout = document.querySelector('[data-lf-signout="1"]')
    let focusedId = null
    if (sel) {
      sel.focus()
      focusedId = document.activeElement?.id ?? null
    }
    return {
      selExists: Boolean(sel),
      selVisible: Boolean(sel && sel.getBoundingClientRect().height > 0),
      optionCount: sel ? sel.options.length : 0,
      accessibleName: label?.textContent?.trim() ?? sel?.getAttribute('aria-label') ?? '',
      focusedId,
      signoutExists: Boolean(signout),
      signoutName: signout?.getAttribute('aria-label') ?? '',
      signoutHeight: signout ? Math.round(signout.getBoundingClientRect().height) : 0,
    }
  })

  await page.addScriptTag({ content: AXE_SRC })
  const axe = await page.evaluate(async () => {
    // @ts-expect-error axe 由上一行注入
    return await window.axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] },
      resultTypes: ['violations'],
    })
  })
  const serious = (axe.violations ?? []).filter((v) => ['serious', 'critical'].includes(v.impact))

  const ok =
    probe.selExists &&
    probe.selVisible &&
    probe.optionCount === orgs.length &&
    probe.accessibleName.length > 0 &&
    probe.focusedId === 'lf-org-switcher' &&
    probe.signoutExists &&
    probe.signoutName.length > 0 &&
    serious.length === 0

  record(
    cell,
    ok ? 'PASS' : 'FAIL',
    `选择器存在=${probe.selExists} 选项=${probe.optionCount}/${orgs.length} 名="${probe.accessibleName}" ` +
      `焦点=${probe.focusedId} 登出按钮=${probe.signoutExists}(${probe.signoutHeight}px,"${probe.signoutName}") ` +
      `serious+违规=${serious.length}${serious.length ? ' ' + serious.map((v) => v.id).join(',') : ''}`,
  )
  await ctx.close()
}

// Workspace 六屏的登出按钮（Console 那三格已覆盖另一套骨架）
{
  const cell = 'ws-signout-390-field'
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  await ctx.addCookies([
    {
      name: cookieName.trim(),
      value: cookieValue,
      domain: new URL(BASE).hostname,
      path: '/',
      httpOnly: true,
      secure: new URL(BASE).protocol === 'https:',
      sameSite: 'Lax',
    },
  ])
  const page = await ctx.newPage()
  await page.goto(`${BASE}/workspace`, { waitUntil: 'domcontentloaded' })
  await settle(page)
  const probe = await page.evaluate(() => {
    const b = document.querySelector('[data-lf-signout="1"]')
    if (b) b.focus()
    return {
      exists: Boolean(b),
      name: b?.getAttribute('aria-label') ?? '',
      height: b ? Math.round(b.getBoundingClientRect().height) : 0,
      width: b ? Math.round(b.getBoundingClientRect().width) : 0,
      focused: document.activeElement?.getAttribute('data-lf-signout') === '1',
    }
  })
  record(
    cell,
    probe.exists && probe.name.length > 0 && probe.height >= 44 && probe.focused ? 'PASS' : 'FAIL',
    `存在=${probe.exists} 名="${probe.name}" 尺寸=${probe.width}×${probe.height}（≥44 触达区）焦点可达=${probe.focused}`,
  )
  await ctx.close()
}

// ── 端到端：真的在浏览器里切换，头部上下文必须变 ──
// S15（HTTP 层）只证明"服务端按 cookie 解析"，它证明不了"UI 会重新渲染" ——
// 后者要经过 router.refresh() + RSC 重算。两者缺一，"切换器"就只是好看。
{
  const cell = 'org-switcher-ui-switch'
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.addCookies([
    {
      name: cookieName.trim(),
      value: cookieValue,
      domain: new URL(BASE).hostname,
      path: '/',
      httpOnly: true,
      secure: new URL(BASE).protocol === 'https:',
      sameSite: 'Lax',
    },
  ])
  const page = await ctx.newPage()
  await page.goto(`${BASE}/console`, { waitUntil: 'domcontentloaded' })
  await settle(page)

  const headerOrg = () => page.locator('header p').first().textContent()
  const before = (await headerOrg())?.trim() ?? ''
  const other = orgs.find((o) => o.name !== before) ?? null
  if (!other) {
    record(cell, 'FAIL', `头部组织名="${before}" 在租户列表里找不到另一个可切目标`)
  } else {
    await page.locator('#lf-org-switcher').selectOption(other.organizationId)
    const switched = await page
      .waitForFunction(
        (name) => document.querySelector('header p')?.textContent?.includes(name),
        other.name,
        { timeout: 15_000 },
      )
      .then(() => true)
      .catch(() => false)
    const after = (await headerOrg())?.trim() ?? ''
    // 切回去，不留痕迹（cookie 是服务端的，浏览器上下文关掉不影响别的会话，
    // 但同一账号的软偏好会被改掉 —— 还原是基本礼貌，也让脚本可重复跑）。
    if (switched) {
      const first = orgs.find((o) => o.name === before)
      if (first) {
        await page.locator('#lf-org-switcher').selectOption(first.organizationId)
        await page
          .waitForFunction((n) => document.querySelector('header p')?.textContent?.includes(n), before, {
            timeout: 15_000,
          })
          .catch(() => {})
      }
    }
    record(
      cell,
      switched && after.includes(other.name) ? 'PASS' : 'FAIL',
      `"${before}" → 选择"${other.name}" → 头部="${after}"（RSC 重渲染=${switched}）`,
    )
  }
  await ctx.close()
}

await browser.close()

fs.mkdirSync('test-results/v205-org-switcher', { recursive: true })
fs.writeFileSync(
  'test-results/v205-org-switcher/result.json',
  JSON.stringify({ base: BASE, email: EMAIL, tenants: orgs.length, results }, null, 2),
)

const fail = results.filter((r) => r.verdict === 'FAIL').length
const nt = results.filter((r) => r.verdict === 'NOT_TESTED').length
console.log(`\n=== ${results.length - fail - nt} PASS / ${fail} FAIL / ${nt} NOT_TESTED ===`)
process.exit(fail === 0 ? 0 : 1)
