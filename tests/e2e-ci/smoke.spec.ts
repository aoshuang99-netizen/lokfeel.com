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

    // 不乱标价：Connection OS 未获批 ⇒ 页面上不该出现任何金额
    const bodyText = await page.locator('body').innerText();
    expect(bodyText, '未获批定价 ⇒ 页面上不该有金额').not.toMatch(/\$\s?\d/);
    expect(bodyText, '应显式说明定价尚未公布').toContain('定价尚未公布');
  });
});
