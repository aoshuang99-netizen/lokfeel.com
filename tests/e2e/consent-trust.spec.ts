/**
 * T05 · 双边同意 / 撤回 / 介绍 —— 移动端 E2E（AC-04 / AC-05 / AC-06 的浏览器证据）
 *
 * 与 `candidate-match.spec.ts` 同源：`playwright.t02.config.ts`（Pixel 5 视口 +
 * **系统真实 Chrome**，因为本机 Playwright 自带 chromium 在 macOS 13 不受支持）。
 *
 * ⚠️ **串行执行**（`test.describe.serial`）：本文件的多条用例**有意**共享一条状态演化链，
 *   因为它们要证的正是"状态怎么变"：
 *     cp_e2e_mine   单方同意 → 仍待决（AC-04）
 *     cp_e2e_pending 双方同意 → 仍未介绍 → 运营介绍 → 已建立 → 重复介绍 409（AC-06）
 *     cp_e2e_decline 拒绝 → 终态「已拒绝」（AC-05 的"拒绝"腿）
 *     cp_e2e_mutual  同意之后撤回 → 终态「已撤回」（AC-05 的"撤销"腿）
 *   若把每步拆成独立用例并各自重置数据库，就只能测"初始渲染"，测不到这条链。
 *   代价是前一环失败会级联 —— 因此每条断言都写明了"它证的是哪一件事"。
 *
 * ── 登录方式（为什么不用 `loginViaUi` 点表单）──────────────────────────────
 *   T02/T03/T04 的 spec 用"真实 UI 登录"是有意义的：那三条用例的链路本就含登录页。
 *   本文件不同 —— 它证的是**同意状态机**，而 UI 登录在 dev 下会引入一类与业务无关的
 *   抖动：登录页的客户端组件把 `/api/auth/login` 的请求硬编码了 **10s 超时**
 *   （`login-inner-client.tsx`），而 dev 冷编译 + 本机 8G 内存下首次 POST 实测可超 10s；
 *   一旦被中断就**不会**产生任何服务端日志（表现为"点了没反应"），排障成本极高。
 *   因此这里改为：**在页面同源上下文里直接调同一个登录端点**（`/api/auth/login`），
 *   拿到会话 cookie 再去驱动被测页面。登录路径本身已由 T02/T03/T04 的 spec 覆盖。
 *
 * 运行前置：
 *   node scripts/qa/seed-t02-e2e.mjs --regenerate
 *   node scripts/qa/seed-t04-e2e.mjs
 *   node scripts/qa/seed-t05-e2e.mjs
 *   DATABASE_URL=file:/tmp/t02-e2e.db npx next dev -p 3102
 *   E2E_BASE_URL=http://localhost:3102 E2E_T05_MISSION_TOKEN=... \
 *   E2E_MEMBER_EMAIL=... E2E_OP_EMAIL=... E2E_PASSWORD=... \
 *   npx playwright test -c playwright.t02.config.ts tests/e2e/consent-trust.spec.ts
 */

import { test, expect, type Page, type Browser, type BrowserContext } from '@playwright/test'

const BASE_URL = process.env.E2E_BASE_URL || 'https://app.lokfeel.com'
const TOKEN = process.env.E2E_T05_MISSION_TOKEN || ''
const MEMBER_EMAIL = process.env.E2E_MEMBER_EMAIL || ''
const OP_EMAIL = process.env.E2E_OP_EMAIL || ''
const PASSWORD = process.env.E2E_PASSWORD || ''

/** 与 `scripts/qa/seed-t05-e2e.mjs` 的 RATIONALE 必须逐字一致（用于定位卡片）。 */
const RATIONALE = {
  pending: '你们互补：他在找东南亚清关，你有雅加达落地资源。',
  mine: '你们互补：你需要分销，他能给分销。',
  mutual: '你们互补：他需要印尼渠道，你有印尼渠道。',
  intro: '你们互补：他需要合规材料，你有现成模板。',
  rejected: '你们互补：他需要冷链，你有冷链。',
  decline: '你们互补：他需要品牌设计，你有品牌设计。',
}

/** 与夹具逐字一致的负测哨兵（刻意重复一遍，好让"夹具改了断言没改"在 review 里显眼）。 */
const SENTINELS = {
  opEmail: 'e2e.op@example.test',
  peerBio: '十年印尼落地经验',
  peerAge: 47,
  t05bBio: '这段自述只给组织者看',
  t05bAge: 53,
  t05bName: '霍岩',
  t05aBio: '发起方不宜外泄的自述',
}

