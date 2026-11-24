# W5 — 迁移影响分析：WebChat 最小发布能否与 3 个新迁移解耦

- 基线日期：2026-11-24
- 生产实际运行 SHA：`b50e53e48a9cc5b91ba2196654ea0ec69aead22b`（`/api/health` 实测，commitSource=env）
- 应用候选 SHA：`9c6b7415b64b865de9db129b0b60735d15d089f1`
- 分析方法：`git diff --name-status b50e53e 9c6b741 -- prisma/migrations` + 源码引用静态追踪（`grep`）+ 生产 schema 模型对照（`git show b50e53e:src/generated/schema.prisma`）。**纯只读分析，未改生产、未改迁移。**

## 1. 3 个新迁移的性质

RC 相对生产新增 7 个文件 / 3 个迁移目录，均为**纯新增**（无 DROP、无重建、无数据回填）：

| 迁移 | 内容 | 性质 |
| --- | --- | --- |
| `20261115120000_v21_batch2_execution_loop` | `Mission.sourceRunId`、`IdempotencyRecord.actorId` 两个可空列 + `MissionSpecRevision`、`ExecutionVerification` 等 3 张表 + 索引 | 纯新增；旧行新列 NULL |
| `20261120000000_v255_durable_inbox` | `BillingInboxEvent`（支付 webhook durable inbox）+ 索引 | 纯新增 |
| `20261120143000_v256_ai_processing_consent` | `AIProcessingConsent`（服务端 AI 处理授权） | 纯新增；无外键 |

## 2. 核心 WebChat 路径是否依赖这些新表/列 —— 逐路径核查

WebChat 最小链 = 邀请 → 接受 → 关系/Match → Conversation → 双向消息。逐段追踪：

| 核心路径 | 使用的数据模型/表 | 是否触碰 3 个新表/列 |
| --- | --- | --- |
| `POST /api/v1/invitations`（A 创建邀请） | `user` / `organization` / Invitation（生产已有） | 否 |
| `POST /api/v1/invitations/accept`（B 接受） → `acceptInvitation()` | `user` / `organization` / Invitation / Match（生产已有） | 否（该 handler 仅调用 tenancy `acceptInvitation`，无 mission/verification 引用） |
| `GET /api/v1/connections/*`（关系） | Connection / Match（生产已有） | 否 |
| `GET/POST /api/im/conversations`、`/api/im/send`、`/api/im/messages/[conversationId]` | Conversation / Message / MessageReceipt（生产已有） | 否 |
| `/api/im/pusher/auth`、`/api/im/read`、`/api/im/reactions`、`/api/im/typing`、`/api/im/presence` | 生产已有表 | 否 |

**静态结论**：核心邀请/关系/聊天路径**不引用** `MissionSpecRevision` / `ExecutionVerification` / `BillingInboxEvent` / `AIProcessingConsent` / `sourceRunId` / `actorId`（新列）。invitations/accept 与管理层 `organization`/`user` 交互。

新增表/列的唯一消费者全部在**非 WebChat 主线**：

- `MissionSpecRevision` / `ExecutionVerification` / `sourceRunId` / `actorId` → `src/lib/connection/{missions,verification,proposals,intents,idempotency}.ts`（V21 AI Agent 执行闭环）
- `AIProcessingConsent` → `src/app/api/im/ai-assist`、`/api/im/ai-consent`、`src/lib/social-ai/ai-consent.ts`（AI 能力线，按新令本就不在首发范围）
- `BillingInboxEvent` → 支付 webhook durable inbox（S 线支付止损只做 fail-closed，不依赖此表）

生产祖先 `b50e53e` 的 `src/generated/schema.prisma` 已含 `Match` / `Conversation` / `ConversationParticipant` / `MessageReceipt` / `MessageReaction` / `User` 等核心模型 ⇒ 最小 WebChat 所需表在生产 schema 中**全部存在**。

## 3. 判定与两种发布方案

**判定：从数据依赖看，WebChat 最小版本（邀请/接受/关系/聊天）与 3 个新迁移正交。** 纯静态引用层面可以拆出「无迁移」的 WebChat 发布线。

但新令要求「能拆就拆」的前提是**拆分后的代码树可独立构建、CI 通过、且不含引用新表的运行时路径**。本仓是 Next.js 全量构建，需要在隔离库上验证编译/启动期 Prisma client 是否因 schema 缺新模型而失败（Prisma client 在生成期绑定 schema，若部署产物用 RC 的 generated client 而生产库无新表，仅在这些模型被查询时才会报错，核心路径不查询即不触发）。**此项需 Staging 实测确认，静态分析不能替代。**

### 方案 A（推荐，若拆分可验证）
- 部署目标：以 `b50e53e` 为基础、仅叠加 S0 支付 fail-closed + WebChat 已有核心路径的**无迁移最小树**。
- 生产 DB：**零迁移**，规避「先迁移后发版」窗口风险。
- AI / Mission 闭环 / BillingInboxEvent：不进入首发，保持未开放。
- 前置：仍需 Owner 提供隔离库（W1），在隔离库用生产 schema 跑 WebChat E2E 证明「无新表也能闭环」。

### 方案 B（若无法拆分或静态不足）
- 部署 RC `9c6b741` 全量，生产窗口**先迁移后发版**。
- 3 个迁移均纯新增、零停机，但 `CREATE TABLE` 无 `IF NOT EXISTS`，只能执行一次；执行前须备份。
- 前置：隔离库完成迁移演练 + 备份/恢复证明 + Owner 迁移范围授权。

## 4. 当前阻断（不因分析完成而解除）

- **W1 BLOCKED_RESOURCE**：无隔离库 ⇒ 方案 A 的「隔离库 E2E 证明」与方案 B 的「迁移演练」均无法执行。
- **S0 待 Owner 精确 SHA 批准**：CI 因 Dependency audit（存量 CVE 时间漂移）为 failure，见审批包。
- 本分析不修改任何代码/迁移/生产，结论为**技术可行性判定**，不是发布授权。
