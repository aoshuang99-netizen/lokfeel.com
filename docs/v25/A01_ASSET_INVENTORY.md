# A01 | V25 源码资产清单（REUSE / ADAPT / BUILD / DEPRECATE / MISSING）

基线：本地 `07486db`（分支 `v25/open-ai-social`）· 取证 2026-11-17 · 只读源码核验，行号对应当前工作树。
原则（V25 总令 §八 A 组）：**不重复发明已有功能**。每项给真实文件 + 行号 + 判定理由；`BUILD` 只用于确无源码的项。

## 1. Chat / 消息 — REUSE（核心）+ ADAPT（授权 gate）

| 事实 | 位置 |
|---|---|
| IM 会话/消息、`clientMsgId` 幂等、`seq` 单调、事务写、付费门、bot 回复、Pusher 站内实时 | `src/app/api/im/send/route.ts:17,55-124` · `src/lib/im/message-guards.ts:115` · `prisma/schema/core.prisma:385` |
| 会话成员校验、msgType 白名单防伪造 SYSTEM、`@unique([userAId,userBId])` | `src/app/api/im/send/route.ts:53` · `src/lib/im/message-guards.ts:10` · `prisma/schema/core.prisma:483` |
| 证据上报：`consentState` 恒为 `CONSENT_NONE`、媒体档位由 msgType 派生 | `src/app/api/im/send/route.ts:142,193` |

判定 **REUSE**（终局模型，Legacy ChatRoom 已删）+ **ADAPT**：V25 要求「未授权跨人处理为零」，须把 `grantedLevel` 真正接入发送执行点（当前只有上报态，无 gate）。注意 `CONSENT_NONE` 是**保守上报、不是伪造授权**，但媒体档位授权（`L1_IMAGE`/`L2_VOICE`/`L3_VIDEO`）在发送路径**无执行点校验**。副作用：站内写库 + Pusher 站内通道；无站外投递、无扣款。

## 2. Match / Introduction — 双线并存，必须分流

| 线 | 事实 | 判定 |
|---|---|---|
| 租户态 v1 | `src/app/api/v1/connections/proposals/route.ts:47` · `src/lib/connection/proposals.ts:782` · `prisma/schema/connection.prisma:290`：双方 decision、CAS 介绍 only-once、意图互补候选、Idempotency-Key、`withTenant('proposal.create')`、投影刻意不含双方身份、rationale 必填 | **REUSE**（V25 的 Introduction/CMI 底座） |
| Legacy B2C | `/api/matches/**` + `src/app/(dashboard)/dashboard/explore/**`（源码注 V16 F-05 明确标「遗留 B2C 线」） | **DEPRECATE**（不得与 v1 混用；不删代码） |

副作用：propose/introduce 仅写库 + 审计；跟进通知 `deliverNotification` 落站内信，EMAIL 无 `RESEND_API_KEY` 时 `CAPTURED`（`src/lib/workflow/delivery.ts:217-220`），不伪称已送达。

## 3. 关系图谱 / 关系网络 — REUSE 可视化，BUILD 持久化

`src/lib/living/field/graph.ts:249` `assembleFieldGraph` 纯函数零 IO，`matchedTokens` 命中词元数→2.5D 深度；`src/app/workspace/living-workspace.tsx:145` `?view=field`；`src/lib/living/field/types.ts:189` 未授权字段不命名、cross_tenant/过期硬门。

判定：可视化层 **REUSE**；**无独立关系图 Prisma 表**，是候选+提案的运行时投影（AGENT 盘点亦确认）→ V25 若要「关系网络持久化」属 **BUILD**，不是改 UI。副作用：无。

## 4. Agent / Mission / Outcome — REUSE（设计最完备）

`src/lib/agent/runtime.ts:245`（3 技能 INTENT_EXTRACTION / INTRO_DRAFT / COORDINATION_ADVICE、注入检测升级审批、额度先于调用、zod 校验）；`src/lib/agents/executor.ts:114`；`src/app/api/v1/agents/runs/[runId]/execute/route.ts:30`。

三权分立已实现：`agent.run`(OPERATOR) / `agent.approve`(ADMIN 第二双眼睛) / `agent.execute`(OPERATOR)，自批拦截、披露授权快照撤销即刻生效；`AWAITING_APPROVAL → EXECUTED` 边不存在。真实模型 HTTP 在服务端，execute 副作用是 `deliverNotification` 站内回执/EMAIL(CAPTURED)，**不是外部动作**。判定 **REUSE**，V25 的 Social Intelligence Router 应包在其外层而非重写。

## 5. Consent / 授权 — ADAPT（核心 REUSE）

