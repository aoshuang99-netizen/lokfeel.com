# 独立红队 · 修复后复验（第二轮）

执行：独立 QA 子代理脚本 `scripts/qa/v21-batch2-redteam.mjs` **真实重放 HTTP**，非阅读 PASS 报告。
首轮证据（含 FAIL 原始响应）保存在 `redteam-round1-before-fix.json`；第二轮结果覆盖 `redteam-results.json`，逐请求原始响应在 `raw/`。

| 轮次 | 结果 |
|---|---|
| 首轮（修复前） | 8 例：PASS 6 / **FAIL 1（C8/R3 跨用户串台）** / PARTIAL 1；另实测中文注入漏检 |
| 第二轮（修复后） | **PASS 7 / FAIL 0 / PARTIAL 1**（脚本退出码 0） |

## 逐条复验

| 用例 | 首轮 | 第二轮 | 变化依据（原始响应） |
|---|---|---|---|
| C1 匿名越权 | PASS | PASS | 401 `UNAUTHORIZED` ×2，不变 |
| C2 身份字段注入 / 假租户 | PASS | PASS | `organizationId`/`ownerId` 被丢弃，返回资源仍属 `e2e_org_authed` / `e2e_user_authed` |
| C3 MEMBER 零副作用 | PASS | PASS | 403 `PERMISSION_DENIED: missing capability agent.run`，run 数无新增 |
| C4 审批链 + R1 | PARTIAL | **PARTIAL** | INTRO_DRAFT 批准后 `execute` 仍 409 `NO_TARGET`（缺 delivery 目标）；**R1 单一账号自我闭环仍可复现**，未改权限系统（待 Owner 决策） |
| C5 注入标记 | PASS（记录型，含漏检事实） | PASS | `injection-cn-exact` 由 `injectionFlagged=false / PROPOSED` → **`true / AWAITING_APPROVAL`**（D2 修复生效）；英文阳性仍 true；同义改写仍可能不标记（模式表已知局限） |
| C6 XSS 文本渲染 | PASS | PASS | `<script>` 原文落库，API 层非 HTML 执行态 |
| C7 列表信封 | PASS | PASS | missions `data` 数组、runs `data={items}` 对象，均**数据非空**；无权限时 401 而非 200 空数组 |
| **C8 幂等键跨用户串台（R3）** | **FAIL** | **PASS** | 第二账号同键同体不再返回第一账号资源；`Idempotent-Replayed` 重放头消失，各建独立资源（D1 修复生效） |

## 仍未闭合 / 不掩饰

1. **R1（P1）**：ADMIN/OWNER 单会话可完成「发起→批准→执行」。`capabilities.ts` 让 ADMIN 同时持有 `agent.run`/`agent.approve`/`agent.execute`，`decideAgentRun` 不比较 `requestedBy`。本批只在**新增**的核验链强制第二人，既有 approve 链未改（属权限语义变更，需 Owner 批复）。
2. **注入只告警不阻断**：命中后升级为 `AWAITING_APPROVAL`，HTTP 仍 201；模式表可被同义改写绕过。这是既有产品契约，不是安全防线（代码注释亦自述），本批只修确切漏检句。
3. **R2 / R5 / R7**（Creem webhook mock 旁路、debug 路径白名单、GET 触发 cron 副作用）非本批链路，静态审计已记录，未在真实 HTTP 中复现，待排期。
4. **分享页浏览器内 HTML 转义**：无浏览器，记 PARTIAL；仅 API 层取证。
5. **独立性的局限**：本 QA 与本批开发同属一个 WorkBuddy 会话（不同子代理、不改产品代码、亲自发请求），**不是外部 Codex 独立评审**；G20 仍需外部复核人。

## 证据

- `redteam-round1-before-fix.json`（首轮，含 FAIL 原始响应）
- `redteam-results.json` + `raw/`（第二轮 37 份逐请求原始响应）
- `REDTEAM_REPORT.md`（首轮报告；其中 C8 的 FAIL 结论以本复验文件为准）
