# LOKFEEL V25.6-GA | 价值因果、产品体验与受控发布总令

> 版本：2026-11-20。性质：任务与验收设计，不是完成验收或发布授权。**继续沿用 V25.6 与 UX00–17 原有 ID**，本包 GA-A01 等仅为收口子任务号。凡实际发布须 Owner 针对唯一 SHA 批准。

## 0. 战略冻结：5 Whys 从技术特征回到用户价值

**LokFeel** 是面向个人、企业及开发者的**开源 AI 原生生成式社交平台**。优先证明“人在真实沟通中获得可理解、可授权、可衡量的 AI 帮助”，其次证明社群和组织可复用同一底座，最后发展开放协议与社会智能模型。

### 三条已承诺的价值路径
- **Personal**：看到首页理解价值 → 进入真实 Chats → 请求可控 AI 翻译/表达建议 → 服务端校验处理范围 → 真实模型生成可编辑草稿 → 用户明确确认发送 → 对方在另一个浏览器/设备实际看到 → 用户可管理隐私。
- **Business**：组织真实成员进入 Space → 看到“谁在等我/该做哪件事” → 组织 AI 在许可范围帮助跨语言沟通/引荐 → 双方确认 → 真实消息/介绍证据 → 组织可以跟进；管理员不得读取个人私人 Vault。
- **Builder**：两套独立环境通过源码、文档、许可证、自托管安装和本地模型，运行最小聊天+AI 草稿。商业云不构成基础功能唯一依赖。

### 5 Whys 根因链（观察/推断分离）
1. 看不懂：生产远端源码首页仍以 Connection OS/Mission/3D 为中心（SOURCE）；本地已改 Hero 但未发布（REPORT）。
2. 找不到价值入口：旧 `dashboard/chats` 空页跳向 Find Matches，`workspace` 另有 Now/Studio/Field；一位用户可能看到不同产品逻辑（SOURCE）。
3. 技术绿与用户无闭环：20 条浏览器消息证明收发可靠，却未证明真实 AI 翻译质量、真实首次价值和沟通结果（REPORT）。
4. 管理指标错位：console 有真实队列统计但优先呈现运营指标；用户要的“谁、什么事、我能做什么、结果如何”仍缺统一首屏（SOURCE + PRODUCT INFERENCE）。
5. 验收不一致：编译/单测/20 次消息各自 PASS，但真人理解、真实模型、组织隔离、Preview/生产全缺（REPORT）→ 必须建立价值合同、独立验收和发布责任链。

## 1. 实际证据：只陈述已支持的事实
- 用户提供 `REPORT.md` 与 `report.json`：**20/20 真实浏览器消息**、91 次注入扰动（20 发送延迟、45 次读取延迟/模拟500〔其中500为6次〕、20 次幂等重放、后者20次重复均无新增）。仅两独立 BrowserContext、本地隔离 file DB、轮询最终一致；不是两个物理设备的实时 Pusher 测试。
- `V25.6_STATUS.md`：服务端 AI Consent 43 单测与隔离库9场景（未独立重跑），7 档首页截图/axe、typecheck/build exit0；真实 Model Provider Trace、150 条人工评测、10人盲测、组织/群/Vault隔离、CI/Preview/生产仍 BLOCKED/NOT_TESTED。
- **本轮独立 GitHub 只读核查**：`origin/main` SHA = `cad717e92542395e4346e49d388f09be78ec1557`；`protected=false`；仓库 Rulesets=[]；首页/Chats/Workspace/Console 仍有互相竞争的旧入口。**本轮无法独立打开生产站，不能复述旧生产 SHA 为当前实测结果**。
- WorkBuddy 报告称本地 V25.6 改动尚未 commit/push/deploy；因此最新本地候选 SHA 必须由 WorkBuddy 重新取证，不能从对话猜测。
- **新增P0：远端注册页的 `saveRegState(phase, formData, sentInfo)` 会持久化包括 `password` 在内的表单状态至 localStorage（源码已复核）。需要比较最新本地候选、立即修复并审计旧存储。** 不能在未取证情况下声称生产已修。

