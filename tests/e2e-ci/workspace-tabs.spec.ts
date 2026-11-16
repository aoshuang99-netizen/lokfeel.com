import { test, expect } from '@playwright/test';
import { waitForHydration } from './lib/hydration';

import { VIEWPORTS, assertMobileLayout } from './lib/measure';

/**
 * 移动端 390 / 360 · `/workspace` 的页签（UX-08 的最后一小块）
 * ═══════════════════════════════════════════════════════════════════════
 * `authed-mobile.spec.ts` 量的是**页面级**版面（只进 Now 那一屏）；而 `/workspace`
 * 是同一路由里的多个视图，非默认屏"页面级没溢出"完全不代表它们没溢出。
 *
 * V22 · DEV03（信息架构迁移）：导航从「7 个平铺 label」改成
 *   · 一级 4 个中文主任务（直接可见）：开始 / 我的任务 / 待我确认 / 成果
 *   · 二级「更多」3 项（先展开再点）：方案编辑 / 关系网络 / 执行记录
 * 7 个内部 key 一个没删，`?view=` 深链接全部保留 —— 本夹具把
 * now / studio / field / consent / outcomes / agents / missions 七个 key 全覆盖。
 *
 * 🔴 切没切过去：每步都先证 URL 的 view 真的落到了对应 key，否则量的可能是
 *    上一屏，"全绿"也是假的。`workspace-view.ts` 会刻意省略默认视图的
 *    `?view=now`（保持链接干净），所以"参数缺省"即等价于 now —— 与
 *    `workspace-now.spec.ts:121` 完全同一口径。
 *
 * 登录态与 `authed-mobile.spec.ts` 同源：`global-setup.ts` 登录一次产出 storageState。
 */

const AUTHED_STATE = 'test-results/authed-state.json';

/**
 * 与 `src/app/workspace/living-workspace.tsx` 的 `NAV` 保持一致（标签即 accessible name）。
 * `tier` 对应 `LivingNavItem['tier']`：'primary' 直接可见，'more' 收进「更多」。
 * 改名不改 key —— 这里的 key 就是 URL `?view=` 的值，7 个全覆盖。
 */
const VIEWS = [
  { key: 'now', label: '开始', tier: 'primary' },
  { key: 'missions', label: '我的任务', tier: 'primary' },
  { key: 'consent', label: '待我确认', tier: 'primary' },
  { key: 'outcomes', label: '成果', tier: 'primary' },
  { key: 'studio', label: '方案编辑', tier: 'more' },
  { key: 'field', label: '关系网络', tier: 'more' },
  { key: 'agents', label: '执行记录', tier: 'more' },
] as const;

const PRIMARY_VIEWS = VIEWS.filter((v) => v.tier === 'primary');
const MORE_VIEWS = VIEWS.filter((v) => v.tier === 'more');

/** 「更多」触发按钮与展开分组的 accessible name（见 living-shell.tsx）。 */
const MORE_TRIGGER = '更多';
const MORE_GROUP = '更多视图';

test.use({ storageState: AUTHED_STATE });

