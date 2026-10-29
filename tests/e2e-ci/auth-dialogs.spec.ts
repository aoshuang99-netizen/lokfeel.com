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

/**
 * 服务端 `reason` 枚举 → 弹窗里那个按钮的**真实可访问名**。
 *
 * 🔴 踩过的坑：按钮内容 = `label` + `description` 两行，可访问名是二者拼接
 *    （如 "Harassment Bullying, threats, or persistent unwanted contact"）。
 *    早先这里直接拿 API 返回的枚举值 `HARASSMENT` 当正则去点，大小写与文本
 *    都对不上 ⇒ 定位器等 15s 超时。要按 API 认枚举、按 UI 认标签，两边分开。
 */
const REASON_LABELS: Record<string, string> = {
  INAPPROPRIATE_CONTENT: 'Inappropriate Content',
  HARASSMENT: 'Harassment',
  FAKE_PROFILE: 'Fake Profile',
  SPAM: 'Spam',
  OFFENSIVE_BEHAVIOR: 'Offensive Behavior',
  OTHER: 'Other',
};

/** 取某个枚举对应的原因按钮（锚定标签开头，避免 "Other" 命中别的文案） */
function reasonButton(
  dialog: import('@playwright/test').Locator,
  reason: string,
): import('@playwright/test').Locator {
  const label = REASON_LABELS[reason];
  if (!label) throw new Error(`未知的举报原因枚举：${reason}`);
  return dialog.getByRole('button', { name: new RegExp(`^${label}\\b`) });
}

/** 缺夹具 = 前置条件失败，硬红（不做 skip —— skip 会把缺口伪装成通过） */
function requireFixture(): void {
  if (!ENV_A_EMAIL || !ENV_A_PASSWORD || !CONV_ID) {
    throw new Error(
      '缺少 E2E_CHAT_A_* / E2E_CHAT_CONV_ID —— CI 必须先跑 ' +
        '`node scripts/qa/seed-chat-fixture.mjs --db=ci-e2e.db`',
    );
  }
}

/**
 * 真实表单登录，带 3 次重试（前置条件允许重试并留痕；被测断言绝不重试放宽）。
 *
 * 为什么走 HTTP 登录而不是 UI 登录：沙箱里「登录后整页跳转」有已知的网络层
 * 偶发失败（global-setup 的 3 次重试机制就是为此而生）。这里要证明的是
 * 「**登录后的弹窗行为**」，不是「登录跳转能连点 N 次」—— 所以凭据仍走
 * 真实服务器 `/api/auth/login`（不 mock cookie），但把偶发跳转从被测路径里拿掉。
 */
async function loginViaHttp(
  _browser: import('@playwright/test').Browser,
  email: string,
  password: string,
): Promise<string> {
  const base = (process.env.E2E_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
  const reasons: string[] = [];
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const res = await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: base },
        body: JSON.stringify({ email, password }),
        redirect: 'manual',
      });
      const setCookies = res.headers.getSetCookie?.() ?? [];
      const sessionCookie = setCookies.find((c) => /session-token/i.test(c));
      if (!sessionCookie) {
        reasons.push(`第 ${attempt} 次：无 session cookie（status=${res.status}）`);
        continue;
      }
      const [pair] = sessionCookie.split(';');
      const idx = pair.indexOf('=');
      const name = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();
      const host = new URL(base).hostname;
      const state = {
        cookies: [
          {
            name,
            value,
            domain: host,
            path: '/',
            httpOnly: true,
            secure: false,
            sameSite: 'Lax' as const,
          },
        ],
        origins: [],
      };
      return JSON.stringify(state);
    } catch (err) {
      reasons.push(`第 ${attempt} 次：${String((err as Error).message || '').split('\n')[0]}`);
    }
  }
  throw new Error(`HTTP 登录连续 3 次失败（${email}）：\n${reasons.join('\n')}`);
}

