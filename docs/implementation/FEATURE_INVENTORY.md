# LokFeel 功能盘点（Feature Inventory）· SaaS AI 生成式平台

> 生成时间：2026-10-20（v2，**已按正确产品定位重写**）｜ 基线：`7393ebf`（main，生产部署 `6ad7365a5635` ready）
> 页面预览：`reports/ui-gallery/index.html`（生产站真实截图 **47 页**，SaaS 组在前）。
> 重跑：`npm run ui:gallery [--only=saas,public,user,admin]`

---

## 0. 产品定位（先纠偏）

**LokFeel 是一个 SaaS AI 生成式协作平台（Connection OS）**：用户用一句话描述目标，
平台把目标**编译**为结构化的工作空间（WorkspaceSpec），由 **AI Agent + 人类成员**
在 Mission → Intent → Proposal → Workflow → Outcome 的流水线上协作达成连接，
全过程有 **Consent（同意与披露）门禁、租户隔离、用量计费**，并通过
**MCP / A2A / REST** 三协议面向外部 Agent 与集成方开放。

> ⚠️ 仓库里同时存在一套**旧 B2C 交友界面**（`/dashboard/*`、explore、matches 等，
> 约 25 页 + 匹配引擎 + Bot 冷启动）。它跑在同一底座上，但**不是本产品的主线**——
> 本盘点的第一层只写 SaaS 主产品，legacy 面在 §8 单独说明。

### 总量仪表

| 维度 | 数量 | 说明 |
|---|---|---|
| 前端页面（page.tsx） | 78 | **SaaS 主产品 25**（workspace 1 + console 8 + m 分享 4 + 认证 7 + blocked 等）· legacy B2C 约 25 · 运营后台 22 · 公开合规 18 |
| API 路由 | 200 | **v1（SaaS 开放面）50** · admin 40 · auth 14 · im 11 · cron 10 · MCP 1 · A2A 1 · 其余支撑 |
| 数据模型 | 62 | tenancy 4 · connection 7 · agent 4 · outcome 2 · bridge 2 · billing 3 · core 30 · bot 6 |
| 机器互操作 | MCP（Streamable HTTP，5 工具）+ A2A + OpenAPI 契约 + 可运行 SDK 示例 | `contracts/connection.openapi.yaml`、`examples/sdk/`（4 个 demo 随 `tsc --noEmit` 检查） |
| 验收 | 24 PASS / 0 FAIL / 1 BLOCKED | AC-25（真实扣款）属外部凭据依赖 |

---

## 1. Living Workspace（`/workspace`）——生成式工作空间【产品核心】

五区布局：左侧 Dock + 顶部 ContextBar + 中央画布 + 右侧 Evidence Inspector + 底部 Command Composer。
**硬约束**（`check:ui-invariants` 把守）：每个数字来自真实端点；未就绪能力禁用 + 写明原因；
三态（loading/空/错误）齐全；**画布只渲染 `WorkspaceSpec`，任何模型/规则不得直接产 HTML/React**。

| 屏 | 内容 | 抓取结果 |
|---|---|---|
| **Now** | 今日工作台：未读通知 / 未读消息 / 我的匹配 + 待处理；Evidence Lens 逐条标注数据来自哪个端点 | ✅ 截图 |
| **Studio** | **生成式入口**：输入目标 →「编译工作区」→ 文本编译为 `WorkspaceSpec`（zod 校验）→ 名单组件渲染画布。实测输入目标后生成「目标与成功判据（期限:30天内 / 成功:达成20次）/ 候选择优 / 执行状态」三卡片 + 渠道/资源对接口（创建连接任务 / 发起双拟提案）；之后可服务端幂等创建 Mission | ✅ **真实编译成功** |
| **Field** | 关系场图（FieldGraph 节点 + Inspector） | ✅ 截图 |
| **Consent** | 同意与披露门禁（逐字段披露，fail-closed：缺省=未授权）+ 跨社群（Bridge）子面板 | ✅ 截图 |
| **Outcomes** | 成果观测台（Outcome Observatory） | ✅ 截图 |
| **Agents** | Agent 看板：运行/审批状态、用量 | ✅ 截图 |
| Missions | 未就绪（明确标注原因，不放假按钮——AC-18 纪律） | — |

