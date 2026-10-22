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

    // ── 登录失败时的取证（2026-10-22 加） ───────────────────────────────
    // 上一轮 CI 有 5 条用例在 `waitForURL` 上报 `net:ERR_FAILED`，
    // 而当时能拿到的只有这一行字：既不知道是哪个地址、也不知道服务端回没回。
    // `net:ERR_FAILED` 在 Chromium 里是**网络层**的兜底错误码（连接被重置 /
    // 响应体被中途掐断都归它），和"版面坏了"完全不是一回事 —— 分不清这两者，
    // 就会把"服务端没答上来"错记成"移动端布局有问题"。
    // 所以这里只做一件事：把文档级请求的轨迹记下来，失败时一起抛出去。
    const docTrace: string[] = [];
    page.on('requestfailed', (req) => {
      docTrace.push(`✗ requestfailed [${req.resourceType()}] ${req.url()} :: ${req.failure()?.errorText ?? 'unknown'}`);
    });
    page.on('response', (res) => {
      if (res.request().resourceType() === 'document') {
        // 记录 Location：上一轮只看到 `307 /dashboard` 却不知道它跳去哪，
        // 等于知道"有人拐弯"却不知道"拐向哪"，还是定不了性。
        const loc = res.headers()['location'];
        docTrace.push(`· document ${res.status()} ${res.url()}${loc ? `  →  ${loc}` : ''}`);
      }
    });

    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    await page.fill('#login-email', EMAIL);
    await page.fill('#login-password', PASSWORD);
    await page.click('button[type="submit"]');

    // 先证前置：登录真的成功了。拿不到会话时，后面所有页面都会跳回 /login，
    // 那时候的"没有溢出"毫无意义 —— 测的是登录页。
    // `waitUntil: 'domcontentloaded'`：登录成功后是 `window.location.href = …`
    // 的整页跳转，等 `load` 等于把"所有静态资源都下载完"也当成前置条件，
    // 会在慢资源上假红；本用例要的只是"已经离开登录页"。
    try {
      await page.waitForURL((url) => !url.pathname.startsWith('/login'), {
        timeout: 30_000,
        waitUntil: 'domcontentloaded',
      });
    } catch (err) {
      const first = String((err as Error).message || '').split('\n')[0];
      throw new Error(
        `登录后没有离开 /login（当前 URL：${page.url()}）：${first}\n` +
          `文档级请求轨迹（${docTrace.length} 条）：\n` +
          (docTrace.length > 0
            ? docTrace.join('\n')
            : '（浏览器没有报告任何文档级响应 —— 说明请求根本没拿到服务端的响应，' +
              '此时应看 CI 摘要里的 next-start.log，而不是怀疑页面排版）'),
      );
    }
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
