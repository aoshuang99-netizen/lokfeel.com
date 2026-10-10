# REUSE_MATRIX — 复用 / 重构 / 新增 / 移除

> 基线 commit `6085d31`。四类处置互斥；每行给出**改造起点**（文件:行）与**目标**。
> 原则：**不推倒重来**。既有 Consent / IM / 审计 / RBAC 四块是资产，只做「扩维度」，不做「重写」。

---

## A. 复用（REUSE）— 不改语义，直接接入新闭环

| # | 模块 | 位置 | 在新闭环中的角色 | 需要的最小改动 |
|---|---|---|---|---|
| A1 | 会话与消息模型 | `prisma/schema/core.prisma:366-639`（`Conversation`/`ConversationParticipant`/`IMMessage`/`MessageReceipt`/`MessageReaction`/`UserPresence`） | Coordination 层（介绍后的真实交流载体） | 仅**增加** `tenantId` 与 `proposalId` 关联列 |
| A2 | 同意请求 / 授权 | `core.prisma:645-712`；`src/app/api/im/consent/route.ts`（311 行） | Consent 层 | 复用为主；**扩展** scope 三元组（见 B4） |
| A3 | PowerBoard 规则引擎 | `core.prisma:718-751`；`src/lib/rules/{engine,schema,sync,defaults}.ts` | 确定性权限门控（LLM 不做最终判断） | 增加 mission/proposal 维度的策略键 |
| A4 | 哈希链审计 | `core.prisma:757-787`（`prevHash`/`entryHash`） | 不可抵赖审计 | 增加 `organizationId`；与新增 `audit_events` 并存（见 D1） |
| A5 | RBAC 体系 | `core.prisma:1008-1092`（`AdminRole`/`CustomRole`/`AdminPermission`/`AdminUserRole`）；`src/lib/with-permission.ts`；`src/lib/admin-permissions.ts` | 租户内 RBAC/ABAC | 权限判定增加 tenant 归属校验 |
| A6 | 认证 | `src/lib/auth/**`（NextAuth v5）；`/api/auth/**` | Identity | 增加 organization 选择/切换；OIDC 可后置 |
| A7 | 地域 / CORS / 调试端点门控 | `src/config/region-policy.ts`；`proxy.ts` | 部署层边界 | **必须**把新调试路径加入 `DEFAULT_DEBUG_PATHS`（现仅 3 条，`region-policy.ts:93-97`） |
| A8 | WebRTC ICE 四级来源 + TURN 开通 | `src/lib/rtc/ice-sources.ts`；`scripts/setup-cloudflare-turn.mjs` | Connection（音视频） | 无（已上线） |
| A9 | 管理后台骨架 | `src/app/(admin)/admin/**`（21 页）；`src/app/api/admin/**` | SaaS Console 的一部分 | 改造为租户作用域视图 |
| A10 | CI 七道门 | `.github/workflows/ci.yml`（typecheck/lint/test/build/gitleaks/npm-audit/DCO） | AC-23 证据载体 | 增加 e2e / migration / 权限测试 job |
| A11 | 测试基建 | `tests/**`（18 Jest + 6 Playwright） | 全任务测试 | 增加多租户/同意/工作流用例 |
| A12 | 匹配评分内核 | `src/lib/matching/engine.ts:355,468`；`scoring.ts` | 排序层复用 | **仅**保留评分函数；召回层重构（见 B1） |
| A13 | 邮件/通知 | `src/lib/email.ts`；`src/lib/notifications/**`；`Notification`（`core.prisma:793-814`） | Communication Hub | 改为 outbox 驱动（见 C4） |
| A14 | 限流/缓存 | `src/lib/rate-limit.ts`；`src/lib/cache.ts`；`src/lib/redis-cache.ts` | 基础设施 | 无 |

---

## B. 重构（REFACTOR）— 保留位置与调用方，改语义/结构

| # | 模块 | 现状 | 目标 | 影响面 |
|---|---|---|---|---|
| B1 | 匹配召回 | `Match` 是 **sender→receiver 单向投递**（`core.prisma:267-271` + `pitchMessage:306`），无硬过滤分层 | 改为「**硬门控 → 结构化过滤 → 双向互补召回 → 解释性排序**」四段式；`reason`/`conflictWarnings` 复用为解释字段 | `lib/matching/*`、`/api/matching/*`、`/api/auto-match`、`/api/matches/*`、`(dashboard)/dashboard/connections` |
| B2 | 意图模型 | `Profile` 画像字段（`core.prisma:180-203`）是**人设**，无任务关联、无有效期、无披露范围 | 拆出任务级 `social_intents`（见 C3），`Profile` 保留为「人」的属性 | `Profile` 消费方、`/api/profile/*` |
| B3 | 匹配分缓存 | `Profile.compatibilityScore`（`core.prisma:213`）单值缓存，无法表达双向 | 改为按 (mission, pair) 的提案级快照 | 匹配相关 API/页面 |
| B4 | 同意作用域 | 现仅 `conversationId × MediaAccessLevel`（`core.prisma:655-656,693`） | 扩展为 `purpose` × `recipient_scope` × `field_scope` × `expiry`（对齐 `contracts/schema.sql:28-35`） | `/api/im/consent`、`lib/rules/*`、IM 写入校验 |
| B5 | 审计 | `AuditLog` 只挂 `userId`/`conversationId`（`core.prisma:759-761`） | 统一为 `audit_events`（org + actor + resource_type/id + safe_metadata） | 全站写审计处 |
| B6 | RBAC 判定 | `withPermission` 判全局角色 | 判定改为 (org, role) 且**资源归属校验** | `with-permission.ts`、全部 admin 路由 |
| B7 | 后台 → Console | admin 页面是**平台运营视角** | 增加**租户运营视角**（Mission Studio / Member Intelligence / Connection Engine / Agent Workforce / Outcome Analytics / Billing） | `(admin)/**` 与新路由组并存 |
| B8 | 计费 | `Subscription`/`Payment` 是订阅式（`core.prisma:816-879`） | 增加**用量计量**与**结果归因** | `lib/creem.ts`、`/api/payments/*` |
| B9 | 性别词表 | 存量 `MALE/FEMALE` vs 代码约定 `MAN/WOMAN` | 统一（需产品决策） | `gender-utils.ts`、迁移脚本 |
| B10 | 通知投递 | 直接发送 | 改为 outbox → 队列（幂等/重试/死信） | `lib/notifications/*` |

