import { test, expect, type Page } from '@playwright/test';

/**
 * 确认对话框的**真实键盘行为**（V19.5 · WB19-52）
 * ═══════════════════════════════════════════════════════════════════════
 * `tests/a11y/focus-trap.test.ts` 证明的是「算得对」，这里证明的是
 * 「按下去之后浏览器真的把焦点挪了」。两者不能互相替代：
 * 把 `nextFocusIndex` 的返回值算对、却忘了 `preventDefault()`，纯函数测试全绿而用户依旧 Tab 跑出弹窗。
 *
 * 被测面：`/dashboard/settings` → Privacy 页签 → Danger Zone → Delete Account。
 * 它是最该防误触的一类：`variant="danger"`，确认按钮会真的删账号。
 * 所以「初始焦点必须落在取消上」不是审美偏好，是这一屏的安全属性。
 *
 * ⚠️ 只打开、只关闭，绝不点确认。
 */

const AUTHED_STATE = 'test-results/authed-state.json';
test.use({ storageState: AUTHED_STATE });

/** 打开 Delete Account 对话框，返回触发按钮，便于后面断言焦点回收到它身上。 */
async function openDeleteDialog(page: Page) {
  await page.goto('/dashboard/settings', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Privacy', exact: true }).click();

  const trigger = page.getByRole('button', { name: 'Delete', exact: true });
  await expect(trigger).toBeVisible({ timeout: 15_000 });
  await trigger.click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  return { trigger, dialog };
}

test.describe('ConfirmDialog · 键盘与语义', () => {
  /**
   * 视口维度：默认用例跑 1280×720（配置默认值）。
   * 这里补 390（移动）与 1440（桌面宽屏）两档，因为「弹窗被挤成什么形状」会改变
   * 可聚焦元素的实际可见性 —— 而被 `isVisible()` 过滤掉一个按钮，Tab 圈就少一格。
   * 768 平板不做单独一档：它的布局规则与 390 同属单列断点，由既有移动端用例覆盖版面。
   */
  for (const vp of [
    { id: '390×844', width: 390, height: 844 },
    { id: '1440×900', width: 1440, height: 900 },
  ]) {
    test.describe(`视口 ${vp.id}`, () => {
      test.use({ viewport: { width: vp.width, height: vp.height } });

      test('初始焦点 + Tab 圈定（视口相关）', async ({ page }) => {
        const { dialog } = await openDeleteDialog(page);

        await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();

        await page.keyboard.press('Tab');
        await expect(page.getByRole('button', { name: 'Delete Account', exact: true })).toBeFocused();

        await page.keyboard.press('Tab');
        await expect(page.getByRole('button', { name: 'Cancel' })).toBeFocused();

        const inDialog = await page.evaluate(() => {
          const el = document.activeElement;
          const dlg = document.querySelector('[role="dialog"]');
          return !!el && !!dlg && dlg.contains(el);
        });
        expect(inDialog).toBe(true);

        // 移动视口下背景滚动锁同样要生效（弹窗超屏时最容易露出破绽）
        expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');
      });
    });
  }

  test('语义完整：role/aria-modal/labelledby/describedby 都指向真实节点', async ({ page }) => {
    const { dialog } = await openDeleteDialog(page);

    await expect(dialog).toHaveAttribute('aria-modal', 'true');

    const labelledby = await dialog.getAttribute('aria-labelledby');
    const describedby = await dialog.getAttribute('aria-describedby');
    expect(labelledby, '必须用 aria-labelledby 关联标题').toBeTruthy();
    expect(describedby, '有 description 时必须关联描述').toBeTruthy();

    // 指向的 id 必须唯一且真的存在 —— 硬编码 id="dialog-title" 时，
    // 页面上两个 ConfirmDialog 同时挂载就会有重复 id，读屏可能念到另一份文案。
    for (const id of [labelledby!, describedby!]) {
      const count = await page.locator(`[id="${id}"]`).count();
      expect(count, `id=${id} 在页面上必须唯一`).toBe(1);
    }

    await expect(page.locator(`[id="${labelledby}"]`)).toHaveText('Delete Account');
    await expect(page.locator(`[id="${describedby}"]`)).toContainText('cannot be undone');
  });

  test('初始焦点落在「取消」而不是破坏性按钮', async ({ page }) => {
    const { dialog } = await openDeleteDialog(page);

    const focused = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? '');
    expect(focused, '危险操作确认框的初始焦点必须是取消').toBe('Cancel');
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  });

  test('Tab 不跑出弹窗，并在末位回卷到「取消」', async ({ page }) => {
    await openDeleteDialog(page);

    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Delete Account', exact: true })).toBeFocused();

    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeFocused();

    // 再按一次仍然在圈内（背景页面的链接/按钮一个都不该拿到焦点）
    await page.keyboard.press('Tab');
    const inDialog = await page.evaluate(() => {
      const el = document.activeElement;
      const dialog = document.querySelector('[role="dialog"]');
      return !!el && !!dialog && dialog.contains(el);
    });
    expect(inDialog, 'Tab 三轮之后焦点必须仍在 dialog 内').toBe(true);
  });

  test('Shift+Tab 反向回卷到最后一个可聚焦元素', async ({ page }) => {
    await openDeleteDialog(page);

    await page.keyboard.press('Shift+Tab');
    await expect(page.getByRole('button', { name: 'Delete Account', exact: true })).toBeFocused();

    await page.keyboard.press('Shift+Tab');
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeFocused();
  });

  test('Escape 关闭并把焦点还给触发按钮', async ({ page }) => {
    const { trigger } = await openDeleteDialog(page);

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('取消按钮关闭后同样把焦点还给触发按钮', async ({ page }) => {
    const { trigger, dialog } = await openDeleteDialog(page);

    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('背景滚动锁：开时锁住，关后恢复原值', async ({ page }) => {
    await openDeleteDialog(page);
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
  });

  test('关闭后焦点不会丢到 body 上', async ({ page }) => {
    await openDeleteDialog(page);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();

    const tag = await page.evaluate(() => document.activeElement?.tagName ?? '');
    expect(tag, '焦点必须回到某个真实控件，不能掉到 BODY').not.toBe('BODY');
  });
});
