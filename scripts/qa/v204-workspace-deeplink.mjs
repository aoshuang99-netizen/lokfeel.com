/**
 * V20.4 · Batch 2 · G-03 Continuity 深链接专项验收
 *
 * 对应攻坚令「重点验证 G-03」的 6 条：
 *   1. 六屏切换 URL 正确
 *   2. 刷新后恢复当前屏
 *   3. 浏览器前进/后退正确
 *   4. 分享深链接正确
 *   5. 非法 view 参数安全回退
 *   6. 未开放 Missions 不伪装可用
 *
 * 判据一律取「真实浏览器状态」，不看文件、不看源码：
 *   · 当前屏 = `[aria-label="工作区导航"] [aria-current="page"]` 的可见文本
 *   · URL   = `window.location.pathname + search`
 *
 * 用法：
 *   node scripts/qa/v204-workspace-deeplink.mjs --base=http://127.0.0.1:3099 \
 *     --email=qa.male@lokfeel.test --pwd-file=/tmp/v204_qa_pwd
 *
 * 退出码：0 = 全部 PASS；1 = 有 FAIL；2 = 环境前置失败。
 */
import { createRequire } from 'node:module'
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')

const argv = process.argv.slice(2)
const arg = (k, d = '') => {
  const hit = argv.find((a) => a.startsWith(`--${k}=`))
  return hit ? hit.slice(k.length + 3) : d
}

const BASE = arg('base', 'http://127.0.0.1:3099').replace(/\/$/, '')
const OUT_DIR = arg('out-dir', 'test-results/v204-deeplink')
const EMAIL = arg('email', 'qa.male@lokfeel.com')
const PWD_FILE = arg('pwd-file', '/tmp/v204_qa_pwd')
const PASSWORD = process.env.V204_QA_PASSWORD ?? readFileSync(PWD_FILE, 'utf8').trim()

mkdirSync(OUT_DIR, { recursive: true })

/** view key → 导航里可见文案（NAV 定义见 living-workspace.tsx） */
const LABELS = {
  now: 'Now',
  studio: 'Studio',
  field: 'Field',
  consent: 'Consent',
  outcomes: 'Outcomes',
  agents: 'Agents',
}
const VIEWS = Object.keys(LABELS)

const results = []
function check(id, ok, detail) {
  results.push({ id, verdict: ok ? 'PASS' : 'FAIL', detail })
  console.log(`  ${ok ? '✓' : '✗'} ${id.padEnd(34)} ${detail}`)
}

// ───────── 登录 ─────────
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
const sc = login.headers.getSetCookie().find((x) => /session-token/i.test(x))
const [cName, ...cRest] = sc.split(';')[0].split('=')
console.log('✓ 登录成功\n')

const browser = await chromium.launch({
  executablePath: process.env.PW_EXECUTABLE || undefined,
  channel: process.env.PW_EXECUTABLE ? undefined : process.env.PW_CHANNEL || undefined,
  args: ['--proxy-server=direct://', '--proxy-bypass-list=*'],
})
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await ctx.addCookies([
  {
    name: cName.trim(),
    value: cRest.join('='),
    domain: new URL(BASE).hostname,
    path: '/',
    httpOnly: true,
    // 生产 HTTPS 下 NextAuth 下发 __Secure- 前缀 cookie，Playwright 要求
    // 该前缀必须 secure:true；本地 http 则必须 false。按协议推导，别硬编码。
    secure: new URL(BASE).protocol === 'https:',
    sameSite: 'Lax',
  },
])
await ctx.addInitScript(() => {
  try {
    window.localStorage.setItem('lf-theme', 'field')
  } catch {
    /* noop */
  }
})
const page = await ctx.newPage()

/** 等水合 + 导航就绪（点击前必须确认 React 已接管，否则是原生 GET 提交） */
async function waitHydrated() {
  await page
    .waitForFunction(
      () => {
        const nav = document.querySelector('[aria-label="工作区导航"]')
        if (!nav) return false
        const key = Object.keys(nav).find((k) => k.startsWith('__reactFiber$'))
        return Boolean(key)
      },
      { timeout: 30_000, polling: 200 },
    )
    .catch(() => {})
}