test.skip(!TOKEN, '未提供 E2E_T05_MISSION_TOKEN：T05 提案 E2E 夹具未就绪')

/**
 * 预热动态度端点（与 T02/T03/T04 同源的原因）：Turbopack dev 首次请求才现场编译，
 * 冷编译会把断言窗口吃掉，表现为"服务端其实 200、客户端已超时"的假失败。
 *
 * ⚠️ 登录端点用**带 Origin 的请求**预热：不带时会被同源守卫直接 403 掉，
 * 那样只编译了路由外壳，守卫之后的 bcrypt + 数据库路径仍是冷的。
 */
test.beforeAll(async () => {
  const warm = async (path: string, init?: RequestInit) => {
    try {
      const res = await fetch(`${BASE_URL}${path}`, init ?? { method: 'GET' })
      await res.text()
    } catch {
      /* 预热失败不阻断：UI 用例会给出真实结论 */
    }
  }
  const json: HeadersInit = { 'Content-Type': 'application/json' }
  await warm('/api/auth/login', {
    method: 'POST',
    headers: { ...json, origin: BASE_URL },
    body: JSON.stringify({ email: 'warmup@invalid.test', password: 'Warmup-Only-Not-Real' }),
  })
  await warm('/api/auth/session')
  await warm('/api/v1/connections/proposals')
  // ⚠️ **写路由也必须预热**（这一条是踩坑后补的）：实测**首个**写请求的现场编译
  //    耗时 **68 秒** ——`POST /api/v1/connections/{id}/consent 200 in 68s (next.js: 67s)`。
  //    慢的是框架编译、不是业务代码，但它足以吃掉任何"等界面反馈"的断言窗口。
  //    这里**不带凭据**调用：得到 401，而 401 发生在业务代码之前，
  //    因此**不会写任何数据**，但路由模块已经被编译好了 —— 这正是我们要的。
  for (const path of [
    '/api/v1/connections/cp_e2e_mine/consent',
    '/api/v1/connections/cp_e2e_mine/revoke',
    '/api/v1/connections/cp_e2e_pending/introduce',
  ]) {
    await warm(path, { method: 'POST', headers: { ...json, origin: BASE_URL }, body: '{}' })
  }
  await warm('/api/v1/connections/introductions')
  // RSC 页面：未登录会 307 到 /login，但页面模块已被编译
  await warm(`/m/${TOKEN}/proposals`)
})

/**
 * 建立已登录的 context。**不导航到 /login** —— 原因见下。
 *
 * 前一版沿用了 T02/T03/T04 的"进登录页 + 在页面里 fetch 登录端点"写法，在 T05 实测太贵：
 *   ① 登录页在 dev 下要现场编译（实测 `GET /login 200 in 13.9s`）；
 *   ② 更糟的是**登录成功后登录页自己会跳去 `/dashboard/connections`** ——
 *      那是另一张重页面，又搭进去十几秒，而且与本用例要证的东西毫无关系
 *      （dev 日志里能直接看到这一跳）。
 *
 * 改法：`browserContext.request` **共享本上下文的 cookie 罐**，所以直接打
 * `/api/auth/login` 拿到的 `Set-Cookie` 会落进 ctx —— 后续 `ctx.newPage()` 的导航
 * 天然就是已登录态，全程**不需要加载任何 HTML 页面**。
 *
 * 打的是**同一个端点**、带同一个 `Origin`（同源守卫要它），因此并没有绕过被测逻辑：
 * 只是把"用页面当 fetch 容器"这件无关的事省掉了。
 */
async function authedContext(
  browser: Browser,
  email: string,
  password: string
): Promise<{ ctx: BrowserContext; page: Page }> {
  if (!email || !password) throw new Error('缺少 E2E 账号环境变量')
  const ctx = await browser.newContext()

  const res = await ctx.request.post(`${BASE_URL}/api/auth/login`, {
    headers: { origin: BASE_URL },
    data: { email, password },
  })

  const cookies = await ctx.cookies()
  if (!cookies.some((c) => c.name.includes('session-token'))) {
    throw new Error(`登录失败（HTTP ${res.status()}）—— 检查夹具账号与 E2E_PASSWORD`)
  }

  const page = await ctx.newPage()
  return { ctx, page }
}

