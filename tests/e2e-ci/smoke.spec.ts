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
});
