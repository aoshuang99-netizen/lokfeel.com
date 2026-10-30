# 43 — V19.8 基线核验（V19-80 Batch 0）

日期：2026-10-30 19:36~19:45 (GMT+8)　执行：WorkBuddy（本会话）

## 1. 基线快照

| 项 | 值 | 取证渠道 |
|---|---|---|
| HEAD | `654018c` | `git rev-parse` |
| 分支 | `v19/design-exploration` | `git branch --show-current` |
| 工作树 | **干净**（0 改动） | `git status --short` |
| 远端分支 SHA | `3968f8f` | `git ls-remote`（经代理 127.0.0.1:10808） |
| main SHA | `c3213fd` | 同上 |
| 生产 SHA | **`dc102cd`（记忆值，非本次直读）** | `/api/health` 返回 `version:"unknown"`、无 `commit` 字段 —— 生产部署早于 commit 字段上线，无法从 health 直读。生产健康：`status=healthy`、redis=upstash、dbLatency 11~279ms（2026-10-30T11:37Z 实测） |
| 待推送提交 | **3 个**：`4a71898` / `a67be0a` / `654018c` | `git log origin/..HEAD` |

## 2. BLOCKED_GITHUB_AUTH（未解除）

```
fatal: could not read Username for 'https://github.com': terminal prompts disabled
```

- HTTPS：credential.helper=osxkeychain 但 keychain 无 github.com 条目；GITHUB_TOKEN 未设
- SSH：`~/.ssh/id_ed25519.pub` 存在但未注册到 GitHub（Permission denied (publickey)）
- 解除条件：用户提供 PAT（repo 权限）/ 注册公钥 / 用户自行推送。**推送解锁前远端 CI 结论只能覆盖到 `3968f8f`。**
- 遵照执行令：保持 BLOCKED，继续本地可自主工作。

## 3. CI 运行记录（远端，公开 API）

远端 `3968f8f`：**21 check runs**（`/commits/3968f8f/check-runs`，首条 CodeQL `completed/success`）。
该 SHA 早于 V19.6/V19.7 三个本地提交，**不覆盖**弹窗 E2E、Mission 探针、axe 扫描。

## 4. 密钥扫描（本地替代 gitleaks，CLI 未安装）

形状扫描（sk_test/live_、whsec_、AKIA、ghp_、xox）：源码 **0 命中**。
命中均在**未跟踪**位置：`.next-v196/.next-v197/`（本地构建产物）与 `src/generated/query_compiler_fast_bg.wasm-base64.js`（Prisma 打包常量，非凭据）。`.env*` 系列全部为模板/check 脚本，无真实值入库（CI gitleaks 是权威门禁）。

## 5. 生成物审计

`src/generated` 与工作树一致（`654018c` 已再生成，含 `AgentProviderKind.WORKBUDDY`，第 72 行）——修复了"检入产物落后 schema 导致 next build 类型错误"的根因。

## 6. V19.7 carryover（进入 V19.8 时的未闭合项）

| 项 | 状态 |
|---|---|
| 弹窗 E2E 11 条 + Mission 探针 15P/3B/0F | 本地生产构建实测通过（`F5MMlHi7tIE9ttOAt9ulO`）；**远端 CI 未验证**（被 auth 阻塞） |
| axe 24 格 + 棘轮基线 | `654018c` 已冻结，--gate 双跑零新增（本地）；**未接入 CI**（→ Batch 1） |
| 推送 | BLOCKED_GITHUB_AUTH |
| 举报去重口径（per 用户对 vs per 原因） | P2 待用户拍板 |
| VideoCallModal 无 dialog 语义/焦点管理 | P1（无真实双端通话验证渠道） |
| 存量对比度债（落地/注册/workspace，冻结于 axe-baseline.json） | 只许下降不许上涨 |
| D-10 发布批准 / D-06 测试账号 / PR#32 / Figma 连接器 | 人工门，BLOCKED |
| C-03/C-04/E-01（Mission 探针 3 条 BLOCKED） | 需真实 LLM Provider |

## 7. 执行令遵从声明

- 未 reset --hard、未删数据、未丢弃任何变更；
- 未部署生产；
- 本文档所有结论对应本地 `654018c`，远端结论对应 `3968f8f`，两者已区分标注。

---

## 8. Batch 1 证据（V19-80 · 工程门禁闭环）

本地环境：生产构建 `BUILD_ID=gaXauN841hc2wD66dXBCe`（distDir `.next-v200`）、
服务 `localhost:3000`、夹具库 `/tmp/v196-e2e.db`（file:，非远程）。时间 2026-10-30 20:36~21:19 (GMT+8)。