test.describe('移动端 · /workspace 页签（V22 新 IA）', () => {
  for (const vp of VIEWPORTS) {
    // ── 结构断言：一级 4 个直接可见 → 点「更多」→ 3 个二级可见且可点 ──
    test(`${vp.id} · 新 IA：4 个一级 + 「更多」里 3 个二级`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      const res = await page.goto('/workspace', { waitUntil: 'domcontentloaded' });
      expect(res?.status(), 'GET /workspace 应 200（登录态）').toBeLessThan(400);
      expect(new URL(page.url()).pathname, '/workspace 不应跳回 /login').not.toBe('/login');

      const nav = page.getByRole('navigation', { name: '工作区导航' });
      await expect(nav).toBeVisible();

      // 4 个一级主任务：不展开任何菜单就必须直接可见、可点。
      for (const view of PRIMARY_VIEWS) {
        const tab = nav.getByRole('button', { name: view.label, exact: true });
        await expect(tab, `一级「${view.label}」应直接可见`).toBeVisible();
        await expect(tab, `一级「${view.label}」应可点`).toBeEnabled();
      }

      // 点击前必须等水合（V19.8 踩坑）：否则点击走原生提交、视图不切换。
      await waitForHydration(page, '[aria-label="工作区导航"]');
      const moreTrigger = nav.getByRole('button', { name: MORE_TRIGGER, exact: true });
      await expect(moreTrigger, '应有「更多」触发按钮').toBeVisible();
      await moreTrigger.click();
      await expect(moreTrigger, '点后「更多」应展开').toHaveAttribute('aria-expanded', 'true');

      const group = page.getByRole('group', { name: MORE_GROUP });
      await expect(group, '「更多视图」分组应出现').toBeVisible();
      for (const view of MORE_VIEWS) {
        const tab = group.getByRole('button', { name: view.label, exact: true });
        await expect(tab, `二级「${view.label}」应可见`).toBeVisible();
        await expect(tab, `二级「${view.label}」应可点`).toBeEnabled();
      }
    });

    // ── 逐屏切换：7 个 key 全覆盖，点完证 URL ?view=，再量该屏版面 ──
    for (const view of VIEWS) {
      const inMore = view.tier === 'more';
      test(`${vp.id} · 页签 ${view.label} → ?view=${view.key}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });

        const res = await page.goto('/workspace', { waitUntil: 'domcontentloaded' });
        expect(res?.status(), 'GET /workspace 应 200（登录态）').toBeLessThan(400);
        expect(new URL(page.url()).pathname, '/workspace 不应跳回 /login').not.toBe('/login');

        const nav = page.getByRole('navigation', { name: '工作区导航' });
        await waitForHydration(page, '[aria-label="工作区导航"]');

        let tab;
        if (inMore) {
          // 二级项：先展开「更多」，再从分组内定位 —— 证明确实走的是二级菜单。
          const moreTrigger = nav.getByRole('button', { name: MORE_TRIGGER, exact: true });
          await moreTrigger.click();
          const group = page.getByRole('group', { name: MORE_GROUP });
          await expect(group, '「更多」应展开后再点二级项').toBeVisible();
          tab = group.getByRole('button', { name: view.label, exact: true });
        } else {
          tab = nav.getByRole('button', { name: view.label, exact: true });
        }

        await expect(tab, `导航里应有「${view.label}」按钮`).toBeVisible();
        await tab.click();

        // 先证前置：URL 的 view 真的落到了这个 key（now 为默认视图、省略参数）。
        // expect.poll 抵消 pushState / React 批处理带来的时序抖动，避免假红。
        await expect
          .poll(() => new URL(page.url()).searchParams.get('view') ?? 'now')
          .toBe(view.key);
        const current = new URL(page.url());
        if (view.key !== 'now') {
          expect(current.search, 'URL 应显式带 ?view=<key>').toContain(`view=${view.key}`);
        } else {
          expect(current.search, '默认 now 视图不应残留 view 参数').not.toContain('view=');
        }

        // 一级项点完仍在 DOM：用 aria-current 再钉一次"确实切了"；
        // 二级项点完菜单收起、按钮从 DOM 移除，改由「更多」触发按钮的高亮
        // aria-label（activeInside）证明当前视图确实落在二级分组里。
        if (!inMore) {
          await expect(tab, `「${view.label}」应成为当前视图`).toHaveAttribute(
            'aria-current',
            'page',
          );
        } else {
          const activeMoreTrigger = nav.getByRole('button', {
            name: '更多（当前视图在此分组）',
            exact: true,
          });
          await expect(activeMoreTrigger, '当前视图应落在「更多」分组内').toBeVisible();
        }

        await assertMobileLayout(page, {
          viewportId: vp.id,
          route: `/workspace · 页签 ${view.label}`,
        });
      });
    }
  }
});
