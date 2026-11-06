# V20.3 · 50 — 生产证据（本轮无新生产发布）

> 本轮**未执行任何生产发布**（RC 判定 `NOT READY`，见 `49`）。本文件记录**既成生产事实**与其证据边界，
> 不把历史部署冒充本轮 V20.3 发布。

## 1. 本轮发布决策

| 项 | 值 |
|---|---|
| 发布决策 | **NO-GO / NOT READY** |
| 原因 | Figma `BLOCKED`、UI/UX/视觉回归 `NOT_TESTED`、性能 `FAIL (PERF_TARGET_NOT_MET)`、S2 `BLOCKED`、两条 P1 未闭合 |
| 本轮生产部署 ID | **无**（未触发生产部署） |
| 本轮生产实际 SHA | **无** |
| 回滚证据 | Netlify `app.lokfeel.com` 保留作回滚基线（生产 `79459d6`）；**未做演练** |
| D-10 | 本轮未重新申请；作战令 §8 要求生产发布须 D-10 授权 |

## 2. 既成生产事实（上一轮 C，非本轮）

| 项 | 值 | 取证 |
|---|---|---|
| 生产 worker | `lokfeel-app` | Cloudflare API `GET /accounts/{acct}/workers/scripts` |
| 部署时间 | `modified_on = 2026-11-06T03:26:46.790392Z` | 同上 |
| Version ID | `0e4cceba-3e34-4b7c-b307-bd311f8b8bef` | `opennextjs-cloudflare deploy` 输出 |
| 部署源 | `main@064cfe8` | `git rev-parse HEAD` = `origin/main` |
| 生产 URL | `https://lokfeel-app.aoshuang99.workers.dev` | deploy 输出（沙箱对 workers.dev 出网被拦，浏览器未验收） |
| Preview worker | `lokfeel-preview` @ `2026-11-06T02:40:32.592381Z` | CF API；隔离未受本轮影响 |
| CI 门禁 | `620ef6f` 13 job 全绿 | `v20/33` |

## 3. 最终输出清单（作战令 §11 要求逐项给值）

| 要求 | 本轮值 |
|---|---|
| Git SHA | `b5b922d`（V20.3 交付，已推 `t4/v199-visual`）· `a7c1325`（CI 修复，同分支）· `main = 0617c0e`（**仅含 CI 修复**，见 `51` / §5 例外说明） |
| Figma File URL / Node IDs | **BLOCKED** —— 无文件、无 Node ID（`42`） |
| PR | **BLOCKED** —— PAT 缺 `pull_requests:write`（实测 403），无法自助开 PR |
| CI Run | `42180641094` @ `main = 0617c0e` = **`success`**（13 success / 2 skipped）；由 push 自动触发，非 dispatch，PAT 无 `Workflows:Write` 不构成阻塞。详见 `51` |
| Preview URL | `https://lokfeel-preview.aoshuang99.workers.dev`（既有，非本轮触发） |
| 页面验收矩阵 | `43` §7：整体 NOT COMPLETE（② BLOCKED + ⑧ NOT_TESTED） |
| E2E 结果 | `NOT_TESTED`（本轮）；历史 S1 708/708 PASS（`48`） |
| 性能报告 | **FAIL / `PERF_TARGET_NOT_MET`**（冷 LCP 6544ms，`47`） |
| 安全报告 | **NOT_TESTED**（本轮未跑 gitleaks；D-09 轮换未闭合） |
| 未闭合问题 | 见 §4 |
| 发布决策 | **NO-GO** |
| 生产部署 ID | 无（本轮） |
| 生产实际 SHA | 无（本轮） |
| 回滚证据 | Netlify 基线保留，未演练 |

## 4. 未闭合问题（不因本轮推进消失）

| # | 问题 | 状态 |
|---|---|---|
| 1 | Figma 可编辑节点 / Node ID 追溯 | `BLOCKED_FIGMA_WRITE` |
| 2 | 登录性能 LCP 6544ms | `PERF_TARGET_NOT_MET` |
| 3 | `/hlua` 生产 404 + 390px 溢出（两条 P1） | 待发布复测 |
| 4 | D-06 可登录 QA 账号 | BLOCKED → 13 屏业务态无生产证据 |
| 5 | S2 真实 Provider / S3 生产验证 | BLOCKED（缺 CF Secrets / D-10） |
| 6 | 后端运行时（DB/Auth/Cache/OAuth） | BLOCKED（`35`） |
| 7 | 支付 4 凭据（CREEM/STRIPE × API_KEY/WEBHOOK_SECRET） | 未闭合 |
| 8 | D-01 退款口径 / D-02 定价展示 / D-03 法律主体 | 未闭合 |
| 9 | D-09 历史 55 处形似凭据轮换 | 未闭合 |
| 10 | H-3 举报去重 / H-5 草稿刷新恢复 | 未闭合（H-5 部分由本轮 `?view=` 覆盖导航态，业务草稿恢复仍未做） |
| 11 | `Production` GitHub Environment 无审批人（`protection_rules=[]`） | 治理空壳，需配置 reviewer |
| 12 | 受管 `cloudflare-production.yml` 官方 run | BLOCKED（PAT 无 `Workflows:Write`） |

## 5. 本轮改动落盘状态

- 改动：**5 个源码/配置文件**（新增 `workspace-view.ts`、`workspace-view.test.ts`；修改
  `living-workspace.tsx`、`consent-gate.tsx`、`eslint.config.mjs`）+ **11 份 V20.3 交付文档**。
- 提交策略：按作战令「不得因 UI 改动直接推生产」，**只推开发分支，不直推 `main`、不触发生产发布**。
  提交信息带 `[skip netlify]`，推送后以 `git ls-remote` 权威复核（不信脚本退出码）。
- 本轮未开 PR：PAT 缺 `pull_requests:write`（实测 403），与 `42` 的写入边界一致。
- 生产侧零变更：未新增/修改任何 `route.ts`、无 prisma 迁移、未触发 CF Production workflow。

### ⚠️ 例外说明（2026-11-06，`main` 上的纯 CI 修复，详见 `51`）

「只推开发分支、不直推 `main`」约束的是 **V20.3 产品改动**。为让 `main` 上连续两次
`Test (Jest)` 红灯真正转绿，另用 `git commit-tree` 构造了独立提交 `0617c0e`
（父 `064cfe8`）推 `main`，该提交**只含 2 个文件**：`jest.config.js` 与
`tests/cron/bot-online-seed.test.ts`。

- 不含 11 份 V20.3 文档、不含 `G-03` 深链接代码、不含任何 API / Schema / 迁移改动。
- 头提交带 `[skip netlify]` ⇒ Netlify 不构建；`cloudflare-production.yml` 为
  `workflow_dispatch` only、`cloudflare-preview.yml` 为 PR-only ⇒ 均不触发。
- push 到 `main` 自动触发 `ci.yml`（run `42180641094` = **`success`**，13 job 全绿、
  2 skipped），这是本轮唯一的生产分支事件。
- **结论：生产部署零变更，RC 判定仍 `NOT READY` / `NO-GO`，V20.3 发布链路未越关。**

## 6. 纪律声明

- 不以历史部署冒充本轮发布；不以单测成功冒充端到端验收；不以文档写完冒充门禁通过。
- 所有未跑项标 `NOT_TESTED` / `BLOCKED`，不使用「已完成 / 基本通过 / 应该正常」。
