# LOKFEEL V23 | STRATEGY LOCK（关系优先 · 唯一事实源）

状态：**OWNER_REVIEW_REQUIRED / 非自动批准 / 非生产授权**
日期：2026-11-16 · 依据：`docs/v23/spec/lokfeel_v23/00`、`01`（SHA256 见 `BASELINE.json`）
本文件取代 V22 `STRATEGY_LOCK.md` 的批准标准；V22 的安全修复、体验缺陷记录、发布治理证据**原样保留**，不因战略作废而删除。

## 1. 冻结的一级定位（不得重新发明）

**品类**：AI-Native Relationship & Generative Social Platform（AI 原生关系与生成式社交平台）

**中文一句话**：LokFeel 用 AI 理解你想建立的关系，在双方同意与安全边界内，帮你发现、介绍并推进值得连接的真实的人。

**英文**：Meet people worth knowing—with clearer intent, mutual consent, and real follow-through.

**使命**：让更值得建立的真实关系发生，并让人少花时间在无效社交、低信任介绍和无结果互动上。

**最小价值单位**：`Verified Introduction` —— 具有可审计的资格核对、双方意愿、授权范围和实际引荐证据的一次介绍。`Verified` 仅指「满足已声明的介绍验证标准」，**不等于**身份完全可靠、背景调查通过或关系一定成功。

**产品唯一主线（8 步，顺序不可压缩）**：
`Real Person → Relationship Intent → AI Recommendation → Mutual Consent → Verified Introduction → Communication → Follow-up → Relationship Outcome`

每一步都必须有可追溯真实对象、明确授权、服务端状态和失败处理。

## 2. 一个底座，两种产品形态（不得混卖、混页、混账）

| 产品层 | 目标客户 | 核心交付 |
|---|---|---|
| LokFeel Relationship（B2C） | 想建立高质量真实关系的成人个人 | 身份与意图确认、匹配与介绍、双方同意、沟通、见面、关系进展 |
| LokFeel Social SaaS（B2B/B2B2C） | 专业社群、红娘/顾问、会员社区、关系运营者 | 会员关系管理、AI 筛选、人工复核、双向引荐、活动组织、效果追踪 |
| 共同关系智能引擎（内部） | 两者共享 | Relationship Graph / AI Matching / Consent / Introduction / Conversation / Trust & Safety / Outcome Memory |

两个市场的供给、收费、隐私和增长数据**必须分开核算**。B2C 与 SaaS 首页、导航、会员权益、用户资料不得无边界混合。

**V23 原则**：先证明一种真实连接能被 AI 显著改善，再拓展其他关系场景。首个场景建议为成人长期关系 / 优质介绍（历史最早有依据的商业验证场景），但**待 Owner 确认**；社群 SaaS 作为同构第二试点，不同时大规模铺开。

## 3. 作废旧标准（V22）

- `ONE Goal → Verified Outcome` 与「任何有数字事务要完成的个人优先」**不再作为批准标准**。
- 通用个人 Agent OS 叙事不再是对外首页主操作。
- `Task / WorkspaceSpec / AgentRun / Mission / Action` 不再是用户第一购买理由或价值单位。
- 2,925 Jest 全绿、页面 200、Mission CLOSED、Agent EXECUTED、站内 RECEIPT/IN_APP **一律不得**冒充介绍送达、约会发生或关系成功。
- `ExecutionVerification` 行只代表「站内执行确认」，不代表业务成功；`Outcome` 表级别派生不等于 `RelationshipOutcomeEvidence`。

## 4. 反目标（防止再次偏航）

1. 不做「你想干什么我都帮你完成」的通用 Agent OS。
2. 不把 WorkspaceSpec / Agent / Mission / MCP / A2A / Token / Compiler / Studio 作为消费者购买理由或首屏主操作。
3. 不做刷不完的配对卡、机器人冒充真人、虚假活跃人数、无双方同意的自动私信。
4. 不做未经验证的爱情寿命预测、灵魂伴侣分数、性格决定论；不从照片/敏感人口特征推断人格、生育倾向或性取向。
5. 不让一个 UI 同时面向婚恋消费者、社群管理员、开发者与 Hlua 会员。
6. 不生成假真人、假候选、假照片、假匹配分、假统计卡填屏；零供给必须诚实空态。
7. 不把模型输出、站内执行回执或虚拟用户当作真实介绍成功。
8. 不以「完成 37 张卡 / 测试全绿 / 代码提交成功」宣称 LokFeel 已完成。

