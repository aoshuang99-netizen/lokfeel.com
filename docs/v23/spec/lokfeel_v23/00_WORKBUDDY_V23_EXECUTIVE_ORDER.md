# 给 WorkBuddy 的直接执行总令：LOKFEEL V23 RELATIONSHIP-FIRST RESET

版本 2026-11-16 · **战略建议待 Owner 审批，不等于生产授权**

## 01. 最高指令：纠正产品类别，而不只是修 UI

上一版 V22 把“生成式关系与社交产品”错误重构成“AI 帮任意个人任务按步骤执行”。现在立即停止在这个叙事上加功能。LOKFEEL 的一级价值必须恢复为 **AI 帮助真实人建立、确认、推进高质量关系；用户以双向同意和有证据的进展判断价值。**

- 用户第一购买理由：不是模型能力、不是 Mission 创建、不是有多少 API，而是**少认识错误的人、减少无效社交、获得值得信任的真实引荐、在对话/见面/合作上取得实际进展**。
- 核心价值单位：**Verified Introduction**，而不是 `Task` / `WorkspaceSpec` / `AgentRun` / `Action`。
- 两类交付：B2C `LokFeel Relationship`，B2B `LokFeel Social SaaS`。共享身份、关系意图、授权、引荐、对话、安全、结果引擎；展示、定价、租户数据必须隔离。
- V1 聚焦历史已研究的高信任 Verified Introduction 市场验证（首个场景建议成人长期关系/优质介绍，必须按真实供需证据和 Owner 确认），B2B 社群顾问仅做一个同构试点。其他社交场景暂列 P2，不同时铺开。
- 生成式 AI 只承担关系意图抽取、候选解释、引荐文案、沟通辅助、风险提示和关系进展；生成内容不等于真人、不等于两人同意、不等于结果已实现。

**V22 STRATEGY_LOCK.md §1 中“任何数字事务个人优先”及 `ONE Goal→Verified Outcome` 不再作为批准标准，修订为 `Real People→Mutual Intent→Trusted Introduction→Interaction→Relationship Outcome`。原 V22 的失败记录、安全修复与体验问题原样保留。**

## 02. 立即停止的四种错误行为

1. 不再让 WorkBuddy “每完成一轮就另起 V24 / V25 项目定义”，保持本 V23 目标不变；只允许基于事实记录做经审阅的变更请求。
2. 不再将 2,925 Jest 或 12/12 HTML 绿色判定当关系产品的验收。技术测试是必要而非充分条件。
3. 不再将“关系网络、匹配、同意、聊天、见面、反馈”藏到二级导航，再把 Agents/Missions/工作区置于用户首屏。
4. 不再在生产和营销展示虚构真人/候选、已验证关系成功、未批金额、混杂旧 B2C/Hlua 权益与企业 SaaS 承诺。

## 03. 最先执行的五张任务卡（不需新生产授权）

**R00 / 战略映射**：读取 `01_V23_STRATEGY_AND_PRD.md` 与 2026-09-07 已批准/待验证历史辩论结论；输出原事实、当前偏航、拟修正、待 Owner 决策四栏。不得默默把“关系”换成“通用目标”。

**R01 / 代码资产盘点**：审计 `src/app/(dashboard)/dashboard/{explore,matches,connections,chats,onboarding,profile}`、`src/app/workspace/living-workspace.tsx`、旧用户/匹配/聊天/Consent/Agent/Mission/Outcome/支付组件和 Prisma 模型；逐个决定 `REUSE / MODIFY / BUILD / DEPRECATE`。不重写已有安全、登录、支付、幂等和任务状态机。

**D01–D03 / 关系领域建模**：用关系对象把已存在的 AI Intent/WorkspaceSpec/Consent/Mission 接起来，确定双向授权与结果证据的新增字段。先做迁移兼容性测试与数据隔离红队，再写 UI；禁止引入另一个“OS”。

**U01–U04 / 面向人的主流程**：在隔离预览上同时交付四张真用户核心屏：关系目标、候选与推荐理由、双方确认、介绍与跟进。首页主文案必须让陌生真人知道“LokFeel帮我认识值得认识的真实人”。

**R03 / 线上风险整改准备**：重新检查生产 `/pricing` 与 Dodo plans/checkout Gate，以及旧品牌泄露、未批准法务与旧业务混语。现网安全问题创建一张最小可逆热修复候选，涉及生产修改必须等批准；不让大版本重新上线以掩盖风险。

## 04. WorkBuddy 自动执行组织架构

- **Product Architect**：维护一份唯一 `V23_PRODUCT_TRUTH.md`，每个 UI Claim 映射真实业务对象与成功判据。
- **Relationship Domain Engineer**：模型、双向同意、Introduction、Outcome、租户与隐私。
- **AI Matching Engineer**：规则基线、候选过滤、排序可解释、模拟/真实结果隔离。
- **Consumer UX Engineer**：B2C 主页与引荐流程，七视口、有状态、有空态。
- **SaaS UX Engineer**：顾问/社群关系运营工作台，消费者资产不得自动曝光。
- **Trust/Safety Engineer**：真人、年龄、撤销、举报、拉黑、安全边界、反骚扰。
- **Billing/Release Engineer**：商品目录、Dodo test-mode、迁移、CI、Preview、回滚。
- **Independent Reviewer**：独立复跑，不接受同一 Agent 自签；每张失败必须指到原始证据。

