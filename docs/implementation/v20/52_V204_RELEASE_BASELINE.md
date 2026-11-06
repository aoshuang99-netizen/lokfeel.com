# 52 · V20.4 Release Baseline（Batch 0 事实基线与 RC 收敛）

> 生成时间：2026-11-06 18:47 (GMT+8)
> 判定口径：`PASS / FAIL / BLOCKED / NOT_TESTED`。任何一项没有可复现命令输出的，一律不写 PASS。
> 本文件只记录**实测**结果；推断已显式标注为「推断」。

---

## 1. 分支拓扑（权威来源：`git ls-remote`）

| 分支 | SHA | 说明 |
|---|---|---|
| `main` | `0617c0e` | 纯 CI 修复提交（2 文件），CI run `42180641094` = **success**（13 pass / 0 fail / 2 skipped） |
| `t4/v199-visual` | `3c06f24` | V20.3 交付：G-03 深链接代码 + 12 份文档 + 门禁修复 |
| `rc/v20.4` | `e5fa762` | 本轮 RC：`origin/main` 为基，merge `3c06f24`，再加 2 个 workflow 触发器改动 |

分叉点：`064cfe8`。`main` 比它多 1 个提交，`t4/v199-visual` 多 3 个。

核验命令：

```bash
git ls-remote git@github.com:aoshuang99-netizen/lokfeel.com.git \
  refs/heads/main refs/heads/t4/v199-visual refs/heads/rc/v20.4
```

> 纪律：推送是否成功只认 `git ls-remote`，不认脚本退出码。

---

## 2. CI 补丁等价性（关键前置）

`main@0617c0e` 与 `t4/v199-visual@3c06f24` **各自带了一份 CI 修复**。若不先证等价，merge 会产生静默冲突或重复修复。

```bash
git diff --stat 0617c0e 3c06f24 -- jest.config.js tests/cron/bot-online-seed.test.ts
# 输出为空 ⇒ 两分支的该两个文件逐字节相同
```

**结论：逐字等价，merge 安全。** 这解释了为何 RC 的 `git diff 0617c0e..HEAD -- jest.config.js tests/cron/...` 也为空（CI 修复已完整纳入 RC，不重复计入 diff）。

---

## 3. RC 收敛动作

```bash
git switch -c rc/v20.4 origin/main
git merge --no-ff origin/t4/v199-visual -m "rc(v20.4): 收敛 V20.3 交付与 main CI 修复到候选基线 [skip netlify]"
# 结果：无冲突
```

第二个提交 `e5fa762` 改了两个 workflow：

| 文件 | 改动 | 目的 |
|---|---|---|
| `.github/workflows/ci.yml` | `push.branches` 增加 `'rc/**'` | RC 分支 push 自动跑全套 CI |
| `.github/workflows/cloudflare-preview.yml` | `push.branches` 增加 `'rc/**'` | RC 分支 push 自动部署**隔离的** preview worker |

**为什么不改 `main` 的语义**：`main` 仍是 `pull_request`-only 触发 preview（V20.2 决策不变），且不触发任何生产 worker。

**为什么需要这个改动**：PAT 缺 `pull_requests:write`（见 §5），无法创建 PR 触发 `pull_request` 事件。若不加 `rc/**` 的 push 触发，就**拿不到任何远端 CI / Preview 证据**——只能本地自证。这是绕开权限阻塞、又不降低门禁强度的唯一办法。

---

## 4. RC diff 审计

```bash
git diff --name-status 0617c0e..HEAD
```

21 个文件：19 个来自 V20.3（`docs/implementation/v20/*`、`src/lib/living/workspace-view.ts`、`src/app/workspace/living-workspace.tsx`、`src/components/living/consent/consent-gate.tsx`、`tests/living/workspace-view.test.ts`、`eslint.config.mjs`）+ 2 个 workflow。

四项禁止项扫描（脚本化，逐项 PASS 才放行）：

| 检查 | 方法 | 结果 |
|---|---|---|
| 凭据文件 / 构建产物 / 临时截图入 diff | 按扩展名与目录前缀匹配 `png\|jpe?g\|env\|pem\|key\|p12\|zip`、`test-results/\|.next/\|.open-next/\|node_modules/` | **PASS**（0 命中） |
| diff 内形似真实凭据 | `sk_(test\|live)_…`、`whsec_…`、`github_pat_…`、`ghp_…`、`figd_…`、`cfut_…`、`AIza…`、`BEGIN … PRIVATE KEY` | **PASS**（0 命中） |
| 业务面变更（迁移 / API / 中间件） | `prisma/\|src/app/api/\|route\.ts\|middleware\.ts` | **PASS**（0 命中 ⇒ 无 prisma 迁移、无 API 契约变更） |
| workflow YAML 有效性 | `yaml.safe_load` 逐个解析并打印 `on` 键 | **PASS**（3/3 可解析，`on` 键齐全） |

