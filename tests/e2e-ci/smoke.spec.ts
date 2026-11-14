import { test, expect } from '@playwright/test';

/**
 * CI 端到端冒烟（AC-23）
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 这一组用例到底在防什么
 * ═══════════════════════════════════════════════════════════════════════
 *
 * CI 里原本「构建」与「测试」是分开的两个 job：
 *   · `npm test`（jest）→ 纯 Node，**不起服务**，跑的是被 mock 的单元；
 *   · `npm run build`   → 只证明**构建期**能过。
 *
 * 两者都绿，仍然可能「部署上去起不来」—— 运行期才暴露的东西（环境变量读取、
 * instrumentation、路由装配、中间件、DB 连接方式）没有任何一环在拦。
 * 这正是 T12 记下的「本地门禁全绿 ≠ CI 绿」。
 *
 * 所以本组用例的判据刻意选成**运行期事实**，而不是页面文案：
 *   ① `/api/health` 返回 200 且 `status === 'healthy'`
 *      —— 该端点内部会真的执行 `db.user.count()`。它绿 = **构建产物真的
 *         连上了库**（不是「配置看起来对」）。这是本组最强的一条。
 *   ② 匿名访问受保护 API 返回 401
 *      —— 证明鉴权守卫在**构建产物**里真实生效，没有被构建/裁剪绕开。
 *   ③ 登录页渲染出可交互表单（`#login-email` / `#login-password`）
 *      —— 证明客户端组件能水合，不是一张静态壳。
 *   ④ 未知路径返回 404
 *      —— 防止「任何路径都 200」这种兜底把 ①③ 的断言变成永真。
 *   ⑤ 根路径可达且返回 HTML
 *
 * ⚠️ 判据设计的一条铁律（沿用 AC-10 的教训）：**先证前置成立，再断言现象**。
 *    比如「登录页没有报错」在页面根本没渲染出来时也恒真 —— 所以这里
 *    一律先断言**正向可达**（200 / 元素可见），再谈其它。
 *
 * ⚠️ 本组**只读**：不登录、不写库、不动任何业务状态。
 */