async function currentView() {
  // evaluate 在页面导航中被挂住时不会 reject，必须自己上闸（5s）
  const probe = page.evaluate(() => {
    const nav = document.querySelector('[aria-label="工作区导航"]')
    const cur = nav?.querySelector('[aria-current="page"]')
    const text = cur?.textContent?.trim() ?? null
    return { text, href: window.location.pathname + window.location.search }
  })
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('currentView timeout(5s)')), 5000),
  )
  return Promise.race([probe, timeout])
}

async function waitView(view, timeout = 8000) {
  const label = LABELS[view]
  return page
    .waitForFunction(
      (l) => {
        const nav = document.querySelector('[aria-label="工作区导航"]')
        return nav?.querySelector('[aria-current="page"]')?.textContent?.trim() === l
      },
      label,
      { timeout, polling: 200 },
    )
    .then(() => true)
    .catch(() => false)
}

async function gotoWorkspace(view) {
  const url = view ? `${BASE}/workspace?view=${view}` : `${BASE}/workspace`
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 })
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {})
  await waitHydrated()
  await page.waitForTimeout(400)
}

// ═════ 1. 分享深链接：直接打开 ?view=X 必须落到 X ═════
console.log('— 1. 深链接直达（分享场景）—')
for (const view of VIEWS) {
  await gotoWorkspace(view)
  const ok = await waitView(view)
  const cur = await currentView()
  // `now` 是默认屏：URL 不带 view、或显式 `view=now` 都算正确。
  // 只有「active 与 view 不一致」才是真 FAIL —— 规范化（去掉冗余 now）是 P3 建议，不是门禁。
  const urlOk =
    view === 'now'
      ? !/[?&]view=/.test(cur.href) || /[?&]view=now(&|$)/.test(cur.href)
      : cur.href.includes(`view=${view}`)
  check(`deeplink-${view}`, ok && urlOk, `active=${cur.text} url=${cur.href}`)
}

// ═════ 2. 点击切换后 URL 必须正确 ═════
console.log('\n— 2. 点击切换 → URL 同步 —')
await gotoWorkspace('now')
for (const view of VIEWS) {
  if (view === 'now') continue
  const nav = page.locator('[aria-label="工作区导航"]').getByText(LABELS[view], { exact: true }).first()
  const clicked = await nav.click({ timeout: 8000 }).then(() => true).catch(() => false)
  if (!clicked) {
    check(`click-${view}`, false, '导航项不可点击')
    continue
  }
  const activeOk = await waitView(view)
  const cur = await currentView()
  const urlOk = cur.href.includes(`view=${view}`)
  const pushed = await page.evaluate(() => Boolean(window.history.state?.lfWorkspaceView))
  check(`click-${view}`, activeOk && urlOk && pushed, `active=${cur.text} url=${cur.href} state=${pushed}`)
}

// ═════ 3. 刷新恢复当前屏 ═════
console.log('\n— 3. 刷新后恢复 —')
await gotoWorkspace('outcomes')
await waitView('outcomes')
await page.reload({ waitUntil: 'domcontentloaded', timeout: 45_000 })
await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {})
await waitHydrated()
const restored = await waitView('outcomes')
const restoredCur = await currentView()
check('reload-restore-outcomes', restored, `active=${restoredCur.text} url=${restoredCur.href}`)

// ═════ 4. 前进 / 后退 ═════
console.log('\n— 4. 浏览器前进/后退 —')
await gotoWorkspace('now')
await waitView('now')
const seq = ['studio', 'field', 'agents']
for (const v of seq) {
  const nav = page.locator('[aria-label="工作区导航"]').getByText(LABELS[v], { exact: true }).first()
  await nav.click({ timeout: 8000 }).catch(() => {})
  await waitView(v)
}
const afterForwardSeq = await currentView()
await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {})
await page.waitForTimeout(500)
const back1 = await waitView('field')
const back1Cur = await currentView()
check('history-back-field', back1, `active=${back1Cur.text} url=${back1Cur.href}（点击序列末=${afterForwardSeq.text}）`)

