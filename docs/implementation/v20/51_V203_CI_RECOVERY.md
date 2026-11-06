# V20.3 · `main` CI 红灯修复与远端复验（2026-11-06）

> **判定口径**：只用 `PASS / FAIL / BLOCKED / NOT_TESTED`。每项附真实命令、Run ID、Git SHA 或实测数值。
> **本文件只解决一件事**：`main` 上连续两次 `Test (Jest)` 失败。
> **它不代表 V20.3 RC 通过** —— Release Candidate 仍是 `NOT READY / NO-GO`（见 `49`）。

## 1. 现象（真实证据，非推断）

| 项 | 值 |
|---|---|
| 失败 Run | `42153447731` @ `064cfe8`、`42151428045` @ `03a04a6` |
| 触发方式 | `push` 到 `main` → `.github/workflows/ci.yml` |
| Run 结论 | `failure`（两次） |
| 失败 job | **仅 `Test (Jest)`**（13 job 中其余 12 个 `success`、2 个 `skipped`） |
| 失败用例 | `tests/cron/bot-online-seed.test.ts` › `WO-1089 · 群体去相关后在线比例合理 › 固定日期下 2000 个 bot 的在线比例落在 2%–12%` |
| 日志 | `Expected: < 0.12` / `Received: 0.2065` |
| 本地表现 | 同一文件连跑 3 次均 `36/36 PASS`（含构建产物副本） |

「本地绿、CI 红」且数值翻倍有余 ⇒ 优先怀疑**时间/环境依赖**，不是业务逻辑回归。

## 2. 根因（实测确证，非推断）

### 2.1 代码路径

```
tests/cron/bot-online-seed.test.ts:87
  → calculateOnlineProbability(cfg, 'America/New_York')
src/lib/bot-engine/modules/online-status.ts:41
  → getCurrentHourInTimezone(timezone)
src/lib/bot-engine/utils.ts:135
  → const now = new Date()          ← 读真实系统时钟
src/lib/bot-engine/modules/online-status.ts:49-50
  → isPeakHour = online.peakHours.includes(currentHour)
    peakMultiplier = isPeakHour ? 5.0 : 1.0
src/lib/bot-engine/default-config.ts:44
  → peakHours: [20, 21]
```

用例标题写「固定日期」，但只固定了种子里的 `dateKey = 20261104` / `hour = 3`，
**概率 `p` 仍随运行时刻变化**。`activeDays = [0..6]` 恒定，故星期不是变量，唯一变量是小时。

### 2.2 数学与实测对账

| 时刻（America/New_York） | p 计算 | 2000 bot 实测 ratio |
|---|---|---|
| 03:00 off-peak | `(1/24 × 1 + 0.1 × 1/24) × 1 ≈ 0.0458` | **0.0395** |
| 21:00 peak | `(1/24 × 5) × 1 ≈ 0.2083` | **0.2065** |

`0.2065` 与 CI 失败日志 `Received: 0.2065` **逐字一致**。
CI 在 UTC 02:56 触发 ⇒ 纽约 21:56 晚高峰；本地 GMT+8 下午 ⇒ 纽约凌晨 off-peak。
⇒ 判定：**测试自身 flaky，不是生产算法 bug**。同文件 WO-1090 早已使用
`jest.useFakeTimers().setSystemTime()`，WO-1089 漏用。

## 3. 修复（不改生产算法、不放宽阈值、不删断言）

| # | 文件 | 改动 |
|---|---|---|
| 1 | `tests/cron/bot-online-seed.test.ts` | WO-1089 比例用例所在 `describe` 加 `beforeEach` / `afterEach` 固定假时钟到 `2026-11-04T08:00:00Z`（纽约 03:00 off-peak，与 `dateKey` / `hour` 语义一致） |
| 2 | 同上 | 新增 describe `WO-1089 · 时钟依赖根因守卫`（**not A 反例**）：同一批 2000 bot、同一颗种子，只切时钟，断言 off-peak 落在 2%–12%、peak `> 0.12` 且 `> offPeak × 2`。防止后人误删假时钟后静默退化 |
| 3 | `jest.config.js` | `testPathIgnorePatterns` 补 `<rootDir>/.next/` 与 `<rootDir>/.open-next/`。原配置只有 `<rootDir>/tests/e2e/` 这类绝对前缀，覆盖不到构建产物副本 |

### 3.1 第 3 项为什么必须一并修

本地 build 后 `.next/standalone/` 与 `.open-next/` 共含 **254 个 `.test.ts` 副本**，
其中包含 Playwright 用例。修正前 `TZ=UTC npm test -- --ci` 得到
`40 failed / 382 passed / 422 total`，40 个失败全是 `.next/standalone/tests/e2e/*.spec.ts`
被 Jest 加载（Playwright 拒绝在 Jest 内运行）。CI 是干净 checkout（`npm ci` 后直接 `jest`），
不受影响；但排除产物目录后本地与 CI 口径一致，**且不跳过任何源码套件**。

### 3.2 明确没有做的事

- 没有把 `toBeLessThan(0.12)` 放宽到 0.21；
- 没有改 `peakHours` / `peakMultiplier` / `calculateOnlineProbability`；
- 没有 `test.skip` / `it.todo` / 删除断言；
- 没有降级任何 ESLint 规则或 lint 棘轮基线。

## 4. 门禁证据

### 4.1 本地（全部 `env -u NODE_OPTIONS`）

