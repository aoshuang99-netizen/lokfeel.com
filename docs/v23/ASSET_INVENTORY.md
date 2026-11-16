# R01 | V23 已有关系能力资产盘点（REUSE / MODIFY / BUILD / DEPRECATE）

方法：三条独立只读盘点线，全部结论附 `文件路径:行号`；**未修改源码、未连数据库、未跑测试**；只报源码事实，不推断线上状态。判定口径：`REUSE` 可直接复用 / `MODIFY` 扩展后再用 / `BUILD` 源码无法表达 / `DEPRECATE` 不作 V23 主干（保留兼容）。

## 1. Prisma（66 model，9 个 `prisma/schema/*.prisma`，`prisma.config.ts:8` 目录模式）

| 资产 | 事实 | 判定 |
|---|---|---|
| `User` `core.prisma:18`（含 isBot / cardVerified / deletedAt） | 真人主体；已有邮箱验证 `VerificationToken` | REUSE |
| `Profile` `core.prisma:181` | `relationshipGoal / boundaries / dealbreakers(JSON) / isVerified / verificationBadge` | MODIFY（核验等级外挂） |
| `ConnectionProposal` `connection.prisma:290` + `ProposalDecision` `:346` | `status: CONSENT_PENDING/MUTUALLY_ACCEPTED/REJECTED/REVOKED`、`rationale`、`introducedAt`、`@@unique([missionId,proposerId,candidateId])`；决策 `@@unique([proposalId,personId])`（覆盖式） | **MODIFY**（作为 Introduction 主干，不新建 Introduction 表） |
| `SocialIntent` `connection.prisma:143` | 任务内 need/offer + 逐字段 disclosure | MODIFY（补关系语义） |
| `MissionSpecRevision` `v21.prisma:27` | 版本化 + 乐观锁 | REUSE（给 RelationshipIntent 复用模式） |
| `IdempotencyRecord` `connection.prisma:224` / `WorkflowJob` `:449` / `NotificationDelivery` `:515` / `IntroductionWorkflow` `:555` | HTTP 同体幂等、DB outbox、投递留痕、阶段机 | REUSE + MODIFY（事务型 outbox 缺口） |
| `AgentRun/AgentApproval/AgentExecution/AgentDeliveryTarget` `agent.prisma` | AI 建议、审批、执行回执、投递目标和授权字段 | REUSE（降为底座） |
| `ExecutionVerification` `v21.prisma:58` | 站内执行确认 + 第二人核验 | REUSE（**严禁**当关系成功） |
| `Outcome` `outcome.prisma:36` + `OutcomeVerification` `:87` | 三级派生 `SELF_REPORTED→COUNTERPARTY_CONFIRMED→EXTERNALLY_VERIFIED` | REUSE + MODIFY（事件流缺） |
| `Block` `core.prisma:1442` + `UserReport` `:1479` | 表存在；全仓只有 CRUD，**业务路径零拦截** | MODIFY（见 §4） |
| `Organization/Membership/TenantAuditEvent` `tenancy.prisma` | 租户隔离、能力矩阵、强制状态变更审计 | REUSE |
| `CommunityBridge/BridgeMemberOptIn` `bridge.prisma` | 跨社群双边配置 + 逐成员 opt-in | REUSE |
| `Conversation/IMMessage/MessageReceipt/ConversationParticipant` `core.prisma` | 统一 IM 真实链路 | REUSE |
| `BillingEvent/UsageRecord` `billing.prisma` + Dodo 验签 | 事件溯源账本（无需新建 Invoice/Ledger） | REUSE |
| `Match/MatchReaction` `core.prisma:282,358` + `/api/matches/*` | 仅用户级鉴权、无租户隔离、无幂等键；V23 契约明确 `Introduction ≠ Match` | **DEPRECATE**（保留兼容） |
| `ConsentRequest/ConsentGrant` `core.prisma:664,701` | IM 媒体档位授权，`connection.prisma:255-266` 已论证不复用 | DEPRECATE |
| `Bot*` `bot.prisma` / `SincerityWallet` / B2C `Subscription/Payment` | 与关系域无关或明确不与组织账本混用 | DEPRECATE |

**迁移纪律**：`prisma/migrations/20260927140000.../migration.sql:9-11` 明确目录是早期 PG 产物，生产由 `scripts/tenancy/migrate.mjs` / `scripts/connection/migrate.mjs` 批次管理，只支持 `CREATE TABLE/INDEX IF NOT EXISTS`；加列需单独授权的非幂等 `ALTER`。V23 新增 4 表若落地，发布必须**先迁移后发版**。本轮**未写迁移、未执行 db push**。

## 2. 服务端 API 与不变量

