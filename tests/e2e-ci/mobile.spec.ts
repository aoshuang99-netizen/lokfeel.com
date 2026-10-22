import { test, expect } from '@playwright/test';

import { VIEWPORTS, assertMobileLayout } from './lib/measure';

/**
 * 移动端 390 / 360 · **公开面**（V18-06）
 * ═══════════════════════════════════════════════════════════════════════
 * 这组用例补的是 V18 第一周唯一被标成 `UNVERIFIED` 的那一块：
 *
 *   `WEEKLY_OPERATING_REVIEW` §4.2 原文：
 *   「移动端 360·390、无障碍、真实登录态 **没有任何证据**」
 *
 * 判据（溢出 / 触控尺寸 / 豁免规则）全在 `lib/measure.ts`，与认证面**共用一份** ——
 * 见该文件开头的取舍说明。阈值不是拍脑袋：2026-10-22 先用生产实测过一遍，
 * `/login` 有 3 个 20px 高的控件（Forgot password / Continue as Guest / Sign up）、
 * `/pay.html` 有 1 个 17px 的（Apply to yearly），都已修到 ≥44px。
 *
 * ⚠️ 只读：不登录、不写库。认证面在 `authed-mobile.spec.ts`。
 */

/**
 * `expectPath` 用来防"200 但跳走了"：
 * 跟随重定向后 Playwright 会给 200，只有比对最终 pathname 才能发现。
 */
const ROUTES: Array<{ path: string; expectPath: string; name: string }> = [
  { path: '/', expectPath: '/', name: '落地页' },
  { path: '/pricing', expectPath: '/pricing', name: 'Connection OS 定价页' },
  { path: '/hlua', expectPath: '/hlua', name: 'Hlua Pass 说明页' },
  { path: '/refunds', expectPath: '/refunds', name: '退款政策' },
  { path: '/login', expectPath: '/login', name: '登录页' },
  { path: '/pay.html', expectPath: '/pay.html', name: 'Hlua 结账页（静态）' },
];

test.describe('移动端 · 公开面', () => {
  for (const vp of VIEWPORTS) {
    for (const route of ROUTES) {
      test(`${vp.id} · ${route.name} ${route.path}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });

        const res = await page.goto(route.path, { waitUntil: 'domcontentloaded' });
        // 先证前置：页面真的到了（否则后面的"没溢出"是空集恒真）
        expect(res?.status(), `GET ${route.path} 应 200`).toBe(200);
        expect(new URL(page.url()).pathname, `${route.path} 不应跳走`).toBe(route.expectPath);

        await assertMobileLayout(page, { viewportId: vp.id, route: route.path });
      });
    }
  }
});
