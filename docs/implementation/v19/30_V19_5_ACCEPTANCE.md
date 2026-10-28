# V19.5 · 验收矩阵（WB19-56）

> 分支 `v19/design-exploration`｜执行日 2026-10-28
> 生产未动：`main` = `c3213fd`，生产 = `dc102cd`（本轮**未**部署，D-10 未授权）
> 首次 CI 基线：`8301454` → **21 项全 success / 1 skipped（Perf 手动）/ 0 失败**

## 1. 报表面（任务书 §4 格式）

```
CURRENT_HEAD:      见文末「提交链」（代码提交 8301454，本文件位于其后的文档提交）
BRANCH:            v19/design-exploration
REMOTE_MAIN:       c3213fd（未变）
PRODUCTION_COMMIT: dc102cd（未变，未部署）

HOOK_UNIT_TESTS:   PASS   29/29（2 suites，node 环境，未引入 jsdom）
CONFIRM_DIALOG:    PASS   10/10（真实 Chromium，CI E2E job）
REGISTER_FORM:     PASS   7/7（公开面，CI E2E job）
REPORT_MODAL:      PARTIAL  实现完成（ref 依赖已移除）；8 项键盘行为 BLOCKED（无认证夹具）
FIGMA_ALIGNMENT:   BLOCKED  Figma 连接器/token 均不可用；令牌级一致性 PASS（0 新增色值）
ACCESSIBILITY:     新增严重/关键 0（手写断言口径）；axe-core 未接入（见 P1-2）
MOBILE_E2E:        PARTIAL  390、1440 覆盖弹窗键盘；768 未单独一档

TYPECHECK:         PASS   CI「Typecheck (tsc --noEmit)」
LINT:              PASS   CI「Lint (ESLint · 棘轮)」— 新增文件 0 条越基线
BUILD:             PASS   CI「Build (next build)」
JEST:              PASS   CI「Test (Jest)」含新增 29 例
PLAYWRIGHT:        PASS   CI「E2E（构建产物 · 浏览器冒烟）」4m03s
SECURITY:          PASS   Secret scan(gitleaks) / CodeQL / Dependency audit / 租户审计 全绿

P0_OPEN:           0（工程侧可自行推进项已清零）
P1_OPEN:           3（见 §4）
BLOCKED:           3（ReportModal 行为 / Figma 节点级 / axe 接入）

CHANGED_FILES:     15（3 改 3 新增源码 + 2 新增单测 + 2 新增 E2E + 5 文档）
COMMITS:           8301454
TEST_EVIDENCE:     tests/a11y（29）· tests/e2e-ci/dialogs.spec.ts（10）· tests/e2e-ci/register-form.spec.ts（7）
SCREENSHOTS:       本轮无（键盘行为用断言取证，不用截图；截图见 v194-* 目录）
ACTUAL_HOURS:      ≈5.5h（含本地构建环境排查 2h，未计入可交付工时）
```

## 2. 任务书退出条件逐条核对

| 退出条件 | 结果 | 依据 |
|---|---|---|
| 焦点 Hook 核心边界逻辑通过单测 | ✅ | 29 例，覆盖 12 类要求场景（`25` §2） |
| ConfirmDialog 键盘操作通过 | ✅ | 10 例（`29` §2） |
| Register 字段描述关联正确 | ✅ | 7 例，含「描述引用不悬空」全页扫描 |
| Register 多步流程可操作 | ✅ | 前进/输入推进/返回+状态保留（3 条路径） |
| ReportModal 有安全结论与真实证据 | ⚠️ 半 | 安全结论有（改为不依赖 ref，`27` §3）；**真实浏览器证据没有** ⇒ 判 BLOCKED 不判 PASS |
| 没有新增重复 ID | ✅ | `useId` 替换硬编码；E2E 断言 id 唯一 |
| 没有新增严重或关键无障碍问题 | ✅（口径受限） | 手写断言；axe 未接入，见 P1-2 |
| 不破坏认证 / 聊天 / Mission / Consent | ✅ | 改动面：`register`（公开）、`confirm-dialog`（设置页）、`report-modal`（聊天弹窗内部结构）；未触碰 API 与数据层 |
| 原有测试全部通过 | ✅ | CI 全绿；Jest 含存量套件 |
| 新增测试进入 CI | ✅ | 二者均在 `tests/e2e-ci/**`，由 `playwright.ci.config.ts` 收集；jest 因 `testPathIgnorePatterns` 正确排除 |
| 无未经解释的 P0/P1 | ✅ | §4 逐条给了原因与解除条件 |
| main 与生产未被擅自修改 | ✅ | `ls-remote` 核实 `c3213fd`；生产仍 `dc102cd` |

