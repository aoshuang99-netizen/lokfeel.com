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
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/tests/e2e/'],
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