## 5. AI 的职责边界（只允许这五类）

关系意图抽取（可编辑、来源可辨）/ 候选硬约束过滤与可解释排序 / 安全审查辅助（标记交人工）/ 引荐与破冰文案生成（须人工或用户审批后发送）/ 关系进展辅助（不预测感情成功）。

**状态语义**：`MODEL_PROPOSED`（建议已生成）→ `HUMAN_APPROVED`（主体同意）→ `INTRO_SENT`（须有真实发送记录）→ `INTRO_ACKNOWLEDGED`（接收方确认）→ `MEETING_COMPLETED`（须有参与者反馈）→ `OUTCOME_REPORTED`（自报）→ `OUTCOME_VERIFIED`（仅限有明确验证规则与证据的字段）。

`AI 模型可用 / 工作区编译成功 / AgentRun.status=EXECUTED / RECEIPT` 均不等于以上任何业务状态。

**算法纪律**：先实现可复跑的**规则/人工基线**，再衡量 AI 增量；权重只在有标注样本后优化；没有 ground truth 只报告未验证假设；缺资料进 `NEEDS_INFORMATION`，不默认通过。

## 6. 数据、同意与安全不变量

- 数据最少化 + 三层：可公开 / 需单次或双向授权 / 限制级核验资料（只用于核验）。
- Consent 双向且按 `context + recipient + purpose + fieldKey + expiry` 逐项授权；每次发送前服务端复核；撤回后不得新增披露。
- 拒绝后不自动重试骚扰；拉黑后新增提案、消息、介绍全部拒绝；未成年人保护与成人关系场景年龄门禁优先。
- 默认不可共享；`INTRO_SENT` 必须绑定真实投递事件，`providerMessageId` 不得在外部送达前预造。
- 不合规抓取私人社交资料、不自动向外部联系人发未经批准的推荐、不泄露跨租户关系图。
- B2C 敏感资料不得因加入 B2B 社群而默认可供匹配或反向共享。

## 7. 验收口径（严格取代通用 OS 指标）

- 18 道硬门 S00–S17 定义在 `V23_ACCEPTANCE_MATRIX.md`；`PASS_CODE_ONLY / PARTIAL / NOT_TESTED / NO_SAMPLE / BLOCKED / FAIL` 一律不能累计为 PASS。
- 证据状态机：`TODO → CODE_COMPLETE → TESTED_LOCAL → TESTED_PREVIEW → INDEPENDENTLY_VERIFIED → PRODUCTION_VERIFIED`，**禁止跨级**。
- 业务数据必须区分 `NO_SAMPLE` / 自报结果 / 双方确认 / 有外部证据。MVP 试点目标「至少 10 次真实双方同意的介绍样本」是**执行目标，不是现有成果**。
- 每轮报告必须回答：用户真实获得了什么关系价值、哪些关系状态得到真实证据、还有哪些阻断项。

## 8. 不可越权清单（本轮一律未执行）

未经 Owner 明确批准，不得：推 main、生产迁移、生产发布/回滚、修改生产数据库、调价或批准定价、改法务主体、真实扣款、对外发送真人介绍或陌生消息、关闭安全门、修改生产 Consent、从第三方抓取私密资料、把他人授权当作一次性永久授权。

**可直接执行**（无需签字）：只读盘点、战略差异清点、可逆代码工作、本地/沙箱测试、证据注册、RC 报告、决策单编制。作战包 `00 §09` 明确「只读盘点与可逆代码工作无须等待签字」。

## 9. 当前结论

`NO_GO`。V23 是**建议版战略**，首个商业场景待 Owner 确认；本轮已完成事实取证、资产盘点、关系领域不变量与消费者主流程的可逆整改，但 0 次真实双方同意介绍、0 次真实投递、0 名真人访谈、0 次独立复核、0 次生产发布。见 `V23_STATUS.md`（唯一状态页）与 `OWNER_DECISIONS.md`（集中业务决策单）。
