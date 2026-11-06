/**
 * V20.4 · Batch 2 · 13 屏 × 4 视口 × 2 主题 = 104 场景实测审计
 *
 * 与 v198-visual-audit.mjs 的**关键差异**（v198 的口径在 V20.4 下不成立）：
 *
 *   1) 主题不再靠 `colorScheme` 模拟。
 *      实测事实：`/workspace` 的 LivingShell 传了 `dualWorld`，`readThemeSnapshot()`
 *      在 dual 模式下**恒返回 'field'**（见 living-shell.tsx L69-78），
 *      `prefers-color-scheme: light` 对它完全无效 —— v198 用 colorScheme 拍的
 *      "light" 截图，实际 100% 还是 Deep Field。那是**文件名造假**，不是取证。
 *      V20.4 改为：context 预置 `localStorage['lf-theme']`，然后**双重断言**：
 *        · `[data-lf-theme]` 属性值 === 期望主题
 *        · 计算样式 `--lf-bg` === 该主题的真实色值（field #0b0e11 / paper #f7f5f0）
 *      只改属性不改样式、或只改样式不改属性，都会判 FAIL。
 *
 *   2) Console 七屏**不接** `--lf-*`（`console-shell.tsx` 只有 `data-lf-console`
 *      + Tailwind `bg-background`）。因此 Console 的主题维度判定为 `THEME_NA`，
 *      **不计入 PASS**，单独统计并在报告里标为设计一致性缺口。这是如实记录，
 *      不是把 104 格凑成 104 个绿。
 *
 *   3) Workspace 六屏改用**深链接** `?view=<key>` 直接进入，而不是点击页签。
 *      一来天然验证 G-03 的「分享深链接正确」，二来避免点击态/水合竞态污染截图。
 *
 * 用法：
 *   node scripts/qa/v204-visual-audit.mjs --base=http://127.0.0.1:3099 \
 *     --shot-dir=test-results/v204-visual --email=qa.male@lokfeel.test --pwd-file=/tmp/v204_qa_pwd
 *
 * 退出码：0 = 无 FAIL（允许 THEME_NA）；1 = 有 FAIL；2 = 环境前置失败（登录失败等）。
 */
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import path from 'node:path'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')

const argv = process.argv.slice(2)
const arg = (k, d = '') => {
  const hit = argv.find((a) => a.startsWith(`--${k}=`))
  return hit ? hit.slice(k.length + 3) : d
}

const BASE = arg('base', 'http://127.0.0.1:3099').replace(/\/$/, '')
const SHOT_DIR = arg('shot-dir', 'test-results/v204-visual')
const EMAIL = arg('email', 'qa.male@lokfeel.com')
const PWD_FILE = arg('pwd-file', '/tmp/v204_qa_pwd')
const PASSWORD = process.env.V204_QA_PASSWORD ?? readFileSync(PWD_FILE, 'utf8').trim()
/** all | console | workspace —— 增量复跑用（改断言后不必重跑全量 104 格） */
const ONLY = arg('only', 'all')

mkdirSync(SHOT_DIR, { recursive: true })

const VIEWPORTS = [
  ['360', { width: 360, height: 800 }],
  ['390', { width: 390, height: 844 }],
  ['768', { width: 768, height: 1024 }],
  ['1440', { width: 1440, height: 900 }],
]
const THEMES = ['field', 'paper']

/**
 * 主题 → `--lf-bg` 期望值。
 * 🔴 必须写成 **hex 字面量**：`getComputedStyle(el).getPropertyValue('--lf-bg')`
 *    返回的是自定义属性的**原文 token 值**（`#0b0e11`），不会解析成 `rgb()`。
 *    上一版这里写成 `rgb(11, 14, 17)`，导致比较器恒为空串、48 格全部误判 FAIL。
 */
const THEME_BG = {
  field: '#0b0e11', // globals.css L1722
  paper: '#f7f5f0', // globals.css L1754
}

