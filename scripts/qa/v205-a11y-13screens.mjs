#!/usr/bin/env node
/**
 * V20.5 · Batch 2 —— 13 屏 WCAG 2.2 AA 无障碍扫描
 *
 * 与 `v196-axe-scan.mjs` 的分工（不要合并）：
 *   · v196 扫的是**公开面 + B2C 面**（/ /login /register /dashboard/* /workspace），
 *     基线冻结在 `docs/implementation/v19/axe-baseline.json`，带棘轮门禁。
 *   · 本脚本扫的是 **V20.5 的 13 屏主战场**（Workspace 六屏 + Console 七屏），
 *     并且**按主题分开扫** —— 对比度违规几乎全部是主题相关的，
 *     只扫一个主题会漏掉另一套调色板里的死色。
 *
 * 为什么注入 axe 源码而不是 `@axe-core/playwright`：仓里有 `axe-core` 但没有那个包，
 * 沙箱装不完依赖是已知事实。`addScriptTag({content})` 的能力完全一致。
 * （踩过的坑：传 `path` 在 Next 的 CSP/静态资源路径下会 404，必须传 content。）
 *
 * 判据（不是"跑完就算过"）：
 *   · serious / critical 级违规 = **FAIL**，退出码 1；
 *   · moderate / minor 逐条列出，记为存量债，不阻塞但要写进报告；
 *   · 登录态被重定向到 /login ⇒ 该格记 `NOT_TESTED`，**不许**当作"0 违规"（空集恒真是假绿）。
 *
 * 用法：
 *   node scripts/qa/v205-a11y-13screens.mjs --base=http://localhost:3111 \
 *     --email=qa.male@lokfeel.com --pwd-file=/tmp/v204_qa_pwd
 *   PW_EXECUTABLE=<chromium 路径> 可指定已缓存的浏览器（macOS 13 上 playwright
 *   已不支持自动安装 chromium，见报告 §环境）。
 */

import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')
const AXE_SRC = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8')

const argv = process.argv.slice(2)
const arg = (k, d = '') => {
  const hit = argv.find((a) => a.startsWith(`--${k}=`))
  return hit ? hit.slice(k.length + 3) : d
}

const BASE = arg('base', 'http://127.0.0.1:3099').replace(/\/$/, '')
const EMAIL = arg('email', 'qa.male@lokfeel.com')
const PWD_FILE = arg('pwd-file', '/tmp/v204_qa_pwd')
const OUT = arg('out', 'test-results/v205-a11y')
const PASSWORD = process.env.V205_QA_PASSWORD ?? fs.readFileSync(PWD_FILE, 'utf8').trim()

fs.mkdirSync(OUT, { recursive: true })

const CONSOLE_SCREENS = [
  ['console-overview', '/console'],
  ['console-agents', '/console/agents'],
  ['console-connections', '/console/connections'],
  ['console-members', '/console/members'],
  ['console-missions', '/console/missions'],
  ['console-outcomes', '/console/outcomes'],
  ['console-settings', '/console/settings'],
]
const WORKSPACE_VIEWS = ['now', 'studio', 'field', 'consent', 'outcomes', 'agents']

const SCREENS = [
  ...WORKSPACE_VIEWS.map((v) => [`ws-${v}`, `/workspace?view=${v}`]),
  ...CONSOLE_SCREENS,
]

/** 每个主题扫一次桌面视口；移动视口只扫 field（对比度与视口无关，2.5.8 目标尺寸与主题无关）。 */
const COMBOS = [
  { theme: 'field', viewport: { width: 1440, height: 900 }, tag: '1440-field' },
  { theme: 'paper', viewport: { width: 1440, height: 900 }, tag: '1440-paper' },
  { theme: 'field', viewport: { width: 390, height: 844 }, tag: '390-field' },
]

// ───────────── 登录 ─────────────
const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: BASE },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  redirect: 'manual',
})
if (!login.ok) {
  console.error(`✗ 登录失败 HTTP ${login.status}`)
  process.exit(2)
}
const setCookie = login.headers.getSetCookie().find((x) => /session-token/i.test(x))
if (!setCookie) {
  console.error('✗ 登录成功但没有 session cookie')
  process.exit(2)
}
const [cookieName, ...rest] = setCookie.split(';')[0].split('=')
const cookieValue = rest.join('=')
console.log(`✓ 登录成功（${EMAIL}）\n`)

