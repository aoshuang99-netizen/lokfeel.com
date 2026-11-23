# LokFeel · P0-3 / P0-4 状态（2026-11-23）

## 范围与边界

- 应用候选：`9bc4fbb7cdc999d5e61814d2bd22967859b964cd`（`rc/p01-invite-loop-20261123`）。本轮**不改应用代码**。
- 验收基础设施分支：`rc/p03-preview-runtime-audit-20261123`，远端头 **`bb345f936834d61b5b0617ee28f0ad7ed12dc674`**（仅 QA 脚本/workflow/文档）。
- Preview URL：`https://lokfeel-preview.aoshuang99.workers.dev`。
- 未执行：生产部署、生产迁移、真实扣款、外部消息、生产数据写入。

## 1. 用户成果

- P0-1 的 A/B 两账号邀请、接受、双向聊天证据仍有效：`18/18` HTTP + DB，`3/3` 浏览器截图。
- 本机首页主 CTA 真实浏览器操作：填写真实意图 → 点击 `Start a real conversation` → 跳转 `/register`，录像见 `evidence/local-candidate-final/local-candidate-final/video/`。
- **Preview 用户成果：FAIL** —— 独立 Runner 打开 Preview 时首页/注册/产品/方案与关键 API 全部 HTTP 500，用户无法完成任何真实操作。
- 10 名目标用户真人完成率：**BLOCKED（未测）**，不填虚构百分比。

## 2. 工程成果

- 新增独立运行时审计脚本：`scripts/qa/p03-preview-runtime-audit.mjs`。
  - 八页双视口（1440×900 / 390×844）截图；
  - `/api/health` 运行时 SHA 比对；
  - 登录态、公开只读 API、主 CTA 点击录像；
  - 写操作必须显式 `--writes`，否则标 `BLOCKED`。
- 新增 GitHub-hosted Runner workflow：`.github/workflows/preview-runtime-audit.yml`。
- `cloudflare-preview.yml` 加 `paths-ignore`：验收脚本/文档/workflow 变更不重新部署 Preview，避免同一候选被刷成新 SHA。
- 本地候选（生产构建 `127.0.0.1:3215`，隔离库 `/tmp/p01-exp.db`）最终审计：**PASS**。
  - 页面：`16/16 PASS`；登录：`PASS`；Health/SHA：`PASS`（`9bc4fbb`）；
  - 只读 API：`invite-lookup-invalid PASS`、`plans-read PASS`；
  - 写入 API：`BLOCKED`（未授权向可能共享的 Preview 库写入）；主 CTA：`PASS`。
