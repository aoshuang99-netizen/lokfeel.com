# LokFeel · P0-3 / P0-4 状态（2026-11-23）

## 范围与边界

- 应用候选：`9bc4fbb7cdc999d5e61814d2bd22967859b964cd`（`rc/p01-invite-loop-20261123`），Preview 运行时 SHA 待独立 Runner 复核。
- 验收基础设施分支：`rc/p03-preview-runtime-audit-20261123`，当前头 `45796e2`（仅 QA 脚本/workflow/文档，不改应用代码）。
- 未执行：生产部署、生产迁移、真实扣款、外部消息、生产数据写入。
- 本机 `workers.dev` 曾超时；按指令不重复相同请求，改用 GitHub-hosted Runner 做独立网络验收。

## 1. 用户成果

- P0-1 的 A/B 两账号邀请、接受、双向聊天证据仍有效：`18/18` HTTP + DB，`3/3` 浏览器截图。
- 本轮新增首页主 CTA 真实浏览器操作：填写真实意图 → 点击 `Start a real conversation` → 跳转 `/register`，录像与截图见 `evidence/local-candidate-final/local-candidate-final/video/`。
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
  - 页面：`16/16 PASS`；
  - 登录：`PASS`；
  - Health/SHA：`PASS`（`9bc4fbb`）；
  - 只读 API：`invite-lookup-invalid PASS`、`plans-read PASS`；
  - 写入 API：`BLOCKED`（未授权向可能共享的 Preview 库写入）；
  - 主 CTA：`PASS`。
- 本地生产旧版对照（`https://app.lokfeel.com`）已抓取同视口截图，见 `evidence/local-run2/before/shots/`。

## 3. 产品成果

- 首页候选版相较生产旧版有真实可见差异：生产旧版主标题 `Your goal, compiled.`；候选版 `Conversations belong to people. You decide what you share.`，并明确标注 AI 仅私下测试、未作为已发布能力。
- 候选版 390px 八页截图已生成，主 CTA 在移动端可见；详见 `evidence/local-candidate-final/local-candidate-final/shots/`。
- 待独立 Runner 产出 Preview 同视口截图后，才把 P0-4 标为部署环境 PASS。

## 4. 发布成果

- 独立 Reviewer：**BLOCKED**。
- Owner 对精确 SHA / 环境 / 迁移 / 回滚的批准：**BLOCKED**。
- 生产部署、生产验收、回滚演练：**BLOCKED（未授权）**。
- Preview 运行时验收：独立 Runner 运行中；最终 Run ID 与结论待写入。

## 证据目录

- `evidence/local-candidate-final/` — 本地候选最终审计（PASS）。
- `evidence/local-run2/before/` — 生产旧版同视口对照截图。
- `evidence/preview/` — GitHub-hosted Runner 的 Preview 审计产物（待 workflow 完成）。