### 门禁重算纠偏
`V25.6_STATUS.md` 将 build 子项统计为 PASS1；但按 G00–G16 **完整门禁**的口径没有一项已取得包括生产及独立审查在内的所有要求。不能把 build 子项当作整套 G12 PASS。所有分项按证据级别重新判定。

## 2. 当前目标：先上线什么、坚决不上什么
### Release S：支付安全独立热修复
- 由生产基线单独切分支，补未获批准的价格/Checkout 多层 fail-closed；已登录 checkout、plans JSON、页面、Provider 创建数量=0；不绑 UI 新版、不包含两张新表迁移。
- 验证旧订阅管理与真实 webhook 不被误关闭；回滚到旧版可能重开收费，应定义“安全回滚到经过止损的构建”。
- **独立 Owner 针对精确安全 SHA、变更和回滚方案授权后才能部署。** 如果准入/法务未确认，收费保持关闭。

### Release P：面向用户的可用个人 Alpha
- 首页、注册、Chats、AI Assist、Privacy Control 的一条完整纵向链路；实际 AI Provider 没有可验收则不公开“AI 已可用”，可标 `Private beta / waiting for model access`，但不得暗中用 Stub。
- 至少两位独立测试用户能真实 UI 操作，授权使用可见，消息状态真实；无需先学 Mission/Studio。
- 新 `AIProcessingConsent` 数据表，采用扩展式可回滚迁移；先在 Preview/隔离库验证、经 Owner 迁移授权再正式灰度。

### Release B：企业私有 Beta
- 至少一真实组织、两成员和一管理员；真实 Business Space、AI 限制、协同动作、审计；企业管理员不得触及个人私人记忆。
- 在未具备合法伙伴和真实数据前，不上线虚假仪表盘/客户案例。仅可用的功能展示，尚未实现的进入 roadmap，不做假按钮。

### Release O：开源 Community/Developer
- 版本清晰的 OSS 包、可重复安装、最低服务功能、权限/API、模型本地化说明；不能让开源介绍页替代发行制品。该轨道不能阻塞 Release S，也不必阻塞经过授权的有限 Personal Alpha。

**生产全面 GA**：用户价值、真实AI质量、安全合规、企业隔离、独立审查、支付策略、性能、可访问性、生产观察全部达到适用门禁才进入；不以“快速上线”为由关掉应有的安全检查。

## 3. 每页需要有唯一 Value Contract
`ROLE / WHY / ENTRY / PRIMARY_ACTION / AI_ADDED_VALUE / SOURCE_API / DATA_SCOPE / USER_CONTROL / VISIBLE_RESULT / NEGATIVE_STATE / KPI / PROVENANCE / VERDICT`。
- 页面核心必须是用户可执行动作，不是 Stage Graph/Token/使命口号/装饰雷达。
- UI 上出现每个数字都需 `sourceId + asOf + scope + recordCount + permission + drilldown`。无可信源：**不显示数字**，不是放0或者示意图。
- `real zero` 与 `not loaded`、`no permission`、`model unavailable`、`feature not released` 单独状态，不混成同一个灰色空白。
- 旧 B2C Dating、Hlua、商业审批模块保留后端/深链兼容，首页和主 App 导航只保留与本次价值合同相关的入口。

