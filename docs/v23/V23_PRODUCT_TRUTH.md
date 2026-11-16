# V23_PRODUCT_TRUTH | 唯一 Claim 登记表（Product Architect 维护）

规则：每个对外 UI Claim 必须映射到**真实业务对象**与**成功判据**；无对象或无证据的 claim 禁止出现在公开面。`status` 只描述**源码/证据事实**，不等于线上可用。证据等级见 `BASELINE.json`。

## A. 允许对外表达（= 有真实对象）

| Claim ID | 对外文案（中/英） | 真实业务对象 | 成功判据 | 当前证据等级 | 状态 |
|---|---|---|---|---|---|
| C-01 | 「少一点无效社交，多一点值得认识的人」/ Meet people worth knowing | `User` + `Profile` + `ConnectionProposal` | 存在 ≥1 条双方同意且已确认送达的介绍 | NO_SAMPLE | NOT_TESTED |
| C-02 | 「介绍前，双方都有选择权」/ mutual consent, not automatic | `ProposalDecision`（A/B 两条独立 ACCEPT） | 服务端 `MUTUALLY_ACCEPTED` 前有两条独立决策记录 | TESTED_LOCAL（既有单测） | available（代码层） |
| C-03 | 「你会知道为什么推荐」/ clear reasons, not a score | `ConnectionProposal.rationale` + `discloseSubject()` 投影 | 每条候选解释可追溯到已授权字段 | TESTED_LOCAL | available（代码层） |
| C-04 | 「哪些信息被共享、共享给谁，由你决定」 | `SocialIntent.disclosure` + `field-catalog` + `COUNTERPARTY_PROFILE_AUDIENCE` | 默认拒绝；COUNTERPARTY 档仅在介绍落地后生效 | TESTED_LOCAL | available（代码层） |
| C-05 | 「拒绝后不会被反复打扰」 | `Block` + `UserReport` + 提案状态 | 拒绝/撤回/拉黑后新增提案、消息、介绍全部 fail-closed | **GAP**（拉黑拦截 NOT FOUND，见 ADR-03） | BLOCKED_UNTIL_FIXED |
| C-06 | 「没有合适的人时，我们会如实告诉你」 | 候选投影 API 的空数组 | 零供给返回合法空数组，前端不生成假卡片 | TESTED_LOCAL（explore 空态） | available（代码层） |
| C-07 | 「身份与资料的可信程度会分别标示」 | `User.cardVerified` / `Profile.isVerified` / 拟 `IdentityVerification` | 每个 verified 显示都有 provider/event evidence | **GAP**（布尔列 + 恒显徽章） | BLOCKED_UNTIL_FIXED |
| C-08 | 「介绍之后仍能继续沟通与跟进」 | `Conversation` / `IMMessage` / `IntroductionWorkflow` | 真实消息有 seq/receipt，双方仅见授权字段 | TESTED_LOCAL（IM 链路） | available（代码层） |
| C-09 | 「关系进展按证据分级记录」 | `Outcome` / `OutcomeVerification` + 拟 `RelationshipOutcomeEvidence` | 自报 / 双方确认 / 外部事实三级可区分 | PARTIAL（三级派生已有，事件流缺） | gated |

## B. 禁止对外表达（= 无真实对象或无批准）

| 禁 ID | 禁用的 claim | 为什么禁止 | 现网/源码命中 |
|---|---|---|---|
| X-01 | 「AI 帮你完成任何数字事务」/ ONE Goal → Verified Outcome | 产品类别错误（V22 作废标准） | 根 `layout.tsx` metadata、`(landing)/page.tsx` Hero（本地）；生产仍是旧 Hero |
| X-02 | 「已验证的关系成功 / Verified Outcome 27」/ 虚构案例、500K 会员 | 无真实成果、无样本 | `stories` 已标 DEMO；`press` 注释载虚构背书史 |
| X-03 | 未批准价格 `$89/$199/$449`、`From $89/mo`、14 天试用、席位配额 | D1 未批；fail-closed | **生产 LIVE 泄漏**：`/pricing` + plans API（见 `LIVE_RISK_AUDIT.md`） |
| X-04 | 「灵魂契合 97%」/ 预测成功率 / 爱情寿命 | 无 ground truth，禁止模型暗补 | `relationship-engine-preview.tsx` 假分数、`compatibility-breakdown.tsx` 需限定来源 |
| X-05 | MCP / A2A / Token / Compiler / WorkspaceSpec / Mission pipeline / INTENT_EXTRACTION 作为购买理由 | 内部实现，不作消费者首屏 | `login-inner-client.tsx` preflight、`product/page.tsx` 折叠区、根 metadata |
| X-06 | 旧品牌 `LokFee!` / `Find Real Love. No Swiping.` / `AI Relationship Matching Engine` | 旧 B2C 线与未核实 claim | `register/page.tsx:439,531`、`blocked/page.tsx`、`opengraph-image.tsx`、constants |
| X-07 | 未核验法人主体、注册地址、SLA、雇佣承诺（equity/Unlimited PTO）、虚构背书 | 法务与商业未批 | 多份法务页、`careers`、`contact` |
| X-08 | 机器人/库存人像冒充真人、假匹配分、假统计卡 | 违反 S03 / S05 | `analytics-report.tsx`、`avatar-utils.ts`、`explore` 默认值、`profile/[id]` 假照片、bot typing |

## C. 不可混用映射（验收 gate 的硬判定）

| 概念 A | 概念 B | 判定 |
|---|---|---|
| `RelationshipIntent`（想认识谁） | `Mission`（内部执行工作） | 不可混用；Mission 只能作底座 |
| `Introduction`（双方同意后的真实介绍） | `Match`（一种推荐） | 不可混用；Match 为 legacy B2C，DEPRECATE |
| `RelationshipOutcomeEvidence`（关系实际进展） | `ExecutionVerification`（站内执行确认） | 不可混用；后者只代表站内回执 |
| `INTRO_SENT`（真实投递事件） | `RECEIPT / IN_APP / AgentRun EXECUTED` | 不可混用；站内回执不是外部送达 |
| `OUTCOME_REPORTED`（一方自报） | `OUTCOME_VERIFIED`（有验证规则+证据） | 不可混用；未响应不当作已见面 |
| B2C 关系敏感资料 | B2B 社群成员资料 | 不得跨用途默认共享；逐项单独授权 |

**门禁负例**：任何一处把 `Mission CLOSED` / `Agent EXECUTED` / `ExecutionVerification` 判成 `Verified Introduction`，S10 直接 FAIL。对应单测见 `tests/relationship/v23-trust-invariants.test.ts`。

## D. 证据等级定义

`NO_SAMPLE` 无真实业务样本 / `SELF_REPORTED` 一方自报 / `COUNTERPARTY_CONFIRMED` 第二人确认 / `PROVIDER_RECEIPT` 有外部投递回执 / `HUMAN_REVIEW` 人工复核 / `SYSTEM_AUDIT` 系统审计事件。指标采样必须有分母、时间窗与缺失率；缺失数据不得当成功或失败。
