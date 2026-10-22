import { test, expect } from '@playwright/test';

import { VIEWPORTS, assertMobileLayout } from './lib/measure';

/**
 * 移动端 390 / 360 · `/workspace` 的**六个页签**（UX-08 的最后一小块）
 * ═══════════════════════════════════════════════════════════════════════
 * 为什么还要单独一组
 * ----------------
 * `authed-mobile.spec.ts` 量的是**页面级**版面：`/workspace` 只进去了 Now 那一屏。
 * 而 `/workspace` 是同一个路由里的六个视图（Now / Studio / Field / Consent /
 * Outcomes / Agents），**五个都不是默认屏** —— 页面级"没溢出"完全不代表它们没溢出。
 * 这正是 UX-08 一直挂着 BLOCKED 的最后一条理由。
 *
 * 🔴 关键陷阱：切没切过去
 * --------------------
 * 如果点击失败或视图没换，六次量的都是 Now，结果"全绿"却是假的。
 * 所以每一步都先证前置：点完之后那个按钮必须带 `aria-current="page"`。
 * 这不是多余的断言 —— 它是"我确实量了另一屏"的唯一证据。
 *
 * 登录态与 `authed-mobile.spec.ts` 同源：`global-setup.ts` 登录一次产出 storageState。
 */

const AUTHED_STATE = 'test-results/authed-state.json';

/** 与 `src/app/workspace/living-workspace.tsx` 的 `NAV` 保持一致（标签即 accessible name）。 */
const VIEWS = [
  { key: 'now', label: 'Now' },
  { key: 'studio', label: 'Studio' },
  { key: 'field', label: 'Field' },
  { key: 'consent', label: 'Consent' },
  { key: 'outcomes', label: 'Outcomes' },
  { key: 'agents', label: 'Agents' },
] as const;

test.use({ storageState: AUTHED_STATE });

test.describe('移动端 · /workspace 页签', () => {
  for (const vp of VIEWPORTS) {
    for (const view of VIEWS) {
      test(`${vp.id} · 页签 ${view.label}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });

        const res = await page.goto('/workspace', { waitUntil: 'domcontentloaded' });
        expect(res?.status(), 'GET /workspace 应 200（登录态）').toBeLessThan(400);
        expect(new URL(page.url()).pathname, '/workspace 不应跳回 /login').not.toBe('/login');

        const nav = page.getByRole('navigation', { name: '工作区导航' });
        const tab = nav.getByRole('button', { name: view.label, exact: true });
        await expect(tab, `导航里应有「${view.label}」按钮`).toBeVisible();

        await tab.click();

        // 先证前置：真的切到了这一屏（否则下面量的是上一屏，绿也是假的）
        await expect(tab, `点击后「${view.label}」应成为当前视图`).toHaveAttribute(
          'aria-current',
          'page',
        );

        await assertMobileLayout(page, {
          viewportId: vp.id,
          route: `/workspace · 页签 ${view.label}`,
        });
      });
    }
  }
});
