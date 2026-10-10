/**
 * T03 · 意图提交与逐字段披露 —— 移动端 E2E（AC-12 + AC-03 的浏览器证据）
 *
 * 为什么是移动端：与 T02 同口径（`playwright.t02.config.ts`：Pixel 5 视口 +
 * **系统真实 Chrome**，因为本机 Playwright 自带 chromium 在 macOS 13 不受支持）。
 *
 * 两个验收在这一条流程里同时取证：
 *   - **AC-12 意图提交**：need/offer/约束可填写、可编辑，提交走真实 API；
 *   - **AC-03 逐字段披露**：披露预览里只出现被授权的字段，且**受保护字段（邮箱）
 *     的值在整页 HTML 里一次都不出现**（这是"未授权字段不进入输出"的端到端证据）。
 *
 * 运行前置：
 *   node scripts/qa/seed-t02-e2e.mjs --regenerate      # 建隔离库（含 SocialIntent + Profile）
 *   DATABASE_URL=file:/tmp/t02-e2e.db npx next dev -p 3101
 *   E2E_BASE_URL=http://localhost:3101 \
 *   E2E_MISSION_TOKEN=... E2E_MEMBER_EMAIL=... E2E_PASSWORD=... \
 *   npx playwright test -c playwright.t02.config.ts tests/e2e/intent-disclosure.spec.ts
 */

import { test, expect, type Page, type BrowserContext } from '@playwright/test'

const BASE_URL = process.env.E2E_BASE_URL || 'https://app.lokfeel.com'
const TOKEN = process.env.E2E_MISSION_TOKEN || ''
const MEMBER_EMAIL = process.env.E2E_MEMBER_EMAIL || ''
const PASSWORD = process.env.E2E_PASSWORD || ''

test.skip(!TOKEN, '未提供 E2E_MISSION_TOKEN：意图 E2E 夹具未就绪')

/**
 * 预热本任务用到的**动态度**端点。
 *
 * 与 T02 完全同源的原因：Turbopack dev 的路由模块在首次请求时才现场编译，
 * 冷编译耗时（实测 7-14s）远大于真实业务逻辑，会把断言窗口整个吃掉，
 * 表现为"服务端其实 200、客户端已超时"的假失败。
 *
 * 预热请求全部**不带会话**（被鉴权拦下）或**用错误凭据**（只触发编译），
 * 因此不产生任何业务副作用 —— 不会提前写入意图或参与记录。
 */
test.beforeAll(async () => {
  const warm = async (path: string, init: RequestInit) => {
    try {
      const res = await fetch(`${BASE_URL}${path}`, init)
      await res.text()
    } catch {
      /* 预热失败不阻断：UI 用例会给出真实结论 */
    }
  }
  const json: HeadersInit = { 'Content-Type': 'application/json' }

  await warm('/api/auth/login', {
    method: 'POST',
    headers: json,
    body: JSON.stringify({ email: 'warmup@invalid.test', password: 'Warmup-Only-Not-Real' }),
  })
  await warm('/api/v1/intents', {
    method: 'POST',
    headers: { ...json, 'Idempotency-Key': 'warmup' },
    body: JSON.stringify({ missionId: 'warmup', need: 'warmup', offer: 'warmup' }),
  })
  await warm('/api/v1/intents/warmup', { method: 'PATCH', headers: json, body: '{}' })
  await warm('/api/v1/intents/warmup/status', {
    method: 'POST',
    headers: json,
    body: JSON.stringify({ action: 'withdraw' }),
  })
  await warm('/api/v1/intents/warmup/disclosure', { method: 'GET' })
  // RSC 页面：未登录会 307 到 /login，但页面模块已被编译
  await warm(`/m/${TOKEN}/intent`, { method: 'GET' })
})

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

    await page
      .waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 })
      .catch(() => undefined)

    if ((await context.cookies()).some((c) => c.name.includes('session-token'))) return
    await page.waitForTimeout(1_500)
  }
}

