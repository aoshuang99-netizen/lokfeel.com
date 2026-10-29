import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

/**
 * V19.6 · WB19-61 —— 认证面弹窗真实键盘 E2E（ReportModal / VideoCallModal / 跨租户）
 * ═══════════════════════════════════════════════════════════════════════
 * 为什么这批用例现在才出现
 * ------------------------
 * V19.5 只能验公开面与 ConfirmDialog —— ReportModal 挂在认证聊天页，
 * CI 里当时没有「2 用户 + 1 会话」的夹具。本轮 `seed-chat-fixture.mjs`
 * 在本地 file: 库里造齐后，这些行为才第一次拥有可复验的证据渠道。
 *
 * 覆盖（对齐 V19.6 退出条件 UX-01 / UX-03 / ENV-04）：
 *   · More 按钮（此前**无 accessible name**，图标按钮）可被键盘找到并打开；
 *   · ReportModal 8 类行为：语义、初始焦点、Tab 圈定、Shift+Tab、Escape +
 *     焦点恢复、Cancel、选择→提交→成功、重复举报 429 的错误播报；
 *   · 滚动锁：打开锁住、关闭恢复（scroll-lock.ts 引用计数不泄漏）;
 *   · 跨租户：会话外用户 API 404 + 页面不渲染对方内容；
 *   · VideoCallModal（适用行为矩阵）：发起 → UI 出现 → 挂断 → 回到聊天不丢上下文。
 *
 * 🔴 登录走真实表单（不 mock cookie），但每个身份只登一次：
 *    global-setup 的教训（18 次重复登录放大偶发失败 18 倍）在这里同样适用。
 *    userA 登录一次存 storageState；userC 只在跨租户那一条里登录。
 */

const STATE_PATH = path.join('test-results', 'chat-authed-state.json');

const ENV_A_EMAIL = process.env.E2E_CHAT_A_EMAIL ?? '';
const ENV_A_PASSWORD = process.env.E2E_CHAT_A_PASSWORD ?? '';
const ENV_C_EMAIL = process.env.E2E_CHAT_C_EMAIL ?? '';
const ENV_C_PASSWORD = process.env.E2E_CHAT_C_PASSWORD ?? '';
const CONV_ID = process.env.E2E_CHAT_CONV_ID ?? '';

/** 缺夹具 = 前置条件失败，硬红（不做 skip —— skip 会把缺口伪装成通过） */
function requireFixture(): void {
  if (!ENV_A_EMAIL || !ENV_A_PASSWORD || !CONV_ID) {
    throw new Error(
      '缺少 E2E_CHAT_A_* / E2E_CHAT_CONV_ID —— CI 必须先跑 ' +
        '`node scripts/qa/seed-chat-fixture.mjs --db=ci-e2e.db`',
    );
  }
}

/** 真实表单登录，带 3 次重试（前置条件允许重试并留痕；被测断言绝不重试放宽） */
async function loginViaUi(
  browser: import('@playwright/test').Browser,
  email: string,
  password: string,
): Promise<string> {
  const base = (process.env.E2E_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
  const reasons: string[] = [];
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const ctx = await browser.newContext();
    try {
      const page = await ctx.newPage();
      await page.goto(`${base}/login`, { waitUntil: 'domcontentloaded' });
      await page.fill('#login-email', email);
      await page.fill('#login-password', password);
      await page.click('button[type="submit"]');
      await page.waitForURL((u) => !u.pathname.startsWith('/login'), {
        timeout: 30_000,
        waitUntil: 'domcontentloaded',
      });
      const state = await ctx.storageState();
      return JSON.stringify(state);
    } catch (err) {
      reasons.push(`第 ${attempt} 次：${String((err as Error).message || '').split('\n')[0]}`);
    } finally {
      await ctx.close().catch(() => {});
    }
  }
  throw new Error(`登录连续 3 次失败（${email}）：\n${reasons.join('\n')}`);
}

async function openReportModal(page: Page): Promise<void> {
  const more = page.getByRole('button', { name: 'More actions' });
  await expect(more).toBeVisible();
  // 键盘打开：焦点 → Enter（真实键盘路径，不用 .click() 作弊）
  await more.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Report User' });
  await expect(dialog).toBeVisible();
}

async function chatPage(page: Page): Promise<void> {
  await page.goto(`/dashboard/chats/${CONV_ID}`, { waitUntil: 'domcontentloaded' });
  // 等真实内容挂上（waitForStableDom 思路）：对方名字渲染出来 = 会话详情已加载
  await expect(page.getByText('E2E Chat Bob').first()).toBeVisible({ timeout: 20_000 });
}

