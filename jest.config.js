module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    // `next-auth@5.x` 是纯 ESM，jest（CJS）无法 require —— 会抛
    // "Must use import to load ES Module"，与被测逻辑无关。
    // 用无副作用的桩替换，真实的会话行为交给 E2E。
    '^next-auth/react$': '<rootDir>/tests/mocks/next-auth-react.ts',
  },
  testMatch: ['**/tests/**/*.test.ts', '**/tests/**/*.spec.ts'],
  // `tests/e2e/**` 是 **Playwright** 用例，由 `npm run test:e2e` 驱动，
  // 不能混进 jest：既跑不通，又会让 `npx jest` 的失败数虚高、
  // 掩盖真正需要关注的失败。
  // `tests/e2e-ci/**`（AC-23 新增）同理 —— 它是 `playwright.ci.config.ts`
  // 驱动的 CI 冒烟，必须一并排除，否则 jest 会去 require @playwright/test 并炸掉。
  // ⚠️ 2026-11-06 修：`next build` / `opennextjs-cloudflare build` 会把 tests/ 原样
  // 复制进 `.next/standalone/` 与 `.open-next/`（本地实测 254 个 .test.ts 副本）。
  // 上面两条是 `<rootDir>/tests/...` 绝对前缀，覆盖不到这些副本，导致 build 后
  // 跑 `npm test` 会扫进 Playwright 用例（数十个假 FAIL）并让 PASS 数虚高。
  // CI 是干净 checkout 不受影响；排除产物目录只让本地口径与 CI 一致，
  // 不跳过任何源码套件。
  testPathIgnorePatterns: [
    '/node_modules/',
    '<rootDir>/tests/e2e/',
    '<rootDir>/tests/e2e-ci/',
    '<rootDir>/.next/',
    '<rootDir>/.open-next/',
  ],
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/**/*.stories.{ts,tsx}',
    '!src/**/*.test.{ts,tsx}',
    '!src/**/*.spec.{ts,tsx}',
  ],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
};