`prisma/schema/core.prisma:664-730` ConsentRequest/ConsentGrant（MEDIA/LOCATION/CONTACT/INTIMATE、L0_TEXT…L5_CONTACT、过期、撤销）；`src/app/api/im/consent/route.ts:331,361,373` DELETE 写 `isRevoked` + 审计；`src/lib/connection/disclosure.ts:207` `discloseSubject()` 唯一披露出口（缺键默认 SELF=不披露）；`src/app/api/v1/connections/[connectionId]/revoke/route.ts` 撤销 + 取消待发工作流。

判定 **ADAPT**：字段披露/双边同意/过期/撤销审计可 REUSE；缺口见第 1 项（发送执行点未 gate `grantedLevel`）。连接侧撤销真实阻断介绍。

## 6. Memory / 证据 — 证据链 ADAPT，记忆库 BUILD

`src/lib/outcome/verification.ts:50,68` 三级验证、`isVerified`（SELF_REPORTED 不算）；`prisma/schema/outcome.prisma` Outcome/OutcomeVerification 不可变；`prisma/schema/v21.prisma:58` ExecutionVerification 第二人核验；`src/lib/living/now/evidence.ts` Evidence Lens（null≠0）。

判定：证据分级 **REUSE/ADAPT**；**Vault 是限时对话状态机，不是加密记忆库**（`prisma/migrations/20260927140000_conversation_vault_state/migration.sql` + `core.prisma`）；无 Memory/关系记忆 Prisma 模型、无本地加密记忆存储 → 私有/关系记忆 **BUILD**，但按 V25 属 D15-30，非本轮。

## 7. Billing / 支付 — REUSE 门控与账本，ADAPT 目录

`src/config/pricing-gate.ts:21` `PRICING_APPROVED=false`；`src/lib/payments/commercial-gate.ts` 三重合取（V23 加固）；`src/app/api/payments/dodo/checkout/route.ts:177` 返回 503 `PRICING_NOT_APPROVED`；`src/app/(public)/pricing/page.tsx:37` fail-closed 不显金额；`src/lib/payments/dodo/client.ts:25,78` 真实 Dodo REST；`src/app/api/webhooks/dodo/route.ts` HMAC 验签 + 账本落库；`src/lib/stripe/refund.ts:286` 真实退款；`prisma/schema/billing.prisma` 事件溯源账本。

判定：门控/账本 **REUSE**；`products.ts:140-142` 自设 `APPROVED` + `From $89/mo` 与门冲突 → **ADAPT**（V25 商业目录须重做）。当前本地/代码层 closed；**生产仍开**（A00）。真实扣款/退款能力存在但被门与凭据关闭。

## 8. 开放面 / 开发者 — REUSE 主体，ADAPT/BUILD 缺口

`src/app/api/mcp/route.ts:75,137,156,163` 真 MCP JSON-RPC 2.0（限流 120/min/IP、`tools/list` 公开、调用需会话 + 逐工具能力判定）；`src/app/api/v1/a2a/tasks/route.ts` 最小无状态 A2A；`src/lib/interop/tools.ts` 共用 5 工具目录；`examples/sdk/*` 示例客户端（会话 cookie，无 Bearer）；`public/.well-known/agent-card.json`。

`LICENSE`（AGPLv3）+ `LICENSE-COMMERCIAL.md` + `CLA.md` + `DCO.md` + `TRADEMARK.md`；`docs/SELF-HOSTING.md` + `Dockerfile` + `docker-compose.yml`。

判定：MCP/A2A/双许可/自托管文档 **REUSE**；SDK **ADAPT**（示例→正式包，需机器令牌）；许可证 **ADAPT**（AGPLv3 ≠ V25 期望 Apache-2.0，须 RFC 且不得单方改）；**SBOM BUILD**（无文件，`check:deps` / `audit:open-source` 记 NOT_TESTED）。

## 汇总

| 子系统 | 判定 | 真实外部副作用 | 阻断级别 |
|---|---|---|---|
| Chat/IM | REUSE + ADAPT（consent gate） | 站内 + Pusher；无站外 | P0 授权 gate 缺口 |
| Match/Introduction | v1 REUSE；B2C DEPRECATE | 站内回执；EMAIL CAPTURED | 双线混用风险 |
| 关系图谱 | 可视化 REUSE；持久化 BUILD | 无 | 非首版阻断 |
| Agent/Mission/Outcome | REUSE | 真实模型 HTTP；站内回执 | 不得冒充外部动作 |
| Consent | ADAPT（核心 REUSE） | Pusher + 审计 | P0 gate 缺口 |
| Memory/证据 | 证据 ADAPT；记忆库 BUILD | 无 | BUILD 属 D15-30 |
| Billing | 门控/账本 REUSE；目录 ADAPT | 具备扣款能力，当前关 | **生产泄价 P0** |
| 开放面 | MCP/A2A/许可 REUSE；SDK ADAPT；SBOM BUILD | 无 | 许可证 RFC 待批 |