const browser = await chromium.launch({
  executablePath: process.env.PW_EXECUTABLE || undefined,
  channel: process.env.PW_EXECUTABLE ? undefined : process.env.PW_CHANNEL || undefined,
  args: ['--proxy-server=direct://', '--proxy-bypass-list=*'],
})

const rows = []
const violationsByRule = new Map()

async function settle(page) {
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {})
  await page
    .waitForFunction(
      () => {
        const busy = document.querySelector('.animate-spin, .animate-pulse, [aria-busy="true"]')
        const hasH1 = [...document.querySelectorAll('h1')].some((e) => e.textContent.trim())
        return !busy && hasH1
      },
      { timeout: 15_000 },
    )
    .catch(() => {})
}

for (const [id, url] of SCREENS) {
  for (const combo of COMBOS) {
    const cell = `${id}-${combo.tag}`
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
        /* 隐私模式写不了 → 后续主题断言会体现 */
      }
    }, combo.theme)

    const page = await ctx.newPage()
    await page.goto(`${BASE}${url}`, { waitUntil: 'domcontentloaded' })
    await settle(page)

    // 登录态被重定向 ⇒ 这一格没有证据，**不能**算 0 违规
    if (/\/login/.test(page.url())) {
      rows.push({ cell, verdict: 'NOT_TESTED', reason: `redirected to ${page.url()}` })
      console.log(`  – ${cell.padEnd(34)} NOT_TESTED（被重定向到登录）`)
      await ctx.close()
      continue
    }

    // 主题真值核对：只扫到"以为是纸面、其实是深色"的图，等于扫错了对象
    const themeState = await page.evaluate(() => {
      const el = document.querySelector('[data-lf-theme]')
      if (!el) return { theme: null, bg: null }
      return {
        theme: el.getAttribute('data-lf-theme'),
        bg: getComputedStyle(el).getPropertyValue('--lf-bg').trim(),
      }
    })
    if (themeState.theme !== combo.theme) {
      rows.push({ cell, verdict: 'FAIL', reason: `theme drift: attr=${themeState.theme} want=${combo.theme}` })
      console.log(`  ✗ ${cell.padEnd(34)} THEME_DRIFT attr=${themeState.theme}`)
      await ctx.close()
      continue
    }

    await page.addScriptTag({ content: AXE_SRC })
    const res = await page.evaluate(async () => {
      // @ts-expect-error axe 由上一行注入
      return await window.axe.run(document, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] },
        resultTypes: ['violations'],
      })
    })

    const violations = res.violations ?? []
    const blocking = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
    for (const v of violations) {
      const k = `${v.id}:${v.impact}`
      violationsByRule.set(k, (violationsByRule.get(k) ?? 0) + v.nodes.length)
    }

    rows.push({
      cell,
      theme: combo.theme,
      viewport: `${combo.viewport.width}x${combo.viewport.height}`,
      verdict: blocking.length === 0 ? 'PASS' : 'FAIL',
      violations: violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        nodes: v.nodes.length,
        sample: v.nodes[0]?.target?.join(' ') ?? '',
        help: v.help,
      })),
    })
    console.log(
      `  ${blocking.length === 0 ? '✓' : '✗'} ${cell.padEnd(34)} ${blocking.length === 0 ? 'PASS' : 'FAIL'}     违规=${violations.length}（serious+ = ${blocking.length}）`,
    )
    await ctx.close()
  }
}

await browser.close()

const pass = rows.filter((r) => r.verdict === 'PASS').length
const fail = rows.filter((r) => r.verdict === 'FAIL').length
const nt = rows.filter((r) => r.verdict === 'NOT_TESTED').length

console.log(`\n=== ${pass} PASS / ${fail} FAIL / ${nt} NOT_TESTED · 共 ${rows.length} 格 ===`)
if (violationsByRule.size > 0) {
  console.log('\n违规汇总（按规则）：')
  for (const [k, n] of [...violationsByRule.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(48)} nodes=${n}`)
  }
}

const reportPath = path.join(OUT, 'a11y-13screens.json')
fs.writeFileSync(reportPath, JSON.stringify({ base: BASE, rows, summary: { pass, fail, notTested: nt } }, null, 2))
console.log(`\n报告：${reportPath}`)

process.exit(fail === 0 ? 0 : 1)
