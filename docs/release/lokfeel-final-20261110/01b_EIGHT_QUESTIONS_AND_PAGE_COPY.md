# B1 · 对外八问矩阵 + 逐页完整文案（lokfeel-final-20261110）

> 状态：**内容层完成**（文案 + 能力映射 + 证据），页面实现属 B2。
> 语言口径：英文为公开主版本；本档给英文成稿 + 中文要点对照，关键术语词表见 §W。
> 诚实性纪律：每条对外声明都在「证据」列绑定源码事实；未实现能力一律不写；演示案例全部显式标注。
> 更新：2026-11-10 21:0x GMT+8 · 绑定候选 `192a8ff`

---

## A. 八问矩阵（首页必须逐一回答；陌生人 10 秒可懂）

| # | 问 | 回答（对外成稿一句话） | 落页面 | 证据（源码事实） |
|---|---|---|---|---|
| Q1 | 你是谁 | LokFeel is a Connection OS — an agent-native workspace by LokFeel Inc. that turns collaboration intent into approved action and verifiable outcomes. | / | products.ts `connection-os`；page.tsx hero |
| Q2 | 服务谁 | Teams, professional communities and industry-network operators with real members, owners and collaboration tasks. | / + /solutions | 角色体系 MEMBER/OPERATOR/OWNER（tenancy） |
| Q3 | 什么痛点 | Collaboration intent dies in chat threads: nobody approves anything, nobody sees execution, and results can't be proven. | / §pain | 总令 §4；Consent/Outcome 全链路存在的动因 |
| Q4 | 具体能做什么 | Record intent → send proposals → get consent → let agents act under approval → verify outcomes: the full chain runs in one workspace, plus a machine surface (MCP + A2A). | /product | 五步链路 API 全存在（见 §P2 证据列） |
| Q5 | 相对现状的区别 | Four behaviors, not promises: consent before action; visible execution; three-level outcome verification; organization-level control. | / §difference | approval.ts 状态机；verification.ts 三级；console 七屏 |
| Q6 | 结果如何证明 | Every outcome carries a verification level — self-reported, counterparty-confirmed, or externally-verified — with audit events behind each transition. | /product §outcomes + /stories | verification.ts:14-29；audit outcome.confirmed/verified |
| Q7 | 如何开始 | Register with email, Google or X → create or join an organization → submit your first collaboration goal → approve → watch it through to verified outcomes. | /how-it-works | auth providers；POST /api/v1/intents；execute 路由 |
| Q8 | 谁负责、如何获得支持 | LokFeel Inc. is the operator; support@lokfeel.com answers within 24 hours; billing, legal and privacy each have a dedicated mailbox. | /about + /contact | support/contact 页已存在；**主体核实见 D8** |

中文口径（词表级）：LokFeel 帮助团队和专业社群，把合作意向推进为经授权的行动与可核验的成果。

---

## B. 逐页完整文案

### P1 首页 /（重写首屏，保留既有结构骨架）

**导航**：Product · Solutions · Stories · How it works · Pricing · About · Contact → CTA: Start free
**首屏**
- H1: **Turn collaboration intent into approved action and verifiable outcomes.**
- Sub: LokFeel is a Connection OS for teams, professional communities and industry networks. Record what you want to achieve together, get explicit consent, let agents act under approval — and prove what came out of it.
- 主 CTA: **Start your first collaboration**（→ /register）
- 次 CTA: **See how it works**（→ /how-it-works，锚到 60 秒五步演示，非视频占位）
- 首屏元素：**真实 Workspace 截图**（Consent + Outcomes 两屏，B2 采集；禁粒子动画占位）
- ⚠️ 现首页 hero "Describe the outcome. Get a workspace that runs it." 保留为内部 tagline，不作首屏主句（八问覆盖不足）。

**痛点（3 条，逐条对应能力）**
1. Intent dies in chat threads. → Intent 是一等对象：记录、跟踪、到期处理。
2. Nobody approves anything. → Consent 是一等对象：谁批准、批准什么、如何撤回，逐字段披露。
3. Results can't be proven. → Outcome 三级核验 + 审计事件。

**能力四条（映射真实功能）**
1. Consent before action — approval gate 是状态机硬边界（AWAITING_APPROVAL → EXECUTED 不存在）。
2. Visible execution — Agent 运行有真实 Provider（WorkBuddy 云端算力）、进度、失败与下一步。
3. Verifiable outcomes — SELF_REPORTED / COUNTERPARTY_CONFIRMED / EXTERNALLY_VERIFIED。
4. Organization control — 成员、角色、审计、配额与预算，七屏控制台。