| 资产 | 事实 | 判定 |
|---|---|---|
| `withTenant(cap)` `src/lib/tenancy/guard.ts:64-134` | 会话→memberships→`organization.status=ACTIVE`→能力校验→拒绝写审计 | REUSE，`/api/v1/` 60 个 route 中 57 处调用 |
| `resolveStatusAfterDecision` `src/lib/connection/proposals.ts:160-177` | **单方 ACCEPT 不进 MUTUALLY_ACCEPTED** | REUSE（S07 核心） |
| `evaluateIntroducibility` `:193-199` + `introduceConnection` `:782-832` | 执行时再校验 + `updateMany where {introducedAt:null,status:'MUTUALLY_ACCEPTED'}` CAS | REUSE |
| `onConsentDecided` `src/lib/workflow/hooks.ts:202-218` | 仅双方同意才入队 `INTRODUCE_CONNECTION` | REUSE |
| `discloseSubject` `src/lib/connection/disclosure.ts:207-224` + `field-catalog.ts:138-148` | 默认拒绝；COUNTERPARTY 档仅在 `introducedAt !== null` 生效 | REUSE |
| `assertNoLeakage` `src/lib/workflow/notification-content.ts` | 通知正文禁止放 rationale 与档案字段 | REUSE |
| `withIdempotency` `src/lib/connection/idempotency.ts:142-227` | 同键同体回放 / 同键异体 409 / 并发撞唯一键读回胜者 / actor 分区 | REUSE |
| `jobDedupeKey` / `deliveryDedupeKey` `src/lib/workflow/job-core.ts:57-102` | 键内禁时间戳随机数，提案级原子 | REUSE |
| `src/lib/outcome/verification.ts` | `LEVEL_ORDER` 三级派生，级别不接受客户端入参 | REUSE |
| `src/lib/agents/*` + `src/lib/agent/*`（纯内核，禁 IO） | AI 建议 / 审批 / 执行 / 成本 / 连通性 | REUSE |
| `PRICING_APPROVED=false` `config/pricing-gate.ts` + `dodo/plans/route.ts:38-49` + `(public)/pricing/page.tsx:36-37` | SSR/JSON 双门 fail-closed | REUSE（**生产未部署**，见 `LIVE_RISK_AUDIT.md`） |
| `proxy.ts` 安全头 / 地域封禁 / CORS 精确比较 / 冻结 rewrite | 不可破坏 | REUSE |

### 缺口（NOT FOUND，必须 BUILD/MODIFY）

| 缺口 | 搜索证据 | 影响门禁 |
|---|---|---|
| `isBlockedEitherWay` 拉黑拦截 | 全仓 `db.block.*` 只命中 `users/[userId]/block/route.ts:31,55`；`proposals.ts:610` 源码自认「要停止联系应走 Block，不属本任务」；`matches/request`、`im/send`、`candidates` 均无 block 引用 | S07/S11 BLOCKER |
| `bothConsentStillValid`（同意记录本身撤销/过期） | 仅 `introductionBlockersByProposal`（`proposals.ts:724-735`）部分覆盖 | S07 |
| 事务型 outbox | `consent/route.ts:43-46` `.catch(() => {})` + `reconcileMissingJobs()` 兜底；`src/lib/workflow/` 内 `$transaction` 未命中 | S08 |
| `providerMessageId` 绑定真实回执 | `NotificationDelivery` 有 `CAPTURED/SENT` 区分但未与 `INTRO_SENT` 严格绑定 | S08 |
| `/api/v1/reports` 租户隔离 | `reports/route.ts:24,118` 仅 `auth()` | S11 |
| `src/lib/relationship`、`src/lib/consent`、`src/lib/verification`、`src/lib/safety` | 目录 NOT FOUND（实际为 `connection/`、`tenancy/`、`rules/`） | D01 BUILD |

## 3. 前端关系资产（B2C 主线可复用度高于预期）

