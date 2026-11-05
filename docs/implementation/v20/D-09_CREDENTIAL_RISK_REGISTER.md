# D-09 — 凭据风险登记（Credential Risk Register）

> 交付物编号：D-09 · V20.0 §5 自主项
> 生成时间：2026-11-04 14:30 (GMT+8) · 巡检第 1076 轮
> 范围：`nexus-app/` 工作树（不含 `node_modules` / `.git` / 构建产物）
> **本文件全部内容已脱敏**：只保留类型、位置、长度、SHA-256 前 8 位指纹，不含任何明文凭据。

---

## §0 结论先行

| 判断 | 结果 |
| --- | --- |
| 工作树中是否存在硬编码凭据？ | **存在 6 处，全部位于 gitignored 本地文件**，入库文件 0 处 |
| 是否曾泄露进 git 历史？ | **否**。`.env` / `.env.local` / `.env.production` / `.cf-secrets.json` 在 `--all` 历史中均 0 次提交 |
| 密钥扫描是否真正在跑？ | **否**。`.gitleaks.toml` 有 8 条自定义规则，但 `gitleaks` 未安装、无 pre-commit hook、无 npm script ⇒ **规则零执行路径** |
| 最高优先级动作 | **把 gitleaks 接进 pre-commit**（唯一能阻止「下次误提交」的机制），非轮换 |

一句话：**存量干净，机制缺失。** 风险不在「已泄露」，而在「无网」。

---

## §1 扫描方法

- 13 类正则：Stripe（`sk_`/`pk_`）、`whsec_`、`wbpk_`、Creem、Netlify（`nfp_`）、Cloudflare（`cfut_`/`cfat_`）、GitHub PAT（`ghp_` 等）、Vercel（`vcp_`）、JWT 三段式、OpenAI（`sk-`）、Resend（`re_*_*`）、PEM 私钥头。
- 排除：`node_modules`、`.git`、`.next*`、`dist`、`build`、`coverage`、二进制与锁文件。
- 每条命中判定 `git ls-files --error-unmatch` 是否入库，打印时把命中值替换为掩码。
- 首轮宽松正则在 `.next-dev-v196` 构建产物中产生 713 条噪声（`re_` 前缀误匹配 `re_build`/`re_pen` 等），收紧为 `re_[A-Za-z0-9]{8,}_[A-Za-z0-9]{8,}` 并将 `.next-dev-*` 入排除集后降至 6 条。

---

## §2 风险登记表

### R-1 · 本地凭据工件（风险等级：低→中，取决于磁盘共享面）

| # | 类型 | 位置 | 长度 | 指纹 | 入库 | 忽略来源 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Firebase 私钥块 | `.cf-secrets.json:15` | 17 | `573da6fd` | 否 | `.gitignore:59` |
| 2 | Resend API Key | `.cf-secrets.json:22` | 36 | `5233708a` | 否 | `.gitignore:59` |
| 3 | Turso Auth Token | `.env:8` | 279 | `7fa375c5` | 否 | `.gitignore:34` |
| 4 | Turso Auth Token | `.env.local:24` | 279 | `36861437` | 否 | `.gitignore:53` |
| 5 | Netlify Token | `.env.local:41` | 40 | `59f26ca2` | 否 | `.gitignore:53` |
| 6 | Vercel OIDC Token | `.env.production:53` | 1248 | `1b343d6e` | 否 | `.gitignore:36` |

结论：忽略规则覆盖完整，四个文件的 `git check-ignore -v` 均命中具体行号，**无遗漏**。

### R-2 · 文件权限过宽（风险等级：低）

四个文件均为 `-rw-r--r--`（644），同机其他用户可读。单用户 Mac 上实际暴露面小，但与「凭据文件」的期望档位（600）不符。

### R-3 · 密钥扫描零执行路径（风险等级：**高**，本轮核心发现）

| 检查项 | 实际状态 |
| --- | --- |
| `.gitleaks.toml` | 存在，3775 B，8 条自定义规则 + allowlist |
| `gitleaks` 可执行文件 | **未安装**（`which gitleaks` → not found） |
| pre-commit hook | **不存在**（`.git/hooks/pre-commit` 缺失） |
| npm script 调用 gitleaks | **无**（186 个 script 中无任何 gitleaks 调用） |

现有 8 条规则（`lokfeel-creem-api-key`、`lokfeel-generic-webhook-secret`、`lokfeel-turso-token`、`lokfeel-neon-connection-string`、`lokfeel-nextauth-secret`、`lokfeel-vercel-oidc-token`、`lokfeel-cloudflare-api-token`、`lokfeel-stripe-secret-key`）覆盖面审视后存在 **4 类未覆盖**：

- `nfp_`（Netlify）—— 而 R-1 #5 正是一枚 Netlify token，该规则集**抓不到**
- `ghp_` / `gho_` 等 GitHub PAT
- `re_*_*`（Resend）—— R-1 #2 同样抓不到
- `wbpk_` / `sk-`（OpenAI）

即：**即使今天装上 gitleaks，R-1 的 6 项里有 2 项仍会漏检。**

### R-4 · 唯一防线是平台侧

当前实际生效的拦截只有 GitHub push-protection（2026-09-05 曾触发并完成净化）。本地提交到本地分支无任何拦截——`[skip netlify]`、`--no-verify` 类路径完全开放。

---

## §3 建议动作（按优先级）

