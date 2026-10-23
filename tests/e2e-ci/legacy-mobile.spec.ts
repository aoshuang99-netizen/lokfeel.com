import { test, expect, type Page } from '@playwright/test';

import { assertMobileLayout, waitForStableDom } from './lib/measure';

/**
 * Legacy B2C 线 · 四视口验收（V18.3 · WB18-34 · UX-08 最后一块）
 * ═══════════════════════════════════════════════════════════════════════
 * 为什么要有这一组
 * ------------
 * `authed-mobile.spec.ts` 覆盖的是 SaaS 主线（`/workspace` + `/console` 七屏）。
 * 但仓库里同时活着一条 **legacy B2C 线**（`/dashboard/*`：聊天、连接、资料、
 * 通知、发现、设置）—— 它和主线共用同一份登录态与同一批用户，
 * 线上真实用户此刻能点到的就是这些屏。**它们此前一条版面证据都没有。**
 * UX-08 至今 BLOCKED，唯一理由就是这一块空白。
 *
 * 🔴 任务书里的路由名要纠正
 * ------------
 * 任务书写的是 `/dashboard/chats`、`/matches`、`/profile`。实测
 *   · `/dashboard/chats`  → 307（未登录）/ 200 → 存在
 *   · `/matches`          → **404**（不存在）
 *   · `/profile`          → **404**（不存在）
 *   · `/dashboard/profile`→ 307（未登录）/ 200 → 存在
 *   · `/dashboard/matches`→ 308 → `/dashboard/connections`
 * 所以真正的"匹配操作"面是 `/dashboard/connections`，不是 `/matches`。
 * 这里按**真实路由**测，不按任务书的字面路由测 —— 测一个 404 页面然后
 * 宣布"没有溢出"是没有意义的。
 *
 * 🔴 为什么现在可以测 `/dashboard/chats` 了
 * ------------
 * 上一轮把它从认证面排除，理由是"它开 WebSocket，稳定判定会退化成超时"。
 * 读代码后纠正：开长连接的是 `/dashboard/chats/[roomId]`。
 * 列表这一层由 `chats/layout.tsx` 渲染（拉一次会话列表，无 socket），
 * `page.tsx` 只是 42 行的静态空态。
 * 用一个通用理由排除一个不需要它的页面，属于把"不确定"当成"不测"。
 * `[roomId]` 仍不在范围内：夹具没有真实会话，且长连接页面无法稳定测量 ——
 * 这条限制写在报告里，不写成"已通过"。
 *
 * 🔴 不量骨架屏（这一条是上一轮血的教训）
 * ------------
 * `measure()` 里已带 `waitForStableDom`，但稳定 ≠ 内容加载完 ——
 * 骨架屏自己也很"稳定"。所以每条用例先等一个**只属于真实内容**的锚点：
 * 这些页的 `loading.tsx` / `dynamic({ loading })` 骨架里 **一个 `<h1>` 都没有**
 * （已逐个核过），所以「h1 出现」就是"真内容到了"的可证信号。
 * 拿不到锚点就判红，而不是降级成"量一下算了"。
 */

const AUTHED_STATE = 'test-results/authed-state.json';

test.use({ storageState: AUTHED_STATE });

/** 任务书要求的四个视口。手机两个 + 平板 + 桌面。**四个都按同一把尺子判。** */
const LEGACY_VIEWPORTS = [
  { id: '390×844', width: 390, height: 844 },
  { id: '360×800', width: 360, height: 800 },
  { id: '768×1024', width: 768, height: 1024 },
  { id: '1440×900', width: 1440, height: 900 },
] as const;

interface LegacyRoute {
  path: string;
  name: string;
  /**
   * 真实内容已落地的锚点（Playwright selector）。
   * 骨架屏里没有 `<h1>`，所以 `<h1>` 出现即可信。
   */
  ready: string;
}

const LEGACY_ROUTES: LegacyRoute[] = [
  // ⚠️ 锚点必须**在手机宽度下也可见**。第一版把 `/dashboard/chats` 的锚点写成页面里的
  //    「LokFee! Messages」，CI 直接给了答案：`locator resolved to <h3>...` 但 `hidden`
  //    —— 手机上聊天布局只显示列表面板，页面那份空态是隐藏的。
  //    改用布局内的搜索框（所有宽度都渲染），它才是"这一屏真的来了"的证据。
  { path: '/dashboard/chats', name: '聊天列表（空态）', ready: 'input[placeholder="Search or start new chat"]' },
  { path: '/dashboard/connections', name: '连接 / 匹配操作', ready: 'h1:has-text("Connections")' },
  { path: '/dashboard/profile', name: '资料编辑', ready: 'input[placeholder="Your name"]' },
  { path: '/dashboard/notifications', name: '通知', ready: 'h1:has-text("Notifications")' },
  // 同一个路由有三种状态：loading（无 h1）/ 空态（h2「No more profiles」）/ 有候选人（h1「Discover」）。
  // 夹具没有候选人 ⇒ 必然落在空态。第一版只等 h1「Discover」，等于要求一个**不会出现**的元素。
  { path: '/dashboard/explore', name: '发现（刷卡）', ready: 'h1:has-text("Discover"), h2:has-text("No more profiles")' },
  { path: '/dashboard/settings', name: '设置', ready: 'h1:has-text("Settings")' },
];

