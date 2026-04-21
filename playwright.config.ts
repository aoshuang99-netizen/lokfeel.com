import { defineConfig, devices } from '@playwright/test';

/**
 * LokFeel E2E 测试配置
 * 
 * 测试环境：生产 https://app.lokfeel.com
 * 本地开发：http://localhost:3000
 * 
 * 使用方法：
 *   npx playwright test                  — 运行所有E2E测试
 *   npx playwright test --ui             — 可视化测试运行器
 *   npx playwright test tests/e2e/auth   — 只运行认证测试
 *   npx playwright test --headed         — 有头模式（可见浏览器）
 */
export default defineConfig({
  // 测试目录
  testDir: './tests/e2e',
  
  // 超时设置
  timeout: 60_000,
  expect: { timeout: 10_000 },
  
  // 并行与重试
  fullyParallel: false,  // 认证测试有状态依赖，串行更可靠
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : 1,  // 单worker避免session冲突
  
  // 报告
  reporter: [
    ['html', { open: 'never', outputFolder: 'test-results/html' }],
    ['json', { outputFile: 'test-results/results.json' }],
    ['list'],
  ],
  
  // 全局配置
  use: {
    // 基础URL — 优先使用环境变量，否则用生产
    baseURL: process.env.E2E_BASE_URL || 'https://app.lokfeel.com',
    
    // 浏览器配置
    headless: true,
    viewport: { width: 1280, height: 720 },
    ignoreHTTPSErrors: true,
    
    // 截图与视频
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
    
    // 导航超时
    navigationTimeout: 30_000,
    actionTimeout: 15_000,
  },

  // 浏览器配置
  projects: [
    {
      name: 'Desktop Chrome',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'Mobile Chrome',
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'Mobile Safari',
      use: { ...devices['iPhone 13'] },
    },
  ],

  // 构建前启动本地服务器（可选）
  // webServer: {
  //   command: 'npm run dev',
  //   url: 'http://localhost:3000',
  //   reuseExistingServer: !process.env.CI,
  //   timeout: 120_000,
  // },

  // 输出目录
  outputDir: 'test-results/artifacts',
});