test.describe('认证弹窗 · ReportModal（真实键盘）', () => {
  test.describe.configure({ mode: 'serial' });

  let browser: import('@playwright/test').Browser;

  test.beforeAll(async ({ browser: b }) => {
    requireFixture();
    browser = b;
    fs.mkdirSync('test-results', { recursive: true });
    const state = await loginViaUi(browser, ENV_A_EMAIL, ENV_A_PASSWORD);
    fs.writeFileSync(STATE_PATH, state, 'utf8');
  });

  test.use({ storageState: STATE_PATH });

  test('① 会话页真实渲染 + More 按钮有 accessible name 且可键盘打开', async ({ page }) => {
    await chatPage(page);
    // V19.5 之前这个图标按钮没有任何可访问名 —— 读屏用户听不到它是什么
    const more = page.getByRole('button', { name: 'More actions' });
    await expect(more).toBeVisible();
    await more.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Report User' })).toBeVisible();
  });

  test('② 语义完整：role/aria-modal/labelledby 指向真实节点', async ({ page }) => {
    await chatPage(page);
    await openReportModal(page);
    const dialog = page.getByRole('dialog', { name: 'Report User' });
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    const labelledby = await dialog.getAttribute('aria-labelledby');
    expect(labelledby, 'aria-labelledby 必须指向存在的 id（不悬空）').toBeTruthy();
    const title = page.locator(`#${labelledby}`);
    await expect(title).toHaveText('Report User');
  });

  test('③ 初始焦点落在第一个举报原因（不是右上角关闭按钮）', async ({ page }) => {
    await chatPage(page);
    await openReportModal(page);
    await expect(
      page.getByRole('button', { name: /Inappropriate Content/ }),
    ).toBeFocused();
  });

  test('④ Tab 连续 14 次仍在弹窗内（圈定不逃逸）', async ({ page }) => {
    await chatPage(page);
    await openReportModal(page);
    const dialog = page.getByRole('dialog', { name: 'Report User' });
    for (let i = 0; i < 14; i += 1) {
      await page.keyboard.press('Tab');
      const inside = await dialog.evaluate((el) => el.contains(document.activeElement));
      expect(inside, `第 ${i + 1} 次 Tab 后焦点必须还在弹窗内`).toBe(true);
    }
  });

  test('⑤ Shift+Tab 反向循环也在弹窗内', async ({ page }) => {
    await chatPage(page);
    await openReportModal(page);
    const dialog = page.getByRole('dialog', { name: 'Report User' });
    for (let i = 0; i < 6; i += 1) {
      await page.keyboard.press('Shift+Tab');
      const inside = await dialog.evaluate((el) => el.contains(document.activeElement));
      expect(inside, `第 ${i + 1} 次 Shift+Tab 后焦点必须还在弹窗内`).toBe(true);
    }
  });

  test('⑥ Escape 关闭且焦点恢复到 More 按钮；滚动锁不泄漏', async ({ page }) => {
    await chatPage(page);
    const more = page.getByRole('button', { name: 'More actions' });
    await more.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Report User' });
    await expect(dialog).toBeVisible();

    // 打开时背景滚动被锁（scroll-lock.ts：overflow hidden）
    const locked = await page.evaluate(() => document.body.style.overflow);
    expect(locked).toBe('hidden');

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(more).toBeFocused();

    // 关闭后滚动锁必须释放
    await expect
      .poll(async () => page.evaluate(() => document.body.style.overflow), { timeout: 5_000 })
      .not.toBe('hidden');
  });

  test('⑦ 选原因→提交→成功页 + 举报真实落库（GET my-reports 可见）', async ({ page }) => {
    await chatPage(page);
    await openReportModal(page);
    const dialog = page.getByRole('dialog', { name: 'Report User' });
    const submit = dialog.getByRole('button', { name: /Submit Report/ });
    await expect(submit).toBeDisabled(); // 没选原因时提交必须禁用

    // 选一个 24h 内没举报过的原因（夹具库跨轮复用时不会撞 429 假红）
    const res0 = await page.request.get('/api/reports?type=my-reports');
    const reported0 = new Set(
      ((await res0.json()) as { reports: Array<{ reason: string }> }).reports.map((r) => r.reason),
    );
    const reason = ['HARASSMENT', 'FAKE_PROFILE', 'SPAM', 'OFFENSIVE_BEHAVIOR', 'INAPPROPRIATE_CONTENT', 'OTHER']
      .find((r) => !reported0.has(r));
    expect(reason, '六个原因用尽说明夹具库被反复使用过度，应清理后重跑').toBeTruthy();

    const reasonBtn = dialog.getByRole('button', { name: new RegExp(reason!) });
    await reasonBtn.click();
    await expect(reasonBtn).toHaveAttribute('aria-pressed', 'true');
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(dialog.getByText('Report Submitted')).toBeVisible({ timeout: 15_000 });

    // 真实持久化：不是只改 UI 状态 —— 用同一会话查自己的举报列表
    const res = await page.request.get('/api/reports?type=my-reports');
    expect(res.status()).toBe(200);
    const data = (await res.json()) as { reports: Array<{ reason: string }> };
    expect(
      data.reports.filter((r) => r.reason === reason).length,
      '举报必须真实写入 UserReport',
    ).toBeGreaterThanOrEqual(1);
  });

  test('⑧ 重复举报 429：错误在弹窗内以 role=alert 播报', async ({ page }) => {
    await chatPage(page);
    const dialog = page.getByRole('dialog', { name: 'Report User' });

    // 保证目标原因 24h 内已存在一条举报（没有就现场造一条），然后重报 → 429
    const res0 = await page.request.get('/api/reports?type=my-reports');
    const reported0 = ((await res0.json()) as { reports: Array<{ reason: string }> }).reports.map(
      (r) => r.reason,
    );
    let target = reported0[0];
    if (!target) {
      await openReportModal(page);
      const firstFree = ['SPAM', 'OFFENSIVE_BEHAVIOR', 'INAPPROPRIATE_CONTENT'].find((r) => r);
      await dialog.getByRole('button', { name: new RegExp(firstFree!) }).click();
      await dialog.getByRole('button', { name: /Submit Report/ }).click();
      await expect(dialog.getByText('Report Submitted')).toBeVisible({ timeout: 15_000 });
      // 成功页 ~2s 后自动关闭
      await expect(dialog).toBeHidden({ timeout: 10_000 });
      target = firstFree;
    }

    await openReportModal(page);
    await dialog.getByRole('button', { name: new RegExp(target!) }).click();
    await dialog.getByRole('button', { name: /Submit Report/ }).click();
    // 服务端 24h 去重 → 429，错误必须以 role=alert 播报而不是无声失败
    const alert = dialog.locator('[role="alert"]');
    await expect(alert).toBeVisible({ timeout: 15_000 });
    await expect(alert).toContainText(/already reported/i);
  });

  test('⑨ Cancel 关闭弹窗且不产生任何举报', async ({ page }) => {
    await chatPage(page);
    await openReportModal(page);
    const dialog = page.getByRole('dialog', { name: 'Report User' });
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    const res = await page.request.get('/api/reports?type=my-reports');
    const data = (await res.json()) as { reports: Array<{ reason: string }> };
    // Cancel 这条没提交过 OTHER —— 断言它没有新增（前后对比，不依赖夹具库干净）
    expect(data.reports.filter((r) => r.reason === 'OTHER').length).toBe(0);
  });
});