---

## 2. SaaS Console（`/console/*`）——组织经营工作台

「个人态 vs 组织态」分层：`/dashboard/*` = 个人态，`/console/*` = 组织态（我的社群），不共用 chrome。
未登录→跳登录；无 ACTIVE 组织→渲染说明页（**不是** 403）。本次预览已给测试账号授予
`LokFeel Preview` 组织（ADMIN），七屏全部真实渲染：

| 屏 | 内容 |
|---|---|
| 总览 | 在飞任务 / 需人处置（死信·已接管·永久失败）/ 停滞连接（阶段超时）/ 死信；消息投递计数（`captured` 不并入 `sent`——AC-09 诚实口径） |
| 任务 | Mission 列表：创建/暂停，约束经 json-codec，成功标准可判定 |
| 成员 | 成员与角色（OWNER/ADMIN/OPERATOR/MEMBER × ACTIVE/INVITED/SUSPENDED） |
| 连接 | ConnectionProposal 管道：候选→提案→决策→引荐（IntroductionWorkflow） |
| 智能体 | AgentRun 列表：状态机 `decideAgentRun()` 唯一出口 |
| 成果 | Outcome 确认/验证 + 指标 |
| 设置 | 组织设置 |

---

## 3. AI Agent Runtime（T09）

| 能力 | 说明 |
|---|---|
| 三技能 | `INTENT_EXTRACTION` / `INTRO_DRAFT` / `COORDINATION_ADVICE` |
| 审批分离 | 高风险技能必须人工批准（approve/execute/reject 三端点）；制度是「**能跑不能批**」（QA 账号只给 OPERATOR 的原因） |
| 注入防御 | 用户目标文本是不可信输入；注入信号 → 升级为必须批准 |
| 落库口径 | 风险级快照、目标对象标签（**不存档案字段值**）、`requestedBy` 软引用（注销后可查） |
| 用量 | `agent:usage` 上报 + 对账（agent-reconcile） |
| 出口连通性 | 生产 `OPENAI_BASE_URL` → Netlify AI Gateway；网络层已验证 PASS（285ms），「能否出稿」需一次计费调用（未实测） |

---

## 4. 连接流水线（T02–T06）与跨社群（T10）

```
Mission(使命，高熵 shareToken 可分享)
  └─ SocialIntent(意图：要什么/给什么 + 逐字段披露表 + 导入许可留痕)
       └─ ConnectionProposal(提案) → ProposalDecision(决策)
            └─ WorkflowJob(任务队列：重试/接管/死信)
                 └─ IntroductionWorkflow(引荐) → Outcome(成果) → OutcomeVerification(验证)
跨社群：CommunityBridge(两组织协议，软引用不可继承) + BridgeMemberOptIn
```

- 幂等底座：`IdempotencyRecord`（`Idempotency-Key` 头，`mission.create` 等）
- 租户铁律：所有查询以 `organizationId` 为首要条件；绝不信任客户端传 organizationId
- M 短链（`/m/[token]` 4 页）：高熵 token 即能力凭证；未注册访客预览受 `allowGuestPreview` 开关控制，最小披露

## 5. 计量与计费（T08）

- 用量收集（`billing/usage/collect`）、订阅事件、charges；`billing-reconcile` 对账
- ⚠️ 对外收款（Creem/Stripe）**未配置**：7 入口统一 503 `PAYMENT_NOT_CONFIGURED`，只差 4 个凭据

## 6. 机器互操作（T11–T12）