- 审计分支完整 CI：`45125703299` = completed/**success**（SHA `45796e2`）；后续 workflow-only 提交见 `bb345f9`。
- **Preview 独立 Runner 审计：`45128348904` = FAIL**。
  - 结果分支：`audit-results/p03-45128348904`（`b012f6149746bb8493a6bb979937c8667c51525f`）。
  - `/api/health`：`500`，无 `status` / `commit` / `commitSource` ⇒ **SHA 无法对齐**。
  - 公开页：8 个 FAIL（桌面/移动各 4 页：`/`、`/register`、`/product`、`/solutions`），全部 HTTP 500。
  - 认证页：8 个 BLOCKED（登录凭据未提供）。
  - 只读 API：`invite-lookup-invalid` 500、`plans-read` 500。
  - 登录：`BLOCKED` —— `QA_PASSWORD` secret 未配置；没有用默认口令代替。
  - 主 CTA：`FAIL`（页面 500，无法点击）。
  - 写 API：`BLOCKED`（未授权向可能共享的 Preview 库写入）。
- 初步根因：Preview Worker 运行时返回全站 500，`wrangler.preview.jsonc` 只声明 assets/self-reference，没有任何 DB/Auth 变量绑定；生产 Worker 的环境在平台侧。最终根因仍需 Cloudflare Worker 日志确认。

## 3. 产品成果

- 生产旧版同视口截图已抓取：`evidence/local-run2/before/shots/`。
- 候选版本地双视口截图已生成，首页移动主 CTA 可见：`evidence/local-candidate-final/local-candidate-final/shots/`。
- 首页文案有真实可见差异：旧版 `Your goal, compiled.` → 候选版 `Conversations belong to people. You decide what you share.`，并明确 AI 仍为私下测试、未发布能力。
- **部署态产品成果：FAIL** —— Preview 页面 500，不能把本地 PASS 当成部署通过。
- Console 本地候选移动端可见真实待办入口与 `0` 状态（来自本地测试库），不是无来源图表；但部署态仍待 Preview 修好后复验。

## 4. 发布成果

- 独立 Reviewer：**BLOCKED**。
- Owner 对精确 SHA / 环境 / 迁移 / 回滚的批准：**BLOCKED**。
- 生产部署、生产验收、回滚演练：**BLOCKED（未授权）**。
- Preview 运行时验收：**FAIL**（Run `45128348904`），不是 BLOCKED —— 已有独立网络环境的确定证据。
- 直接修复动作：
  1. 责任人 CI/Cloudflare Owner：为 `lokfeel-preview` Worker 绑定运行所需 DB/Auth 环境与 QA 账号 secret，确认日志后重跑 `preview-runtime-audit.yml`；
  2. 责任人 WorkBuddy：审计脚本已就位，Runner 结果会自动落入 `audit-results/p03-<run_id>`；
  3. 在 Preview 八页/登录/API/SHA 全绿前，不得把 P0-4 标为 PASS，也不得进入生产发布。

## 证据目录

- `evidence/local-candidate-final/` — 本地候选最终审计（PASS）。
- `evidence/local-run2/before/` — 生产旧版同视口对照截图。
- 独立 Runner 结果：`git show origin/audit-results/p03-45128348904:docs/p03-preview-runtime-audit/evidence/preview/result.json`。

## 5. 2026-11-23 续 · 全站 500 根因取证与修复

> 唯一根因证据页：`docs/p500-cloudflare-runtime/ROOT_CAUSE.md`。本节只记状态结论。

- **P0-01 根因：已定位（有原始堆栈，不再是"疑似缺环境变量"）**
  - `ChunkLoadError: Failed to load chunk server/chunks/[root-of-the-server]__1tt-pf6z9r63u._.js from runtime for chunk server/instrumentation.js`
  - 包装异常：`Error: An error occurred while loading the instrumentation hook`
  - 失败点：`NextNodeServer.prepare() → loadInstrumentationModule() → requireChunk()`；发生在 DB 查询之前，故 health 是 500 而非 503。
  - 取得方式：本地 `opennextjs-cloudflare preview` 复现 + 构建产物临时注入 `cause` 序列化（调试注入已随重新构建清除，未提交）。
- **已证伪**：`@sentry/nextjs` 顶层 `createRequire`（补丁已应用但运行时仍 500，错误发生在 chunk 加载前）；「缺 DB/Auth 变量」只解释 secrets 为空，不解释公开页 500。
- **因果链**：Next 16.4.5 Turbopack 源 `.next` 有 514 个 root-of-server chunk → `standalone` 只带 254 个（instrumentation nft 明确列出的两个缺失）→ OpenNext `copyTracedFiles` 从 standalone 复制并静默跳过缺失 src → worker bundle 的 `requireChunk` switch 无 case → ChunkLoadError → 全站 500。
- **最小修复**：`scripts/ci/patch-opennext-build.mjs` 新增 `ensureTraceRestoreFix()`，把 nft 已追踪但 standalone 漏掉的文件从构建目录补回；不改业务代码、不改 `next.config.ts`、不动生产凭据。幂等、带锚点校验。
- **本地复现实测（补丁后）**：`/`、`/register`、`/product`、`/solutions` **500 → 200**；`/api/payments/dodo/plans` **500 → 200**；`/favicon.ico` 200；`/api/health` **500 → 503**（设计分支，返回 `commit=2192e22` / `commitSource=git`）⇒ 500 根因已消除。
- **仍未闭合（P0-02 / P0-03 保持 BLOCKED）**：`/api/health` 503、非法邀请码 500。原因是 Preview Worker 无隔离 DB 配置（secrets `names: []`）且 Prisma 的 libSQL adapter 在 Workers 上有 native binding / 动态 WASM 限制。按用户硬约束不复制生产 DB/密钥，需 Owner 提供独立 QA 库与 Prisma-on-Workers 方案。已尝试 web adapter 但错误转为 `Wasm code generation disallowed by embedder`，**已回退，不进入提交**。
- **本轮未执行**：生产部署、生产迁移、真实扣款、外部消息、生产数据写入；Preview 部署与独立 Runner 复验仍待执行。