### 8.1 axe 24 格接入 CI + 门禁三态验证

`.github/workflows/ci.yml` 在「浏览器冒烟」之后新增步骤 `axe 四视口棘轮门禁（V19.8）`
（`timeout-minutes: 15`，命令 `node scripts/qa/v196-axe-scan.mjs --base=http://127.0.0.1:3000 --gate`）。
登录态来自同 job 先跑的聊天夹具（`$GITHUB_ENV`），因此认证面（explore/workspace/chats）才有证据。

| 场景 | 命令 | 退出码 | 结论 |
|---|---|---|---|
| 正常（第 1 次独立运行） | `--gate --shot-dir=/tmp/v198-shots-a` | **0** | `✓ axe 棘轮：零新增` |
| 正常（第 2 次独立运行） | `--gate --shot-dir=/tmp/v198-shots-b` | **0** | 同上，双跑一致 |
| 变异（基线 `color-contrast` 31→30） | `--gate` | **1** | `🔴 /|360x800 :: color-contrast 30 -> 31` |
| 服务不可达（`:3999`） | `--gate` | **2** | `可扫面不完整 0/24` |

**修复的假绿（本轮新发现的产品级缺陷）**：旧逻辑把 `status !== 'ok'` 的格子只打 `□ 状态变化`
然后 `continue` —— 实测对死服务跑 `--gate` 返回 **exit 0 + “零新增”**（24 格全 nav-failed）。
这与"空集恒真是假绿"同型。现改为：
① 先校验可扫面完整性（`scannedKeys < 页数×视口数` ⇒ exit 2，并列出失败格原因）；
② 状态不再作为"不算新增"的免死牌 —— 全部扫到才进入逐规则比对。

原始产物：`/tmp/v198-p1.log`、`/tmp/v198-p2.log`、`/tmp/v198-mut2.log`、`/tmp/v198-gate-dead2.log`；
截图 24 张/轮于 `/tmp/v198-shots-a`、`/tmp/v198-shots-b`。

### 8.2 三组回归（真实用例，非 skip）

| 组 | 用例数 | 结果 |
|---|---|---|
| `auth-dialogs.spec.ts`（ReportModal 9 + 跨租户 1 + VideoCall 1） | 11 | passed |
| `dialogs.spec.ts`（ConfirmDialog 键盘与语义） | 10 | passed |
| `register-form.spec.ts`（注册字段语义 + 多步） | 7 | passed |
| 合计 | **28** | **28 passed / 0 failed（1.6m）** |

首次跑 11 红，两条根因都不是产品缺陷，均已按要求补齐前置后复跑全绿：
① ⑦ 的「24h 去重」前置不干净 → `seed-chat-fixture --cleanup` 后重建；
② `dialogs.spec.ts` 需要 `test-results/authed-state.json`（CI 由 `global-setup` 产出），
本地用 `PW_SKIP_GLOBAL_SETUP=1` 时应先跑 `seed-authed-e2e-user.mjs` 并生成登录态。

### 8.3 静态与单测链路

| 项 | 命令 | 结果 |
|---|---|---|
| Typecheck | `node node_modules/typescript/bin/tsc --noEmit` | **exit 0**（56s） |
| Lint 棘轮 | `node scripts/ci/lint-ratchet.mjs` | **exit 0 零新增**；债务下降 4 处、清零 15 处 |
| Jest | `node node_modules/jest/bin/jest.js --ci --silent` | **117 suites / 2335 tests 全过**（29s） |
| Build | `npx prisma generate && next build` | 产物完整（BUILD_ID 已写出）；**exit 1 来自沙箱 safe-delete 收尾清理**，非编译错误 —— 以 CI 的 build job 为权威结论 |

**lint 棘轮的本地环境修正**：首次跑报 `+153283 条新增`，根因是本地取证 distDir
（`.next-v196/v197/v199/v200`、`.next-dev-*`、`.next/dev-stale-*`、`.trash-audit/`）未在
`eslint.config.mjs` 的 `globalIgnores` 里，全仓 eslint 把构建产物当源码扫。
已把通配模式加入 `BUILD_ARTIFACTS`（CI 的 distDir 恒为 `.next`，行为不变）。

### 8.4 尚未闭环（诚实标注）

- **远端 CI 未跑**：`BLOCKED_GITHUB_AUTH`，上述 24 格与 28 条用例只有本地证据；
- 生产构建的 axe 门禁与本地 dev 结果一致（dev 环境下 HMR 会让 `page.goto` 被导航打断，
  dev 取证不合格，已改用生产构建 —— 这与 CI 同构）。