test.describe('T03 · 意图提交与逐字段披露（移动端 · AC-12 / AC-03）', () => {
  test('🔒 匿名访问意图页 → 重定向到登录（敏感动作需身份验证）', async ({ page }) => {
    await page.goto(`${BASE_URL}/m/${TOKEN}/intent`, { waitUntil: 'domcontentloaded' })

    expect(page.url()).toContain('/login')
    expect(decodeURIComponent(page.url())).toContain(`/m/${TOKEN}/intent`)
    // 未登录不得看到表单
    await expect(page.getByTestId('intent-form')).toHaveCount(0)
  })

  test.describe.serial('登录后的完整意图闭环', () => {
    test('加入 → 提交 → 披露预览 → 编辑 → 撤销', async ({ page, context }) => {
      test.skip(!MEMBER_EMAIL || !PASSWORD, '未提供 E2E 成员账号')
      // 这条用例串了 5 个真实写操作（加入 / 提交 / 编辑 / 撤销 + 一次刷新重读），
      // dev 下每次写都要现场编译路由。120s 是 T02 单写操作的口径，这里必须放宽。
      test.setTimeout(240_000)

      await loginViaUi(page, context, MEMBER_EMAIL, PASSWORD)
      expect((await context.cookies()).some((c) => c.name.includes('session-token'))).toBe(true)

      // ── ① 先加入任务（意图的前置条件：父锚点 MissionParticipation）──
      await page.goto(`${BASE_URL}/m/${TOKEN}`, { waitUntil: 'domcontentloaded' })

      const joinButton = page.getByTestId('mission-join-button')
      await expect(async () => {
        if ((await joinButton.count()) > 0) {
          await joinButton.click({ timeout: 5_000 }).catch(() => undefined)
        }
        await expect(page.getByTestId('mission-joined')).toBeVisible({ timeout: 4_000 })
      }).toPass({ timeout: 60_000 })

      // ── ② 进入意图页 ──
      await page.goto(`${BASE_URL}/m/${TOKEN}/intent`, { waitUntil: 'domcontentloaded' })
      // ⚠️ 刻意**不用** `waitForLoadState('networkidle')`：
      //    dev 模式下 HMR 长连接与客户端预取会让"500ms 无网络"可能永不达成，
      //    表现是"服务端其实已经 200、测试却在等待上耗尽 120s 超时"的假失败。
      //    这里改为对**目标元素**重试等待 —— 要证明的是"表单可用"，不是"网络安静"。
      await expect(async () => {
        await expect(page.getByTestId('intent-page')).toBeVisible({ timeout: 10_000 })
        await expect(page.getByTestId('intent-form')).toBeVisible({ timeout: 5_000 })
      }).toPass({ timeout: 90_000 })
      // 已加入 → 不应再提示"需要先加入"
      await expect(page.getByTestId('intent-need-join')).toHaveCount(0)

      // ── ③ 填写意图（AC-12：need/offer/约束/有效期可编辑且有字段校验）──
      await page.getByTestId('intent-need').fill('我需要印尼与越南本地的分销与清关伙伴。')
      await page
        .getByTestId('intent-offer')
        .fill('我可以提供样品支持、合规材料模板与工厂验厂资源。')
      await page.getByTestId('intent-constraints').fill('仅限东南亚、不接受独家代理')

      // 逐字段披露：先"采用建议"，再**主动扩大**一个敏感字段（年龄）的范围
      await page.getByTestId('intent-suggest').click()
      // ⚠️ 点的是**可见的 label**，不是 input：radio 带 `sr-only`（视觉隐藏），
      //    直接点 input 会被外层 label 拦成 "intercepts pointer events"。
      //    真实用户在移动端点到的也正是这个胶囊按钮。断言 toBeChecked 保证真的选中。
      await expect(async () => {
        await page.getByTestId('intent-field-age').getByText('组织者', { exact: true }).click()
        await expect(page.getByTestId('intent-aud-age-ORGANIZER')).toBeChecked({ timeout: 2_000 })
      }).toPass({ timeout: 30_000 })

      // 受保护字段（邮箱）**没有**可选项，只给出原因说明
      await expect(page.getByTestId('intent-protected-email')).toBeVisible()
      await expect(page.getByTestId('intent-aud-email-COUNTERPARTY')).toHaveCount(0)

      // ── ④ 提交（真实 API + 幂等键）──
      await page.getByTestId('intent-submit').click()
      await expect(page.getByTestId('intent-message')).toContainText('已提交', { timeout: 45_000 })
      await expect(page.getByTestId('intent-status')).toContainText('ACTIVE')

      // ── ⑤ 披露预览：只出现被授权字段（AC-03 的正面证据）──
      const organizerPreview = page.getByTestId('intent-preview-organizer')
      await expect(organizerPreview).toContainText('昵称')
      await expect(organizerPreview).toContainText('林晓')
      // 刚才主动扩大的敏感字段确实生效了 —— 否则"逐字段"只是摆设
      await expect(organizerPreview).toContainText('年龄')

      // 🔒 AC-03：受保护字段（邮箱）的**值**在整页 HTML 里一次都不出现
      expect(await page.content()).not.toContain(MEMBER_EMAIL)

      // ── ⑥ 编辑：改正文 + **收紧**披露范围（AC-12 可编辑 + AC-03 授权可撤回）──
      await page.getByTestId('intent-need').fill('更新：优先印尼市场，其次是越南。')
      await expect(async () => {
        await page.getByTestId('intent-field-age').getByText('仅自己', { exact: true }).click()
        await expect(page.getByTestId('intent-aud-age-SELF')).toBeChecked({ timeout: 2_000 })
      }).toPass({ timeout: 30_000 })
      await page.getByTestId('intent-submit').click()
      await expect(page.getByTestId('intent-message')).toContainText('已更新', { timeout: 45_000 })
      // 收紧后预览立刻反映（年龄重新变成"仅自己"）
      await expect(page.getByTestId('intent-preview-organizer')).not.toContainText('年龄')

      // 刷新后编辑结果仍在（真实落库，不是前端状态）
      await page.reload({ waitUntil: 'domcontentloaded' })
      await expect(page.getByTestId('intent-need')).toHaveValue(/优先印尼市场/)

      // ── ⑦ 撤销（AC-05 的前置能力：撤销后不再披露）──
      await page.getByTestId('intent-withdraw').click()
      await expect(page.getByTestId('intent-status')).toContainText('WITHDRAWN', { timeout: 45_000 })
      await expect(page.getByTestId('intent-preview-organizer')).toContainText('（无）')
      await expect(page.getByTestId('intent-withdraw')).toHaveCount(0)

      // ── ⑧ 移动端布局：无横向滚动 ──
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      )
      expect(overflow).toBeLessThanOrEqual(1)
    })
  })
})
