import { defineConfig, devices } from '@playwright/test'

/**
 * T02 专用 Playwright 配置 —— 「真实 Chrome + 移动视口」
 *
 * 为什么不复用 playwright.config.ts：
 *   1. 该文件默认 baseURL 指向**生产** app.lokfeel.com，而 T02 的分享页 E2E 需要
 *      一个可控的本地夹具库（见 scripts/qa/seed-t02-e2e.mjs）；
 *   2. 本机 Playwright 自带 chromium 的下载版本（1243）在 macOS 13 上不受支持
 *      （`Playwright does not support chromium on mac13`），但**系统安装的真实
 *      Chrome 可用** → 用 `channel: 'chrome'`，既不依赖下载，也让证据更贴近
 *      「真实浏览器」的要求。
 *
 * 用法：
 *   node scripts/qa/seed-t02-e2e.mjs
 *   DATABASE_URL=file:/tmp/t02-e2e.db npx next dev -p 3101
 *   E2E_BASE_URL=http://localhost:3101 E2E_MISSION_TOKEN=... \
 *     npx playwright test -c playwright.t02.config.ts tests/e2e/mission-link.spec.ts
 *
 * ⚠️ `timeout` 设为 120s（默认 90s 偏紧）：spec 内含「真实登录页登录 → 真实加入」
 * 两步写操作，dev 模式下未预热的写路由现场编译可达 14s；已用 beforeAll 预热，
 * 此处仅留冗余，避免慢机器上因编译抖动误报失败。
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: 'test-results/t02-results.json' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:3101',
    headless: true,
    ignoreHTTPSErrors: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    // AC-11 要求「移动端可访问」。Pixel 5 = 393×851 的典型移动视口。
    {
      name: 'Mobile Chrome (real)',
      use: { ...devices['Pixel 5'], channel: 'chrome' },
    },
  ],
})