## 4. 工程归属（不允许覆盖既有资产）
- Landing: `src/app/(landing)/page.tsx`、root metadata/layout、公开导航。
- Auth: `src/app/(auth)/login/page.tsx`、`login-inner-client`、`register/page.tsx`；登录回跳必须保留受信任相对路径，防 open redirect。
- Personal: `src/app/(dashboard)/dashboard/chats/page.tsx`、`chats/[roomId]/page.tsx` + `page-content.tsx`；`dashboard/connections`, `dashboard/profile`, `dashboard/settings`, `dashboard/explore`。
- Legacy workspace: `src/app/workspace/living-workspace.tsx` + workspace shell；保留 7 key 深链，但只放在高级/兼容入口。
- Business: `src/app/console/page.tsx`, `console/connections`, `console/members`, `console/agents`, `console/outcomes`, `console/settings`，使用既有 `/api/v1/workflow/*`, `/api/v1/connections/pipeline`, `/api/v1/members` 等契约；所有权限后端优先。
- AI/Consent: `src/lib/social-ai/*`, `/api/im/ai-assist`, `/api/im/ai-consent`, `/api/im/send`, Prisma `AIProcessingConsent`；真 Provider 需要隔离授权，禁止把生产模型密钥导出给测试脚本。
- Billing/Risk: commercial gate、`/pricing`、plans JSON、auth'd checkout handler、Provider 审计；安全补丁从生产基线独立切出。

## 5. 不要仅靠单一功能指标推断最终价值（因果实验）
**North Star：Consented Meaningful Interactions（CMI）**，分母为符合安全/许可条件的真实互动机会，分子为双方真实参与且至少一方自愿确认有实际帮助/进展的互动；必须标注试点自报、偏差和可观察范围。没有用户许可时不采集消息原文。

### 三层指标
- L1 可靠性：有效消息持久/投递、权限/撤回/一致性、失败率、p95；这是必要条件。
- L2 直接体验：5秒理解、首次 AI 草稿、确认发送、首次双方对话完成率、用户主动分钟。
- L3 结果与商业：意图保持及误解修复、双向有意义沟通、留存、企业协作结果、愿意付费；不能由 L1 自动推出 L3。

### 可证伪的对照
- 同一任务场景随机分配 A组“常规聊天”、B组“聊天+受控真实 AI”；比较任务完成率、意图保持、主动时间、满意度、对方是否正确理解，记录失败/拒答。阻断未授权云调用、模型幻觉和过度断言。
- 10 名独立目标用户做探索性 5秒/90秒/180秒；目标≥8/10是候选可用性门槛，样本小不能证明市场因果。更强产品价值结论须预注册更充分的实验样本，给出区间与负面结果。
- 初次实验不录制非必要私人消息内容；模拟任务材料明确标“测试”，真人评测不以 LLM 代替。

## 6. 任务执行顺序（交并行）
**立即：** GA-20 注册敏感数据存储止损（远端源码已确认 `formData` 含 password，而 auto-save 将整体序列化至 localStorage；先复核最新候选）、GA-01 事实基线与版本收敛、GA-02 商业安全独立 Hotfix、GA-03 页面/数据审计、GA-04 首页/登录第一入口、GA-05 个人聊天工作台、GA-06 真模型与权限接通、GA-07 P0 证据管道。
**之后（依赖复用）：** GA-08 关系/隐私、GA-09 Business 首屏、GA-10 指标与可视化、GA-11 文案语言、GA-12 视觉/无障碍、GA-13 性能、GA-14 独立审查、GA-15 真实用户价值试点、GA-16 发布分波；开源 GA-17 并行。

## 7. 每卡验收格式（不接受故事性自报）
`TASK_ID, PARENT_UX_ID, ISSUE, BRANCH, BASE_SHA, RESULT_SHA, PREVIEW_SHA, PRODUCTION_SHA, EVIDENCE_LEVEL, TARGET_URL, SCREENSHOT_BEFORE, SCREENSHOT_AFTER, UI_VIDEO, API_TRACE, DB_DIFF, PROVIDER_TRACE, CONSENT_REF, EVENT_IDS, NEGATIVE_TESTS, TEST_EXIT_CODES, AXE, LHCI, REVIEWER, DEPENDENCY, RESULT, VERDICT`。

不得以作者自测做“独立验收”。应在 Preview/隔离环境先实际使用真实模型，先保护生产、保证登录/支付安全、再逐波打开人群。需要 Owner 的是具体的 `release_id + sha + migration_hash + feature_flags + rollback_sha + reviewer_verdict`，不是含糊的“按建议执行”空授权。