---

## C. 新增（NEW）

| # | 模块 | 对齐契约 | 任务 |
|---|---|---|---|
| C1 | **租户**：`organizations` / `memberships`（role: owner/admin/operator/member） | `contracts/schema.sql:4-14` | T01 |
| C2 | **Mission**：`missions`（goal/offer/success_criteria/status/expires_at）+ CRUD + 免安装分享页 | `schema.sql:15-20`；`connection.openapi.yaml:11-38` | T02 |
| C3 | **Intent**：`social_intents`（need/offer/constraints/disclosure/expires_at） | `schema.sql:21-27` | T03 |
| C4 | **Proposal**：`connection_proposals` + `proposal_decisions`（accept/reject/revoke，`CHECK proposer<>candidate`） | `schema.sql:36-47` | T04/T05 |
| C5 | **Outcome**：`outcomes`（verification_level ∈ self_reported / counterparty_confirmed / externally_verified） | `schema.sql:48-54` | T08 |
| C6 | **统一审计**：`audit_events` | `schema.sql:55-59` | T05 |
| C7 | **租户隔离执行层**：tenant middleware + RLS（或等价应用层强制）+ 负测 | 契约注释 `schema.sql:64-65` | T01 |
| C8 | **工作流运行时**：持久任务 + outbox + 幂等键 + 重试 + 超时 + 死信 + 人工接管 | `ARCHITECTURE.md:11,19` | T06 |
| C9 | **Agent Runtime**：LLM 输出 schema 校验 + 提示注入防御 + 人工批准闸门 + 成本限额 + 失败降级 | `ARCHITECTURE.md:7,17`；`ACCEPTANCE_MATRIX:12,24` | T09 |
| C10 | **SaaS Console**：Mission Studio / Member Intelligence / Connection Engine / Agent Workforce / Communication Hub / Workflow / Outcome Analytics / Trust / Integrations / Billing 十个模块页 | `PRODUCT_PRD.md:9,13-24`；AC-18 | T07 |
| C11 | **Community Bridge**：双群主协议 + 成员 opt-in + 跨群最小披露 | `PRODUCT_PRD.md:18`；AC-19 | T10 |
| C12 | **Open SDK**：A2A/MCP 适配 + LDCP schema + 示例 + 许可证审计 | `ARCHITECTURE.md:25`；AC-22 | T11 |
| C13 | **可观测性**：结构化脱敏日志 + 指标 | `ARCHITECTURE.md:23` | T06/T12 |
| C14 | **数据生命周期**：导出 / 删除 / 缓存与索引清理 | AC-10 | T05/T06 |

---

## D. 移除 / 收敛（REMOVE）

| # | 对象 | 证据 | 处置 | 注意 |
|---|---|---|---|---|
| D1 | 调试/诊断路由散落 | `/api/debug/*`（9 条）、`/api/test-panel`、`/api/geo-check`、`/api/config/firebase`、`/api/diagnostic/*` | 收敛到受控入口；未列入 `DEFAULT_DEBUG_PATHS` 的**必须**补入或删除 | ⚠️ 删除前先查调用方（历史教训：`dead-code-removal-preflight` 技能） |
| D2 | `.env.*` 已追踪变体 | `.env.check`/`.env.creem-check`/`.env.pull`/`.env.vercel`（值均为空或占位） | 删除或纳入 `.gitignore` | 非阻断，卫生问题 |
| D3 | 遗留 Twitter 重复路由 | `/api/auth/twitter/{signin,callback}`（与 `/api/auth/oauth/twitter/*` 重复，无调用方） | 已在上轮改为「说明 + 转出」薄壳；确认无调用方后删除 | 需再次全仓验证引用 |
| D4 | 匹配单向下行路径 | 与 B1 冲突的旧查询/页面分支 | **并行存在 → 验证无流量 → 再删** | 严禁先删后建 |
| D5 | 文档漂移 | `docs/MULTI-TENANCY-DESIGN.md:12`（42 表 / `schema.prisma`） | 订正为 `prisma/schema/*.prisma`（39 model） | 随 T01 |

---

## E. 禁止事项（来自主指令）

- ❌ 不得为引入新技术而重写 `A1`/`A2`/`A4` 等可用功能。
- ❌ 不得把 `reference_backend/`（FastAPI 内存态）复制覆盖生产代码——它只是**契约演示**。
- ❌ 不得让 LLM/Agent 做最终权限判断（`WORKBUDDY_MASTER_PROMPT.md:20`）。
- ❌ 不得用静态 mock 页面冒充可用功能（`tasks/T00_REPO_AUDIT.md:10`）。
- ❌ 未接通外部服务（如 Creem）只能标 **BLOCKED**，不得标 PASSED。

---

_产出：2026-10-10 · 基线 `6085d31`_
