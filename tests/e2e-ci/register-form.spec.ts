import { test, expect, type Page } from '@playwright/test';

/**
 * 注册表单的可访问性（V19.5 · WB19-53）
 * ═══════════════════════════════════════════════════════════════════════
 * 这一组要钉住三件在读屏里会直接「说不清」的事：
 *
 * ① **谁的错误就挂在谁身上**。改造前所有错误塞进一个 `#reg-error` 横幅，
 *    三个输入框同时 `aria-describedby` 指向它，而 DOB 三个下拉和两个勾选框
 *    一个都没接 —— 在最该听清原因的那几个控件上，读屏是沉默的。
 * ② **`aria-describedby` 引用的 id 必须真的存在**。指向一个当前没渲染的节点，
 *    等于没有描述（而且不会报错，只会静默失效）。
 * ③ **校验失败要把焦点送到第一个无效字段**。只把框描红，键盘用户得自己一路摸回去。
 *
 * 多步流程（表单 → 验证码 → 返回）用 `page.route` 拦住发码接口：
 * 测的是**客户端的多步切换与字段语义**，不是邮件服务。真实发信需要 SMTP，
 * 那是另一件事，不在本组用例的射程内（发信链路自身的门禁在别处）。
 */

const PASSWORD = ['v19', 'audit', 'pass'].join('-');

/** 页面上所有 aria-describedby / aria-labelledby 的引用是否都能解析到真实节点。 */
async function danglingIdRefs(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const offenders: string[] = [];
    const attrs = ['aria-describedby', 'aria-labelledby'] as const;
    document.querySelectorAll('*').forEach((el) => {
      for (const attr of attrs) {
        const raw = el.getAttribute(attr);
        if (!raw) continue;
        for (const id of raw.split(/\s+/).filter(Boolean)) {
          if (!document.getElementById(id)) {
            offenders.push(`${el.tagName.toLowerCase()}[${attr}="${id}"]`);
          }
        }
      }
    });
    return offenders;
  });
}

/** 空表单直接提交（表单带 noValidate，走的是 React 校验而不是浏览器原生弹窗）。 */
async function submitEmpty(page: Page) {
  await page.getByRole('button', { name: /Send Verification Code/i }).click();
}

