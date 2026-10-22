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
 * 登录态从哪来（2026-10-22 改）
 * ------------
 * 不再每条用例各登一次，改为 **globalSetup 登录一次 → storageState**。
 * 原因不是"登录太难测"，而是实测数据：18 次登录里约 1/3 会死在
 * 「登录后整页跳到 `/dashboard` → 307 → `/dashboard/explore`」这一跳上报 `net:ERR_FAILED`，
 * 且每轮失败的用例都不一样。已用证据排除服务端侧原因（307 的 `has: cookie` 条件、
 * 服务端零错误行、纯 HTTP 探针 3 轮全绿）。这 18 条用例要证明的是**版面**，
 * 不是"登录能连点 18 次"——后者把偶发失败放大了 18 倍，却不多证明任何东西。
 * 登录本身仍被门禁覆盖：`global-setup.ts`（起不来就整轮失败）+ 纯 HTTP 探针。
 *
 * 🔴 不跳过、不静默
 * ------------
 * 缺少夹具凭据时 globalSetup 会硬失败（不 `test.skip`）：
 * 跳过会让"没测"看起来像"通过"，而这正是这一组用例存在的理由。
 *
 * ⚠️ 只读：登录后只 GET，不点任何写操作按钮。
 */

/** globalSetup 产出的登录态（路径与 `global-setup.ts` 保持一致）。 */
const AUTHED_STATE = 'test-results/authed-state.json';

test.use({ storageState: AUTHED_STATE });

/**
 * 认证后的核心面（V18-06 第二轮 · 2026-10-22）
 *
 * 第一轮只放了 3 个路由（`/workspace`、`/console`、`/console/missions`），
 * 理由是"三处最容易被挤坏"；但那是在挑样本，不是在覆盖。组织态一共七屏，
 * 漏掉的四屏里 `members` 有一行多列的成员表、`agents` 有额度与长原因文本、
 * `settings` 有表单行 —— 恰恰是 390px 最容易横向溢出的形态。
 * 这里补齐组织态七屏，并加入本轮新做的取消订阅入口所在页
 * （`/dashboard/subscription`：那是唯一一处新增 UI，必须自己进闸门）。
 *
 * ⚠️ `/dashboard/chats*` 刻意不在列表里：它开 WebSocket，稳定判定会退化成超时，
 *    用一个会超时的用例去证明"版面没问题"，结论是不可信的。
 */
const AUTHED_ROUTES: Array<{ path: string; name: string }> = [
  { path: '/workspace', name: 'Living Workspace' },
  { path: '/console', name: '组织总览' },
  { path: '/console/missions', name: '任务列表' },
  { path: '/console/connections', name: '连接屏' },
  { path: '/console/agents', name: '智能体屏' },
  { path: '/console/outcomes', name: '结果屏' },
  { path: '/console/members', name: '成员屏' },
  { path: '/console/settings', name: '组织设置' },
  { path: '/dashboard/subscription', name: '订阅与取消' },
];

test.describe('移动端 · 认证面（storageState 登录态）', () => {
  for (const vp of VIEWPORTS) {
    for (const route of AUTHED_ROUTES) {
      test(`${vp.id} · ${route.name} ${route.path}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });

        const res = await page.goto(route.path, { waitUntil: 'domcontentloaded' });
        expect(res?.status(), `GET ${route.path} 应 200（登录态）`).toBeLessThan(400);

        // 没被踢回登录页 —— 否则测的是登录页而不是这个面。
        // 这条同时是"storageState 真的有效"的前置证明：空集上的版面断言恒真。
        expect(
          new URL(page.url()).pathname,
          `${route.path} 不应跳回 /login —— 若出现，先看 global-setup 产出的 ` +
            `${AUTHED_STATE} 是否有效，不要先怀疑版面`,
        ).not.toBe('/login');

        await assertMobileLayout(page, { viewportId: vp.id, route: route.path });
      });
    }
  }
});
