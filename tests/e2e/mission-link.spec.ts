/**
 * T02 · Mission Link 分享页 —— 移动端 E2E（AC-11 的浏览器证据）
 *
 * 为什么是移动端：AC-11 明确要求「移动端可访问」。playwright.t02.config.ts 用
 * Pixel 5 视口 + **系统真实 Chrome**（本机 Playwright 自带 chromium 在 macOS 13
 * 不受支持），因此证据贴近「真实浏览器 + 真实移动视口」。
 *
 * 运行前置（脚本见 scripts/qa/seed-t02-e2e.mjs）：
 *   1. node scripts/qa/seed-t02-e2e.mjs
 *   2. DATABASE_URL=file:/tmp/t02-e2e.db npx next dev -p 3101
 *   3. E2E_BASE_URL=http://localhost:3101 \
 *      E2E_MISSION_TOKEN=... E2E_PAUSED_TOKEN=... \
 *      E2E_MEMBER_EMAIL=... E2E_PASSWORD=... \
 *      npx playwright test -c playwright.t02.config.ts tests/e2e/mission-link.spec.ts
 *
 * 这个 spec **只在提供了夹具 token 时运行**（否则 skip），因此不会在
 * 面向生产的 `npx playwright test` 全量跑里造成假失败。
 */

import { test, expect, type Page, type BrowserContext } from '@playwright/test'

const BASE_URL = process.env.E2E_BASE_URL || 'https://app.lokfeel.com'
const TOKEN = process.env.E2E_MISSION_TOKEN || ''
const PAUSED_TOKEN = process.env.E2E_PAUSED_TOKEN || ''
const MEMBER_EMAIL = process.env.E2E_MEMBER_EMAIL || ''
const PASSWORD = process.env.E2E_PASSWORD || ''
// 22 位合法形状但不存在的令牌（应先过形状校验，再在 DB 查不到 → 404）
const MISSING_TOKEN = 'zzzzzzzzzzzzzzzzzzzzzz'

test.skip(!TOKEN, '未提供 E2E_MISSION_TOKEN：分享页 E2E 夹具未就绪')

