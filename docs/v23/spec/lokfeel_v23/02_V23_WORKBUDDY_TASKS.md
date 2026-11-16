# V23 · WorkBuddy 系统整改任务矩阵（机读任务卡同步版）

状态：**NO_GO**，每张卡在真实独立复验前均为 TODO（本文件不是对已存在能力的否认；WorkBuddy 必须复用已实现功能、用新验收要求判定）。

**证据状态机**：`TODO → CODE_COMPLETE → TESTED_LOCAL → TESTED_PREVIEW → INDEPENDENTLY_VERIFIED → PRODUCTION_VERIFIED`。禁止跨级。所有任务须附变更文件、commit SHA、可复跑命令、实际退出码、负例、HAR/截图/数据库证据、评审人、批准记录。

**工程隔离**：变更仅在 V23 独立分支。禁止把本地6bab34c直接改名为GA或在缺审批情况下推 main。每项先确认当前源码是否已有能力，`REUSE / MODIFY / BUILD / DEPRECATE` 再开发。

## R0 战略定轨

| ID / 优先级 | 任务 | Owner | 依赖 | 验收（证据） | 红队负例 |
|---|---|---|---|---|---|
| **R00 / P0** | 以 V23 取代 V22 通用 ONE Goal 定位；固定一句话、首个双边关系场景、两产品线、反目标<br/><sub>docs/v23/STRATEGY_LOCK.md; capability-register.yaml; legacy/V22 impact report</sub> | Product Owner + WorkBuddy PM | 无 | V23 目标、MVP 边界、Claim ID 及跨产品拆分均有签字记录；未签字保持 PENDING | 把“任意个人事务”写成首页主场景时战略门自动 FAIL |

## R0 版本与资产

| ID / 优先级 | 任务 | Owner | 依赖 | 验收（证据） | 红队负例 |
|---|---|---|---|---|---|
| **R01 / P0** | 冻结生产、远端、本地 6bab34c 候选与 V21 提交链；核实不可变构建来源和旧 B2C 能力<br/><sub>scripts/qa/v23-source-inventory.mjs; docs/v23/BASELINE.json</sub> | Reality Auditor | 无 | 分别报告四 SHA、构建时间、schema、路由、支付真实状态；17 LIVE / 7 工作区未登录不算 LIVE；按真实当前值更新 | 无登录态 / 302 不能当页面完成；无法取证=NOT_TESTED |

## R0 制止扩散

| ID / 优先级 | 任务 | Owner | 依赖 | 验收（证据） | 红队负例 |
|---|---|---|---|---|---|
| **R02 / P0** | 停止通用 Agent OS 新功能并建立 Relation-first architecture decision record<br/><sub>docs/v23/ARCHITECTURE_ADR.md; backlog freeze</sub> | Engineering Lead | R00 | 所有活跃开发项均有 Relationship outcome 关联；无关事项暂停不删除既有代码 | AgentRun/WorkspaceSpec 数量不能作为用户价值 KPI |

## R0 现网保护

