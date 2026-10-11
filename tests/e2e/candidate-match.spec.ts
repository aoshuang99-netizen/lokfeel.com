/**
 * T04 · 双向互补候选与披露边界 —— 移动端 E2E（AC-13 + AC-03 的浏览器证据）
 *
 * 与 `intent-disclosure.spec.ts` 同源：`playwright.t02.config.ts`（Pixel 5 视口 +
 * **系统真实 Chrome**，因为本机 Playwright 自带 chromium 在 macOS 13 不受支持）。
 *
 * 三条断言各自取证一件事，且**互相不可替代**：
 *   ① **AC-13 有依据**：候选卡必须展示"实际命中的词元"，且双向互补的正文都在页面上；
 *   ② **AC-13 不伪造**：非互补的任务参与人**不得**出现；被门控的行只贡献计数；
 *   ③ **AC-03 不越权**：对方授权给「已同意的对手方」与「组织者」的字段
 *      （`age` / `bio`）在**整页 HTML 与候选 API 响应里一次都不出现** ——
 *      这是"候选投影档位有没有写反"的端到端判据。
 *
 * 运行前置：
 *   node scripts/qa/seed-t02-e2e.mjs --regenerate   # 建隔离库 + 基线夹具
 *   node scripts/qa/seed-t04-e2e.mjs                # 追加 T04 样本（互补/非互补/被门控）
 *   DATABASE_URL=file:/tmp/t02-e2e.db npx next dev -p 3101
 *   E2E_BASE_URL=http://localhost:3101 \
 *   E2E_MISSION_TOKEN=... E2E_MISSION_ID=mission_e2e_active \
 *   E2E_MEMBER_EMAIL=... E2E_PASSWORD=... \
 *   npx playwright test -c playwright.t02.config.ts tests/e2e/candidate-match.spec.ts
 */

import { test, expect, type Page, type BrowserContext } from '@playwright/test'

const BASE_URL = process.env.E2E_BASE_URL || 'https://app.lokfeel.com'
const TOKEN = process.env.E2E_MISSION_TOKEN || ''
const MISSION_ID = process.env.E2E_MISSION_ID || 'mission_e2e_active'
const MEMBER_EMAIL = process.env.E2E_MEMBER_EMAIL || ''
const PASSWORD = process.env.E2E_PASSWORD || ''
const PEER_NAME = process.env.E2E_PEER_NAME || '陈岸'
const PEER_CITY = process.env.E2E_PEER_CITY || '雅加达'

/** 与 `scripts/qa/seed-t04-e2e.mjs` 的 SENTINELS 必须逐字一致 —— 这里刻意重复一遍，
 *  好让"夹具改了但断言没改"这件事在 code review 里显眼。 */
const SENTINELS = {
  peerEmail: 'e2e.peer@example.test',
  peerAge: '47',
  peerBio: '十年印尼落地经验',
  noiseName: '噪音甲',
  dormantName: '已撤销乙',
  outsiderName: '外部丙',
}

test.skip(!TOKEN, '未提供 E2E_MISSION_TOKEN：T04 候选 E2E 夹具未就绪')

/**
 * 预热本任务用到的**动态度**端点（与 T02/T03 同源的原因）：
 * Turbopack dev 的路由模块首次请求时才现场编译，冷编译（实测 7-14s）远大于
 * 真实业务逻辑，会把断言窗口整个吃掉，表现为"服务端其实 200、客户端已超时"的假失败。
 *
 * 预热请求**不带会话**（被鉴权拦下）→ 不产生任何业务副作用。
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

  // ⚠️ 这条**必须**有：登录端点走的是自定义的 `/api/auth/login`，dev 下首次请求要
  //    现场编译。漏掉它时症状是"登录重试 3 次都拿不到 session-token"——
  //    看起来像鉴权坏了，其实是编译慢（T03 的 spec 已经踩过一次）。
  await warm('/api/auth/login', {
    method: 'POST',
    headers: json,
    body: JSON.stringify({ email: 'warmup@invalid.test', password: 'Warmup-Only-Not-Real' }),
  })
  await warm('/api/v1/connections/candidates?missionId=warmup')
  // RSC 页面：未登录会 307 到 /login，但页面模块已被编译
  await warm(`/m/${TOKEN}/matches`)
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

/**
 * 在**页面同源**上下文里打候选 API（自动带上会话 cookie）。
 * 为什么不用 `request` fixture：那需要手工搬运 cookie，且与"真实浏览器里的
 * 用户视角"隔了一层；用 `page.evaluate` 更贴近"这个页面自己会看到什么"。
 */
async function fetchCandidates(page: Page) {
  return page.evaluate(async (missionId: string) => {
    const res = await fetch(
      `/api/v1/connections/candidates?missionId=${encodeURIComponent(missionId)}`
    )
    return { status: res.status, body: await res.json() }
  }, MISSION_ID)
}