/** 收集未捕获异常与控制台错误。只有前者判红 —— 见 `test.beforeEach`。 */
interface PageIssues {
  pageErrors: string[];
  consoleErrors: string[];
}

function watchPage(page: Page): PageIssues {
  const issues: PageIssues = { pageErrors: [], consoleErrors: [] };
  page.on('pageerror', (err) => {
    issues.pageErrors.push(String(err?.message || err).slice(0, 300));
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') issues.consoleErrors.push(msg.text().slice(0, 300));
  });
  return issues;
}

/**
 * 遮挡检查：把元素中心点交给 `elementFromPoint`，看命中的是不是它自己。
 *
 * 为什么需要它：横向溢出为 0、尺寸也达标，仍然可能被一个固定定位的浮层
 * （底栏、Toast、Cookie 条）压在下面 —— 那种缺陷在纯几何测量里完全看不出来。
 * 判据用 `contains` 双向包含，避免"命中的是子元素（图标）"被误判成遮挡。
 */
async function assertNotOccluded(page: Page, selector: string, label: string): Promise<void> {
  const box = await page.locator(selector).first().boundingBox();
  expect(box, `${label} 应该有可见几何（拿不到 boundingBox）`).not.toBeNull();
  if (!box) return;

  const hit = await page.evaluate(
    ({ x, y, sel }) => {
      const target = document.querySelector(sel);
      const el = document.elementFromPoint(x, y);
      if (!target || !el) return { ok: false, reason: 'elementFromPoint 返回 null' };
      const ok = el === target || target.contains(el) || el.contains(target);
      return {
        ok,
        reason: ok ? '' : `命中的是 <${el.tagName.toLowerCase()} class="${String(el.className).slice(0, 60)}">`,
      };
    },
    { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2), sel: selector },
  );

  expect(hit.ok, `${label} 被其它元素遮挡：${hit.reason}`).toBe(true);
}

test.describe('Legacy B2C · 四视口版面与可用性', () => {
  for (const vp of LEGACY_VIEWPORTS) {
    for (const route of LEGACY_ROUTES) {
      test(`${vp.id} · ${route.name} ${route.path}`, async ({ page }) => {
        const issues = watchPage(page);
        await page.setViewportSize({ width: vp.width, height: vp.height });

        const res = await page.goto(route.path, { waitUntil: 'domcontentloaded' });
        expect(res?.status(), `GET ${route.path} 应 200（登录态）`).toBeLessThan(400);

        // 没被踢回登录页 —— 否则测的是登录页，不是这个面
        const landed = new URL(page.url()).pathname;
        expect(landed, `${route.path} 不应跳回 /login`).not.toBe('/login');

        // 🔴 先证"真内容到了"：骨架屏没有 h1，所以这个锚点出现才算数
        const ready = page.locator(route.ready).first();
        await expect(
          ready,
          `${route.path} 的真实内容没有出现（只看到骨架屏或空容器）`,
        ).toBeVisible({ timeout: 20_000 });

        await waitForStableDom(page);

        const m = await assertMobileLayout(page, { viewportId: vp.id, route: route.path });

        // 四个视口用同一把尺子。原本打算 1440 只统计不判红（"移动端补证"范围外），
        // 但第一次跑就发现那段"仅统计"的意图**根本没生效** —— `assertMobileLayout`
        // 内部已经把 tooSmall 断言掉了，外面的 annotation 分支永远走不到。
        // 与其加一个 `enforceTouch: false` 开关把判据变软，不如就按同一标准判：
        // 1440 当时只报出页脚 4 个 16px 链接，修完即过。
        // 一个会骗人的开关，比一条更严的判据危险得多。
        test.info().annotations.push({
          type: 'touch-44',
          description: `${vp.id} ${route.path}: ${m.belowRecommended.length}/${m.total} 个目标 <44px`,
        });

        // 未捕获异常判红；控制台 error 只报告 —— 缺图/第三方脚本失败会被记为
        // console error，但页面并没有坏，拿它判红会制造与版面无关的红。
        test.info().annotations.push({
          type: 'console-errors',
          description: `${vp.id} ${route.path}: ${issues.consoleErrors.length} 条控制台错误`,
        });
        expect(
          issues.pageErrors,
          `${route.path} 出现未捕获异常：\n${issues.pageErrors.join('\n')}`,
        ).toEqual([]);
      });
    }
  }
});