test.describe('CI 冒烟 · 构建产物可启动且守卫真实生效', () => {
  test('① 健康检查 200，且数据库真实可达', async ({ request }) => {
    const res = await request.get('/api/health');

    // 先证前置：端点本身通
    expect(res.status(), 'GET /api/health 应 200（503 = 数据库不可达）').toBe(200);

    const body = await res.json();
    expect(body.status).toBe('healthy');
    // dbLatency 存在 = db.user.count() 真的跑过（健康分支才会带上它）
    expect(typeof body.dbLatency, 'dbLatency 应为数字（证明 db.user.count() 成功）').toBe(
      'number'
    );
    // Redis 未配置时应优雅降级为 memory，而不是把健康检查打挂（G-4 行为）
    expect(body.redis?.backend, 'redis.backend 应存在（upstash 或 memory）').toBeTruthy();
  });

  test('② 匿名访问受保护 API 必须 401（守卫未被构建产物绕开）', async ({ request }) => {
    for (const path of ['/api/v1/org', '/api/v1/members']) {
      const res = await request.get(path);
      expect(res.status(), `GET ${path} 应 401（匿名不可达）`).toBe(401);
    }
  });

  test('③ 登录页渲染出可交互表单（客户端组件已水合）', async ({ page }) => {
    const res = await page.goto('/login', { waitUntil: 'domcontentloaded' });
    expect(res?.status(), 'GET /login 应 200').toBe(200);

    await expect(page.locator('#login-email')).toBeVisible();
    await expect(page.locator('#login-password')).toBeVisible();
  });

  test('④ 未知路径必须 404（否则 ①③ 的断言会退化成永真）', async ({ request }) => {
    const res = await request.get('/__ci_smoke_no_such_route__');
    expect(res.status(), '未知路径应 404，而不是 200 兜底').toBe(404);
  });

  test('⑤ 根路径可达且返回 HTML', async ({ page }) => {
    const res = await page.goto('/', { waitUntil: 'domcontentloaded' });
    expect(res?.status(), 'GET / 应 200').toBe(200);
    await expect(page.locator('body')).toBeVisible();
  });

  /**
   * ⑥ 定价页必须是**自己的**页面（V18-02）。
   *
   * 这条守的是一个已经发生过的错卖：`/pricing` 曾 307 到 `public/pay.html`，
   * 而那一页卖的是 Hlua Pass（streaming / H-Points）。用户点"定价"，
   * 看到的是另一个产品 —— 而且没有任何页面能让人察觉。
   *
   * 断言分四层，缺一层就会漏：
   *   · 状态码 200 —— 挡住"又跳走了"（307 时 Playwright 会跟随后返回 200，
   *     所以还要看最终 URL，见下）；
   *   · 最终路径是 `/pricing` —— 挡住跟随重定向后"200 但其实是 pay.html"；
   *   · 正文含 Connection OS、并显式声明"定价尚未公布"—— 挡住"页面在但内容是别人的"；
   *   · **没有任何指向 pay.html 的链接、没有任何金额** —— 这才是"不导流、不乱标价"的
   *     可判定形式。
   *
   * 🔴 这里踩过一次：最初写的是 `not.toContain('H-Points')`，而页面底部的
   * "这里不卖什么"一节**必须**提到 H-Points 才能把边界说清楚 ⇒ 断言与意图相反。
   * 字面串断言容易变成"禁止解释"，所以改成**结构断言**（链接数 / 金额正则）。
   */
  test('⑥ 定价页是 Connection OS 自己的页面（不是 Hlua 的结账页）', async ({ page }) => {
    const res = await page.goto('/pricing', { waitUntil: 'domcontentloaded' });
    expect(res?.status(), 'GET /pricing 应 200').toBe(200);

    // 跟随重定向后的落地路径 —— 这是本用例最关键的一条
    expect(new URL(page.url()).pathname, '/pricing 不得跳去别处（尤其是 /pay.html）').toBe(
      '/pricing'
    );

    const html = await page.content();
    expect(html, '页面应讲 Connection OS').toContain('Connection OS');

    // 不导流：任何指向 Hlua 结账页的链接都是回归
    await expect(page.locator('a[href*="pay.html"]'), '不得出现指向 Hlua 结账页的链接').toHaveCount(0);

    // 不乱标价：金额显不显示，必须与**商业批准状态**一致，而不是与实现者的偏好一致。
    // 2026-11-13 重新定价后目录转 APPROVED，页面开始展示 $89 / $199 / $449；
    // 所以这条断言不能写死"不得有金额"，否则它守的就不是"未获批不得标价"，
    // 而是"永远不准卖"。改成先读服务端判定，再双向断言 —— 两个方向都能抓：
    //   · APPROVED 却仍显示"定价尚未公布" ⇒ 页面没跟上目录（客户看不到已公布的价格）
    //   · 未批准却出现金额 ⇒ 对外承诺了一个还没批的价（这才是原始回归）
    const plansRes = await page.request.get('/api/payments/dodo/plans');
    const plans = await plansRes.json();
    const approved = plans?.commercialApproval?.status === 'APPROVED';

    const bodyText = await page.locator('body').innerText();
    if (approved) {
      expect(bodyText, '定价已获批 ⇒ 页面必须公布金额').toMatch(/\$\s?\d/);
      expect(bodyText, '定价已获批却仍写"尚未公布"，说明页面没跟上目录').not.toContain(
        '定价尚未公布'
      );
    } else {
      expect(bodyText, '未获批定价 ⇒ 页面上不该有金额').not.toMatch(/\$\s?\d/);
      expect(bodyText, '应显式说明定价尚未公布').toContain('定价尚未公布');
    }
  });

  /**
   * ⑦ 2026-11-14 · P1-1 回归守卫
   * ────────────────────────────────────────────────────────────────
   * 根布局曾写死 `canonical: 'https://app.lokfeel.com'`，所有子页继承它，
   * 等于每页都对外声明"正本是首页"。旧检查只断言「canonical 存在」——
   * 存在性恒真，是典型的假绿，所以这条必须**比对本页 URL**。
   *
   * 现在正确状态是「根布局不声明，各页按需自报」，所以允许 0 个 canonical；
   * 但为了不让这条守卫退化成恒绿，末尾用注入的错误 canonical 做负向对照：
   * 检测器必须能把它判成"不等于本页"，否则整条断言作废。
   */
  test('⑦ 子页 canonical 若存在必须等于自身 URL（不得全部指向首页）', async ({ page }) => {
    const pages = ['/pricing', '/about', '/terms', '/faq'];
    for (const pathname of pages) {
      const res = await page.goto(pathname, { waitUntil: 'domcontentloaded' });
      expect(res?.status(), `GET ${pathname} 应 200`).toBe(200);
      expect(new URL(page.url()).pathname, `${pathname} 不得被重定向到别的页面`).toBe(pathname);

      const links = page.locator('link[rel="canonical"]');
      const count = await links.count();
      expect(count, `${pathname} 最多只能有一个 canonical`).toBeLessThanOrEqual(1);
      if (count === 1) {
        const href = await links.first().getAttribute('href');
        expect(href, `${pathname} 的 canonical 必须有 href`).toBeTruthy();
        expect(
          new URL(href as string, page.url()).pathname,
          `${pathname} 的 canonical 指向了别的页面 —— 子页会自请出索引`
        ).toBe(new URL(page.url()).pathname);
      }
    }

    // 负向对照：注入一个"指向首页"的错误 canonical，检测器必须判它为不匹配。
    // page.url() 仍是最后一个真实子页，所以 '/' 与 '/faq' 必然不等。
    await page.setContent('<html><head><link rel="canonical" href="/"></head><body>probe</body></html>');
    const fakeHref = await page.locator('link[rel="canonical"]').first().getAttribute('href');
    expect(fakeHref, '注入的对照样本必须能被读到（否则守卫是恒绿摆设）').toBe('/');
    expect(
      new URL(fakeHref as string, page.url()).pathname,
      '负向对照：错误 canonical 必须被判成不等于本页'
    ).not.toBe(new URL(page.url()).pathname);
  });
});
