import { defineConfig, devices } from '@playwright/test';

/**
 * CI 端到端冒烟配置（AC-23）
 *
 * ── 为什么不复用 `playwright.config.ts` ──────────────────────────────
 *
 * 那个配置的 `baseURL` 默认是**生产站** `https://app.lokfeel.com`，
 * 且 `tests/e2e/**` 的用例依赖**真实测试账号**与真实数据。
 * 把它挂到 CI 上等于「每个 PR 都去打生产库」—— 不可重复、不安全、
 * 而且一旦生产有脏数据就会随机红。
 *
 * 本配置只做一件事：对**本地构建产物**（`next start`）做浏览器冒烟。
 * 测的是 jest（纯 Node，不起服务）覆盖不到的那一层：
 * 「构建能过」≠「应用能起来」。Next 的构建期与运行期是两个不同的世界，
 * T12 的教训（本地门禁全绿 ≠ CI 绿）正是发生在这个缝里。
 *
 * 用例在 `tests/e2e-ci/**`，**不含**真实账号、不写任何数据 —— 全只读。
 */

export default defineConfig({
  testDir: './tests/e2e-ci',

  timeout: 60_000,
  expect: { timeout: 15_000 },

  // 冒烟用例很少且互相独立，但串行更稳（避免同时冷启动多个请求）
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,

  reporter: [['list'], ['html', { open: 'never', outputFolder: 'test-results/ci/html' }]],

  outputDir: 'test-results/ci/artifacts',

  use: {
    // 默认指向本机构建产物；CI 里由 env 显式给定
    baseURL: process.env.E2E_BASE_URL || 'http://127.0.0.1:3000',
    headless: true,
    viewport: { width: 1280, height: 720 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    // 本地构建产物没有跨境延迟，超时给紧一些，让真问题更快暴露
    navigationTimeout: 30_000,
    actionTimeout: 15_000,
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
