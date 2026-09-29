import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // 已 gitignore 的本地产物/旧代码副本。之前没排除，导致 lint 会去扫这些
    // 陈旧拷贝 —— eslint 10 的兼容性崩溃最初就是在 backups/ 里以"看起来只影响
    // 备份目录"的形式暴露的，掩盖了它其实是全局问题。排除后 lint 只反映真实源码。
    "backups/**",
    "deploy-tasks/**",
    // Prisma 生成产物（3.6MB 声明文件），不是手写源码
    "src/generated/**",
  ]),
]);

export default eslintConfig;