const CONSOLE_SCREENS = [
  ['console-overview', '/console'],
  ['console-agents', '/console/agents'],
  ['console-connections', '/console/connections'],
  ['console-members', '/console/members'],
  ['console-missions', '/console/missions'],
  ['console-outcomes', '/console/outcomes'],
  ['console-settings', '/console/settings'],
]

/** Workspace 六屏：真实单路由 + ?view= 深链接（NAV 白名单内，missions 不可达） */
const WORKSPACE_VIEWS = ['now', 'studio', 'field', 'consent', 'outcomes', 'agents']

const results = []
function record(id, verdict, detail, extra = {}) {
  results.push({ id, verdict, detail, ...extra })
  const mark = verdict === 'PASS' ? '✓' : verdict === 'FAIL' ? '✗' : '□'
  console.log(`  ${mark} ${id.padEnd(30)} ${verdict.padEnd(8)} ${detail}`)
}

// ───────────── 登录（真实 API，非 UI 点击，避免水合竞态） ─────────────
const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: BASE },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  redirect: 'manual',
})
if (!login.ok) {
  const body = await login.text().catch(() => '')
  console.error(`✗ 登录失败 HTTP ${login.status} — ${body.slice(0, 200)}`)
  process.exit(2)
}
const setCookie = login.headers.getSetCookie().find((x) => /session-token/i.test(x))
if (!setCookie) {
  console.error('✗ 登录成功但未下发 session cookie')
  process.exit(2)
}
const cookiePair = setCookie.split(';')[0]
const [cookieName, ...cookieRest] = cookiePair.split('=')
const cookieValue = cookieRest.join('=')
console.log(`✓ 登录成功（${EMAIL}），cookie=${cookieName}\n`)

const browser = await chromium.launch({
  // 三选一：PW_EXECUTABLE（指定已缓存的 headless shell）> PW_CHANNEL（系统 Chrome）> 内置
  executablePath: process.env.PW_EXECUTABLE || undefined,
  channel: process.env.PW_EXECUTABLE ? undefined : process.env.PW_CHANNEL || undefined,
  // 本地网络有代理隧道，Workers/本机回环必须直连，否则 502
  args: ['--proxy-server=direct://', '--proxy-bypass-list=*'],
})

async function openCell(theme, viewport) {
  const ctx = await browser.newContext({ viewport, colorScheme: theme === 'paper' ? 'light' : 'dark' })
  await ctx.addCookies([
    {
      name: cookieName.trim(),
      value: cookieValue,
      domain: new URL(BASE).hostname,
      path: '/',
      httpOnly: true,
      // 生产 HTTPS 下 NextAuth 下发 __Secure- 前缀 cookie，Playwright 要求
      // 该前缀必须 secure:true；本地 http 则必须 false。按协议推导，别硬编码。
      secure: new URL(BASE).protocol === 'https:',
      sameSite: 'Lax',
    },
  ])
  // 主题真值来源：LivingShell 读 localStorage['lf-theme']
  await ctx.addInitScript((t) => {
    try {
      window.localStorage.setItem('lf-theme', t)
    } catch {
      /* localStorage 不可用则保持默认，后续断言会判 FAIL */
    }
  }, theme)
  const page = await ctx.newPage()
  const errors = []
  const failed = []
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text().slice(0, 200))
  })
  page.on('pageerror', (e) => errors.push(`pageerror:${String(e.message).slice(0, 160)}`))
  page.on('requestfailed', (r) => {
    const f = r.failure()?.errorText ?? ''
    // 第三方 beacon / 分析脚本在离线环境必失败，不计入（会单独说明）
    if (/cloudflareinsights|googletagmanager|google-analytics|sentry/i.test(r.url())) return
    failed.push(`${r.method()} ${r.url().slice(0, 110)} :: ${f.slice(0, 60)}`)
  })
  return { ctx, page, errors, failed }
}

/**
 * 内容就绪判据（沿用 v198 的三条教训，prod 下同样适用）：
 * 忙碌指示器消失 + 连续 3 次采样内容量不变 + 有 h1 或内容量充足。
 */