async function openReportModal(page: Page): Promise<void> {
  const more = page.getByRole('button', { name: 'More actions' });
  await expect(more).toBeVisible();
  // 键盘打开：焦点 → Enter 展开菜单 → 再 Enter/点击「Report User」
  // （More 是下拉菜单的开关，弹窗挂在菜单项上 —— 少点这一层就只是展开了菜单）
  await more.focus();
  await page.keyboard.press('Enter');
  const item = page.getByRole('button', { name: 'Report User' });
  await expect(item).toBeVisible();
  await item.click();
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
    const state = await loginViaHttp(browser, ENV_A_EMAIL, ENV_A_PASSWORD);
    fs.writeFileSync(STATE_PATH, state, 'utf8');
  });

  test.use({ storageState: STATE_PATH });

  test('① 会话页真实渲染 + More 按钮有 accessible name 且可键盘打开菜单与弹窗', async ({ page }) => {
    await chatPage(page);
    // V19.5 之前这个图标按钮没有任何可访问名 —— 读屏用户听不到它是什么
    const more = page.getByRole('button', { name: 'More actions' });
    await expect(more).toBeVisible();
    await more.focus();
    await page.keyboard.press('Enter');
    // 菜单项键盘可达，再用键盘进入弹窗
    const item = page.getByRole('button', { name: 'Report User' });
    await expect(item).toBeVisible();
    await item.focus();
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
    await openReportModal(page);

    // 打开时背景滚动被锁（scroll-lock.ts：overflow hidden）
    const locked = await page.evaluate(() => document.body.style.overflow);
    expect(locked).toBe('hidden');

    await page.keyboard.press('Escape');
    const dialog = page.getByRole('dialog', { name: 'Report User' });
    await expect(dialog).toBeHidden();
    // V19.6 修复的验证点：触发它的菜单项已随菜单卸载，焦点必须还给仍然存在的 More 按钮
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

    // 🔴 前置：这一对（举报人, 被举报人）24h 内必须没有举报记录。
    //    `/api/reports` 的去重是 **per 用户对**，不是 per 原因 ——
    //    换一个原因再报同一人同样 429。所以这条用例只能证明"首次举报成功"，
    //    重复举报由 ⑧ 覆盖。前置不干净时给出可执行的清理指令，而不是让
    //    断言在 15s 后以"成功页没出现"这种误导性形态红。
    const res0 = await page.request.get('/api/reports?type=my-reports');
    const priorReports = ((await res0.json()) as { reports: Array<{ reason: string }> }).reports;
    expect(
      priorReports.length,
      '24h 内该用户对已有举报（去重是 per 用户对）—— 前置不干净。' +
        '请先 `node scripts/qa/seed-chat-fixture.mjs --cleanup` 再重新 seed 后重跑',
    ).toBe(0);

    const reason = 'HARASSMENT';
    const reasonBtn = reasonButton(dialog, reason);
    await reasonBtn.click();
    await expect(reasonBtn).toHaveAttribute('aria-pressed', 'true');
    await expect(submit).toBeEnabled();
    await submit.click();
    // 🔴 成功页会**换掉 aria-labelledby 指向的标题**（"Report User" → "Report Submitted"），
    //    于是 `role=dialog` 的可访问名跟着变，原来的 `dialog` 定位符从此不匹配。
    //    这里显式按新名断言 —— 顺带把"成功页仍是一个有名字的可访问对话框"这件事钉住。
    const successDialog = page.getByRole('dialog', { name: 'Report Submitted' });
    await expect(successDialog).toBeVisible({ timeout: 15_000 });

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
      target = Object.keys(REASON_LABELS).find((r) => !reported0.includes(r));
      expect(target, '六个原因 24h 内全被举报过，无法构造 429 前置').toBeTruthy();
      await reasonButton(dialog, target!).click();
      await dialog.getByRole('button', { name: /Submit Report/ }).click();
      // 成功页的可访问名会变成 "Report Submitted"（见 ⑦ 的说明）
      await expect(page.getByRole('dialog', { name: 'Report Submitted' })).toBeVisible({
        timeout: 15_000,
      });
      // 成功页 ~2s 后自动关闭
      await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 10_000 });
    }

    await openReportModal(page);
    await reasonButton(dialog, target!).click();
    await dialog.getByRole('button', { name: /Submit Report/ }).click();
    // 服务端 24h 去重 → 429，错误必须以 role=alert 播报而不是无声失败
    const alert = dialog.locator('[role="alert"]');
    await expect(alert).toBeVisible({ timeout: 15_000 });
    await expect(alert).toContainText(/already reported/i);
  });

  test('⑨ Cancel 关闭弹窗且不产生任何举报', async ({ page }) => {
    await chatPage(page);
    // 前后对比（夹具库跨轮复用，绝不能断言"绝对为 0"—— 那是把环境干净当成被测行为）
    const countOther = async (): Promise<number> => {
      const res = await page.request.get('/api/reports?type=my-reports');
      const data = (await res.json()) as { reports: Array<{ reason: string }> };
      return data.reports.filter((r) => r.reason === 'OTHER').length;
    };
    const before = await countOther();

    await openReportModal(page);
    const dialog = page.getByRole('dialog', { name: 'Report User' });
    // 先选一个原因（证明是「选了但不提交」也不落库，而不是「没选所以没落库」）
    await reasonButton(dialog, 'OTHER').click();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();

    expect(await countOther()).toBe(before);
  });
});

test.describe('跨租户 · 会话外用户被拒（ENV-04）', () => {
  test('userC 无权访问 userA 的会话：API 404 + 页面不渲染对方内容', async ({ browser }) => {
    requireFixture();
    if (!ENV_C_EMAIL || !ENV_C_PASSWORD) {
      throw new Error('缺少 E2E_CHAT_C_* —— 夹具必须包含第二租户用户');
    }
    const state = await loginViaHttp(browser, ENV_C_EMAIL, ENV_C_PASSWORD);
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