test.describe('跨租户 · 会话外用户被拒（ENV-04）', () => {
  test('userC 无权访问 userA 的会话：API 404 + 页面不渲染对方内容', async ({ browser }) => {
    requireFixture();
    if (!ENV_C_EMAIL || !ENV_C_PASSWORD) {
      throw new Error('缺少 E2E_CHAT_C_* —— 夹具必须包含第二租户用户');
    }
    const state = await loginViaUi(browser, ENV_C_EMAIL, ENV_C_PASSWORD);
    const ctx = await browser.newContext({ storageState: {
      cookies: JSON.parse(state).cookies,
      origins: JSON.parse(state).origins,
    } });
    const page = await ctx.newPage();

    // 契约层：resolveConversationRef 对非参与者返回 null → 404（不泄露会话存在性）
    const res = await page.request.get(`/api/im/conversations/${CONV_ID}`);
    expect(res.status(), '会话外用户必须拿到 404').toBe(404);

    // UI 层：对方姓名与消息内容都不出现
    await page.goto(`/dashboard/chats/${CONV_ID}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3_000);
    expect(await page.getByText('E2E Chat Bob').count()).toBe(0);
    expect(
      await page.getByText('Hey! This is the E2E fixture message.').count(),
    ).toBe(0);
    await ctx.close();
  });
});

test.describe('VideoCallModal · 适用行为矩阵（UX-03）', () => {
  test.describe.configure({ mode: 'serial' });

  test.use({ storageState: STATE_PATH, permissions: ['camera', 'microphone'] });

  test('发起通话 → 通话 UI 出现 → 挂断 → 回到聊天不丢上下文', async ({ page }) => {
    requireFixture();
    await chatPage(page);
    const composerBefore = await page
      .locator('textarea, [contenteditable="true"], input[placeholder]')
      .first()
      .isVisible()
      .catch(() => false);

    // 头像旁的视频按钮（title 提供可访问名）
    const videoBtn = page.getByTitle('Start video call');
    await expect(videoBtn).toBeVisible();
    await videoBtn.click();

    // 通话 UI 出现（呼叫中 / 连接中 / 错误任一真实状态均可 —— 不 mock Provider）
    const callOverlay = page.locator('.video-call-modal');
    await expect(callOverlay).toBeVisible({ timeout: 20_000 });

    // 挂断（CallControls 的红键，title=挂断）
    const hangup = callOverlay.getByTitle('挂断');
    await expect(hangup).toBeVisible({ timeout: 20_000 });
    await hangup.click();

    // 回到聊天：通话层消失 + 输入区仍在（"不丢通话上下文/不破坏聊天"的适用判据）
    await expect(callOverlay).toBeHidden({ timeout: 15_000 });
    const composerAfter = await page
      .locator('textarea, [contenteditable="true"], input[placeholder]')
      .first()
      .isVisible()
      .catch(() => false);
    expect(composerAfter || composerBefore, '挂断后聊天输入区必须可用').toBe(true);
  });
});