---

## 5. 远端 CI 与 Preview（真实 run，非本地自证）

| 事件 | Run ID | 结论 |
|---|---|---|
| CI（`rc/v20.4` push @ `e5fa762`） | `42188252386` | **success**：13 success / 0 failure / 2 skipped |
| Cloudflare Preview（同 push） | `42188252454` | **success** |
| CI（`rc/v20.4` push @ **`e1a0dea`**，含安全修复 + 验收工具） | **`42208114349`** | **success**：13 success / 0 failure / 2 skipped |
| Cloudflare Preview（同 push） | **`42208114255`** | **success** |

### 5.1 `e1a0dea` 的 CI 逐 job 结论

| Job | 结论 |
|---|---|
| Typecheck (tsc --noEmit) | success |
| Test (Jest) | **success**（含本轮修好的 `bot-online-seed` 假时钟守卫） |
| Lint (ESLint · 棘轮) | success |
| Build (next build) | success |
| Migration（libSQL 文件库 · 全批次） | success |
| Secret scan (gitleaks) | **success**（PingPong 脱敏后仍无新增泄漏） |
| Dependency audit（生产可达 · 棘轮） | success |
| 租户作用域审计 | success |
| 支付凭据灌注自证 | success |
| Perf SLO 对账（AC-24） | success |
| cron 方法一致性 | success |
| 上线预检汇总口径自证 | success |
| E2E（构建产物 · 浏览器冒烟） | **success**（含 axe 四视口棘轮门禁、首屏指标采集器自证） |
| DCO sign-off / Perf 基线实跑 | skipped（按设计仅手动/PR 触发） |

**合计：13 success / 0 failure / 2 skipped —— 与 `e5fa762` 那轮同口径，绿灯未被安全修复打破。**

Preview 部署落地核验（Cloudflare API，两次部署对照）：

```
lokfeel-preview  modified_on 11:12:23Z  deployment 97a3a4de  (e1a0dea)
lokfeel-preview  modified_on 08:34:47Z  deployment 4d5b274f  (e5fa762)
lokfeel-app      modified_on 03:26:46Z  （两次均未变 ⇒ 生产 worker 未被波及）
```

**隔离确认 PASS**：preview 部署只更新了 `lokfeel-preview`，生产 `lokfeel-app` 的 `modified_on` 保持前一版本时间戳不变。

---

## 6. 阻塞项（如实记录，不隐藏）

| 项 | 状态 | 证据 |
|---|---|---|
| 创建 PR | **BLOCKED** | `POST /repos/.../pulls` → **403**；PAT 缺 `pull_requests:write` |
| 读分支保护规则 | **BLOCKED** | `GET /branches/main/protection` → 403（同一权限边界） |
| `workflow_dispatch` 受管生产流水线 | **BLOCKED** | PAT 缺 `Workflows:Write`（前序已实测，本轮未变） |
| PR URL | **BLOCKED** | 无 PR，因此 RC 证据链里「PR URL」这一项**空缺**，不以分支 URL 冒充 |

> 这一条直接影响 Batch 6 的 RC 12 项证据：第 2 项「PR URL」无法提供。它不阻断技术验收，但**阻断「受保护合并」这一治理要求**。详见 `58`。

---

## 7. 本批次结论

| 验收项 | 判定 |
|---|---|
| RC SHA 固定且可追溯 | **PASS** `rc/v20.4 = e5fa762` |
| 与主分支差异清单完整 | **PASS** 21 文件，逐项归类 |
| 无未解释冲突 | **PASS** `--no-ff` 无冲突且 CI 补丁等价性已证 |
| 无无关提交 | **PASS** 无凭据 / 无产物 / 无业务变更 |
| required checks 通过 | **PASS** run `42188252386` 13/0/2 |
| 不使用 force push | **PASS** 全程普通 push |
| 不直接触发生产部署 | **PASS** `lokfeel-app` 时间戳未变 |
| PR 创建 | **BLOCKED** 权限边界 |

**Batch 0 判定：技术收敛完成（6/7 PASS），治理项（PR）BLOCKED。**
