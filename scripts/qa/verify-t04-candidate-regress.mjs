/**
 * T04 候选页回归取证（**不依赖登录页 UI**）
 *
 * 为什么需要它：
 *   `tests/e2e/candidate-match.spec.ts` 的第 2/3 例用 `loginViaUi()` 走**真实登录页**。
 *   在 dev（Turbopack 冷编译 + 8G 内存）下，登录页的受控组件在 hydration 完成前
 *   接受 `fill()` 却不会让 React state 更新 → 提交时前端校验报
 *   "Please enter your email and password."，于是 3 次重试都拿不到 session-token，
 *   用例卡在 `expect(cookies).toHaveProperty('session-token')`（实测连续 2 轮复现）。
 *   这是**登录页的脆弱性**，与候选页断言无关 —— 它根本没执行到候选页。
 *
 * 本脚本把"登录方式"这个无关变量消除掉（改用与 T05 `authedContext` 相同的手法：
 * `ctx.request.post('/api/auth/login')` 共享 cookie 罐），只复验**T05 真正改动的那一处**：
 *   `candidate-match.spec.ts` 的 ④ —— T04 的 `matches-connect-coming` 已换成
 *   `matches-connect-note` + `matches-view-proposals`，且普通成员**不得**出现
 *   `propose-open`（发起连接是运营动作 proposal.create）。
 * 同时把候选页的核心断言（依据含命中原词、双向互补正文、档案档位、无横向滚动）一并复跑。
 *
 * 用法（先起 dev 服务器并 seed）：
 *   E2E_BASE_URL=http://localhost:3102 E2E_MISSION_TOKEN=... \
 *   E2E_MEMBER_EMAIL=... E2E_PASSWORD=... \
 *   node scripts/qa/verify-t04-candidate-regress.mjs
 *
 * 退出码：0 全通过 / 1 有断言失败 / 2 登录失败 / 3 脚本异常。
 */

import { chromium, devices } from 'playwright'

const BASE = process.env.E2E_BASE_URL || 'http://localhost:3102'
const TOKEN = process.env.E2E_MISSION_TOKEN || 'e2eActiveTokenAbcdefghijklmnop'
const EMAIL = process.env.E2E_MEMBER_EMAIL || 'e2e.member@example.test'
const PASSWORD = process.env.E2E_PASSWORD || 'E2E-Test-Passw0rd!'

const PEER_NAME = process.env.E2E_PEER_NAME || '陈岸'
const PEER_CITY = process.env.E2E_PEER_CITY || '雅加达'

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`)
}

const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const ctx = await browser.newContext({ ...devices['Pixel 5'], channel: 'chrome' })

  // ── 登录：打同源端点（带 Origin，同源守卫要它），不加载任何页面 ──
  const login = await ctx.request.post(`${BASE}/api/auth/login`, {
    headers: { origin: BASE },
    data: { email: EMAIL, password: PASSWORD },
  })
  const hasSession = (await ctx.cookies()).some((c) => c.name.includes('session-token'))
  check('登录成功（session-token 已落 ctx）', hasSession, `HTTP ${login.status()}`)
  if (!hasSession) {
    console.log('无法继续：登录失败')
    await browser.close()
    process.exit(2)
  }

  const page = await ctx.newPage()
  await page.goto(`${BASE}/m/${TOKEN}/matches`, { waitUntil: 'domcontentloaded' })

  await page.getByTestId('matches-page').waitFor({ state: 'visible', timeout: 60_000 })
  await page.getByTestId('matches-list').waitFor({ state: 'visible', timeout: 30_000 })
  check('候选页渲染（matches-page + matches-list）', true)

  check('无候选空态未出现', (await page.getByTestId('matches-empty').count()) === 0)

  const cardCount = await page.getByTestId('match-card').count()
  check('候选卡数量 = 1', cardCount === 1, `count=${cardCount}`)

  const card = page.getByTestId('match-card').first()

  const evidence = await card.getByTestId('match-evidence').innerText()
  check('依据含「你」「对方」', evidence.includes('你') && evidence.includes('对方'))
  check('依据引用命中原词（清关 / 分销）', evidence.includes('清关') && evidence.includes('分销'))

  const needText = await card.getByTestId('match-need').innerText()
  const offerText = await card.getByTestId('match-offer').innerText()
  check('need 正文含「分销渠道」', needText.includes('分销渠道'))
  check('offer 正文含「清关与仓储」', offerText.includes('清关与仓储'))

  const profile = await card.getByTestId('match-profile').innerText()
  check(`档案含昵称 ${PEER_NAME}`, profile.includes(PEER_NAME))
  check(`档案含城市 ${PEER_CITY}`, profile.includes(PEER_CITY))
  check('档案用中文标签（昵称 / 城市）', profile.includes('昵称') && profile.includes('城市'))

  // ── ④ T05 改动后的三条断言（本次回归的核心）──
  check(
    '④ matches-connect-note 可见',
    await page.getByTestId('matches-connect-note').isVisible().catch(() => false)
  )
  check(
    '④ matches-view-proposals 可见',
    await page.getByTestId('matches-view-proposals').isVisible().catch(() => false)
  )
  const proposeOpen = await page.getByTestId('propose-open').count()
  check('④ propose-open 不存在（普通成员看不到发起按钮）', proposeOpen === 0, `count=${proposeOpen}`)

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  )
  check('移动端无横向滚动（overflow ≤ 1）', overflow <= 1, `overflow=${overflow}`)

  await browser.close()
} catch (err) {
  console.error('脚本异常：', err)
  await browser.close()
  process.exit(3)
}

const failed = results.filter((r) => !r.ok)
console.log(`\n结果：${results.length - failed.length}/${results.length} 通过`)
process.exit(failed.length === 0 ? 0 : 1)