/** 按推荐理由定位卡片（理由文本在夹具里唯一）。 */
function cardBy(page: Page, rationale: string) {
  return page.getByTestId('proposal-card').filter({ hasText: rationale })
}

/**
 * 打开提案页并等到主分区渲染出来。
 * ⚠️ 刻意**不用** `networkidle`（dev 下 HMR 长连接让它永不达成，T02/T03/T04 都踩过）。
 */
async function openProposals(page: Page) {
  await page.goto(`${BASE_URL}/m/${TOKEN}/proposals`, { waitUntil: 'domcontentloaded' })
  await expect(async () => {
    await expect(page.getByTestId('proposals-page')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByTestId('proposals-pending')).toBeVisible({ timeout: 5_000 })
  }).toPass({ timeout: 120_000 })
}

/**
 * 对一个提案执行动作（accept / reject / revoke），然后核对它造成的**持久**变化。
 *
 * ⚠️ 为什么**不**写"点击 → 断言成功提示文案" —— 两个互相独立的坑都踩过：
 *
 *   ① **终态动作的提示会被刷新卸载。** 动作成功后页面 `router.refresh()`，而闭合的卡片
 *      **不再渲染动作区**（`page.tsx` 里 `actions.length > 0` 才渲染 `ProposalActions`），
 *      那条"已关闭"的提示随刷新消失 —— 断言它等于在抢一个瞬态 DOM。
 *      第一版实测：服务端其实已 200、库里 `status` 已是 `REJECTED`，提示却没被捕捉到。
 *   ② **首个写请求在 dev 下可能现场编译到 68 秒。** 实测指纹：
 *      `POST /api/v1/connections/{id}/consent 200 in 68s (next.js: 67s, application-code: 1157ms)`
 *      —— 慢的是框架编译，不是业务代码。再宽的"等提示出现"窗口也可能不够，
 *      而**等 POST 的响应**天然不受编译耗时影响。
 *
 * 因此锚点取 **POST 的响应**，判据取 **重载之后依然成立**的事实。
 *
 * 两阶段设计（而不是把整个流程塞进一个 `toPass`）：
 *   - **阶段一**只负责"让动作真的发出去并拿到响应"，失败就重试 —— 它很便宜
 *     （不重载页面），所以可以重试很多次；
 *   - **阶段二**只做**一次**重载 + 断言 —— 由阶段一保证动作已发生，这里无需再重试。
 *
 * 阶段一为什么需要重试：点击可能落在 **hydration 完成之前**（Playwright 的 click
 * 只等"可见/可用"，不等 React 把 onClick 挂上），此时点了个寂寞、没有任何请求。
 * `409` 不算失败：重试时动作可能已经生效过 —— 那正是我们要的结果。
 */
async function actOnProposal(
  page: Page,
  rationale: string,
  action: 'accept' | 'reject' | 'revoke',
  after: { state: string; hint?: string }
) {
  // ── 阶段一：确保动作发出并返回 ──
  await expect(async () => {
    // 先挂监听再点，避免响应比监听先到（waitForResponse 漏掉已发生的事件）。
    const waiter = page
      .waitForResponse(
        (r) => r.request().method() === 'POST' && r.url().includes('/api/v1/connections/'),
        { timeout: 120_000 }
      )
      .catch(() => null)
    await cardBy(page, rationale).getByTestId(`proposal-action-${action}`).click()
    const resp = await waiter
    if (!resp) throw new Error('点击后未观察到 POST 响应（可能落在 hydration 之前），重试')
    expect([200, 409]).toContain(resp.status())
  }).toPass({ timeout: 300_000 })

  // ── 阶段二：重载一次，核对持久状态 ──
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(cardBy(page, rationale).getByTestId('proposal-state')).toContainText(after.state, {
    timeout: 30_000,
  })
  if (after.hint) {
    await expect(cardBy(page, rationale).getByTestId('proposal-hint')).toContainText(after.hint, {
      timeout: 30_000,
    })
  }
}