**操作步骤（4 步横条）**：Sign up → Create or join an org → Submit a goal → Approve & verify.
**演示案例**：引 /stories 两个案例的第一屏摘要（显式标注 "Demo scenario — not a real customer result"）。
**信任与 FAQ**：Free tier exists（20 proposals / 10 outcomes）；14-day trial（见 P6 绑卡说明）；support 24h。
**页脚**：保留现 footer（5 MCP tools · 50 REST routes…）+ 法律链接全量。

### P2 产品 /product（新增）

副题：One workspace from intent to proof.
五步，每步配真实截图 + 输入/输出/权限/限制：

| 步 | 文案 | 输入→输出 | 权限 | 限制（诚实写明） |
|---|---|---|---|---|
| 1 Intent | State what you want to achieve. | 自然语言目标 → Intent 记录 | intent.manage（自助） | 须先加入 Mission，否则 409 |
| 2 Proposal | Turn it into a proposal between two parties. | Intent → Proposal（含过期派生状态） | 发起=proposal.create（OPERATOR+），读=自助 | 单方操作不等于同意 |
| 3 Consent | Both sides approve, with field-level disclosure. | Proposal → 双方 Consent | proposal.decide（自助） | 拒绝理由不回流对方 |
| 4 Action | Agents act — only after approval. | 批准（agent.approve，ADMIN+）→ 执行（agent.execute，OPERATOR+）→ 运行记录 | 两权分离 | 无批准记录 409；Prompt 注入不能绕过审批 |
| 5 Outcome | Prove what happened. | 上报（全量）→ 对手方确认 → 外部核验 | outcome.report / confirm / verify(ADMIN+) | 自报不算验证成功 |

**产品面**：Workspace 六屏（Now / Studio / Field / Consent / Outcomes / Agents）+ Console 七屏 — 每屏一句真实功能描述（照 Explore 盘点，不加修饰）。
**机器面**：MCP（5 工具：list_missions / list_bridges / bridge_discovery / list_outcomes / report_outcome，逐工具鉴权）+ A2A 任务端点（120 req/min）。发现公开、调用必授权。
**诚实边界块**：不宣称的清单（外发渠道仅站内信+邮件投递；无外部 CRM/WhatsApp 等集成；无自动化"成交"承诺）。

### P3 场景 /solutions（新增）

场景一 · **Professional communities**（社群专业引荐）
- 角色：社群负责人（OPERATOR/OWNER）、被引荐双方。
- 触发：成员提出合作意向（Intent）。
- 行动：负责人起草提案（Proposal）→ 双方同意（Consent）→ 负责人执行介绍 → 双方在产品内跟进。
- 结果：介绍有记录，后续成果可上报并由对手方确认。
- 边界：介绍与跟进发生在产品内（站内信 + 邮件通知）；不宣称站外渠道投递。

场景二 · **Small teams**（小团队目标推进）
- 角色：成员提交目标；负责人审批；另一位成员独立核验。
- 触发：团队把一个目标录入 Workspace（Studio 编译为结构化任务）。
- 行动：负责人批准 Agent 执行（批准权与执行权分离）；执行过程与失败可见。
- 结果：成果三级核验 + 审计事件；组织七屏全程可管。
- 边界：Agent 执行受配额与预算上限（各档均有限值，刻意不写"无限"）。

场景三 · **Hiring / cross-border collaboration**（只写"可作为真实能力支撑的场景"，不扩张为垂直解决方案）
- 用场景一/二的同一链路描述招聘协作与跨境业务协作的使用方式；明确声明：非行业专用方案。

每场景附「适用边界 + 入口 CTA（Start free / Talk to us）」。

### P4 案例 /stories（新增）

案例 A · **A professional introduction, done properly**（演示）
- 问题：社群成员请求引荐；历史做法是群里 @ 一下，没有同意、没有记录。
- 输入：一条 Intent + 一份双字段披露的 Proposal。
- 步骤：双方 Consent → 负责人 introduce → 站内信+邮件通知 → 三周后一方上报成果。
- 证据：Consent 记录、介绍事件、Outcome（COUNTERPARTY_CONFIRMED）+ 审计事件三类。
- 结果与限制：结果=一次有记录、被双方确认的引荐；明标 **Demo scenario — not a real customer result.**
案例 B · **From goal to verified outcome in one workspace**（演示）
- 问题：小团队目标停在聊天记录。
- 输入：目标 → Studio 编译 → Mission。
- 步骤：负责人批准 → Agent 执行（真实 Provider）→ 另一角色外部核验（EXTERNALLY_VERIFIED）。
- 证据：运行记录、审计、核验记录集派生级别。
- 结果与限制：明标演示；不出现任何量化提升承诺。
（真实客户案例 = 0，不伪造 Logo/引语/收益；有授权真实案例后再加。）