| 门禁 | 命令 | 结果 |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | **PASS 0** |
| 改动文件 lint | `npx eslint tests/cron/bot-online-seed.test.ts jest.config.js` | **PASS 0** |
| 单文件 · 4 时区 | `TZ={UTC,America/New_York,Asia/Shanghai,Pacific/Auckland} npx jest --runTestsByPath tests/cron/bot-online-seed.test.ts --ci --silent` | **PASS 14/14 × 4** |
| 全量 Jest（CI 命令） | `TZ=UTC npm test -- --ci --reporters=default --silent` | **PASS 128 套件 / 2493 测试** |
| UI 不变量 | `npm run check:ui-invariants` | **PASS R1–R11** |
| Lint 棘轮 | `npm run lint:gate` | **PASS 零新增**（债务下降 5、清零 17） |

> 全量 Jest 有一条既有告警 `A worker process has failed to exit gracefully`（teardown 泄漏提示），
> 退出码 0、不影响门禁；如实记录，未掩盖、未在本轮处理。

peak 守卫能在本地通过，本身即反证假时钟生效：若假时钟未生效，真实 off-peak 时刻下
`peakRatio ≈ 0.0395`，`> 0.12` 断言必然失败。

### 4.2 远端 CI（唯一权威判据）

| 项 | 值 |
|---|---|
| 提交 | `0617c0ee066ca8fbfa34421d9a0234b2ad5253df` |
| 分支 | `main`（`git ls-remote` 权威确认） |
| Run | `42180641094`，`push` 自动触发（非 `workflow_dispatch`） |
| 结论 | **`success`** |
| job | 13 `success` / 0 `failure` / 2 `skipped`（DCO、Perf 基线实跑） |
| `Test (Jest)` | **success**（此前连续两次 failure） |

13 个 success job：Typecheck、Perf SLO 对账、Secret scan (gitleaks)、Migration、
cron 方法一致性、E2E（构建产物浏览器冒烟）、Build (next build)、Dependency audit、
上线预检汇总口径自证、**Test (Jest)**、支付凭据灌注自证、Lint (ESLint 棘轮)、租户作用域审计。

## 5. 分支与发布边界（防止把 CI 修复误读成产品发布）

| 分支 | SHA | 内容 |
|---|---|---|
| `t4/v199-visual` | `b5b922d` | V20.3 交付：G-03 深链接 3 文件 + 11 份文档（40–50） |
| `t4/v199-visual` | `a7c1325` | 本 CI 修复 + 文档口径修正 |
| `main` | `0617c0e` | **仅 2 个文件**：`jest.config.js`、`tests/cron/bot-online-seed.test.ts` |

`main` 提交用 `git commit-tree` 构造（父 `064cfe8`），不切换工作区、不夹带 V20.3 文档或
G-03 代码。头提交带 `[skip netlify]` ⇒ Netlify 不构建；`cloudflare-production.yml` 为
`workflow_dispatch` only、`cloudflare-preview.yml` 为 PR-only ⇒ 均不触发。

- **生产部署零变更**：无 `route.ts` 改动、无 prisma 迁移、无 CF Workers 部署、无 Netlify 构建。
- **V20.3 RC 判定不变**：`NOT READY / NO-GO`（`49`）；本文件不是 D-10 授权。
- 上一版生产事实（`lokfeel-app` version `0e4cceba…`、`modified_on=2026-11-06T03:26:46Z`）不受本轮影响。

> 运维备注：首次 push 因 zsh 把 `"$COMMIT:refs/heads/main"` 里的 `:r` 当作参数修饰符而失败
> （refspec 被吃成 `...3dfefs/heads/main`）。改用 `"${COMMIT}:refs/heads/main"` 后成功。
> 结论仍以 `git ls-remote` 为准，不信脚本退出码。

## 6. 本轮未闭合（不因 CI 转绿而消失）

| 项 | 状态 |
|---|---|
| Figma 可编辑节点 / Node ID 追溯 | `BLOCKED_FIGMA_WRITE`（`42`） |
| 登录性能 LCP ≤2500ms | **FAIL / `PERF_TARGET_NOT_MET`**（`47`） |
| D-06 可登录 QA 账号 / 13 屏业务态生产证据 | BLOCKED |
| S2 真实 Provider / S3 生产业务闭环 | BLOCKED（`48`） |
| 后端运行时 DB / Auth / Cache / OAuth | BLOCKED（`35`） |
| 视觉回归 After 截图、Playwright Trace、全站响应式 | `NOT_TESTED`（`46`） |
| 受管 `cloudflare-production.yml` 官方 run | BLOCKED（PAT 无 `Workflows:Write`） |
| `Production` Environment 审批人 | 治理空壳（`protection_rules=[]`） |
| 支付 4 凭据 / D-01 / D-02 / D-03 / D-09 / H-3 / H-5 | 未闭合（`50` §4） |

## 7. 复跑命令

```bash
cd /Users/frankzhao/WorkBuddy/20260402202519/nexus-app
env -u NODE_OPTIONS npx tsc --noEmit
env -u NODE_OPTIONS npx eslint tests/cron/bot-online-seed.test.ts jest.config.js
TZ=UTC env -u NODE_OPTIONS npx jest --runTestsByPath tests/cron/bot-online-seed.test.ts --ci
TZ=UTC env -u NODE_OPTIONS npm test -- --ci --reporters=default --silent
env -u NODE_OPTIONS npm run check:ui-invariants
env -u NODE_OPTIONS npm run lint:gate
env -u NODE_OPTIONS git ls-remote git@github.com:aoshuang99-netizen/lokfeel.com.git refs/heads/main refs/heads/t4/v199-visual
```