## 3. 定量目标对账

| 指标 | 目标 | 实际 |
|---|---|---|
| Hook 单测场景 | ≥12 | **24**（focus-trap）+ 5（scroll-lock） |
| ConfirmDialog 核心行为 | 8 类 | **10 例**（8 类 + 2 视口档） |
| 注册表单字段关联 | 100% 可见字段 | **6/6** 字段（name/email/password/dob 组/两个 checkbox） |
| 多步注册流程 | 前进/返回/错误/提交 | 前进 ✅ 返回 ✅ 错误播报 ✅ 提交（服务端错误路径，靠 `role="alert"` 静态断言） |
| 新增 P0/阻断 P1 | 0 | 0 |
| 新增严重/关键 a11y 问题 | 0 | 0（手写口径） |
| 响应式视口 | 360/390/768/1440 | 390/1440（弹窗）+ 360/390（既有移动端套件）⇒ **3/4 档** |
| CI 必需检查 | 全通过 | 21 success / 1 skipped / 0 失败 |
| 登录 LCP ≤2.5s | 改善且不回退 | 本轮**未动**登录面性能；维持 `PERF_TARGET_NOT_MET`（见 `20`） |

## 4. 未闭合（P1 / BLOCKED）

| 编号 | 事项 | 类型 | 解除条件 |
|---|---|---|---|
| P1-1 | `ReportModal` 8 项键盘行为未在真实浏览器验证 | BLOCKED | 可登录账号（D-06）或新增 `seed-chat-e2e.mjs`（2 用户 + 1 聊天室，需授权写聊天数据） |
| P1-2 | `axe-core` / `@axe-core/playwright` 未接入 | 工程债 | 接入 `@axe-core/playwright` 并对 4 条公开路由 + 2 条认证路由跑一遍；**注意**：axe 通过 ≠ 屏幕阅读器通过，两者要分开记 |
| P1-3 | 768 视口未单独一档 | 覆盖缺口 | 在 `dialogs.spec.ts` 的视口数组里补一档即可（成本 ~1 例） |
| B-1 | Figma 节点级一致性 | BLOCKED | 安装 Figma 连接器或提供 `FIGMA_TOKEN`；步骤见 `19` §3 |
| B-2 | 屏幕阅读器人工验收 | BLOCKED | 需要 NVDA（Win）或 VoiceOver（macOS）会话记录；本轮无 |

## 5. 本轮确立的两条纪律（写给下一轮）

1. **纯函数与浏览器各测各的，谁也别替谁下结论。**
   `nextFocusIndex` 算对不等于 Tab 真的动了；Tab 真的动了也不等于 5 个边缘条件都被覆盖。
2. **不能让「无法验证」变成「看起来完整」。**
   `ReportModal` 上一轮回退是对的；本轮的做法不是硬接 hook，而是**把 ref 依赖从设计里删掉**，
   于是「ref 能不能透传」这个问题不再需要答案 —— 需要浏览器证明的那部分，仍然老老实实标 BLOCKED。

## 6. 提交链

```
6fe9ece  fix(a11y): onClose ref 赋值移入 effect，消除 react-hooks/refs 报错   ← 本轮基线
8301454  feat(a11y): 焦点算法下沉纯函数 + 滚动锁引用计数 + 注册字段级错误关联   ← CI 21 全绿
（后一条）docs(v19): V19.5 焦点/弹窗/注册/ReportModal/Figma 五份报告 + 台账 §7
```

## 7. 环境限制记录（供后续排障，不属产品缺陷）

本仓 `src/generated` 是**提交进仓库的** Prisma 产物，而 schema 已包含 `WORKBUDDY` 枚举值。
直接用提交版跑 `tsc --noEmit` 会得到 2 条假报错（`src/lib/agents/runs.ts` 的 providerKind 赋值），
因为生成的 client 落后于 schema。**先 `npx prisma generate` 再 typecheck** 即消失；
CI 的 typecheck job 正是这么做的（第 45–46 步），所以 CI 绿而本地红不是矛盾。
副作用：generate 会改写 `src/generated/**`（含 engine 与 wasm 哈希），提交前需 `git checkout -- src/generated`。