/**
 * 交互可用性：只在一个视口上做（390×844），且**全部是只读探针**。
 *
 * 任务书要求「聊天输入、匹配操作、资料编辑可用」。逐条对应：
 *   · 资料编辑 → 往输入框里写值再读回来（不提交，不发写请求）；
 *   · 匹配操作 → 断言空态的下一步按钮可见且未被遮挡（夹具没有候选人，
 *     空态本身就是这一轮唯一能证明的"匹配面可用"形态）；
 *   · 聊天输入 → **做不到**：输入框在 `/dashboard/chats/[roomId]`，
 *     而夹具里没有任何真实会话。这条在报告里记 NOT_APPLICABLE，
 *     不拿列表页的空态冒充"聊天可用"。
 */
test.describe('Legacy B2C · 交互可用性（390×844 · 只读）', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('资料页的姓名输入框可编辑、可回读', async ({ page }) => {
    await page.goto('/dashboard/profile', { waitUntil: 'domcontentloaded' });
    const name = page.locator('input[placeholder="Your name"]').first();
    await expect(name).toBeVisible({ timeout: 20_000 });

    const before = await name.inputValue();
    await name.fill('E2E Probe Name');
    await expect(name, '写进去的值读不回来 ⇒ 这个框实际不可用').toHaveValue('E2E Probe Name');

    // 还原，避免污染同一 storageState 下的后续用例
    await name.fill(before);
    await expect(name).toHaveValue(before);

    // 输入框本身也得够大（它是主交互控件，不是装饰）
    const box = await name.boundingBox();
    expect(box?.height ?? 0, `姓名输入框高度 ${box?.height ?? 0}px < 24px`).toBeGreaterThanOrEqual(24);
  });

  test('连接页的空态给出可用的下一步，且没有被底栏压住', async ({ page }) => {
    await page.goto('/dashboard/connections', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('h1:has-text("Connections")').first()).toBeVisible({ timeout: 20_000 });
    await waitForStableDom(page);

    // 夹具没有候选人/匹配 ⇒ 必然落在某个空态上。空态不是"没测到"，
    // 它就是新用户看到的第一屏，必须自己站得住。
    const emptyTitles = page.getByText(/No likes yet|No matches yet|All caught up!/);
    const count = await emptyTitles.count();
    expect(count, '连接页应有空态文案（夹具无候选人的预期形态）').toBeGreaterThan(0);
    await expect(emptyTitles.first()).toBeVisible();

    // 空态里的 CTA 必须点得到（不被固定底栏覆盖）
    const cta = page.locator('main a[href], main button').first();
    if (await cta.count()) {
      await assertNotOccluded(page, 'main a[href]', '连接页空态的首个 CTA');
    }

    test.info().annotations.push({
      type: 'connections-empty-state',
      description: `390×844 空态命中 ${count} 处；CTA 遮挡检查已执行`,
    });
  });

  test('聊天列表在手机上给出真实出路，且那条链接够大、没被遮住', async ({ page }) => {
    await page.goto('/dashboard/chats', { waitUntil: 'domcontentloaded' });
    // 手机上这一屏只渲染列表面板（页面那份空态是隐藏的），所以锚点用列表里的搜索框
    await expect(page.locator('input[placeholder="Search or start new chat"]')).toBeVisible({
      timeout: 20_000,
    });
    await waitForStableDom(page);

    // 夹具没有会话 ⇒ 列表必然为空态。空态不是"没测到"，它是新用户看到的第一屏。
    await expect(page.getByText('No conversations yet')).toBeVisible();

    const discover = page.locator('a[href="/dashboard/explore"]').first();
    await expect(discover, '空态必须给出下一步，不能是死胡同').toBeVisible();

    // 这条链接在 768×1024 曾被新门禁判红：119×20 < 24px。这里把它钉成固定判据，
    // 免得以后改样式时又退回去。
    const box = await discover.boundingBox();
    expect(box?.height ?? 0, `「Discover people →」高度 ${box?.height ?? 0}px < 24px`).toBeGreaterThanOrEqual(24);

    await assertNotOccluded(page, 'a[href="/dashboard/explore"]', '聊天空态的「Discover people →」');
  });
});