async function settle(page) {
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {})
  await page
    .waitForFunction(
      () => {
        const busy = document.querySelector('.animate-spin, .animate-pulse, [aria-busy="true"]')
        const main = document.querySelector('main') ?? document.body
        const len = (main.textContent ?? '').length
        const hasH1 = [...document.querySelectorAll('h1')].some((e) => e.textContent.trim())
        const g = (window.__lfSettle ??= { len: -1, stable: 0 })
        if (len === g.len) g.stable += 1
        else {
          g.len = len
          g.stable = 0
        }
        return !busy && g.stable >= 3 && (hasH1 || len > 200)
      },
      { timeout: 20_000, polling: 400 },
    )
    .catch(() => {})
  await page.waitForTimeout(250)
}

async function measure(page, expectTheme) {
  return page.evaluate(
    ({ expectedHex }) => {
      const de = document.documentElement
      const overflow = de.scrollWidth - de.clientWidth
      const main = document.querySelector('main') ?? document.body
      const len = (main.textContent ?? '').length
      const h1 = [...document.querySelectorAll('h1')].map((e) => e.textContent.trim()).filter(Boolean)

      // ── 主题双重断言 ──
      const themed = document.querySelector('[data-lf-theme]')
      const themeAttr = themed?.getAttribute('data-lf-theme') ?? null
      let themeBg = null
      if (themed) {
        // 自定义属性返回原文 token（hex），不做 rgb 归一
        themeBg = getComputedStyle(themed).getPropertyValue('--lf-bg').trim()
      }
      const expectedRgb = expectedHex

      // 触控目标：360/390 下 <24×24 记违规（display:inline 的句内链接豁免）
      const small = []
      for (const el of document.querySelectorAll('button, a[href], [role="button"], input, select, textarea')) {
        if (el.offsetParent === null) continue
        const r = el.getBoundingClientRect()
        if (r.width === 0 || r.height === 0) continue
        if (r.width < 24 || r.height < 24) {
          const style = getComputedStyle(el)
          if (style.display === 'inline' && el.tagName === 'A') continue
          const label = (el.textContent ?? el.getAttribute('aria-label') ?? '').trim().slice(0, 14)
          small.push(`${el.tagName}:${label}(${Math.round(r.width)}x${Math.round(r.height)})`)
        }
      }

      return { overflow, len, h1, themeAttr, themeBg, expectedRgb, small: small.slice(0, 8) }
    },
    { expectedHex: THEME_BG[expectTheme] },
  )
}

async function auditCell({ id, url, theme, viewport, vpName }) {
  const { ctx, page, errors, failed } = await openCell(theme, viewport)
  let shot = ''
  try {
    await page.goto(`${BASE}${url}`, { waitUntil: 'domcontentloaded', timeout: 45_000 })
    await settle(page)

    let m = await measure(page, theme)
    // 内容不足时重置静默期重采一次（瞬时慢 API 会量到骨架，重试后仍不足才算真 FAIL）
    if (m.len <= 60) {
      await page.evaluate(() => delete window.__lfSettle).catch(() => {})
      await settle(page)
      m = await measure(page, theme)
    }

    shot = path.join(SHOT_DIR, `${id}.png`)
    await page.screenshot({ path: shot, fullPage: false })

    const contentOk = m.len > 60
    const overflowOk = m.overflow <= 1
    const touchOk = !['360', '390'].includes(vpName) || m.small.length === 0
    const hasH1 = m.h1.length > 0

    // 主题判定：无 [data-lf-theme] ⇒ THEME_NA（Console 未接入 --lf-*）
    let themeVerdict = 'THEME_NA'
    let themeDetail = 'no [data-lf-theme] scope'
    if (m.themeAttr !== null) {
      const attrOk = m.themeAttr === theme
      const styleOk = m.themeBg === m.expectedRgb
      themeVerdict = attrOk && styleOk ? 'THEME_PASS' : 'THEME_FAIL'
      themeDetail = `attr=${m.themeAttr} --lf-bg=${m.themeBg} expect=${m.expectedRgb}`
    }

    const ok = contentOk && overflowOk && touchOk && hasH1 && themeVerdict !== 'THEME_FAIL'
    const detail = `overflow=${m.overflow}px len=${m.len} h1=${m.h1.length} | ${themeVerdict}(${themeDetail})` +
      (m.small.length ? ` | 触控<24:${m.small.join(';')}` : '') +
      (errors.length ? ` | consoleErr=${errors.length}` : '') +
      (failed.length ? ` | reqFail=${failed.length}` : '')

    record(id, ok ? 'PASS' : 'FAIL', detail, {
      theme: themeVerdict,
      overflow: m.overflow,
      len: m.len,
      h1: m.h1,
      shot,
      consoleErrors: errors.slice(0, 6),
      requestFailures: failed.slice(0, 6),
    })
  } catch (e) {
    record(id, 'FAIL', `sample-error: ${String(e.message).slice(0, 90)}`, { shot })
  }
  await ctx.close()
}

