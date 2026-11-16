# ADR-V23-001 | Relation-first：停止通用 Agent OS 扩散

- 状态：**ACCEPTED_FOR_LOCAL_WORK**（工程层）/ 战略批准待 Owner
- 日期：2026-11-16 · 分支：`v23/relationship-reset`（从 `6bab34c` 切出，未推送）
- 取代：V22 `ONE Goal → Verified Outcome` 作为批准标准；**不删除** V22 的安全/证据/发布治理资产

## 决策

LokFeel 的一级业务对象是「真实人之间的可信介绍」，不是「任意数字目标的执行」。所有活跃开发项必须能映射到关系闭环中的一步；无法映射的新功能暂停（不删除既有代码）。`AgentRun / WorkspaceSpec / Mission / Consent / 审计 / Dodo` 全部降为**关系业务的技术底座**。

## 背景（本轮只读盘点结论）

三条独立只读盘点线（`ASSET_INVENTORY.md`）确认：

- Prisma 为 9 文件目录 schema，**66 个 model**；生产由 `scripts/*/migrate.mjs` 批次脚本管理，`prisma/migrations/*.sql` 多为变更记录，**禁止直接 `prisma migrate deploy` / `db push` 到生产**。
- 服务端**已存在**可直接复用的双向同意不变量：`resolveStatusAfterDecision`（单方 ACCEPT 不改状态）、`evaluateIntroducibility`、`introduceConnection` 执行时 CAS 复检、`discloseSubject()` 默认拒绝、`COUNTERPARTY_PROFILE_AUDIENCE` 介绍后才生效、`assertNoLeakage()`。
- 已存在 `IdempotencyRecord + withIdempotency`、`WorkflowJob/NotificationDelivery` 幂等 outbox、`TenantAuditEvent`、`withTenant(cap)`、`AgentApproval` 职责分离、`OutcomeVerification` 三级派生、fail-closed 定价门、Dodo 验签账本。
- 关键缺口：`Block` 表只有 CRUD，**任何业务路径都没有拉黑拦截**；同意本身被撤销/过期缺少独立二次校验；业务写入与入队不在同一事务；`providerMessageId` 与 `INTRO_SENT` 未严格绑定；`/api/v1/reports` 无租户隔离。

## 资产判定总览（禁止无盘点推倒重写）

| 类别 | 判定 | 代表资产 |
|---|---|---|
| 身份/租户/鉴权 | REUSE | `User` / `Profile` / `Organization` / `Membership` / `withTenant` / `TenantAuditEvent` / `auth()` / `proxy.ts` 安全头 |
| 双向同意与披露 | REUSE + MODIFY | `ConnectionProposal` / `ProposalDecision` / `discloseSubject()` / `field-catalog` / `v1/connections/*` |
| 沟通 | REUSE | `Conversation` / `IMMessage` / `MessageReceipt` / `/api/im/*` / `chats/[roomId]` |
| 幂等/编排 | REUSE + MODIFY | `IdempotencyRecord` / `WorkflowJob` / `jobDedupeKey` / `NotificationDelivery` / `cron/workflow-tick` |
| AI/审批 | REUSE（降级为底座） | `AgentRun` / `AgentApproval` / `AgentExecution` / `AgentDeliveryTarget` / `ExecutionVerification` |
| 成果 | REUSE + MODIFY | `Outcome` / `OutcomeVerification` / `src/lib/outcome/verification.ts` |
| 支付 | REUSE（不新建账本） | `BillingEvent` / `UsageRecord` / `Dodo` 验签 / `commercial-gate` / `PRICING_APPROVED` 双门 |
| 跨社群 | REUSE | `CommunityBridge` / `BridgeMemberOptIn`（双边配置 + 逐成员 opt-in） |
| 前台假数据 | **DEPRECATE / MODIFY** | `analytics-report.tsx` demo、`avatar-utils` 库存人像、`relationship-engine-preview` 假用户、`user-list` demo、`pitch-editor` mock、bot typing |
| Legacy B2C 关系实体 | DEPRECATE（保留兼容，不作主干） | `Match` / `MatchReaction` / `/api/matches/*` / `SincerityWallet` / `Bot*` / `Subscription`/`Payment`(Stripe) / `ConsentRequest`/`ConsentGrant`(IM 媒体档) |

## 新实体最小集合（BUILD，须先迁移兼容性测试，本轮**未执行迁移**）

| 实体 | 为什么现有表不能表达 | 复用模式 |
|---|---|---|
| `RelationshipIntent`(+Revision) | `SocialIntent` 是任务内 need/offer + 逐字段披露，缺 `context / nonNegotiables / boundaries / consentPolicyVersion / schemaVersion / revision` | revision 乐观锁复用 `MissionSpecRevision` |
| `IdentityVerification` | 现有只有布尔列 `cardVerified/isVerified/linkedInVerified`，无法表达 provider、evidenceRef、通过条件、核验人、撤销 | — |
| `DisclosureGrant` | `SocialIntent.disclosure` 是扁平 JSON，`AgentDeliveryTarget` 是创建时快照；缺 `context+recipient+purpose+fieldKey+expiry` 逐项授权与逐条撤销 | 作为 `discloseSubject()` 的授权来源 |
| `RelationshipOutcomeEvidence` | `OutcomeVerification` 是级别派生（一人一级一条），无法承载事件流 `event/source/status/evidenceRef/verificationRuleId` | 与 `ExecutionVerification` 严格区分 |

**不新建 `Introduction` 表**：`ConnectionProposal + ProposalDecision` 已覆盖「提案→双方表态→介绍→撤销→过期」主干，建议 MODIFY 加 `context / disclosurePolicyVersion / allowedFieldKeys / deliveryProvider / providerMessageId`，并把 `ProposalDecision` 的覆盖式写入补成可审计（追加式或写 `TenantAuditEvent`）。理由：避免重复建表与历史数据割裂，符合「不重复建设」的 Owner 指令。

## 必须补齐的服务端不变量（非实体，S07/S08/S11 硬门）

1. `isBlockedEitherWay(sideA, sideB)` → 接入 `createProposal / decideProposal / introduceConnection / candidates / dispatch` 与 `matches/request / im/send`（现 NOT FOUND）。
2. `bothConsentStillValid(intro)` → 补「同意记录本身未被撤销/过期」的独立判定（现仅 `introductionBlockersByProposal` 部分覆盖）。
3. 业务写入 + outbox 入队同事务，先提交再由 worker 投递（现 `.catch(() => {})` + `reconcileMissingJobs` 兜底）。
4. `INTRO_SENT` 绑定真实投递事件；`providerMessageId` 只在真实回执后落库。
5. `/api/v1/reports` 补租户隔离并与拉黑联动。

## 后果

- 正面：不重写安全/登录/支付/幂等/状态机，改造面收敛到「关系语义 + 去假数据 + 不变量补齐 + 面向人的 IA」。
- 负面/成本：新增 4 表意味着生产发布必须**先迁移后发版**；本批未迁移、未部署。
- 风险：现网 `b50e53e` 的未批准定价与 `checkoutReady=true` 不因本 ADR 改变；需 Owner 单独批准最小可逆热修复（见 `LIVE_RISK_AUDIT.md`）。

## 不做什么

不新建通用任务 OS、不把 7 个 `?view=` 工程 key 推给新用户、不引入第二个 UI 面向四类人群、不安装未审查的第三方 Skill 脚本、不由同一会话的子代理自签独立复核。
