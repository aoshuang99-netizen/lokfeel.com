import { test, expect } from '@playwright/test';

/**
 * 认证相关响应的缓存策略（V18.3 · WB18-35）
 * ═══════════════════════════════════════════════════════════════════════
 * 为什么要有这一组
 * ------------
 * `next.config.ts` 的 `headers()` 里曾经给 `/login` 与 `/register` 写了
 * `public, s-maxage=300, stale-while-revalidate=86400` —— 照抄"给 ISR 页面开 CDN 缓存"
 * 的写法，却套到了**会在服务端读会话**的页面上。生产实测后果：
 *   · `/login`     `cache-control: public`，`age` 106 → 111 → 117 → 120（不归零）
 *   · `/register`  `cache-control: public`，`age: 173745`（≈ 部署至今没换过）
 *   · 同一 `(auth)` 组的 `/forgot-password`、`/reset-password` 是 `private, no-store`
 *     —— 它们同样 `await auth()`。所以问题不在框架，在那条配置。
 *
 * 为什么用响应头断言，而不是断言配置文件内容
 * ------------
 * 配置里写了什么，和**构建产物实际发什么头**，是两件事：
 *   · `headers()` 的规则按路径匹配，写错路径就静默不生效；
 *   · 路由自己的 `NextResponse` 可以覆盖配置（这个仓里 `/api/health` 就踩过反向的坑：
 *     配了 `public` 之后，路由里改 `no-store` 无效 —— 因为配置优先级更高）。
 * 所以唯一可信的判据是**打一次请求，读响应头**。这也是这条缺陷被发现的方式。
 *
 * 判据
 * ----
 * 认证面：必须含 `no-store`，且**不能**含 `public`。
 * 只查"有没有 no-store"不够 —— `public, no-store` 这种自相矛盾的值也能通过前者。
 */

/** 认证入口页：都会 `await auth()`，响应形状随 cookie 变化。 */
const AUTH_ENTRY = [
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/verify-request',
  '/auto-login',
  '/admin-login',
] as const;

test.describe('缓存策略 · 认证面不得被公共缓存', () => {
  for (const path of AUTH_ENTRY) {
    test(`${path} 返回 private + no-store`, async ({ request }) => {
      const res = await request.get(path, { maxRedirects: 0 });
      const cc = (res.headers()['cache-control'] ?? '').toLowerCase();

      expect(cc, `${path} 没有 Cache-Control 头 —— 那会落到浏览器的启发式缓存`).not.toBe('');
      expect(
        cc,
        `${path} 的 Cache-Control 含 "public"：认证页响应随 cookie 变化，不能被公共缓存`,
      ).not.toContain('public');
      expect(
        cc,
        `${path} 的 Cache-Control 缺 "no-store"：${cc}`,
      ).toContain('no-store');
    });
  }
});

test.describe('缓存策略 · 探活与其它敏感端点', () => {
  test('/api/health 不缓存（否则 dbLatency 会是旧快照）', async ({ request }) => {
    const res = await request.get('/api/health');
    const cc = (res.headers()['cache-control'] ?? '').toLowerCase();
    expect(cc).toContain('no-store');
    expect(cc).not.toContain('public');
  });

  test('/api/auth/session 不缓存（响应里带 Set-Cookie）', async ({ request }) => {
    const res = await request.get('/api/auth/session');
    const cc = (res.headers()['cache-control'] ?? '').toLowerCase();
    expect(cc, '/api/auth/session 的 Cache-Control 必须是 no-store').toContain('no-store');
    expect(cc).not.toContain('public');
  });
});

/**
 * 反证：公开营销页**应当**允许缓存。
 *
 * 没有这一条，上面那组"不许 public"可以被一个"全站禁缓存"的粗暴改法满足 ——
 * 那会把 TTFB 和 LCP 一起打回原点（首页正是靠 CDN 命中才撑住的）。
 * 所以这里同时钉住"该缓存的仍然缓存"。
 */
test.describe('缓存策略 · 公开页仍允许 CDN 缓存（防止过度收紧）', () => {
  test('/', async ({ request }) => {
    const res = await request.get('/');
    const cc = (res.headers()['cache-control'] ?? '').toLowerCase();

    // 注意：这里**不**断言 `s-maxage`。生产实测 `/` 回来的就是 `public`
    // （`next.config` 里写的 `s-maxage=300` 并没有出现在响应头里 —— 推测被平台的
    //  Next 运行时按静态资源语义改写），拿一个没被证实的指令当判据会制造假红。
    // 这一条只守一件事：**别把公开页也一起禁掉**。
    expect(cc, '首页不应被标成 no-store（那会让每次访问都回源）').not.toContain('no-store');
    expect(cc, '首页不应被标成 private（它不是个性化响应）').not.toContain('private');
  });
});