| 资产 | 事实 | 判定 |
|---|---|---|
| `dashboard/connections/page.tsx:56-57` | `/api/matches?limit=50` + `who-liked-me`，三 Tab 计数由真实列表 filter，三处诚实空态 | **REUSE**（关系枢纽） |
| `dashboard/matches/[id]/page-content.tsx:75-77` | 真实匹配对象、ACCEPTED/PENDING/EXPIRED、Accept/Pass/Unmatch、Send Message | **REUSE**（候选详情） |
| `dashboard/explore/page-content.tsx:52-57,341,361,365,425-444` | 真实 `/api/discover`，注释明确删除 DEMO USERS，API 空/错均 `setUsers([])` 显式空态 | **MODIFY**（去掉 `:349,354-356` 的 `age=25/score=85/Great compatibility/tags=["Match"]` 回填） |
| `dashboard/chats/layout.tsx:164` + `chats/[roomId]/page-content.tsx` | 统一 IM、5s 增量轮询、`clientMsgId` 幂等、已读、举报/拉黑 UI | **MODIFY**（`:607-617` bot typing「simulate real human behavior」、`:851` 写死 48h） |
| `dashboard/onboarding/page-content.tsx` / `profile/page-content.tsx` | 真实 `/api/profile` 读写、6 步资料采集，无假统计 | **REUSE**（渐进建档） |
| `components/living/consent/consent-gate.tsx:202-203,288-289` | 「这里不会凭空生成一条」「这是查询成功后的空，不是读取失败」 | **REUSE**（V23 空态基线） |
| `hooks/use-api.ts` / `lib/api.ts` / `lib/chat/adapter.ts` | SWR 缓存 + 同 URL in-flight 合并 + 超时重试 | REUSE |
| `components/dashboard/analytics-report.tsx:260-311` | 全量 demo 统计卡（12/8/45/50、89/124/-28、92%、82%），真实 `/api/dashboard/analytics` 调用被注释；由 `page.tsx:385` 渲染 | **DEPRECATE**（V23 最大误导源） |
| `lib/avatar-utils.ts:162-188` + `public/avatars/hd/{men,women}` 71 张 | 库存人像兜底，全链路候选/匹配/会话显示人脸 | **MODIFY/DEPRECATE**（掩盖真人供给为空） |
| `dashboard/profile/[id]/page.tsx:183-196,559-575` | 10 张 Unsplash 假照片按性别+名字确定性选图；恒显 Identity Verified 绿勾 / Active | **MODIFY** |
| `components/onboarding/relationship-engine-preview.tsx:78-84` | 6 个具名假用户 + seed 假匹配分（孤儿组件） | DEPRECATE |
| `components/discover/user-list.tsx:250-255,316-322` | Demo 复制用户伪造 id、age=25、score=85（孤儿） | DEPRECATE |
| `components/matches/pitch-editor.tsx:272-310` | 编造开场白 mock（孤儿） | DEPRECATE |
| `src/constants/index.ts:711-727` | `QUICK_REPLIES` / `AI_SUGGESTIONS` 固定话术，被在用聊天室渲染 | MODIFY |
| `src/app/api/dashboard/analytics/route.ts:11-30` | 真实 Prisma 统计查询已存在但被前端绕过 | REUSE（替换 demo 的数据源） |
| `src/components/chat/*`、`matches/*`、`onboarding/*` 多个孤儿 | 全仓无 import；项目注释自述「未挂载」「两套实时通道未上线」 | DEPRECATE（不删除代码，仅不复用） |

## 4. 公开面 / 首页 / 工作区 / 品牌

| 资产 | 事实 | 判定 |
|---|---|---|
| `(landing)/page.tsx:263-276` | V22 Hero `Say what you want done / Stay in control / See what actually happened`，主 CTA `What do you want to get done?` → `/register?goal=` | **MODIFY**（V23 逐字重写） |
| `lib/goal-draft.ts` + `register/page.tsx:128-162,388-427` | goal 草稿接力、240 长限制、只作 React 文本节点、无 innerHTML/eval | REUSE（改造成关系意图接力，保留安全契约） |
| `workspace/living-workspace.tsx:131-147` | 一级「开始/我的任务/待我确认/成果」，二级「更多」放方案编辑/关系网络/执行记录；7 key 全保留 | **MODIFY**（一级改关系 IA，7 key 兼容不动） |
| `config/brand.ts:19-37` | `category='Agent-Native Connection OS'`，description 含 `compiles/Every outcome verified`；`legalName='LokFeel'`（主体未核验） | **MODIFY**（保留 legalName 不编造） |
| `app/layout.tsx:23-92` | 根 title/description/OG/keywords 含 `Connection OS / compiles / verified / MCP server / A2A protocol` | **MODIFY** |
| `app/opengraph-image.tsx:7-12,90` | `AI Relationship Matching Engine` 旧品牌 claim | **MODIFY** |
| `register/page.tsx:439,531` | 旧品牌 `LokFee!` 可见；`gender/sexuality/18+` 表单 | MODIFY（成人门槛属 V23 需要，但品牌与文案须改） |
| `login/login-inner-client.tsx:45,165-220` | `Connection OS` 徽章 + preflight `skills/gates/INTENT_EXTRACTION` | **MODIFY** |
| `(public)/pricing/page.tsx` + `dodo/plans/route.ts` | 本地 fail-closed 双门 | REUSE（**不可回退**） |
| `(public)/help` `/faq` `/support` `/terms` `/privacy` `/refunds` `/hlua` `/checkout/success` `/careers` `/press` 等 | 未批商业承诺、中文占位、旧 B2C/Hlua/成人内容法务模板混语、法务主体 `LokFeel Inc.` | **MODIFY**（逐页，见 `ROUTE_MATRIX.md`） |
| `proxy.ts` + `config/public-surface.ts` + `holding` + `sitemap` 冻结过滤 | 安全与冻结门 | **REUSE，不可破坏** |

## 5. 结论

**已有关系能力比 V22 假设的强得多**：双向同意状态机、字段级披露、租户隔离、幂等 outbox、IM、三级证据分级全部真实存在；V23 不需要重建底座。真正要做的只有三类事：① 把关系对象升为一级（命名/IA/文案/Claim），② 清掉假真人与假证据（S03/S05 阻断源），③ 补齐拉黑拦截、同意有效性、事务型 outbox、真实投递绑定（S07/S08/S11）。**不重写登录、支付、鉴权、幂等与状态机**。