await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {})
await page.waitForTimeout(500)
const back2 = await waitView('studio')
const back2Cur = await currentView()
check('history-back-studio', back2, `active=${back2Cur.text} url=${back2Cur.href}`)

await page.goForward({ waitUntil: 'domcontentloaded' }).catch(() => {})
await page.waitForTimeout(500)
const fwd = await waitView('field')
const fwdCur = await currentView()
check('history-forward-field', fwd, `active=${fwdCur.text} url=${fwdCur.href}`)

// ═════ 5. 非法 view 安全回退 ═════
console.log('\n— 5. 非法 view 安全回退 —')
const BADS = [
  ['missions', '未开放页签'],
  ['../../etc/passwd', '路径穿越串'],
  ['<script>alert(1)</script>', 'XSS 串'],
  ['NOW', '大小写变体'],
  ['', '空值'],
]
for (const [bad, desc] of BADS) {
  const q = bad === '' ? '?view=' : `?view=${encodeURIComponent(bad)}`
  // 每项独立 try/catch + 20s 上限：非法串可能让浏览器侧导航进入异常态，
  // 不能让它把整个 22 项验收挂死（实测 ?view=<script> 会卡住 evaluate）。
  try {
    await page.goto(`${BASE}/workspace${q}`, { waitUntil: 'domcontentloaded', timeout: 20_000 })
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {})
    await waitHydrated()
    await page.waitForTimeout(400)
    const cur = await currentView()
    const fellBack = cur.text === LABELS.now
    // 非法值不得被当作有效视图（不出现对应 aria-current），页面不得崩（内容仍在）
    const alive = await page.evaluate(
      () => Boolean(document.querySelector('h1')?.textContent?.trim() || document.body.textContent.length > 200),
    )
    check(`invalid-${desc}`, fellBack && alive, `active=${cur.text} url=${cur.href} alive=${alive}`)
  } catch (e) {
    // 导航层异常本身也算失败证据：说明「安全回退」在真实浏览器里不成立
    check(`invalid-${desc}`, false, `导航异常: ${String(e.message).slice(0, 80)}`)
    await page.goto(`${BASE}/workspace`, { waitUntil: 'domcontentloaded', timeout: 20_000 }).catch(() => {})
  }
}

// ═════ 6. 未开放 Missions 不伪装可用 ═════
console.log('\n— 6. Missions 不可达 —')
await gotoWorkspace('now')
const missionsProbe = await page.evaluate(() => {
  const nav = document.querySelector('[aria-label="工作区导航"]')
  const items = [...(nav?.querySelectorAll('a, button, [role="button"]') ?? [])].map((e) => ({
    text: (e.textContent ?? '').trim(),
    disabled: e.hasAttribute('disabled') || e.getAttribute('aria-disabled') === 'true',
    href: e.getAttribute('href') ?? '',
  }))
  return items
})
const missionsItem = missionsProbe.find((i) => /mission/i.test(i.text))
// 期望：要么根本没有 Missions 项，要么存在但明确 disabled 且无有效 href
const notFake = !missionsItem || missionsItem.disabled || !missionsItem.href || missionsItem.href === '#'
check('missions-not-fake', notFake, `item=${JSON.stringify(missionsItem ?? null)}`)

await page.goto(`${BASE}/workspace?view=missions`, { waitUntil: 'domcontentloaded', timeout: 45_000 })
await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {})
await waitHydrated()
const missionsCur = await currentView()
check('missions-view-fallback', missionsCur.text === LABELS.now, `active=${missionsCur.text} url=${missionsCur.href}`)

await browser.close()

const fails = results.filter((r) => r.verdict === 'FAIL')
writeFileSync(
  path.join(OUT_DIR, 'deeplink-results.json'),
  JSON.stringify({ base: BASE, generatedAt: new Date().toISOString(), results }, null, 2),
)
console.log(`\n=== ${results.length - fails.length} PASS / ${fails.length} FAIL（共 ${results.length} 项）===`)
if (fails.length) {
  console.log('失败项：', fails.map((f) => f.id).join(', '))
  process.exit(1)
}
process.exit(0)