test.describe('T04 · 双向互补候选与披露边界（移动端 · AC-13 / AC-03）', () => {
  test('🔒 匿名访问候选页 → 重定向到登录（候选是成员数据）', async ({ page }) => {
    await page.goto(`${BASE_URL}/m/${TOKEN}/matches`, { waitUntil: 'domcontentloaded' })

    expect(page.url()).toContain('/login')
    expect(decodeURIComponent(page.url())).toContain(`/m/${TOKEN}/matches`)
    // 未登录不得看到任何候选卡（更不该看到任何对方信息）
    await expect(page.getByTestId('match-card')).toHaveCount(0)
    await expect(page.getByTestId('matches-list')).toHaveCount(0)
  })

  test('✅ 候选页渲染：有依据、有互补正文、非互补者不出现', async ({ page, context }) => {
    test.skip(!MEMBER_EMAIL || !PASSWORD, '未提供 E2E 成员账号')
    test.setTimeout(180_000)

    await loginViaUi(page, context, MEMBER_EMAIL, PASSWORD)
    expect((await context.cookies()).some((c) => c.name.includes('session-token'))).toBe(true)

    await page.goto(`${BASE_URL}/m/${TOKEN}/matches`, { waitUntil: 'domcontentloaded' })

    // ⚠️ 刻意**不用** `networkidle`（dev 下 HMR 长连接会让它永不达成，见 T02/T03 的教训），
    //    改为对目标元素重试等待：要证明的是"页面渲染出了候选"，不是"网络安静"。
    await expect(async () => {
      await expect(page.getByTestId('matches-page')).toBeVisible({ timeout: 10_000 })
      await expect(page.getByTestId('matches-list')).toBeVisible({ timeout: 5_000 })
    }).toPass({ timeout: 90_000 })

    // 无候选的空态**不应**出现 —— 夹具里有一条严格互补的伙伴
    await expect(page.getByTestId('matches-empty')).toHaveCount(0)

    const cards = page.getByTestId('match-card')
    await expect(cards).toHaveCount(1)

    const card = cards.first()

    // ① AC-13：每个候选都必须带得走依据 —— 展示**实际命中的词元**，不是匹配度百分比
    const evidence = await card.getByTestId('match-evidence').innerText()
    expect(evidence).toContain('你')
    expect(evidence).toContain('对方')
    expect(evidence.length).toBeGreaterThan(0)
    // 依据必须引用命中原词（夹具里的 2-gram 命中）
    expect(evidence).toContain('清关')
    expect(evidence).toContain('分销')

    // ② 参与匹配的正文（need/offer）双向都在
    await expect(card.getByTestId('match-need')).toContainText('分销渠道')
    await expect(card.getByTestId('match-offer')).toContainText('清关与仓储')

    // ③ 经授权披露的档案：昵称 + 城市（peer 授权到 CANDIDATE 档）
    const profile = card.getByTestId('match-profile')
    await expect(profile).toContainText(PEER_NAME)
    await expect(profile).toContainText(PEER_CITY)
    // 展示的是字段中文标签（来自唯一的字段目录）
    await expect(profile).toContainText('昵称')
    await expect(profile).toContainText('城市')

    // ④ 诚实标注：连接流程尚未开放，且不提供"点了没用"的按钮
    await expect(page.getByTestId('matches-connect-coming')).toBeVisible()

    // ⑤ 移动端：无横向滚动
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    )
    expect(overflow).toBeLessThanOrEqual(1)
  })

  test('🔒 AC-03：未授权字段在页面与 API 里都不存在（含值级扫描）', async ({ page, context }) => {
    test.skip(!MEMBER_EMAIL || !PASSWORD, '未提供 E2E 成员账号')
    test.setTimeout(180_000)

    await loginViaUi(page, context, MEMBER_EMAIL, PASSWORD)

    await page.goto(`${BASE_URL}/m/${TOKEN}/matches`, { waitUntil: 'domcontentloaded' })
    await expect(async () => {
      await expect(page.getByTestId('matches-list')).toBeVisible({ timeout: 10_000 })
    }).toPass({ timeout: 90_000 })

    // ── 页面级：整页 HTML 的**值级**扫描 ──
    const html = await page.content()
    // `age` 授权给 COUNTERPARTY（尚未同意的候选不该看到）
    expect(html).not.toContain(SENTINELS.peerBio) // bio 只授权 ORGANIZER
    expect(html).not.toContain(SENTINELS.peerEmail) // 受保护字段：结构性不可授权
    // 非互补的参与人与被门控者：连"存在"这件事都不该暴露在页面上
    expect(html).not.toContain(SENTINELS.noiseName)
    expect(html).not.toContain(SENTINELS.dormantName)
    expect(html).not.toContain(SENTINELS.outsiderName)

    // ── API 级：自描述档位 + 投影白名单 + 门控计数 ──
    const res = await fetchCandidates(page)
    expect(res.status).toBe(200)

    const data = res.body.data
    // 自描述：本次投影用的档位必须是 CANDIDATE（不是 COUNTERPARTY）
    expect(data.profileAudience).toBe('CANDIDATE')
    expect(data.candidates).toHaveLength(1)

    const candidate = data.candidates[0]
    expect(candidate.userId).toBe('u_e2e_peer')

    // 🔴 投影白名单：**键集恰好**是 {city, displayName} —— 不多不少。
    //    多一个键 = 越权披露；少一个 = 授权的字段没给出去。
    expect(Object.keys(candidate.subject).sort()).toEqual(['city', 'displayName'])

    // 被门控的行只贡献**原因码 + 计数**，不贡献内容
    expect(candidate).not.toHaveProperty('constraints')
    expect(data.considered).toBe(2) // peer + noise（过了门控）；noise 在召回阶段被排除
    expect(data.noCandidatesReason).toBeNull()
    expect(data.gatedOut).toEqual([
      { code: 'intent_not_active', count: 1 },
      { code: 'not_participant', count: 1 },
    ])

    // 值级扫描（API 响应整体）
    const json = JSON.stringify(res.body)
    expect(json).not.toContain(SENTINELS.peerEmail)
    expect(json).not.toContain(SENTINELS.peerBio)
    expect(json).not.toContain(SENTINELS.peerAge)
    // `age` 这个**键**也不该出现（键不存在，而非值为 null）
    expect(Object.prototype.hasOwnProperty.call(candidate.subject, 'age')).toBe(false)
    // 被门控者的正文不得回流（防"gatedOut 里附带了内容"）
    expect(json).not.toContain(SENTINELS.dormantName)
  })
})