### P5 使用说明 /how-it-works + /help（新增）

七段，全部对应真实功能：①注册（email/Google/X，含邮箱验证重发）②建组织或受邀加入（创建组织者即 OWNER）③提交首个目标（Intent/Mission，带幂等键防重复）④批准（批准门语义 + 谁能批）⑤查看结果（Outcome 级别语义表）⑥失败恢复（执行失败状态可见、重试语义、投递失败不丢——NotificationDelivery 落库）⑦支持渠道。
验收基线：新用户不看开发文档即可走完 ①→⑤（G5 用户测试用同一脚本）。

### P6 订阅 /pricing（在现页基础上补三块）

- 顶部价值块（先讲价值再讲价）+ 选档指引（按组织规模与介绍/核验量）。
- 试用与扣费**必须写明**（对照源码事实）：14-day trial — **you authorize payment (bind a card) at checkout; the first charge happens after the trial ends; cancel any time before then and you won't be charged**（Dodo `trial_period_days` 语义）。
- 超额/配额说明：各档配额有限值（无"无限"）；Agent 预算以微分级计价、有月度高成本调用上限。
- 税费：显示为不含税价，结账时由支付商按地区计税（Dodo 行为）。
- 取消/退款：14 天冷静期（/refunds），取消即期末失效，取消流程入口。
- **当前状态如实显示**：connection-os = PENDING_APPROVAL → 按钮文案 "Pricing approval pending"（commercial-gate 503 同源）；D1 批准前不得出现"Buy now"可点状态。
- Scale 年付 $3,990 受 Dodo 单笔 $3,000 上限约束 → 按 D3 决定（提额/降档/下架年付）后再上可售状态。

### P7 公司 /about（改造现页）

- 使命与产品背景：保留现页四理念（Structured over conversational / Consent first-class / Recoverable by design / Open at the edges），补一段八问口径的公司陈述。
- 团队信息：**BLOCKED（D8）** — 无经核实的团队背景资料，缺位处不填占位符。
- 经营主体：LokFeel Inc.（Delaware）——**待 D8 核实**注册文件与收款主体一致性后才能上 /about /terms /privacy；不一致即 BLOCKED。

### P8 联系 /contact（微调现页）

- 现页邮箱结构保留（hello/support/billing/legal/privacy/dmca@lokfeel.com）；响应承诺 24–48h 保留。
- 增加用途说明段与"表单提交失败时的重试指引"；**收件端可达性**（受控收件回执）留 B4 实测（G2）。

### P9 法律 /privacy /terms /refunds

- /terms:156 "Stripe, Inc." → **改为 Dodo Payments**（与实际收银台一致；B2 执行，登记为内容缺陷 C-01）。
- 主体一致性同 P7（D8）。
- /refunds 14 天冷静期与订阅取消口径已一致，保留。

### P10 登录/注册/邀请与收银台回跳（已有，验收口径）

- 登录：email/Google/X（/login）；注册同源；邮箱验证可重发。
- 收银台回跳：URL 参数不赋权，服务端确认后才显示开通（checkout/success 语义不变，G7 已测）。

---

## C. 全站诚实性负表（禁止出现的说法 → 事实依据）

| 禁止说法 | 事实依据 |
|---|---|
| "AI 保证成交/自动取得商业成功" | 无任何成交承诺机制；只承诺流程与核验 |
| "无限 Agent/无限额度" | PLAN_LIMITS 全档有限值，预算微分计价 |
| "已开售/立即购买" | connection-os = PENDING_APPROVAL（D1） |
| "与 Slack/WhatsApp/CRM 集成" | 不存在；投递=站内信+邮件（Resend） |
| "AI 测评/人格分析能力" | LokFeel 无 human model（KKmatch 资产不复用为能力） |
| "Connection OS / MCP / A2A 不解释直接用" | 首次出现必须一句话释义（见 §W） |

## W. 术语词表（英文主词 → 中文 → 一句话释义）

| EN | 中文 | 首次出现释义 |
|---|---|---|
| Connection OS | 连接操作系统 | A workspace that treats connections — people, intent, consent, action — as structured, governable objects. |
| MCP (Model Context Protocol) | 机器上下文协议 | A standard way for external AI tools to call LokFeel's five authorized tools. |
| A2A (Agent-to-Agent) | 智能体互通协议 | A task endpoint other agents can submit work to, under the same permission gates. |
| Outcome | 成果 | A recorded result of a connection, with a verification level. |
| Externally verified | 外部已核验 | Confirmed by an admin who is neither the reporter nor the counterparty. |
| Consent gate | 批准门 | No agent runs without an explicit approval record; prompt injection cannot bypass it. |