| ID / 优先级 | 任务 | Owner | 依赖 | 验收（证据） | 红队负例 |
|---|---|---|---|---|---|
| **R03 / P0** | 现网未批准定价和营销承诺隔离；维持 Dodo 商业门及已有合法事件<br/><sub>src/config/products.ts; src/config/pricing-gate.ts; src/app/api/payments/dodo/*; proxy.ts</sub> | Security + Billing | R01 | GET Pricing/JSON 不泄未批价；未批准已登录 checkout 返回业务拒绝；不会影响历史订阅和合法 Webhook | 匿名 401 不代替已登录 503；不擅自改生产环境 |

## R0 对比实验

| ID / 优先级 | 任务 | Owner | 依赖 | 验收（证据） | 红队负例 |
|---|---|---|---|---|---|
| **R04 / P0** | 访谈历史目标用户与关系运营者；明确首个 MVP 垂类及供需分布<br/><sub>docs/v23/DISCOVERY_PROTOCOL.md</sub> | UX Research + Product | R00 | 20 需求者+10 被引荐方+3 运营者目标；真实同意与访谈记录，非代理模拟 | 没有采访真实人类 => UNTESTED, 不以合成用户放行 |

## P1 关系数据

| ID / 优先级 | 任务 | Owner | 依赖 | 验收（证据） | 红队负例 |
|---|---|---|---|---|---|
| **D01 / P0** | 设计 RelationshipIntent、VerifiedProfile、Candidate、Introduction、Consent、FollowUp、OutcomeEvidence 实体与租户隔离<br/><sub>prisma/schema.prisma; prisma/migrations/*; src/lib/relationship/*</sub> | Backend + Data Architect | R01, R00 | 迁移含唯一/外键/行级租户控制；schema 与 client 一致；旧版兼容及脱敏回滚演练 PASS | 跨租户 ID 或旧认证 cookie 读取他人档案必须拒绝 |

## P1 用户身份

| ID / 优先级 | 任务 | Owner | 依赖 | 验收（证据） | 红队负例 |
|---|---|---|---|---|---|
| **D02 / P0** | 验证等级分离：UNVERIFIED、SELF_REPORTED、DOCUMENT_CHECKED 等；成人门槛与隐私级别<br/><sub>src/lib/verification/*; src/app/api/verification/*</sub> | Backend + Trust | D01 | 任一 verified 显示都有 provider/event evidence；失败按 UNKNOWN 展示；禁伪造通过 | 无 provider 证据但前端展示 Verified => FAIL |

## P1 意图抽取

| ID / 优先级 | 任务 | Owner | 依赖 | 验收（证据） | 红队负例 |
|---|---|---|---|---|---|
| **D03 / P0** | 从自然语言生成 RelationshipIntent（目标、边界、场景、偏好、禁忌、时效），缺字段只问关键问题<br/><sub>src/lib/agent/skills.ts; src/lib/relationship/intent.ts; api relationship-intents</sub> | AI + Backend | D01 | 服务端 schema 双校验；AI/规则来源分明；保存版本、可编辑、不推断敏感属性 | 模型离线不得降级为 AI 成功；注入/空JSON/竞态负例 |

## P1 候选池

| ID / 优先级 | 任务 | Owner | 依赖 | 验收（证据） | 红队负例 |
|---|---|---|---|---|---|
| **D04 / P0** | 只从获授权真人供给中检索可被推荐候选；验证库存和城市/社群覆盖率<br/><sub>src/lib/relationship/candidates/*; candidate api</sub> | Backend + Supply | D01, D02, D03 | 存在真人+有效同意+场景兼容的候选才能显示；候选不足真实空态 | 零候选绝不能自动生成真人图片/简介填屏 |

## P1 AI 排序

| ID / 优先级 | 任务 | Owner | 依赖 | 验收（证据） | 红队负例 |
|---|---|---|---|---|---|
| **D05 / P0** | 硬约束过滤→软约束解释排序→风险/未知置信度→可人工覆核<br/><sub>src/lib/relationship/ranking/*; tests/relationship/ranking*</sub> | ML + Trust | D03, D04 | top K 均有具体公开允许的解释；不推荐硬冲突；离线 baseline 与人工比较 | 敏感属性/未知信息不能被模型暗补为匹配事实 |

## P1 双向同意

| ID / 优先级 | 任务 | Owner | 依赖 | 验收（证据） | 红队负例 |
|---|---|---|---|---|---|
| **D06 / P0** | 双向 opt-in、字段级目的授权、有效期、撤销、反骚扰<br/><sub>src/lib/consent/*; src/app/api/v1/connections/*</sub> | Backend Security | D01, D04 | 接收/拒绝分别记服务端主体与权限版本；双方未同意不得放联系信息 | 并发撤销与发送、单方同意、冒用身份、跨租户访问必须 fail-closed |

## P1 真实介绍

| ID / 优先级 | 任务 | Owner | 依赖 | 验收（证据） | 红队负例 |
|---|---|---|---|---|---|
| **D07 / P0** | Introduction lifecycle：建议→双方同意→真实发送/确认；接入一种获授权真实投递通道<br/><sub>src/lib/relationship/introductions/*; messaging provider adapter</sub> | Backend + Communication | D05, D06 | 至少10次真实双向同意试点介绍；provider receipt 与 introductionId 对账、去重 | 内网 RECIEPT/SENT 不等于外部已送达；重试不重复通知 |

## P1 沟通体验

| ID / 优先级 | 任务 | Owner | 依赖 | 验收（证据） | 红队负例 |
|---|---|---|---|---|---|
| **D08 / P0** | 复用已有聊天/连接记录，把介绍上下文带入双方可见的受控对话<br/><sub>src/app/(dashboard)/dashboard/chats/*; dashboard/connections/*</sub> | Frontend + Backend | D07 | 双方只见获授权信息；消息状态可复验；举报/拉黑即停新联系 | 拒绝后的新消息/泄露对方限制级资料 => FAIL |

## P1 后续进展

| ID / 优先级 | 任务 | Owner | 依赖 | 验收（证据） | 红队负例 |
|---|---|---|---|---|---|
| **D09 / P0** | 真实交流/线下会面/取消/爽约/双向反馈与下一次决定<br/><sub>src/lib/relationship/follow-up/*; src/app/api/relationship/outcomes/*</sub> | Relation Ops | D07, D08 | 记录各方自报来源、时间、缺失；支持不同关系场景，婚恋与职业场景不能混指标 | 一方自报不得标双方验证；未响应不能当已见面 |

## P1 证据分级

| ID / 优先级 | 任务 | Owner | 依赖 | 验收（证据） | 红队负例 |
|---|---|---|---|---|---|
| **D10 / P0** | 独立 OutcomeEvidence 及 EvidenceLevel；不把机器人回执或审批记录当真实关系成功<br/><sub>prisma/schema.prisma; src/lib/relationship/evidence/*</sub> | Trust + Data | D09 | 用户/顾问/Provider 事件各有独立级别；能追溯纠错与撤销；所有指标采样有分母 | Mission CLOSED/Agent EXECUTED 被误判 Verified Introduction 时 gate 必 FAIL |

## P1 风险安全

| ID / 优先级 | 任务 | Owner | 依赖 | 验收（证据） | 红队负例 |
|---|---|---|---|---|---|
| **D11 / P0** | 成人保护、举报/拉黑、诈骗检测、人工升级、线下见面安全提醒<br/><sub>src/lib/safety/*; src/app/api/reports/*</sub> | Safety + Legal | D02, D06 | 举报有可见回执和 SLA 工作流；拉黑后新增提案、消息、介绍都拒绝 | 遭举报用户能继续向举报方引荐或私信 => BLOCKER |

## P1 数据边界

| ID / 优先级 | 任务 | Owner | 依赖 | 验收（证据） | 红队负例 |
|---|---|---|---|---|---|
| **D12 / P0** | B2C 与 SaaS 隔离、跨社群/跨用途 consent、安全审计与保留删除流程<br/><sub>src/lib/tenant/*; src/lib/bridge/*; privacy policies</sub> | Privacy + Security | D01, D06 | 各关系用途单独授权；成员离开社群后未来共享截止；导出/删除按政策处理 | 婚恋敏感数据自动暴露给雇主/活动主办方 => BLOCKER |

## P2 面向人的界面

| ID / 优先级 | 任务 | Owner | 依赖 | 验收（证据） | 红队负例 |
|---|---|---|---|---|---|
| **U01 / P0** | 建立 Relationship-first IA：发现 / 引荐 / 消息 / 进展；7 key 保兼容，但不是主页导航<br/><sub>src/app/(landing)/page.tsx; src/app/workspace/living-workspace.tsx; living-shell</sub> | Product Design | R00, D03 | 10名真人中>=8名5秒内答对“帮助真人建立可信关系”；主按钮进入关系目标 | 用户回答“这是AI任务管理软件”占多数 => FAIL |

## P2 官网首页

| ID / 优先级 | 任务 | Owner | 依赖 | 验收（证据） | 红队负例 |
|---|---|---|---|---|---|
| **U02 / P0** | 首页一屏讲真实连接价值、两方同意与清晰边界，真实情景，无技术词堆叠<br/><sub>src/app/(landing)/page.tsx; src/config/brand.ts</sub> | Frontend + Copy | R00, U01 | 桌面和手机第一屏定位、对象、CTA、可信边界完整；无假案例、无未批价格 | 随手输入“帮我写代码”被误路由成全能 Agent => FAIL |

## P2 消费者主页

| ID / 优先级 | 任务 | Owner | 依赖 | 验收（证据） | 红队负例 |
|---|---|---|---|---|---|
| **U03 / P0** | 重构登录后首页：关系意图/推荐候选/等待我同意/介绍进展/聊天<br/><sub>src/app/(dashboard)/dashboard/{page,explore,connections}*</sub> | Frontend + UX | U01, D04, D06 | 在90秒内完成初次关系意图或明确知道目前无合适供给；加载/空/错三态 | 主屏出现MCP、Mission pipeline或4个读不到统计卡 => FAIL |

## P2 介绍卡

| ID / 优先级 | 任务 | Owner | 依赖 | 验收（证据） | 红队负例 |
|---|---|---|---|---|---|
| **U04 / P0** | 候选卡展示真实/未知信息、共识与冲突、双方意愿状态及可操作授权<br/><sub>dashboard/matches/*; components/relationship/*</sub> | Frontend + Accessibility | D05, D06 | 不超权显示照片/联系方式；推荐理由具体；举报拒绝可达 | 自动给陌生人展示限制级验证数据 => BLOCKER |

## P2 SaaS 控制台

| ID / 优先级 | 任务 | Owner | 依赖 | 验收（证据） | 红队负例 |
|---|---|---|---|---|---|
| **U05 / P1** | 为顾问/社群运营者实现审核队列、成员、引荐、跟进、指标、风险<br/><sub>console existing routes verify; no new os</sub> | Frontend SaaS | D07, D09 | 顾问对每次介绍明确标识人工复核与授权；原始成员数据仅本组织可见 | 将B2C用户一键加入SaaS营销名单 => FAIL |

## P2 端到端注册

| ID / 优先级 | 任务 | Owner | 依赖 | 验收（证据） | 红队负例 |
|---|---|---|---|---|---|
| **U06 / P0** | 首页关系目标→注册/验证→同一草稿恢复→完成必要资料→候选/无库存<br/><sub>(auth)/register; (dashboard)/dashboard/onboarding; goal-draft</sub> | Frontend Auth | D03, U03 | 真实邮件/登录凭据、刷新前进后退与两端可用；私密偏好不暴露在 URL | 只通过浏览器边界 mock 却宣称注册真实 E2E => FAIL |

## P2 公共页重写

| ID / 优先级 | 任务 | Owner | 依赖 | 验收（证据） | 红队负例 |
|---|---|---|---|---|---|
| **U07 / P0** | Product/Solutions/How/Stories/About/Help 只讲真实社交闭环；旧 B2C/Hlua 分产品隔离<br/><sub>(public)/{product,solutions,how-it-works,stories,about,help}/page.tsx</sub> | Marketing + Product | U01 | 所有公开宣称有 Claim ID 与能力状态；例子以 Demo 明示；产品英语/工作区中文一致 | 通用 Agent SaaS、已验证假案例、旧品牌混入均 FAIL |

## P2 视觉质量

| ID / 优先级 | 任务 | Owner | 依赖 | 验收（证据） | 红队负例 |
|---|---|---|---|---|---|
| **U08 / P0** | 设计 Token、Figma 可编辑映射、7视口、状态截图、可访问性与文案<br/><sub>src/styles or globals.css; Figma components</sub> | UX + QA | U02, U03 | 7视口无溢出；axe严重0、键盘焦点、200% zoom、读屏、动效可减 | 黑屏/字体超界/按钮无响应任一P0即FAIL |

## P3 收费

| ID / 优先级 | 任务 | Owner | 依赖 | 验收（证据） | 红队负例 |
|---|---|---|---|---|---|
| **B01 / P0** | 拆分Relationship Assessment/Verified Introduction/会员与SaaS产品目录，所有价格实验先审批<br/><sub>src/config/products.ts; src/app/(public)/pricing/page.tsx</sub> | Commerce + Legal | R00, R03 | D1未批则SSR/API/checkout不显示或创建新交易；旧B2C和Hlua权益不混账 | 200 JSON暗泄价格或未批 checkout 建立 session => BLOCKER |

## P3 支付

| ID / 优先级 | 任务 | Owner | 依赖 | 验收（证据） | 红队负例 |
|---|---|---|---|---|---|
| **B02 / P0** | Dodo test_mode真实订单→官方Webhook→Ledger→关系权益→退款/失败重试<br/><sub>src/app/api/payments/dodo/*; ledger tests</sub> | Billing + QA | B01, D07 | 真实Provider eventId、验签、DB、权益一致；退款/续费/拒付反向一致 | 自签自验或账本零样本不得 PASS |

## P3 SaaS定价

| ID / 优先级 | 任务 | Owner | 依赖 | 验收（证据） | 红队负例 |
|---|---|---|---|---|---|
| **B03 / P1** | 访谈后提出组织 SaaS 试点单价、规模、人工成本、ROI，不和B2C收费合并<br/><sub>docs/v23/SAAS_PRICING_EXPERIMENT.md</sub> | Business + Finance | R04, U05 | 至少3机构意向及1份单位经济情景；均标假设/事实 | 将历史假设价格写进当前收费 API => FAIL |

## P3 增长

| ID / 优先级 | 任务 | Owner | 依赖 | 验收（证据） | 红队负例 |
|---|---|---|---|---|---|
| **B04 / P1** | 供应侧招募/邀请、关系 referral、真实供给密度与合规渠道<br/><sub>docs/v23/GTM_SUPPLY_PLAN.md</sub> | Growth + Trust | R04, D04 | 每个试点城市/社群报告合格供给及可被引荐密度；无无授权外呼 | 自动抓取私人社媒资料或制造假会员 => BLOCKER |

## P3 测量与实验

| ID / 优先级 | 任务 | Owner | 依赖 | 验收（证据） | 红队负例 |
|---|---|---|---|---|---|
| **B05 / P0** | 事件口径、漏斗、AI vs人工/规则基线、匿名结果与缺失率<br/><sub>src/lib/analytics/*; docs/v23/METRICS_DICT.md</sub> | Analytics + ML | D07, D09 | 分母非空、渠道/群体、来源时间、缺失率清晰；无样本展示NO_SAMPLE | 仅看注册和Agent调用次数宣称产品成功 => FAIL |

## P4 工程稳定

| ID / 优先级 | 任务 | Owner | 依赖 | 验收（证据） | 红队负例 |
|---|---|---|---|---|---|
| **Q01 / P0** | 9页真实Trace长任务归因，首屏按需加载/SSR-RSC；保业务行为<br/><sub>living-workspace; public pages; webpack/next config</sub> | Performance Engineer | U03 | 9/9 TBT<=200ms；LCP<=2.5s；CLS<=0.1，同设备节流至少3轮，Trace留档 | 任何未测页、改阈值/降节流或移除真实交互 => FAIL |

## P4 独立审计

| ID / 优先级 | 任务 | Owner | 依赖 | 验收（证据） | 红队负例 |
|---|---|---|---|---|---|
| **Q02 / P0** | 真正独立审计战略、权限、数据、真实交付与 UI<br/><sub>PR+checks+evidence</sub> | Codex Independent QA | D01, D07, U02, U03 |  Reviewer 对源SHA复跑所有 P0，报告与 WorkBuddy 断言逐项对照 | 同一子代理自己签字 => FAIL |

## P4 CI治理

| ID / 优先级 | 任务 | Owner | 依赖 | 验收（证据） | 红队负例 |
|---|---|---|---|---|---|
| **Q03 / P0** | 保护 main、required status、审查后合并、Preview由批准分支触发<br/><sub>GitHub ruleset; workflows; Netlify build settings</sub> | Release + GitHub admin | R01 | GitHub API实读protected/ruleset有效；未通过 required check不能合并；无直接main上线 | 只写YAML / gh不存在当挡箭牌 / skip netlify误发布 => FAIL |

## P4 生产迁移

| ID / 优先级 | 任务 | Owner | 依赖 | 验收（证据） | 红队负例 |
|---|---|---|---|---|---|
| **Q04 / P0** | Prisma迁移旧新版兼容、备份恢复及关系新增实体迁移<br/><sub>prisma/migrations; release plan</sub> | Data + SRE | D01 | 干净DB+历史快照迁移/验证/恢复；先迁移后代码发版且安全窗口 | db push或未备份直接 prod migrate => BLOCKER |

## P4 真用户验证

| ID / 优先级 | 任务 | Owner | 依赖 | 验收（证据） | 红队负例 |
|---|---|---|---|---|---|
| **Q05 / P0** | 10名用户认识/同意/介绍/反馈真人可用性测试，含双边用户<br/><sub>docs/v23/USER_TEST_PROTOCOL.md</sub> | UX Researcher | U03, D07 | >=8/10 5秒说对“可信真人连接”；>=8/10无需提示完成核心意图/双向授权任务；复盘失败录屏 | AI代理模拟真人不能充数；目标人数不足继续UNTESTED |

## P4 发布

| ID / 优先级 | 任务 | Owner | 依赖 | 验收（证据） | 红队负例 |
|---|---|---|---|---|---|
| **Q06 / P0** | 冻结唯一可重建RC，Preview与生产候选一致；Owner单次批准<br/><sub>RELEASE_MANIFEST.json; rollback.json; CI logs</sub> | Release Agent | Q01, Q02, Q03, Q04, Q05, B02 | 每个强制Gate PASS；生产SHA=批准RC，关系主链真E2E、48h观察与安全回滚证据 | 只有本地绿或生产旧SHA => NO_GO |

## P4 生产持续质量

| ID / 优先级 | 任务 | Owner | 依赖 | 验收（证据） | 红队负例 |
|---|---|---|---|---|---|
| **Q07 / P1** | 48小时后继续对账、安全事件、引荐完成率、供给密度与投诉<br/><sub>monitoring dashboards; evidence logs</sub> | Ops + Trust | Q06 | 告警可定位到真实介绍ID；安全撤销、Webhook和数据一致性可回放 | 0交易或0引荐不能宣称业务可用性PASS |

**当前总数：37项。V23 原则：对现有能力不重复开发；完成既有测试不等于满足关系价值门禁。**
