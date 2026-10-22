import { test, expect } from '@playwright/test';

import { VIEWPORTS, assertMobileLayout } from './lib/measure';

/**
 * 移动端 390 / 360 · **认证面**（V18-06 · UX-08 · UX-12 的前半段）
 * ═══════════════════════════════════════════════════════════════════════
 * 为什么单独一组
 * ------------
 * `mobile.spec.ts` 只能测公开面 —— CI 里原本**没有任何可登录的账号**（库是每次现建的）。
 * 于是"登录之后的页面在手机上什么样子"一直没证据，而那恰恰是产品本体。
 *
 * 这组用例用 `scripts/qa/seed-authed-e2e-user.mjs` 造的夹具，走**真实登录表单**
 * （不是注入 cookie）：填 `#login-email` / `#login-password` → 提交 → 等离开 /login。
 * 这样顺带证明了登录链路本身在构建产物里可用。
 *
 * 🔴 不跳过、不静默
 * ------------
 * 缺少 `E2E_AUTHED_EMAIL` / `E2E_AUTHED_PASSWORD` 时**判红**，不 `test.skip`。
 * 跳过会让"没测"看起来像"通过"；而这正是这一组用例存在的理由。
 * （本仓规矩：不为让 CI 变绿而增加跳过。）
 *
 * ⚠️ 只读：登录后只 GET，不点任何写操作按钮。
 */

const EMAIL = process.env.E2E_AUTHED_EMAIL ?? '';
const PASSWORD = process.env.E2E_AUTHED_PASSWORD ?? '';

/** 认证后的核心面：工作台 + 组织控制台 + 任务列表（三处最容易被挤坏的地方） */
const AUTHED_ROUTES: Array<{ path: string; name: string }> = [
  { path: '/workspace', name: 'Living Workspace' },
  { path: '/console', name: '组织控制台' },
  { path: '/console/missions', name: '任务列表' },
];

test.describe('移动端 · 认证面（真实登录）', () => {
  test.beforeEach(async ({ page }) => {
    expect(
      EMAIL,
      '缺少 E2E_AUTHED_EMAIL —— CI 必须先跑 `node scripts/qa/seed-authed-e2e-user.mjs --db=ci-e2e.db`',
    ).not.toBe('');
    expect(
      PASSWORD,
      '缺少 E2E_AUTHED_PASSWORD —— 同上，由造数脚本写进 $GITHUB_ENV',
    ).not.toBe('');

    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    await page.fill('#login-email', EMAIL);
    await page.fill('#login-password', PASSWORD);
    await page.click('button[type="submit"]');

    // 先证前置：登录真的成功了。拿不到会话时，后面所有页面都会跳回 /login，
    // 那时候的"没有溢出"毫无意义 —— 测的是登录页。
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 });
  });

  for (const vp of VIEWPORTS) {
    for (const route of AUTHED_ROUTES) {
      test(`${vp.id} · ${route.name} ${route.path}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });

        const res = await page.goto(route.path, { waitUntil: 'domcontentloaded' });
        expect(res?.status(), `GET ${route.path} 应 200（登录态）`).toBeLessThan(400);

        // 没被踢回登录页 —— 否则测的是登录页而不是这个面
        expect(new URL(page.url()).pathname, `${route.path} 不应跳回 /login`).not.toBe('/login');

        await assertMobileLayout(page, { viewportId: vp.id, route: route.path });
      });
    }
  }
});
