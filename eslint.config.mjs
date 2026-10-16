import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * ESLint 配置（flat config）
 *
 * ⚠️ 关于全仓 lint 债与「lint 门禁」的关系（2026-10-16，AC-23）
 *
 * `npm run lint` 是**裸 `eslint`**（等价于 `eslint .`），会扫真实源码树里的
 * 全部既有债。全仓当前有约 1.5k problems（`no-unused-vars` / `no-explicit-any` /
 * `no-require-imports` 三条占 79%），**这是历史存量，不是本轮引入**。
 *
 * 因此：
 *   · `npm run lint`            —— 人用。全量、不收敛，如实呈现存量债。
 *   · `npm run lint:gate`       —— CI 用。**棘轮门禁**（`scripts/ci/lint-ratchet.mjs`）：
 *                                  以 `docs/implementation/lint-baseline.json` 为冻结基线，
 *                                  只有**新增**债务才判红。既有债不再掩盖真实回归。
 *
 * 这里**不降级任何规则的 severity**。降级 = 削弱；棘轮 = 在不削弱的前提下让 CI
 * 重新变得可信（红 = 你引入的，绿 = 你没让情况变糟）。
 *
 * 基线的更新方式是显式且有审计痕迹的：
 *   npm run lint:baseline        # 重写基线（应在同一提交里说明为什么）
 */

/** 已 gitignore 的产物目录 —— 不是源码，lint 它们只会产生噪音与假红。 */
const BUILD_ARTIFACTS = [
  // 已在 .gitignore；历史上的 lint 报错有 5 条来自这里，属纯噪音
  "coverage/**", // jest --coverage 产物
  ".open-next/**", // opennextjs-cloudflare build 产物
  ".wrangler/**", // wrangler 本地状态
  ".vercel/**", // vercel 本地状态
  ".stage5-probe/**", // chat-merge 门禁的合成夹具（运行期创建/清理）
];

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
    ...BUILD_ARTIFACTS,
  ]),
]);

export default eslintConfig;