test.describe('T02 · Mission Link 分享页（移动端 · AC-11）', () => {
  /**
   * 预热两条「动态度」端点。
   *
   * 为什么必须预热：本项目走 Turbopack dev，**路由模块在首次请求时才现场编译**。
   * 实测冷编译代价——
   *   · `POST /api/auth/login`           application-code 7.4s，而登录页自带 10s
   *     客户端超时（login-inner-client.tsx 的 AbortController）→ 冷启动时出现
   *     「服务端返回 200，客户端已 abort」的**假失败**，与 T02 功能无关；
   *   · `POST /api/v1/public/missions/[token]/join`  整请求 14.1s，其中
   *     `next.js: 13.8s` / `application-code: 209ms` —— 编译时间远大于真实逻辑耗时，
   *     会把断言窗口整个吃掉。
   *
   * 预热手法是「打一次不产生副作用的请求」：
   *   · 登录端点用**错误密码** → 只触发编译，不建会话；
   *   · 加入端点**不带会话 cookie** → 被 401 拦下，但路由模块已编译，且**不写入任何
   *     参与记录**（保证后续用例仍从 0/5 开始）。
   * 两者均无速率限制，不会挤占真实用例的配额。
   */
  test.beforeAll(async () => {
    const warmPost = async (path: string, body: unknown) => {
      try {
        const res = await fetch(`${BASE_URL}${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        await res.text()
      } catch {
        // 预热失败不阻断：UI 用例会给出真实结论
      }
    }
    await warmPost('/api/auth/login', {
      email: 'warmup@invalid.test',
      password: 'Warmup-Only-Not-A-Real-Password',
    })
    await warmPost(`/api/v1/public/missions/${TOKEN}/join`, {})
  })

  test('匿名可预览：最小披露内容可见，且不出现"加入"按钮', async ({ page }) => {
    const res = await page.goto(`${BASE_URL}/m/${TOKEN}`, { waitUntil: 'domcontentloaded' })
    expect(res?.status()).toBe(200)

    await expect(page.getByTestId('mission-share')).toBeVisible()
    await expect(page.getByTestId('mission-title')).toContainText('寻找东南亚渠道伙伴')
    await expect(page.getByTestId('mission-goal')).toBeVisible()
    await expect(page.getByTestId('mission-offer')).toBeVisible()
    await expect(page.getByTestId('mission-success')).toBeVisible()

    // AC-11：未注册预览可看，但**敏感动作（加入）需要身份验证**
    await expect(page.getByTestId('mission-login-cta')).toBeVisible()
    await expect(page.getByTestId('mission-join-button')).toHaveCount(0)
  })

  test('匿名预览不泄露任何内部标识（源码级检查）', async ({ page }) => {
    await page.goto(`${BASE_URL}/m/${TOKEN}`, { waitUntil: 'domcontentloaded' })
    const html = await page.content()

    for (const leak of [
      'organizationId',
      'ownerId',
      'shareToken',
      'mission_e2e_active',
      'org_e2e',
      'u_e2e_owner',
    ]) {
      expect(html).not.toContain(leak)
    }
  })

  test('铁律：无候选时不伪造 —— 渲染显式空态而非占位候选', async ({ page }) => {
    await page.goto(`${BASE_URL}/m/${TOKEN}`, { waitUntil: 'domcontentloaded' })

    const empty = page.getByTestId('mission-candidates-empty')
    await expect(empty).toBeVisible()
    await expect(empty).toContainText('不会')
    await expect(page.getByTestId('mission-candidates')).not.toContainText('匹配度')
  })

  test('移动端布局：无横向滚动（内容不溢出视口）', async ({ page }) => {
    await page.goto(`${BASE_URL}/m/${TOKEN}`, { waitUntil: 'domcontentloaded' })
    await page.waitForLoadState('networkidle')

    const overflow = await page.evaluate(() => {
      const doc = document.documentElement
      return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth }
    })
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1)

    // 主行动按钮在移动视口内可点（拇指可达）
    const cta = page.getByTestId('mission-login-cta')
    const box = await cta.boundingBox()
    expect(box).not.toBeNull()
    const viewport = page.viewportSize()!
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1)
  })

  test('不存在的令牌 → 404（不泄露"该链接是否存在"以外的信息）', async ({ page }) => {
    const res = await page.goto(`${BASE_URL}/m/${MISSING_TOKEN}`, { waitUntil: 'domcontentloaded' })
    expect(res?.status()).toBe(404)
  })

  test('暂停中的任务：给出确定的不可加入原因（不显示"登录后加入"）', async ({ page }) => {
    test.skip(!PAUSED_TOKEN, '未提供 E2E_PAUSED_TOKEN')
    await page.goto(`${BASE_URL}/m/${PAUSED_TOKEN}`, { waitUntil: 'domcontentloaded' })

    await expect(page.getByTestId('mission-status')).toContainText('已暂停')
    await expect(page.getByTestId('mission-blocked-reason')).toContainText('已暂停')
    await expect(page.getByTestId('mission-login-cta')).toHaveCount(0)
    await expect(page.getByTestId('mission-join-button')).toHaveCount(0)
  })

  test('未登录点击"登录后加入" → 跳登录页并带回跳地址', async ({ page }) => {
    await page.goto(`${BASE_URL}/m/${TOKEN}`, { waitUntil: 'domcontentloaded' })
    await page.getByTestId('mission-login-cta').click()
    await page.waitForURL(/\/login/, { timeout: 30_000 })

    expect(page.url()).toContain('callbackUrl=')
    expect(decodeURIComponent(page.url())).toContain(`/m/${TOKEN}`)
  })

  test('真实登录后可加入（写操作）；重复加入幂等', async ({ page, context }) => {
    test.skip(!MEMBER_EMAIL || !PASSWORD, '未提供 E2E 成员账号')

    await loginViaUi(page, context, MEMBER_EMAIL, PASSWORD)
    // AC-11：敏感动作必须经过真实身份验证 —— 以「拿到会话 cookie」为硬证据
    expect((await context.cookies()).some((c) => c.name.includes('session-token'))).toBe(true)

    await page.goto(`${BASE_URL}/m/${TOKEN}`, { waitUntil: 'domcontentloaded' })
    // ⚠️ 关键：等服务端 HTML 变成"已登录"之后再等 React 接管。
    // 分享页是 RSC；`domcontentloaded` 时 DOM 已可断言，但按钮的 onClick
    // 尚未挂载（hydration 未完成）→ 此时点击会**静默无效**（真实踩到过一次）。
    await page.waitForLoadState('networkidle')

    const joinButton = page.getByTestId('mission-join-button')
    await expect(joinButton).toBeVisible()
    await expect(page.getByTestId('mission-seats')).toContainText('0/5')

    // 点一次 → 按钮进入 submitting（disabled）→ 成功后**整体被替换**为"已加入"。
    // 因此重试块里只在按钮仍存在时才点击；唯一终态断言是 `mission-joined`
    // （若失败后按钮又回来，说明加入未生效，自然会重试点击）。
    await expect(async () => {
      if ((await joinButton.count()) > 0) {
        await joinButton.click({ timeout: 5_000 }).catch(() => undefined)
      }
      await expect(page.getByTestId('mission-joined')).toBeVisible({ timeout: 4_000 })
    }).toPass({ timeout: 60_000 })

    // 刷新后仍为"已加入"（服务端状态已落库，且重复加入是幂等的）
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('mission-joined')).toBeVisible()
    await expect(page.getByTestId('mission-join-button')).toHaveCount(0)

    // 名额计数应为真实值 1（不是伪造的）
    await expect(page.getByTestId('mission-seats')).toContainText('1/5')
  })
})

/**
 * 通过真实登录页登录（不使用 API 直连，确保覆盖登录页真正的提交路径：
 * `POST /api/auth/login`，而不是 NextAuth 的 callback/credentials）。
 *
 * 容忍 dev 模式的冷编译延迟：登录页的 fetch 自带 10s 客户端超时，慢机器上
 * 首跑可能 abort → 这里以「会话 cookie 是否出现」为判据，最多重试 3 次。
 */
async function loginViaUi(
  page: Page,
  context: BrowserContext,
  email: string,
  password: string
): Promise<void> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' })
    await page.locator('#login-email').fill(email)
    await page.locator('#login-password').fill(password)
    await page.locator('button[type="submit"]').click()

    // 成功 → 离开 /login；失败 → 停留并显示错误（含 10s 客户端超时提示）
    await page
      .waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 })
      .catch(() => undefined)

    if ((await context.cookies()).some((c) => c.name.includes('session-token'))) return
    await page.waitForTimeout(1_500)
  }
}