| 面 | 内容 |
|---|---|
| **MCP** | `/api/mcp`，Streamable HTTP（非 stdio——Netlify 无常驻进程），协议版本 2025-06-18，server `lokfeel-connection-os@0.2.0`；发现（initialize/tools/list）公开，`tools/call` 逐工具 `resolveTenant()+can(role,capability)`；**5 个工具**：`list_missions` / `list_bridges` / `bridge_discovery` / `list_outcomes` / `report_outcome` |
| **A2A** | `/api/v1/a2a/tasks` + agent-card；与 MCP **共用同一份工具目录**（`src/lib/interop/tools.ts`，防两套清单静默漂移） |
| **REST v1** | 50 条：missions / intents / connections / workflow / outcomes / bridges / billing / org / members / me(export·erasure) / public(missions token) |
| **契约** | `contracts/connection.openapi.yaml` + `check:openapi-contract` CI 门禁 |
| **SDK 示例** | `examples/sdk/`：demo-discovery（免凭据）/ demo-rest / demo-mcp / demo-a2a，可运行文档 |

## 7. 共用底座（SaaS 与 legacy 共享）

NextAuth v5（JWT + Google/Twitter OAuth + Firebase）· Turso（libSQL）+ Prisma 7 多文件 schema ·
Upstash Redis（缓存/限流，`ratelimit:<name>:<key>`）· Pusher（IM 实时）· Resend（邮件）·
Metered TURN（WebRTC）· Netlify scheduled functions（10 条 cron，方法门禁）· Sentry ·
CF `CF-Connecting-IP` 地域风控 + `/blocked` · 三道 CI 棘轮（lint/依赖/schema 漂移）

---

## 8. 遗留 B2C 交友面（legacy，不属 SaaS 主线）

| 块 | 页面/能力 | 状态 |
|---|---|---|
| 个人态 | `/dashboard/*` 15 页：explore（五维匹配）、connections、chats（Pusher + WebRTC 视频）、profile、subscription、settings | 仍在生产、可访问；产品主线之外 |
| 匹配引擎 | 五维评分 + AI 解释 + BotLearningRecord 反哺 | 服务的 legacy 线 |
| Bot 冷启动 | 3500 bot 用户 + 互动日志/学习/头像（6 模型） | 服务的 legacy 线 |
| 运营后台 | `/admin/*` 22 页 + 40 API | 两侧共用（用户/审核/订阅/告警通用） |
| 公开层 | 18 页（营销 + 11 份合规文件） | 品牌门面 |

> 两条线的关系：共享账号、鉴权、租户、IM、通知、审计底座；`Now` 屏的「我的匹配」即来自 legacy 匹配端点。
> 若产品全面转向 SaaS，legacy 面的取舍（保留/下线/合并）是待决策项。

---

## 9. 未接入 / 风险区（如实列出）

| 项 | 状态 | 解锁条件 |
|---|---|---|
| 对外收款 | 7 入口 503 | CREEM/STRIPE 4 个凭据（LAUNCH_READINESS.md） |
| Workspace 的 Missions 屏 | 未就绪（诚实禁用） | 任务列表区接线（创建与画布已在 Studio 提供） |
| Agent 生产出稿 | 未实测 | 需一次计费调用 |
| 11 表 organizationId | 未建模到 DB | 隔离为应用级非 DB 级 |
| `/admin/subscriptions` | 前端异常 1 条 | `undefined.toUpperCase` 白屏风险，建议加空值兜底 |
| `/admin/features` | 前端异常 1 条 | React #418 hydration 不匹配 |
| 落地页叙事 | ⚠️ 首页 `/` 仍是交友叙事（"AI matches what swiping can't"） | **与 SaaS 定位不符，需要重写落地页** |
| Creem 条款 | 未法务复核 | 交友类业务被拒风险（PAYMENT-COMPLIANCE.md） |

---

## 10. 预览索引

`reports/ui-gallery/index.html`（47 页，四组）：**saas 13**（Studio 已含一次真实编译结果画布）·
public 10 · user 10（legacy）· admin 14。明细 `manifest.json`（每页 HTTP 状态/H1/异常数）。
预览基础设施：`scripts/qa/ui-gallery.mjs` + `scripts/qa/grant-preview-org.mjs`（组织授权，dry-run 默认，`--revoke` 可撤销）。