**调用辅助技能**：`obra/superpowers` 用于 TDD/调试、`anthropics/skills` 的 frontend-design、`pbakaus/impeccable` 做视觉审稿，`vercel-labs/agent-skills` 优化 React 性能；`microsoft/playwright-cli` / `axe-core` / `lighthouse-ci` 做独立浏览器与质量检查。先审查版本 SHA、许可和执行脚本，再在隔离目录安装，不擅自跑网络安装器。

## 05. 分段执行与交付

**Wave A / 事实与战略（R00-R04）**：只读清点、差异表、风险保护、真实供需访谈任务书与证据注册；必须输出未解决决策，但不能停止其他工作。

**Wave B / 关系业务闭环（D01-D12）**：真实关系对象、可解释候选、双向同意、可追溯引荐、会话/见面/结果。先 RED→GREEN→契约→双账号浏览器真实跑通，负例跟随每次提交。

**Wave C / 消费者 + SaaS 体验（U01-U08）**：关系中心首页、真实候选与介绍、社群运营台、Public/Consumer/SaaS 路由与 i18n 隔离，原 7 deep link 保留但不置于消费者一级导航。各页有 Before/After、DOM、HAR、Trace、键盘/axe。

**Wave D / 商业/增长（B01-B05）**：供应侧密度、用户质量、客户访谈、人工+AI成本、定价实验、Dodo真实沙箱事件与权益；未批定价一律 fail-closed。

**Wave E / 质量/发布（Q01-Q07）**：9页性能收口、数据迁移演练、受保护 PR/CI、真正独立审查、10 人真人用户测试、Preview、正式 RC 签字包、批准后 G13+48h 监控。

## 06. 最低真实验收示例（必须有证据文件，不接受口头“已完成”）

**场景一：消费者**：独立真实账号 A 输入关系目标→系统明确哪些资料自报/已核验→推荐真实合法候选 B→A 接受，B 拒绝→不得向 B 发送后续推销或联系；B 接受则服务端成功创建独一 `Introduction` 并通过有授权通道投递→出现真实 delivery/audit id→双方反馈分别记录，不能直接标注恋爱成功。

**场景二：社群 SaaS**：运营者提出可信引荐→只看本组织成员被允许的资料→AI 给候选理由→两名独立当事人选择是否同意→双向同意后才发送，禁止跨社群读取敏感资料→顾问看到可对账的关系进展而不是 Agent 运行日志。

**场景三：风险/无供给**：零合格真人、资料缺失、对方拒绝、用户拉黑、撤销同意、Provider 超时、跨租户 ID、旧 cookie 与 AI 注入至少 8 种失败情况都必须诚实落业务状态，不能自动虚构匹配或完成结果。

## 07. 18项强制 Gate

权威定义在 `04_V23_RELEASE_AND_ROUTE_AUDIT.md`：S00 战略、S01 版本、S02 数据、S03 真人、S04 意图、S05 供给、S06 推荐、S07 双向 Consent、S08 引荐、S09 沟通、S10 Outcome、S11 安全、S12 UX、S13 商业、S14 指标、S15 性能、S16 CI/迁移、S17 生产。

**所有适用必需 Gate 必须为 `PASS`；`PASS_CODE_ONLY`、`PARTIAL`、`NOT_TESTED`、`NO_SAMPLE`、`BLOCKED`、`FAIL` 一律不能累计完成。**

## 08. 不可擅自执行的动作

未经 Owner 明确批准，不得推 main、生产迁移、对外发送真实引荐/消息、从第三方抓取私密用户资料、真实扣款、调价/改法务身份、修改生产 Consent、关闭安全门、生产发布或回滚。用户与第三方授权是**每次实际动作的边界**，不因“要求全自动”而消失。

## 09. 唯一交付格式

每张卡报：`TASK_ID / PRODUCT_JTBD / REAL_USER_VALUE / STATUS / SOURCE_SHA / FILE_DIFF / API / EVIDENCE_LEVEL / BEFORE_AFTER / TEST_COMMAND / EXIT_CODE / NEGATIVE_CONTROL / REAL_SUBJECT_CONSENT / BLOCKER / NEXT_ACTION`。

每日只汇报：有效真实关系介绍、供给密度、用户体验与信任风险、尚未通过的 Gate、可验证提交与证据。**禁止再把“写了多少行代码、多少 Agent、多少 API、页面数”放在产品进展第一栏。**

立即开始。只读盘点与可逆代码工作无须等待签字；首次需要 Owner 的是一份集中业务决策单，不能逐条反复提问。生产事项单独审批。