| 优先级 | 动作 | 阻塞物 | 可自主完成 |
| --- | --- | --- | --- |
| **P0** | `brew install gitleaks` + 写 `.git/hooks/pre-commit`（`gitleaks protect --staged --redact`） | 需装系统包 | 需授权（brew 安装） |
| **P0** | 补齐 4 类缺失规则（`nfp_` / `gh*_` / `re_*_*` / `wbpk_` / `sk-`）到 `.gitleaks.toml` | 无 | ✅ 可以，但会改动入库文件，须走提交 |
| P1 | 四个敏感文件 `chmod 600` | 无 | ✅ 可自主 |
| P1 | 新增 npm script `"scan:secrets": "gitleaks detect --no-git -v"` | 依赖 P0 安装 | 需先有二进制 |
| P2 | 轮换 R-1 中的 Netlify token 与 Resend key（二者曾被本轮/历史会话在工具输出中出现过） | 需 Frank 在各自后台操作 | ❌ 需人工 |
| P2 | 全历史 blob 扫描（`gitleaks detect --log-opts=--all`） | 依赖 P0 | 待二进制就位 |
| P3 | 确认 `.cf-secrets.json` 是否仍有用途，无用则删除 | 需 Frank 判断 | ❌ 需人工 |

---

## §4 诚实边界（明确未做的事）

1. **未验证凭据有效性**。本登记只判断「存在与入库状态」，未对任何 key 发起探测请求——探测本身会消耗配额并可能触发风控，属独立任务。
2. **未做全历史 blob 扫描**。仅用 `git log --all -- <path>` 确认这 4 个路径从未被提交；这不等于「历史中不存在任何其他泄露」，后者需 `gitleaks detect --log-opts=--all`。
3. **未扫描 `~/` 下其他仓库**（`nexus-landing` 等），本轮范围仅 `nexus-app`。
4. **指纹不可逆推出明文**，但同一指纹可用于跨文件关联（本轮据 `573da6fd` 识别出 `.next-dev-v196` 中的私钥块为同一值的编译产物副本，非新增泄露）。
5. **R-2 权限建议未执行**——本文件为只读巡检产物，未改动任何文件权限或内容。

---

## §5 与 V20 计划书 §5 的出入（必须记录）

`docs/implementation/v20/00_V20_EXECUTION_PLAN.md` §5 原文：

> **D-09 凭据风险清单**：扫描当前工作树中形似凭据的前缀……产出脱敏风险登记，供轮换评审（**详见同名交付物**）。

实际核验：截至 2026-11-04 14:29，`docs/implementation/v20/` 下**仅有 `00_V20_EXECUTION_PLAN.md` 一个文件**，全工作区（排除 `node_modules`）不存在任何 D-09 同名交付物。

判断：§5 属**计划陈述被写成了完成陈述**，交付物缺失。本文件即为对该缺口的补齐，并如实标注生成时间晚于计划书。

---

*本文件由只读巡检生成，未 push / 未部署 / 未改动任何被登记文件。*

---

## §6 2026-11-05 复核（V20.0 推进期）

针对 §1「入库文件 0 处」结论，本轮用精确正则对**入库源码**做了二次核验（排除 `node_modules`、`.git`、构建产物、`.env.*`）：

| 前缀 / 形态 | 命中文件 | 性质 | 是否真实密钥 |
| --- | --- | --- | --- |
| `sk_(test\|live)_[A-Za-z0-9]{8,}` | `scripts/qa/payment-credentials-apply.mjs`、`docs/implementation/T00/tests.md` | 自测夹具（`sk_test_abcdefgh`）/ 文档示例 | 否 |
| `whsec_[A-Za-z0-9]{8,}` | `scripts/qa/payment-credentials-apply.mjs` | 自测假服务端夹具（`whsec_`+24×`a`） | 否 |
| `creem_[A-Za-z0-9_-]{10,}` | 无 | — | — |
| `wbpk_` / `pk_(test\|live)_` | 仅 `provider.ts` 注释中「`wbpk_…`」形态说明 | 前缀形状注释 | 否 |
| `rk_(test\|live)_` / `nfp_` / `AKIA*` / `cfut_` / JWT 三段式 | 无真实命中（JWT 命中为脚本内 `..fake` 占位） | 占位 / 构建产物 | 否 |

**结论**：入库源码中**无任何真实凭据字面量**；之前「历史 55 处形似凭据」在精确重扫下归于自测夹具、文档示例、构建产物（`.next-dev-*` wasm base64、`query_compiler_fast_bg.wasm-base64.js`），**不构成泄露**。§0 结论成立。

### 本轮已执行的加固（P1）
- 四个本地凭据文件（`.env` / `.env.local` / `.env.production` / `.cf-secrets.json`）权限已由 `644` 收紧为 `600`。

### 仍待处理（需授权 / 人工）
- **P0**：`gitleaks` 未安装、无 pre-commit hook、无 npm script 调用 → 规则零执行路径（§3 R-3）。需 `brew install gitleaks` 并写入 `.git/hooks/pre-commit`（需授权）。
- **P0**：`.gitleaks.toml` 缺 `nfp_` / `gh*_` / `re_*_*` / `wbpk_` / `sk-` 四类规则（§3 R-3），可在提交内补齐。
- **P2**：Netlify token / Resend key 轮换需 Frank 在各自后台操作。
