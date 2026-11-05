# 33 · V20.2 GitHub PR + CI 收口门禁

> 对应 V20.2 作战令 Batch 0 + Batch 1。结论先行：代码事实已复核、生产误部署风险已消除、CI 门禁配置完整且真实；唯一卡点是 **GitHub PR 无法在本环境自主创建**（无 `gh` CLI、无 GitHub API Token）。

## Batch 0 — 代码事实源复核（不信任旧 SHA）

| 检查项 | 结果 |
|---|---|
| 工作树状态 | 干净（`git status --short` 空） |
| 当前分支 | `t4/v199-visual` |
| 本地 HEAD | `1dcbc39`（含 P0-02 构建修复 + 本次 CI 隔离修复） |
| 远端 `main` | `d4ad0d45ab6e87115aab584eed622bc0701b9330`（`d4ad0d4`，未变） |
| 远端 `t4/v199-visual`（SSH `ls-remote` 权威核验） | `1dcbc39655785c908daff73c77f636d3dd43de48` = 本地 HEAD ✓ |
| OpenNext 构建补丁 | 已提交（`scripts/ci/patch-opennext-build.mjs` + `cf:build` 接线） |
| `package.json` / `package-lock.json` | 同提交 `4686be7` 一并提交，一致 |
| 构建产物混入 Git | 无（`.open-next/` 已被 gitignore，`git status` 干净） |
| 生产当前承载 | Netlify（`app.lokfeel.com` = 生产 `79459d6`），本轮**保留**作回滚基线 |
| CF Production 误触发 | **已修复**（见下） |

## Batch 1 — GitHub PR + CI 自主闭环（修复项）

### 1. 生产部署误触发风险：已消除 ✅
原 `cloudflare-production.yml` 含 `on.push: branches: [main]`，即合并到 `main` 会**自动部署生产**。已改为：
- 移除 `push` 触发器，仅保留 `workflow_dispatch`。
- 必须显式输入 `confirm=DEPLOY`。
- 绑定受保护 GitHub Environment `production`（需在仓库 Settings → Environments 配置审批人）。
- 普通合并到 `main` 现在**只**触发 `ci.yml`，绝不会触碰 Cloudflare 生产。

### 2. Preview 流水线：构建门禁与凭据解耦 ✅
`cloudflare-preview.yml` 保留 `pull_request` 触发；构建步骤始终运行（CI 的「CF Build」门禁，校验 `.open-next/worker.js` 产出）。**Deploy 步骤改为仅在有 `CLOUDFLARE_API_TOKEN` 时运行**；无凭据时整步 SKIP（标记 `BLOCKED_ACCESS`），不会让 PR 的必需检查硬红。

### 3. CI 既有门禁清点（来自 `ci.yml`，均为真实执行）
| 检查 | 实现 |
|---|---|
| Typecheck | `tsc --noEmit`（本环境实测 **PASS，0 error**） |
| ESLint | eslint 全仓 + `scripts/ci/lint-ratchet.mjs` 棘轮（只拦新增债） |
| Jest | `npm test` + 多组自证（workspace-drift / evidence-lens / pricing / product-catalog / refund-e2e） |
| Build | `next build`（占位凭证下） |
| Migration | libSQL 文件库全批次建库 + 幂等复跑 + 漂移棘轮 |
| Playwright E2E | `playwright.ci.config.ts` 对本地构建产物真实浏览器冒烟 |
| axe | 四视口棘轮门禁（V19.8） |
| **Secret scan** | **`gitleaks/gitleaks-action@v3`，`fetch-depth: 0` 全历史扫描（真实执行，非仅配置）** |
| 依赖审计 | `npm audit --omit=dev` 棘轮（新增/未登记豁免/豁免到期 → 判红） |
| DCO | PR 提交签署校验 |
| SLO / launch-check / payment-apply / tenancy-scoping / cron-method | 确定性或变异自证门禁 |

### 4. CF Build 门禁：本地实测 PASS ✅
`npm run cf:build`（含 `patch-opennext-build.mjs` 幂等补丁）在纯净 `node_modules` 产出 `.open-next/worker.js` + `assets` + `server-functions`，构建完整通过。

## 诚实边界（未伪造、未越权）

| 项 | 状态 |
|---|---|
| **GitHub PR 创建** | ⚠️ **BLOCKED**：本环境无 `gh` CLI、无 GitHub API Token，无法自主开 PR。分支 `t4/v199-visual` 已推送远端，你可一键在 GitHub 创建 PR，或提供 `GITHUB_TOKEN`（repo 权限）由我创建。 |
| **GitHub CI Run ID** | ⚠️ **PENDING PR**：CI 仅在 PR / main push 时触发；PR 创建后 `ci.yml` 与 `cloudflare-preview.yml` 会自动运行，届时取真实 Run ID。 |
| **gitleaks 本地实跑** | 本环境未装 gitleaks 二进制；CI 用 `gitleaks-action@v3`（真实、全历史扫描），PR 触发后产出真实 Run ID。 |
| 生产部署 | 已隔离，仅 `workflow_dispatch` + `confirm=DEPLOY` + 受保护 Environment。 |

## 下一步
1. **你侧**：配置 GitHub Secrets `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`（最小权限、Preview 作用域），并在 Environments 配置 `production` 审批人；创建 `t4/v199-visual → main` 的 PR（或给 `GITHUB_TOKEN`）。
2. **我侧（PR 触发后自动）**：`ci.yml` 跑全套门禁；`cloudflare-preview.yml` 跑 CF Build 并（有凭据时）部署 Preview。
3. 凭据到位后进入 Batch 2（Cloudflare Preview 真实部署验收）。
