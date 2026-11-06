# V20.3 · 45 — 前后端契约（真实 API / Schema / 门禁）

> 权威源：`src/app/api/v1/**/route.ts`（48 条真实 route.ts）、`prisma/schema/*.prisma`、
> `v20/01_V200_PAGE_API_STATE_MATRIX.md`、`v20/13_EVIDENCE_TRUTH_MATRIX.md`。不新建虚构端点。

## 1. 业务主链（作战令 §7，不改写）

```
Intent → WorkspaceSpec → Workspace → Mission → Agent → Consent → Action → Verified Outcome
```

| 环节 | 真实实现 | 服务端事实 |
|---|---|---|
| Intent | `GET/POST /api/v1/intents`、`/intents/{id}/disclosure`、`/intents/fields` | `SocialIntent` + `IntentStatus.ACTIVE/WITHDRAWN` + 逐字段披露档位 `SELF→ORGANIZER→COUNTERPARTY→CANDIDATE`（包含式，`rank(granted)>=rank(viewer)`） |
| WorkspaceSpec | `compileWorkspaceSpec(draft)` **纯前端编译**，`src/lib/workspace-spec` | 画布只渲染 WorkspaceSpec；模型/规则不得直接产 HTML/React |
| Workspace | `/workspace` 单路由六屏（本轮加 `?view=` 深链接） | 导航态，不落库 |
| Mission | `POST /api/v1/missions`（带 `Idempotency-Key`）、`GET /missions`、`/{id}/pause` | `Mission` + `MissionStatus.DRAFT/ACTIVE/PAUSED/CLOSED`；成功只认服务端 `id` |
| Agent | `GET /api/v1/agents/runs`、`/agents/usage`、`/agents/diagnostics/connectivity` | `AgentRun`/`AgentCall`/`AgentApproval`/`AgentExecution`；`AgentRunStatus` 8 态 |
| Consent | `/connections/proposals`、`/connections/{id}/consent`、`/bridges*` | 服务端 `proposal.decide` 重新判定；UI 只按 `availableActions` 渲染 |
| Action | `POST /api/v1/agents/runs/{runId}/approve\|reject\|execute` | 唯一写入点 `executor.ts`；幂等 `dedupeKey = agent-exec:<runId>` |
| Verified Outcome | `GET /api/v1/outcomes`、`/outcomes/metrics`、`POST /outcomes`、`/{id}/confirm`、`/{id}/verify` | `Outcome.verificationLevel` 派生自 `OutcomeVerification`；`verify` 仅 ADMIN+ |

## 2. 真实 API 目录（48 条 route.ts，按域）

| 域 | 端点 |
|---|---|
| missions | `/missions`、`/[missionId]`、`/[missionId]/intents`、`/[missionId]/pause` |
| org / members | `/org`、`/members` |
| agents | `/agents/runs`、`/runs/[runId]`、`/approve`、`/reject`、`/execute`、`/usage`、`/diagnostics/connectivity` |
| connections | `/proposals`、`/pipeline`、`/candidates`、`/introductions`、`/[connectionId]/introduce\|consent\|revoke` |
| intents | `/intents`、`/[intentId]`、`/status`、`/disclosure`、`/fields` |
| outcomes | `/outcomes`、`/metrics`、`/[outcomeId]/confirm`、`/verify` |
| bridges | `/bridges`、`/[bridgeId]`、`/discovery`、`/approve`、`/revoke`、`/opt-in`、`/opt-out` |
| workflow | `/workflow/overview`、`/jobs`、`/[jobId]/takeover`、`/requeue` |
| billing | `/billing/charges`、`/usage`、`/usage/collect`、`/subscription`、`/subscription/events` |
| 其他 | `/a2a/tasks`、`/public/missions/[token]`(+`/join`)、`/me/export`、`/me/erasure` |

## 3. 十条不变量（作战令 §7 要求，真实测试把守）

| # | 不变量 | 测试证据 | 判定 |
|---|---|---|---|
| 1 | 无批准不能执行（`AWAITING_APPROVAL → EXECUTED` 边不存在） | `adversarial-injection.test.ts`、`execution-gated.test.ts` | PASS（S1） |
| 2 | 降级不降低门槛（`DEGRADED` 仍须批准；`PROPOSED → APPROVED` 无边） | `runtime.test.ts`、`approval.test.ts` | PASS（S1） |
| 3 | 裁决唯一且 `decision ≡ status` | `approval-consistency.test.ts`（含变异自证） | PASS（S1） |
| 4 | 未校验文本永不渲染（只交 zod 校验后 `payload`，`rawText` 仅审计） | `runtime.test.ts` ④ | PASS（S1） |
| 5 | 幂等 | `runs-service.test.ts`（`dedupeKey` 重放仅一次投递） | PASS（S1） |
| 6 | 跨租户隔离（`organizationId` 强制过滤） | `tests/tenancy/*` | PASS（S1） |
| 7 | 无证据不能显示 Verified | `outcome/verification` 单测、`VERIFIED_LEVELS` 派生 | PASS（S1） |
| 8 | 生产禁止 Stub Provider（生产+stub 硬抛错；缺凭据返回 `unavailable` 不回退） | `provider-mode` 单测 | PASS（S1） |
| 9 | 模型输出 ≠ 已执行动作；Action 成功 ≠ Outcome Verified | `13_EVIDENCE_TRUTH_MATRIX.md` §0 | PASS（S1） |
| 10 | 失败恢复 / 刷新恢复 | 业务态来自端点重取；本轮新增导航态 `?view=` 恢复 | **部分 PASS / NOT_TESTED（Trace）** |

## 4. S1 / S2 / S3 分层验收（继承 `v20/36`，不伪绿）

| 层 | 内容 | 结果 |
|---|---|---|
| S1 隔离沙箱 | 真实 HTTP + 独立库 + 显式 stub | **708/708 PASS（39 套件）** |
| S2 真实 Provider | 需 `WORKBUDDY_LLM_*` / `OPENAI_API_KEY` 经 CF Secrets 注入 | **BLOCKED**（`35` 亦记录 DB/Auth/Cache 全 BLOCKED） |
| S3 生产业务验证 | 需真实用户授权 + 真实 Outcome + D-10 | **BLOCKED** |

> 作战令 §7「真实 Provider 至少一条经授权的端到端闭环通过」——**本轮未达成，明确标 BLOCKED**。
> 不以 708 条单测或前端成功提示替代 S2/S3。

## 5. 本轮改动对契约的影响

- **零 API 变更**：未新增/修改任何 `route.ts`，未改 `prisma/schema`，无需数据库迁移。
- **零业务状态变更**：`?view=` 只影响客户端导航态，不写库、不发请求。
- **新增纯函数模块** `src/lib/living/workspace-view.ts`，无 IO、无 React，可独立单测。
- **风险面**：仅 `/workspace` 单页；`pushState` 为原生 History API，未引入 router 往返。
- 未破坏 Hlua / legacy 链路（作战令 §4.3）。

## 6. 待补（复跑命令）

```bash
env -u NODE_OPTIONS npx jest tests/agents tests/agent tests/living/consent tests/outcome tests/tenancy/consent-revocation.test.ts --ci
env -u NODE_OPTIONS npx playwright test --config playwright.ci.config.ts   # 需 D-06 登录态
node scripts/qa/verify-payment-off.mjs --base=https://app.lokfeel.com       # 显式 BASE，避免打本机假绿
```