test.describe('注册表单 · 字段语义', () => {
  test('每个可见输入/下拉都有可访问名，且描述引用不悬空', async ({ page }) => {
    await page.goto('/register', { waitUntil: 'domcontentloaded' });

    // 用 Playwright 的「按可访问名找得到」当断言：名字为空时这里直接超时
    await expect(page.getByRole('textbox', { name: /Name/i })).toBeVisible();
    await expect(page.getByRole('textbox', { name: /Email/i })).toBeVisible();
    await expect(page.getByLabel(/Password/i)).toBeVisible();
    await expect(page.getByLabel('Birth year')).toBeVisible();
    await expect(page.getByLabel('Birth month')).toBeVisible();
    await expect(page.getByLabel('Birth day')).toBeVisible();
    await expect(page.getByRole('checkbox', { name: /I agree to the/i })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: /at least 18/i })).toBeVisible();

    expect(await danglingIdRefs(page)).toEqual([]);
  });

  test('密码规则是常驻帮助文本，不是只在 placeholder 里', async ({ page }) => {
    await page.goto('/register', { waitUntil: 'domcontentloaded' });

    const password = page.getByLabel(/Password/i);
    const describedby = (await password.getAttribute('aria-describedby')) ?? '';
    expect(describedby, '密码框应描述到帮助文本').toContain('reg-password-help');

    await password.fill('a');
    // 输入后帮助仍然在（placeholder 此时已经消失）
    await expect(page.locator('#reg-password-help')).toHaveText(/At least 8 characters/);
  });

  test('空表单提交：焦点落到姓名字段，且该字段被标记 aria-invalid', async ({ page }) => {
    await page.goto('/register', { waitUntil: 'domcontentloaded' });
    await submitEmpty(page);

    await expect(page.getByLabel(/Name/i)).toBeFocused();
    await expect(page.getByLabel(/Name/i)).toHaveAttribute('aria-invalid', 'true');

    const describedby = await page.getByLabel(/Name/i).getAttribute('aria-describedby');
    expect(describedby).toBe('reg-name-error');
    await expect(page.locator('#reg-name-error')).toHaveText(/Please enter your name/);

    // 只有出错的字段挂描述，别的字段不该被牵连
    expect(await page.getByLabel(/Email/i).getAttribute('aria-describedby')).toBeNull();
    expect(await danglingIdRefs(page)).toEqual([]);
  });

  test('填了姓名/邮箱/密码但没填生日：焦点落到年份下拉，三个下拉都标错误', async ({ page }) => {
    await page.goto('/register', { waitUntil: 'domcontentloaded' });

    await page.getByLabel(/Name/i).fill('Audit User');
    await page.getByLabel(/Email/i).fill('audit.v195@example.invalid');
    await page.getByLabel(/Password/i).fill(PASSWORD);
    await submitEmpty(page);

    await expect(page.getByLabel('Birth year')).toBeFocused();
    for (const name of ['Birth year', 'Birth month', 'Birth day']) {
      await expect(page.getByLabel(name)).toHaveAttribute('aria-invalid', 'true');
    }
    await expect(page.locator('#reg-dob-error')).toHaveText(/date of birth/i);
    expect(await danglingIdRefs(page)).toEqual([]);
  });

  test('未勾选条款：错误挂在勾选框自己身上，而不是页面顶部横幅', async ({ page }) => {
    await page.goto('/register', { waitUntil: 'domcontentloaded' });

    await page.getByLabel(/Name/i).fill('Audit User');
    await page.getByLabel(/Email/i).fill('audit.v195@example.invalid');
    await page.getByLabel(/Password/i).fill(PASSWORD);
    await page.getByLabel('Birth year').selectOption('1995');
    await page.getByLabel('Birth month').selectOption('05');
    await page.getByLabel('Birth day').selectOption('12');
    await submitEmpty(page);

    await expect(page.getByRole('checkbox', { name: /I agree to the/i })).toBeFocused();
    await expect(page.getByRole('checkbox', { name: /I agree to the/i })).toHaveAttribute(
      'aria-invalid',
      'true'
    );
    await expect(page.locator('#reg-terms-error')).toHaveText(/Terms of Service/);
    expect(await danglingIdRefs(page)).toEqual([]);
  });

  test('改动了出错的字段，错误立刻撤掉（不长期挂着红字）', async ({ page }) => {
    await page.goto('/register', { waitUntil: 'domcontentloaded' });
    await submitEmpty(page);
    await expect(page.locator('#reg-name-error')).toBeVisible();

    await page.getByLabel(/Name/i).fill('A');
    await expect(page.locator('#reg-name-error')).toHaveCount(0);
    await expect(page.getByLabel(/Name/i)).not.toHaveAttribute('aria-invalid', 'true');
  });
});

test.describe('注册表单 · 多步流程', () => {
  test('前进 → 验证码页（6 格有名字）→ 返回 → 表单内容还在', async ({ page }) => {
    // 拦住发码接口：本组只验客户端行为
    await page.route('**/api/auth/register', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'sent', maskedIdentifier: 'a***@example.invalid', devMode: false }),
      });
    });

    await page.goto('/register', { waitUntil: 'domcontentloaded' });
    await page.getByLabel(/Name/i).fill('Audit User');
    await page.getByLabel(/Email/i).fill('audit.v195@example.invalid');
    await page.getByLabel(/Password/i).fill(PASSWORD);
    await page.getByLabel('Birth year').selectOption('1995');
    await page.getByLabel('Birth month').selectOption('05');
    await page.getByLabel('Birth day').selectOption('12');
    await page.getByRole('checkbox', { name: /I agree to the/i }).check();
    await page.getByRole('checkbox', { name: /at least 18/i }).check();
    await submitEmpty(page);

    // 前进：进入验证码页
    await expect(page.getByRole('heading', { name: /Verify Your Email/i })).toBeVisible();
    for (let i = 1; i <= 6; i += 1) {
      await expect(page.getByLabel(new RegExp(`Verification code digit ${i} of 6`))).toBeVisible();
    }
    // 第一格自动聚焦，输入即可推进
    await page.getByLabel(/digit 1 of 6/).fill('1');
    await expect(page.getByLabel(/digit 2 of 6/)).toBeFocused();

    // 返回：回到表单，且之前填的内容没丢
    await page.getByRole('button', { name: /Back to registration/i }).click();
    await expect(page.getByLabel(/Name/i)).toHaveValue('Audit User');
    await expect(page.getByLabel('Birth year')).toHaveValue('1995');
  });
});