test.describe.serial('T05 · 双边同意 / 撤回 / 介绍（移动端 · AC-04 / AC-05 / AC-06）', () => {
  test('🔒 匿名访问提案页 → 重定向到登录（提案是成员数据）', async ({ page }) => {
    await page.goto(`${BASE_URL}/m/${TOKEN}/proposals`, { waitUntil: 'domcontentloaded' })

    expect(page.url()).toContain('/login')
    expect(decodeURIComponent(page.url())).toContain(`/m/${TOKEN}/proposals`)
    await expect(page.getByTestId('proposal-card')).toHaveCount(0)
  })

  test('✅ 分区渲染：待处理 / 已建立 / 已结束，且文案不把「双方同意」说成「已连接」', async ({
    browser,
  }) => {
    // 整页 6 张卡片 + 6 次档案投影；dev 下实测 1.2–2.2 分钟。
    test.setTimeout(300_000)
    const { ctx, page } = await authedContext(browser, MEMBER_EMAIL, PASSWORD)

    await openProposals(page)

    const pending = page.getByTestId('proposals-pending').getByTestId('proposal-card')
    const connections = page.getByTestId('proposals-connections').getByTestId('proposal-card')
    const closed = page.getByTestId('proposals-closed').getByTestId('proposal-card')

    // 待处理 4 条：待我回应的（decline）、我作为发起方的（mine）、
    // 对方已同意等我回应的（pending）、双方已同意但尚未介绍的（mutual）
    await expect(pending).toHaveCount(4)
    // 已建立连接 1 条：只有**真正被介绍**的才在这里
    await expect(connections).toHaveCount(1)
    // 已结束 1 条（REJECTED）
    await expect(closed).toHaveCount(1)

    // ① 待我回应：state 文案不能是"已同意"，并且提示要说明单方同意不够
    const pendingCard = cardBy(page, RATIONALE.pending)
    await expect(pendingCard.getByTestId('proposal-state')).toContainText('待你回应')
    await expect(pendingCard.getByTestId('proposal-hint')).toContainText('单方同意不会产生介绍')
    await expect(pendingCard.getByTestId('proposal-counterpart-decision')).toContainText('已同意')

    // ② 我是发起方
    const mineCard = cardBy(page, RATIONALE.mine)
    await expect(mineCard.getByTestId('proposal-my-role')).toContainText('发起方')
    await expect(mineCard.getByTestId('proposal-counterpart-decision')).toContainText('尚未回应')

    // ③ 「双方已同意」≠「已建立连接」—— 这条区分是 AC-04 的界面判据
    const mutualCard = cardBy(page, RATIONALE.mutual)
    await expect(mutualCard.getByTestId('proposal-state')).toContainText('双方已同意')
    await expect(mutualCard.getByTestId('proposal-state')).not.toContainText('已建立连接')
    await expect(mutualCard).toHaveAttribute('data-introduced', 'false')

    // ④ 已建立的那条
    const introCard = cardBy(page, RATIONALE.intro)
    await expect(introCard.getByTestId('proposal-state')).toContainText('已建立连接')
    await expect(introCard).toHaveAttribute('data-introduced', 'true')

    // ⑤ 终态卡片**不再提供任何动作**（终态不可逆）
    await expect(closed.first().getByTestId('proposal-actions')).toHaveCount(0)

    // ⑥ 移动端：无横向滚动
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    )
    expect(overflow).toBeLessThanOrEqual(1)

    await ctx.close()
  })

  test('★AC-04 单方同意 → 仍是待决（不产生介绍）', async ({ browser }) => {
    test.setTimeout(360_000)
    const { ctx, page } = await authedContext(browser, MEMBER_EMAIL, PASSWORD)
    // 客户端组件用 window.confirm 做确认 —— 不接管对话框会被 Playwright 自动取消
    page.on('dialog', (d) => d.accept())

    await openProposals(page)
    const mineCard = cardBy(page, RATIONALE.mine)
    await expect(mineCard.getByTestId('proposal-my-decision')).toContainText('尚未回应')

    // 我作为**发起方**同意 → 状态必须仍是「等待对方回应」（AC-04 的核心判据）。
    await actOnProposal(page, RATIONALE.mine, 'accept', { state: '等待对方回应' })

    // 🔴 关键：提案仍在**待处理**里、状态不是「已建立连接」
    const after = cardBy(page, RATIONALE.mine)
    await expect(after.getByTestId('proposal-state')).not.toContainText('已建立连接')
    // 已经同意过 → 不再重复给「同意」按钮
    await expect(after.getByTestId('proposal-action-accept')).toHaveCount(0)
    await expect(after).toHaveAttribute('data-introduced', 'false')
    // 它不在「已建立连接」分区里
    await expect(
      page
        .getByTestId('proposals-connections')
        .getByTestId('proposal-card')
        .filter({ hasText: RATIONALE.mine })
    ).toHaveCount(0)

    await ctx.close()
  })

  test('★AC-04 双方都同意 → 变「双方已同意，等待介绍」，仍非已连接', async ({ browser }) => {
    test.setTimeout(360_000)
    const { ctx, page } = await authedContext(browser, MEMBER_EMAIL, PASSWORD)
    page.on('dialog', (d) => d.accept())

    await openProposals(page)
    const card = cardBy(page, RATIONALE.pending)
    await expect(card.getByTestId('proposal-counterpart-decision')).toContainText('已同意')
    await expect(card.getByTestId('proposal-action-accept')).toBeVisible()

    // 对方已同意，我现在也同意 → 状态变「双方已同意」，但**仍不是**「已建立连接」。
    await actOnProposal(page, RATIONALE.pending, 'accept', {
      state: '双方已同意',
      hint: '运营执行介绍后才会真正建立连接',
    })

    const after = cardBy(page, RATIONALE.pending)
    await expect(after).toHaveAttribute('data-introduced', 'false')
    await expect(
      page
        .getByTestId('proposals-connections')
        .getByTestId('proposal-card')
        .filter({ hasText: RATIONALE.pending })
    ).toHaveCount(0)

    await ctx.close()
  })

  test('★AC-06 运营介绍 → 200 建立连接；重复介绍 → 409', async ({ browser }) => {
    // 本用例最重：两个独立浏览器上下文（各自要过一遍 /login 的 RSC 加载）+
    // 两次 introduce + 一次成员侧提案页整页渲染。dev 模式（Turbopack 现场编译）
    // 下实测 1.5–2.5 分钟，故留足预算 —— 超时是**环境抖动**，不是断言失败。
    test.setTimeout(300_000)
    const { ctx } = await authedContext(browser, OP_EMAIL, PASSWORD)

    // ⚠️ 契约路径：`/connections/{connectionId}/introduce`（`[connectionId]` = 提案 id）。
    //    不要写成 `/connections/proposals/{id}/introduce` —— 那是 4 段路径，必然 404。
    const url = `${BASE_URL}/api/v1/connections/cp_e2e_pending/introduce`
    const headers = { origin: BASE_URL }

    // 双方已同意 + 双方意图仍有效 → 介绍成功
    const first = await ctx.request.post(url, { headers })
    expect(first.status()).toBe(200)
    const body = await first.json()
    expect(body.data.introducedAt).toBeTruthy()

    // 第二次 = "又要求介绍一次" → 409（**不是**幂等成功，也不能静默返回上次结果）
    const second = await ctx.request.post(url, { headers })
    expect(second.status()).toBe(409)
    const dup = await second.json()
    expect(dup.error.details.blockers).toContain('already_introduced')

    // 成员侧随即应看到「已建立连接」
    const member = await authedContext(browser, MEMBER_EMAIL, PASSWORD)
    await openProposals(member.page)
    await expect(
      member.page
        .getByTestId('proposals-connections')
        .getByTestId('proposal-card')
        .filter({ hasText: RATIONALE.pending })
    ).toHaveCount(1)

    await member.ctx.close()
    await ctx.close()
  })

  test('★AC-05 拒绝与撤回 → 分别进入终态「已拒绝」/「已撤回」，且不再有任何动作', async ({
    browser,
  }) => {
    // 本用例要跑两个动作（拒绝 + 撤回），且每个动作都要重载一次页面核对持久状态。
    test.setTimeout(480_000)
    const { ctx, page } = await authedContext(browser, MEMBER_EMAIL, PASSWORD)
    // 两个终态动作都用 window.confirm 做确认 —— 不接管对话框会被 Playwright 自动取消。
    page.on('dialog', (d) => d.accept())

    await openProposals(page)

    // ── ① 拒绝：cp_e2e_decline 是"对方提给我、我尚未表态"的待决提案 ──
    const declineCard = cardBy(page, RATIONALE.decline)
    await expect(declineCard.getByTestId('proposal-state')).toContainText('待你回应')
    await expect(declineCard.getByTestId('proposal-my-decision')).toContainText('尚未回应')
    await actOnProposal(page, RATIONALE.decline, 'reject', { state: '已拒绝' })

    const declinedClosed = page
      .getByTestId('proposals-closed')
      .getByTestId('proposal-card')
      .filter({ hasText: RATIONALE.decline })
    await expect(declinedClosed).toHaveCount(1)
    // 终态不可逆：不再提供任何动作按钮（也就无法"重新打开"）
    await expect(declinedClosed.getByTestId('proposal-actions')).toHaveCount(0)
    // 我的表态被记为「已拒绝」—— 这才是"拒绝"落库后的界面事实
    await expect(declinedClosed.getByTestId('proposal-my-decision')).toContainText('已拒绝')
    await expect(
      page
        .getByTestId('proposals-pending')
        .getByTestId('proposal-card')
        .filter({ hasText: RATIONALE.decline })
    ).toHaveCount(0)

    // ── ② 撤回：cp_e2e_mutual 是"我已经同意过"的提案 ──
    //   AC-05 的另一半是**撤回同意**。这一步同时证两件事：
    //   (a) 同意过之后界面**只**给「撤回」—— 不给「同意」（重复点击无意义），
    //       也不给「拒绝」（我已同意，此刻改主意的准确语义是撤回；两个按钮会把
    //       同一个意图写成两种不同的决策记录）；
    //   (b) 撤回后立刻终态「已撤回」，且不再有任何动作。
    const mutualCard = cardBy(page, RATIONALE.mutual)
    await expect(mutualCard.getByTestId('proposal-state')).toContainText('双方已同意')
    await expect(mutualCard.getByTestId('proposal-my-decision')).toContainText('已同意')
    await expect(mutualCard.getByTestId('proposal-action-revoke')).toBeVisible()
    await expect(mutualCard.getByTestId('proposal-action-accept')).toHaveCount(0)
    await expect(mutualCard.getByTestId('proposal-action-reject')).toHaveCount(0)

    await actOnProposal(page, RATIONALE.mutual, 'revoke', { state: '已撤回' })

    const mutualClosed = page
      .getByTestId('proposals-closed')
      .getByTestId('proposal-card')
      .filter({ hasText: RATIONALE.mutual })
    await expect(mutualClosed).toHaveCount(1)
    await expect(mutualClosed.getByTestId('proposal-actions')).toHaveCount(0)
    await expect(mutualClosed.getByTestId('proposal-my-decision')).toContainText('已撤回')
    await expect(
      page
        .getByTestId('proposals-pending')
        .getByTestId('proposal-card')
        .filter({ hasText: RATIONALE.mutual })
    ).toHaveCount(0)

    await ctx.close()
  })

  test('🔒 档位随阶段升级 + 未授权字段不出现（含值级扫描）', async ({ browser }) => {
    test.setTimeout(300_000)
    const { ctx, page } = await authedContext(browser, MEMBER_EMAIL, PASSWORD)

    await openProposals(page)

    // ① 已建立连接（cp_e2e_intro → t05b）：COUNTERPARTY 档 → 昵称 + **年龄**可见
    const introProfile = cardBy(page, RATIONALE.intro).getByTestId('proposal-counterpart')
    await expect(introProfile).toContainText(SENTINELS.t05bName)
    await expect(introProfile).toContainText('年龄')
    await expect(introProfile).toContainText(String(SENTINELS.t05bAge))
    // 但 bio 只授权给 ORGANIZER → 连介绍之后也不可见
    await expect(introProfile).not.toContainText(SENTINELS.t05bBio)

    // ② 尚未介绍（cp_e2e_mutual → peer，前一条用例已把它撤回成 REVOKED，但 introducedAt 仍为 null）
    //    → 档位仍是 CANDIDATE → 年龄(COUNTERPARTY)与简介(ORGANIZER)都不可见。
    //    这条与 ① 互为对照：若把判据写成"同意即升级"，47 就会漏出来。
    const mutualProfile = cardBy(page, RATIONALE.mutual).getByTestId('proposal-counterpart')
    await expect(mutualProfile).toContainText('昵称')
    await expect(mutualProfile).not.toContainText('年龄')
    await expect(mutualProfile).not.toContainText(String(SENTINELS.peerAge))

    // ③ 整页值级扫描：邮箱与未授权自述一次都不该出现（字符串哨兵，不依赖数字巧合）
    const html = await page.content()
    expect(html).not.toContain(SENTINELS.opEmail)
    expect(html).not.toContain(SENTINELS.t05aBio)
    expect(html).not.toContain(SENTINELS.t05bBio)
    expect(html).not.toContain(SENTINELS.peerBio)

    await ctx.close()
  })
})