// ═════════════ Console 七屏 ═════════════
if (ONLY === 'all' || ONLY === 'console') {
  console.log('— Console 七屏 × 4 视口 × 2 主题 —')
  for (const [key, route] of CONSOLE_SCREENS) {
    for (const [vpName, viewport] of VIEWPORTS) {
      for (const theme of THEMES) {
        await auditCell({ id: `${key}-${vpName}-${theme}`, url: route, theme, viewport, vpName })
      }
    }
  }
}

// ═════════════ Workspace 六屏（深链接） ═════════════
if (ONLY === 'all' || ONLY === 'workspace') {
  console.log('\n— Workspace 六屏 × 4 视口 × 2 主题（?view= 深链接）—')
  for (const view of WORKSPACE_VIEWS) {
    for (const [vpName, viewport] of VIEWPORTS) {
      for (const theme of THEMES) {
        await auditCell({
          id: `ws-${view}-${vpName}-${theme}`,
          url: `/workspace?view=${view}`,
          theme,
          viewport,
          vpName,
        })
      }
    }
  }
}

await browser.close()

// ───────────── 汇总 ─────────────
const total = results.length
const fails = results.filter((r) => r.verdict === 'FAIL')
const passes = results.filter((r) => r.verdict === 'PASS')
const themeNA = results.filter((r) => r.theme === 'THEME_NA')
const themePass = results.filter((r) => r.theme === 'THEME_PASS')
const themeFail = results.filter((r) => r.theme === 'THEME_FAIL')

const summary = {
  base: BASE,
  only: ONLY,
  generatedAt: new Date().toISOString(),
  cells: total,
  expectedCells: ONLY === 'all' ? 13 * 4 * 2 : ONLY === 'console' ? 7 * 4 * 2 : 6 * 4 * 2,
  pass: passes.length,
  fail: fails.length,
  theme: { pass: themePass.length, na: themeNA.length, fail: themeFail.length },
  failIds: fails.map((f) => f.id),
  themeFailIds: themeFail.map((f) => f.id),
  // 请求失败样本（用于定位控制台错误来源，不是门禁）
  requestFailureSamples: results.flatMap((r) => r.requestFailures ?? []).slice(0, 12),
  consoleErrorSamples: results.flatMap((r) => r.consoleErrors ?? []).slice(0, 12),
}
const outName = ONLY === 'all' ? 'visual-results.json' : `visual-results-${ONLY}.json`
writeFileSync(path.join(SHOT_DIR, outName), JSON.stringify({ summary, results }, null, 2))

console.log(
  `\n=== 汇总 ${passes.length} PASS / ${fails.length} FAIL / 共 ${total} 格（期望 ${summary.expectedCells}）===`,
)
console.log(`    主题：PASS ${themePass.length} · N/A ${themeNA.length} · FAIL ${themeFail.length}`)
console.log(`    报告：${path.join(SHOT_DIR, outName)}`)
if (fails.length) process.exit(1)
if (total !== summary.expectedCells) {
  console.error(`✗ 场景数 ${total} ≠ ${summary.expectedCells}，取证不完整`)
  process.exit(1)
}
process.exit(0)
