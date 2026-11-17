# LOKFEEL V24 — AI 原生生成式社交网络战略与第一性原理改造总计划

**日期**：2026-11-17  | **性质**：战略、科研、产品与工程执行草案，非上线认证  | **状态**：STRATEGY_PROPOSED / ENGINEERING_NO_GO

> **愿景**：让 AI 更懂人，让人与人更好地连接。  
> **使命**：以用户自主权、隐私和可信关系为前提，让每个人拥有能理解其意图、关系语境和沟通需求的个人社交智能；使真实人际连接、跨文化表达与群体协调比传统消息工具更容易、更安全。  
> **系统边界**：LokFeel 是 AI-native Social Network + Social Intelligence Platform；不是普通 Dating App、企业任务 SaaS、群聊机器人或 HAI/ONE 的又一套独立 OS。

## 0. 战略红线与版本继承

1. **横向架构继承，而非项目混同**：HAI/ONE 的 L0 WHY 是“让 AI 承担数字复杂性，让人回归真实生命”；其 ONE Goal → Verified Outcome、ODC 最小授权、QE 模型路由、VAL 结果独立核验、OIG 证据图谱与 VEC 只读实验均可作为 LokFeel 共享能力。但 HAI/ONE 的通用数字劳动任务不能取代 LokFeel“人—关系—沟通—协同”的一级价值。Army OS 仅作研发/验证调度，不作为社交产品前台。
2. **人与人先于 AI**：AI 是用户专属的关系智能层，任何真人聊天必须可辨明真人、AI 建议与 AI 代理；禁止将机器人伪装真人，禁止未经双方同意共同剖析私聊，禁止 AI 推断真实存在却未获授权的私人事实。
3. **关系类型包容而不失焦**：亲友、跨文化交流、专业协作、社群、可选择的亲密关系都属于 Relationship Domains；“婚恋高端引荐”可作为垂类插件，不再等于整个平台，也不允许凭空扩张至所有类别。
4. **隐私即产品物理架构**：默认本地处理私密消息和个人记忆；敏感类别“不上传、不训练、不跨关系共享”是默认决策。服务器只持有所需的账号/路由/滥用防控信息；远端 AI 使用需显式逐类选择。未实现 E2EE / 远程证明前，不得宣传已经实现。
5. **不伪装互操作性**：WhatsApp、微信、LINE 的私聊不能任意抓取或桥接；只能用公开标准、合法平台接口、双方主动导入或用户授权的整合；在他方 E2EE 边界无法延伸时必须明确安全退化或停止。
6. **当前事实**：V23 `07486db` 由 WorkBuddy 报告是本地提交、未推送；远端 `cad717e`、生产 `b50e53e` 是其当时归档基线。下一轮务必重新核实生产、远端与本地，不允许旧报告自动升级为最新事实。支付在报告中仍有生产未批价格和 `checkoutReady=true` 风险，需优先只读取证并交付最小止损审批包，未授权不得改生产。

## 1. 第一性原理：重新定义消息和社交网络的价值

传统聊天应用优化 `传输消息/通知/联系人/群`，而用户真正需要的是：
- **Expression**：低成本、符合自身意图和文化语境地表达；
- **Understanding**：在信息不完整时避免错误解释他人，允许澄清；
- **Consent & Trust**：知道是谁、能否相信、哪些信息可见；
- **Coordination**：不同的人把共同意愿转成可实现的行动；
- **Relationship Continuity**：跨时间记住共识、承诺、边界和关系进展；
- **Human Agency**：AI 减少误解和重复操作，绝不取代当事人决定。

建议新价值单位：`CMI — Consented Meaningful Interaction`（自愿且有意义的互动），其结构为 `human participants + context + mutual permission + real exchange + reported/verified outcome`。注意只有得到相关参与者独立确认或可靠后置证据，才可称 Verified；AI 生成文字不等于 Verified。

**可证伪的产品假设 H1**：与常规聊天相比，使用私有 AI 社交辅助能在不降低信任的情况下减少 25%（探索性目标）完成跨人任务所需的主动沟通时间；**H2**：用户自主认可的误解修复率提高 ≥15%（探索目标）；**H3**：用户愿意持续使用 AI 社交辅助，而不是仅因新奇感使用。均需同任务基线、随机或配对实验、预注册主指标，才可对外宣称。

**反共识原则**：消息数量、无限刷帖、AI 陪聊时长都不是北极星。北极星候选 `Mutually Affirmed Relationship Value / Active User`，由双方主动标记的有效沟通、完成的协作和自愿复访构成；对只有一方的私密反馈不得公开给对方或广告系统。保留用户自主关闭 AI 的能力。

## 2. 2026 年研究：证据 → 可复用机制 → 不可推导

| 证据/实践 | 核心事实 | LokFeel 应借鉴 | 不能推出的结论 |
|---|---|---|---|
| EMNLP 2026 SMMU | 264 长视频、1519 问答；最佳模型社会理解 0.43 vs 人类 0.85，社会行动 0.33 vs 0.78 | 建立长程意图、视角、关系推理与谦逊拒答测试 | 没有模型能正确读取私人心理；不可把分数当用户收益 |
| EMNLP 2026 SocialArena | 角色、心理状态、行为推理的人工比较评测 | 多轮社会语境、跨文化反馈、人审 pairwise 评测 | 角色扮演高分不等于能安全替人沟通 |
| 2026 NICE 社会智能诊断 | 关注多轮沟通、非语言、同步等弱项 | 把协调/冲突消解拆成子指标 | 不把非语言识别当“读心” |
| Meta WhatsApp Private Processing (2025) | 可选、TEE、远程证明、最少数据与隐私日志的架构 | 远端 AI 的可验证隐私路径和隐私回执 | 未建设 TEE 就宣称“连平台都看不到” |
| Apple Foundation Models / PCC (2025–26) | 端侧推断与保密云计算的分层部署 | 端侧轻推理 + 显式升级 | iOS 设备能力/授权不能迁移成全平台承诺 |
| Opal: Private Memory for Personal AI (2026 preprint) | 研究通过 enclave + oblivious access 减轻检索模式泄漏，报告基于模拟数据的性能结果 | 关注访问模式泄露、知识图谱+本地存储 | 实验结果≠LokFeel 已实现 ORAM，生产先用小数据局部加密 |
| Beyond Similarity / MemGate (2026 preprint) | 检索相关不等于获授权或语境正确，研究提出准入门 | 记忆检索必须先经人/关系/时效/同意过滤 | 相似度分数不能当共享许可 |
| ICML 2026 ZipMoE | 研究提出缓存、压缩和调度减轻端侧 MoE 内存瓶颈，报告部分测试高收益 | 中期探索设备适配与专家缓存 | 单篇最佳收益不等于所有手机都适用 |
| Edge MoE empirical study (2026 preprint) | 一种 MoE 在 Jetson Orin Nano 上更慢、更耗能 | 与小 dense、检索及规则强对照 | 不能预设 MoE 比小模型便宜 |
| LINE CONVERGE 2026 | 宣布将 Agent 整合进聊天、行程和服务；部分仍在规划 | 要从“聊天中一个 AI”升级为关系记忆、双向授权、互联标准 | 不能将 LINE 规划功能当已上线现状 |
| EU DMA WhatsApp interop (2025–26) | 欧洲特定范围对符合条件第三方消息服务开放，逐步试运行 | 关注标准和合规互通可行窗口 | 不能据此声明全球微信/LINE/WhatsApp 私聊可访问 |
| IETF MLS RFC 9420/9750 | 异步群密钥、前向保密和事后恢复机密性 | 引入审计过的 E2EE 协议实现 | RFC 并不自动解决联系人发现、备份、元数据问题 |
| Nature Human Behaviour 2026 AI companion studies | 高强度陪伴与福祉关联不一致，存在依赖风险 | 优化真实人际连接而非 AI 替身 | 观察研究不能直接证明因果 |
| CHI 2026 AI 视频沟通 | AI 中介视效对信任和判断可能造成影响 | 视频、语音修改须显式披露 | 不以生成脸/拟声装作对方真人 |

**来源细节、链接、日期与可信度**见文末。对预印本统一标 `PREPRINT`；对企业发布统一标 `VENDOR_REPORTED`，不与独立同行评审等价。

## 3. 对标与反共识竞争策略

### 3.1 为什么不能复制 WhatsApp / WeChat / LINE

现有平台掌握联系人、日常使用习惯、支付/本地服务生态、社交网络效应与消息分发的成本优势。用户不会仅因“AI 翻译/摘要/生成消息”搬迁整个关系网。2026 年 LINE 已宣布这些方向，WhatsApp 正推进隐私 AI 与部分互通。结论：**先作为用户与小圈子的“关系智能层”有价值，再以跨人共享关系空间形成自己的网络；不要第一天就试图迁移全量联系人。**

### 3.2 非对称切入路径

- **单人即用**：对用户本人获授权的聊天草稿/联系记录提供整理、沟通建议、文化/语言理解；数据默认本地，不使用未经授权的第三方私人消息。即使对方尚未加入 LokFeel，也有价值。
- **双人共用**：双方加入后，各自决定共享“共同记忆 Capsule”中的具体信息，自动完成共同日程、约定和活动协调，能审计每一次授权。
- **小群增长**：邀请进入 Shared Space，在群成员一致的透明规则下做 AI 多语言协作、共识总结、活动安排和关系维护；用户控制加入/退出/静音。
- **B2B SaaS**：给受邀社区、跨文化协会、专业组织提供透明成员关系/同意/引荐治理；组织管理员只能见组织拥有或获成员授权的数据，绝不能见个人私密关系全图。
- **生态层**：官方可用 API、开放适配器、Matrix 可选联邦、数据可导出、插件/Skill 商店（先隔离执行）。不以“买流量 + 买 Token”的二次中介做商业终点。

### 3.3 避免网络效应冷启动死局

首个市场选择 **存在真实重复交互的受邀小团体/跨语种好友网络** 进行 A/B；不同时推广约会、企业 CRM、活动软件等所有分类。先验证“AI 使一组真实的人更好地联系”这一可重复动作。目标：第一批 20–40 个真实用户、5–10 个小群；下一批 100–200 个自愿用户、20–30 个活跃群。上述均是招募目标，非已完成数据。

## 4. 产品定义：从“应用屏幕”改为四个核心社交原语

### 4.1 Private Social Copilot / 私有社交智能

- 用户对私人助手说：“帮我用更温和的语气回复父母”“我们昨晚到底约定了什么”“这句话可能有哪些解释？”
- 输出建议列明 `事实 / 推测 / 不确定`，用户一键纠正；所有发给他人的内容必须由本人最后确认。
- 对方没有同意前，不得把对方画像、私密心理状态、健康/性取向等敏感推断跨人共享、训练或出售。
- 默认不以 AI 的“亲密度分数”评价真人。

### 4.2 Relationship Memory Vault / 私有关系记忆库

- 个人侧保留自己授权的互动事实、对话中用户确认的边界、纪念日和待兑现的承诺；高敏事实仅加密本地保存。
- `Observed fact / User confirmed / AI hypothesis / Disputed / Expired` 五类证据等级；AI 猜测不能变成持久事实。
- 针对关系检索按 `relationshipId`、来源参与者、用途、同意版本、保留期限/撤回过滤；不得仅按 embedding 相似度召回。
- 用户可逐条查看、修正、遗忘、导出；删除与已训练权重退出之间的技术局限必须实话说明。

### 4.3 Consent Handshake / 双向意图与授权

- 例如 A 想邀请 B 共同组织一次聚会：A 对自己 AI 发出意愿；系统发送**明确说明 AI 辅助**的邀请草稿，B 可接受、调整范围或拒绝。
- 只在双方许可时创建 `SharedIntent` 与 `SharedMemory`；各自私人记忆默认不进入共同空间。
- 任何对外消息、联系人请求、活动邀请、第三方日历写入或付费均需本人批准；群空间的 AI 权限受群规则和个体许可共同约束。

### 4.4 Living Social Spaces / AI 原生关系空间

- 1:1 聊天：真实文本/图片/语音通话起步，AI 助手作为“我的私有侧栏”，不能凭空显示在对方一侧。
- 小群：可选择的群 AI“共同协调员”，AI 存在、可访问范围、日志和保留策略对全体成员可见；多数授权是否足够取决于数据共享对象，个人私密数据仍需本人单独授权。
- 共享纪要、跨语种译文、行动约定、活动时间、后续提醒与共同成果；AI 推荐不自动变成双方共识。
- 关系结果：共同计划完成、确认沟通得到澄清、活动真的举行等，保存有限范围的可验证事件，不记录虚构情绪成绩。

### 4.5 建议首页与主界面

**首页**：`Understand each other better. Connect on your terms.`；副文案清晰交代私人 AI、双方决定、隐私权限和真实聊天能力。一个主 CTA：“与朋友开始一次更好的对话”。其次展示真实产品演示与边界，禁止 `MCP/Agent/Token/WorkspaceSpec/Mission pipeline` 占据首屏。

**移动主界面 4 tabs**：`Chats / People / Spaces / You`；聊天详情私有的 `Ask my AI`，通话/视频真实接线后才露出；`My AI` 绝不伪装聊天联系人。

**组织控制台**：Members / Introductions / Spaces / Moderation / Outcomes / Billing / Integrations；仅限有授权的组织管理员。保留现有 `/workspace?view=*` 作为兼容/过渡和专业模式，禁止直接删旧路径。

## 5. 模型架构：Social Intelligence MoE（两种 MoE 严格区分）

**本期可落地的是“策略路由下的专家组合”（expert orchestration）**，不等于已经训练稀疏神经网络 MoE。V24 名称：`Social Intelligence Router / SIR`，科研候选：`Human-Relational MoE / HR-MoE`。

### 5.1 推理流水线

```text
Human input (text / opt-in voice & image)
  -> local permissions & data provenance
  -> Intent / Context / Relationship state extraction
  -> Policy & Consent Gate (ODC, deterministic; model cannot override)
  -> QE/SIR cost-risk routing
      R0 rule/slot parser
      R1 local compact dense model + local memory
      R2 local retrieval + structured relationship graph
      R3 explicit cloud model on minimum disclosed context
      R4 specialized expert / MoE research candidate (only if proven)
  -> Factuality / ambiguity / consent verifier
  -> Suggestion / Need-You / Authorized Action
  -> Real messaging or provider receipt
  -> Auditable Outcome & user correction
  -> VEC opt-in, redacted read-only research path (no production actions)
```

### 5.2 专家分工（逻辑专家，非独立训练模型的承诺）

1. `Intent Expert`：发言目的、对象、时间与要求的结构化槽位；
2. `Context & Relationship Expert`：历史共识、各方视角、时效、语境冲突；
3. `Communication Expert`：跨文化、语气、翻译、澄清问题，避免替人臆测；
4. `Trust & Safety Expert`：骚扰、欺诈、冒充、边界和未成年人风险辅助，严重事件送人审；
5. `Coordination Expert`：日程、多人计划、交接、授权外部动作；
6. `Evidence Expert`：事实与推断隔离，回执、反例、独立结果验证。

**裁决顺序**：Policy > Consent > Safety > Provenance > Quality > Latency/Cost。MoE/router 不能绕过确定性许可。

### 5.3 MoE 实证计划，而不是战略口号

- `B0`：规则 + 模板；
- `B1`：合适的小 dense model + 检索；
- `B2`：B1 + 可信记忆与 QE/SIR 路由；
- `B3`：商业云模型一次性处理的强对照；
- `B4`：同质量与相同硬件下的开源 sparse MoE（有可复核设备基准再做）；
- `B5`：用户授权贡献后的 LoRA/蒸馏专家候选。

量化：意图准确度、上下文泄露、幻觉/过度心理推断、同意违例、社会能力人工评分、跨语言公平性、p50/p95、能耗、内存、云 Token、每次有效互动全链路成本。若 B4 不能在目标设备上同时满足质量和能效，不使用 sparse MoE；切回 B2/B3。不要将训练基础大模型作为 0→1 前置条件。

### 5.4 数据与训练边界

- `D0`：公开许可的多语交际、礼貌学与对话协议样本；
- `D1`：真实用户逐项 opt-in 的最小必要沟通改写样本（未获训练许可不能训练）；
- `D2`：用户许可的个人历史，仅做其设备的临时上下文；默认不参与全局训练；
- `D3`：关系双方共同批准的共享案例，仅用于约定的协作和结果验证；
- `D4`：专门标注的对抗/欺诈/越权/误读案例，用于回归；
- `D5`：封存的人类评测集，任何训练、提示调优、VEC 观察都不得见答案。

任何真实私聊、照片、声音、面部表现均不能因为“用户注册了平台”就默认授权训练。模型训练需数据用途、主体授权、保留期限、可撤回范围和审计记录；注意历史训练权重通常不能保证即时完全遗忘。

## 6. 网络与隐私：四域隔离，零静默跨域

| 域 | 数据示例 | 存储与使用 | 共享许可 |
|---|---|---|---|
| `P0 PERSONAL` | 私人意图/情绪自述、个体关系记忆 | 本人设备加密优先；可选端到端加密备份 | 用户本人；远程 AI 需明确请求 |
| `P1 PAIR` | 双方明确确认的共同计划 | 双方授权设备/按协议 E2EE 房间 | 按双方共享契约与逐条字段许可 |
| `P2 GROUP` | 小群同意共享的会议安排 | 群专属密钥空间，成员变化需轮换 | 群级政策 + 个体敏感字段许可 |
| `P3 PUBLIC` | 自愿公开的个人简介、社区资料 | 可被发现，但不自动入训练 | 公共披露版本+随时撤下 |

`ODC` 应视为固定安全守卫而不是 AI 分类器。API 响应要提供 `data_class, scope, consentRef, retention, provenance, computationLocation, aiUsed, sharedWith, expiresAt`；用户可随时查询“谁在什么时候以什么用途处理了什么信息”。

端到端通信评估：使用成熟并经审计的协议库（MLS RFC 9420/9750、成熟 Signal 系实现或 Matrix 生态的相应协议），不可自创密码学；实现密钥验证、群成员变更、跨设备配对、密钥恢复、备份和撤销。MLS 只是密钥协商，不等于整个应用自动 E2EE 安全。优先安全基线 + 受邀试点，不允许在未经外审的自研消息协议上公开宣称“比 WhatsApp 更安全”。

**外部社交平台兼容性分层**：
- `DIRECT`：LokFeel 自有 E2EE 会话（真实构建后开放）；
- `STANDARD`：Matrix / 被实际批准的协议型适配；
- `OFFICIAL`：各平台合法 API 允许的群/企业/公众功能，逐接口检查限制；
- `USER_IMPORT`：用户主动、合法、最小数据导入，本地分析且保留来源说明；
- `UNSUPPORTED`：任何未经开放的微信/WhatsApp/LINE 私聊、受保护通讯数据抓取和非官方自动化。

在欧洲 DMA 的局部互通政策下可单独申请合规对接，但不能宣称全球任意互通。

## 7. 系统 API / Schema（拟议，先做代码 diff 后接入）

```ts
type EvidenceStatus = 'SELF_REPORTED' | 'COUNTERPARTY_CONFIRMED' | 'PROVIDER_PROVEN' | 'DISPUTED' | 'UNTESTED';
type SocialIntent = {
  id: string; actorId: string; purpose: 'CONNECT'|'REPAIR'|'COORDINATE'|'EXPRESS'|'LEARN';
  recipientScope: 'SELF'|'PAIR'|'GROUP';
  textLocalRef?: string; // private content reference, never the full text in URL
  slots: Record<string, unknown>; confidence?: number; userCorrected: boolean;
  consentRef?: string; modelProvenance: 'LOCAL'|'REMOTE_APPROVED'|'RULES';
  evidenceRefs: string[]; createdAt: string;
};
type ConsentReceipt = {
  id: string; subjectId: string; audienceIds: string[];
  dataClasses: string[]; purposes: string[];
  issuedAt: string; expiresAt?: string; revokedAt?: string;
  version: number; actorProofRef: string;
};
type RelationshipEvent = {
  id: string; relationshipId: string; participants: string[];
  eventType: 'INTRODUCTION'|'MESSAGE'|'ACCEPTANCE'|'PLAN'|'MEETING'|'FEEDBACK';
  consentRefs: string[]; provenance: 'USER'|'PROVIDER'|'AI_SUGGESTION';
  status: EvidenceStatus; eventTime: string; encryptedPayloadRef?: string;
};
```

**不能绕过服务端验证**：`POST /api/social/intents`、`POST /api/social/consent`、`POST /api/social/messages`、`POST /api/social/spaces`、`POST /api/social/agent-suggestions`、`GET /api/social/evidence` 均为提议名称；先盘点现有 `/api/v1/*`、`/api/chats`、`/api/connections`、`/api/matches`、NextAuth、Prisma 和现有 consent/mission 模型，增量 adapter，不能丢历史消息或覆盖 B2C 数据。

## 8. 90 / 180 天 SMART 路线（从实际启动日计算）

| 时间 | 战略目标 | 必须交付 | 进入下一阶段的证据 |
|---|---|---|---|
| D0–D14 | 资产审计、战略与风险复位 | 唯一产品定义、现有关系 API 清单、27+ 路由映射、隐私威胁模型、最新生产安全快照、可运行 Mock-free 交互样机 | 不再把个人 OS/婚恋 SaaS 当一级叙事；关键高风险价格和权限问题有实际处置；正式生产动作仍需授权 |
| D15–D45 | 真人消息与个人 AI 侧栏 | 小群/1:1 消息原型、身份与权限、私有摘要/沟通建议、首版本地记忆、明确来源标注；密码协议只用经验证库 | 双设备往返、权限撤销、同意、断线/离线、AI 隐私边界实验通过；未完成正式安全审查不公开推广安全承诺 |
| D46–D90 | 可信共享关系 Capsule | 双向 consent、共同计划、群组 AI 可见许可、跨语言建议、小群连续性、误读修正；受邀真人试点 | 至少 20–40 真人、5–10 小群试点；预注册可用性/信任指标；0 未授权外发；独立 QA 且匿名投诉有处置机制 |
| D91–D180 | 小生态网络 + 社群 SaaS | Matrix/官方支持适配之一、2–3 个组织试点、可导出关系空间、AI 专家 QE 对照、完整统计与监控 | 对照组上的人类有效沟通改善有可信趋势；B2B 组织可独立使用而无法窥视个人 Vault；成本与留存有真实数 |
| D180–D365 | 研究型 MoE 与能力演进 | 端侧模型签名与灰度、隐私记忆检索、专家消融、VEC 只读经验实验、跨设备同步 | 稀疏 MoE 相比强 baseline 有真实增益才部署；安全、功耗和误读不退化；否则继续小 dense + QE |

资源建议：在未确认团队预算前不假定大规模自研基础模型团队。0–90 天用 **产品/前端 1、后端/加密 1、AI/评测 1、独立安全 QA 外部按需** 的最低角色组合设计；如仅 1–2 人则必须缩短功能范围，优先“私有侧栏 + 双人同意 + 小群可信协作”，不承诺独立完成成熟 E2EE 客户端全家桶。

## 9. V24 核心指标与停止/推进条件（均为候选目标）

### 成果（不得只看用户活跃时长）
- `MutuallyConfirmedUsefulInteractions / eligible participants`：双方认可的有效互动比例；一方拒绝反馈时不得强行追踪；
- `HumanActiveMinutesSaved / task`：匹配的传统聊天基线，计入纠正 AI 的时间；
- `MiscommunicationRepairRate`：在用户主动报告误解的样本中，经确认改善的比例；
- `ConnectionContinuity`：自愿持续互动的关系比例，不把聊天刷屏当成功；
- `Trust & Autonomy`：AI 关闭率、撤回成功率、投诉、骚扰事件、认知清晰度。

### P0 硬门（任何一条失败即 NO-GO）
- `unauthorized_external_messages = 0`；`unconsented_cross-person_ai_processing = 0`；`AI_impersonation_incidents = 0`；`privacy_sensitive_training_without_opt_in = 0`。
- 授权版本检查 100%；撤销后新调用 0；跨用户、跨组织、跨房间越权读取 0；正式账号系统须实际安全审计。
- 用户可选择“无 AI”完整收发消息；按实现范围客观标注 E2EE、云推理与第三方共享状态。
- 未发生的外部动作、关系结果不能显示 Verified；示例头像/场景必须明示 Demo，不能造真人数据。

### P1 定量验收（试点预注册后执行）
- 新用户 10 人至少 8 人 5 秒内回答“这是什么/AI 看得到什么”；
- 10 人至少 8 人能在 2 分钟内完成一次受保护的私有 AI 辅助回复；
- 10 人至少 8 人理解并能撤回某次消息或共享记忆授权；
- 30 次真实有效互动前不可对外宣称提高连接率；不足样本标 `INCONCLUSIVE`；
- 意图槽位识别准确率探索目标 ≥90%（分语言/关系类型），未解释真实置信不以 90% 训练集成绩上线；
- 关键 1:1 消息送达 p95、AI 首 token 延迟、端侧能耗/内存建立真机基线；旧 9 页面 G15 TBT≤200ms / LCP≤2.5s / CLS≤0.1 等既有强制门禁不得因为 V24 改名而删除。

### 失败即停止扩张的可证伪条件
- 社交助手显著增加误会、强迫打扰或依赖；
- Privacy Gate 被绕过一次；
- 真实用户不愿邀请第二个人，单人价值未建立；
- AI 模型优于普通规则的证据不存在但成本明显更高；
- 官方平台对接权限不存在，实际跨生态承诺无法实现。

## 10. 工程整改工单总表（执行前重新定位文件和接口）

| ID | 优先级 | 子系统 | 核心改造 | 禁止伪通过的证据 |
|---|---|---|---|---|
| A00 | P0 | R0/CICD | 生产/remote/local SHA、DB、冻结门、Pricing 安全复核 | 实时 curl/浏览器、git remote、deploy ID、回滚点；失败即阻断生产写 |
| A01 | P0 | 源码资产 | inventory `/api/chats`, matches, introductions, consent, agents, relationship graph | 每项标 REUSE/ADAPT/DEPRECATE/MISSING + 文件行/真实响应 |
| A02 | P0 | 战略锁 | 统一英文/中文产品故事、场景边界、命名/导航，隔离旧 B2C/Hlua/Connection OS | 20 名潜在客户定性测试准备、10 名真实试点前置认知测；首页不得有 MCP/Studio 术语 |
| A03 | P0 | 信息架构 | 首页、Chats、People、Spaces、You、组织 Console 页面完整可操作 | 六视口视觉 + DOM、所有链接/焦点/返回/刷新，0 幽灵按钮 |
| A04 | P0 | 用户身份 | 真实用户、账户恢复、设备配对、AI 身份标注，机器人与真人隔离 | 人工造机器人不能领取 verified-person；跨账号伪装负例 100%拒绝 |
| A05 | P0 | 基础消息 | 1:1、群、离线队列、撤回、附件权限，选择成熟 E2EE 实现 | 双设备消息真实往返，密钥轮换/备份、离线重试、重复零副作用 |
| A06 | P0 | Local Vault | 加密个人记忆、证据级别、老化/删除、按作用域检索 | 断网可检索本人、撤销后不可共享、加密密钥不入日志 |
| A07 | P0 | SIR/QE | 多专家路由、来源/置信证据、模棱两可时澄清 | 强基线对照，不能只测模型自己打分；B4 MoE 非强制 |
| A08 | P0 | 情境 AI | 私人沟通改写、翻译、观点澄清、误读风险提示 | 真实用户认可，未经同意不能自动发送；敏感推断显式不确定 |
| A09 | P0 | Consent | 双向许可、群级与字段级范围、过期/撤回；权限检查服务端 | 拒绝/撤回后新读写 0，跨租户/关系越权 0 |
| A10 | P0 | Shared Spaces | 双人共同 Capsule、群空间、明确 AI 参与声明 | 真实 2+ 客户端，最小共享、加入退出换密钥、无后门侧栏 |
| A11 | P0 | 社交动作 | 经批准的邀请、共同计划、消息发送和回执 | 真实 Provider/服务端回执，不把站内计划写成外部成功 |
| A12 | P0 | Outcome | 社交成果证据、双方自愿确认、无结果诚实显示 | SELF_REPORTED≠MUTUAL_CONFIRMED≠PROVIDER_PROVEN |
| A13 | P0 | 安全与治理 | 滥用/骚扰/假冒举报、未成年保护、申诉、隐私说明 | 提交→处理→回执闭环，敏感材料不暴露给未经授权工作人员 |
| A14 | P0 | i18n/a11y | 中文/英文一致、真实翻译、键盘、200% zoom | 无混语、无横向溢出、axe 0 critical/serious + 手工读屏 |
| A15 | P0 | 性能 | 旧 9 页面 G15 trace 归因、首屏降 JS、手机电量基准 | 原设备配置实跑，9/9 TBT达标，零功能回归 |
| A16 | P0 | 独立审计 | Codex/外部 reviewer 安全与功能独立验收 | 与 WorkBuddy 开发主体不同，重跑原始日志，阻断缺陷零 |
| A17 | P0 | 发布 | feature PR、保护 main、Netlify 受控、迁移及备份验证 | 未经审批不能发布；生产 SHA=批准 SHA；G13 生产复验+48h监控 |
| B18 | P1 | 组织 SaaS | 组织成员、授权引荐、活动、共同 Space、数据域隔离 | 管理员无法见个人 Vault；组织结算/订阅无跨线混账 |
| B19 | P1 | 开放生态 | Matrix/官方 API 插件之一，经批准联通 | 真实被支持的双向通信；安全退化/退出机制；禁非官方私聊爬取 |
| R20 | R&D | 社会评测 | SMMU/SocialArena/NICE 派生私有封存集、多语言和坏例 | 人审、对照、sealed holdout、标注一致性报告 |
| R21 | R&D | MoE 较量 | 小 dense + QE +记忆 vs sparse MoE 相同设备同质量 | p95/内存/能耗/成本；MoE劣于基线则不启用 |
| R22 | R&D | VEC | 只读 opt-in 匿名化错误案例 → 反例候选 → 影子评测 | 私聊原文默认 0 出站；研究成功不改变生产权限 |

## 11. WorkBuddy + Codex 交付与高压验收制度

**先拆原事实，再改代码；禁止“又新增一个 dashboard”。** 每张工单交付统一机器格式：

```json
{
  "taskId":"A09", "baseSha":null,"codeSha":null,"environment":null,
  "changedFiles":[],"contracts":[],"testCommands":[],"exitCodes":[],
  "negativeTests":[],"browserScreenshots":[],"serverReceipts":[],
  "privacyEvidence":[],"independentReviewer":null,
  "status":"NOT_TESTED","blockers":[],"nextExecutableAction":null
}
```

- WorkBuddy 只负责变更与基础 TDD；Codex/独立主体核查每一条业务真相、权限、数据库和安全负例。没有独立审查即 `TESTED_LOCAL`。
- **发布规范**：所有工作在 feature branch；远端 PR/Preview 需明确授权的可用连接，不能因 `gh` 缺失改为直接 push main；生产部署、迁移、合法付费和密钥变更单独批准。
- UI 必须与品牌/产品对齐。设计参考可以用 Impeccable / Vercel Skills / Playwright，但每个技能须先审查来源、固定 commit SHA 和执行权限；审美分数不能代替真实业务价值。
- 已失败的生产定价门禁属于 **现存待处置高风险**；优先交付可检查的最小止损包，绝不让未批准金额因 V24 重构被重新开放。
- 阻断事项不妨碍其余可逆本地开发。不得将用户未提供的真实性证据、合作伙伴授权、App Store 审核或第三方私聊数据虚构为已具备。

## 12. 最小可证伪产品演示：三条完整纵向场景

1. **跨文化好友沟通**：A 用中文输入 → AI 在 A 设备形成三种语气和英文翻译 → A 选定/发送 → B 在其客户端看到真实内容（不是私自注入 Bot）→ 双方可选择把会议或日期加入共同 Capsule → B 拒绝时不记录伪共同同意。
2. **朋友与家人群计划**：群成员同意启用 AI“群协调员” → 私有聊天内容只在被允许的群范围处理 → 提出两个时间选项 → 群成员明确投票 → 日历写入需各方授权 → 真实活动和反馈由成员自主确认。
3. **专业社群介绍**：成员 A、B 设置可披露字段 → AI 根据用户明确需求提出引荐候选 → 双方确认 → 发出真实介绍 → 组织管理员只见同意共享的状态 → 未到第二步不可写 Verified Relationship。

三条均要做 401/403、过期同意、重复发送、断网重试、取消、AI 幻觉、跨语种歧义、假用户、元数据泄露的负例。任何缺权限动作必须以 `NEED_YOU / BLOCKED` 结束，而非静默执行。

## 13. 商业与生态模式

- **个人订阅**：私有关系记忆容量与端侧辅助/云端调用分级；无 AI 也能正常聊天；不得以“付费才有基础隐私安全”为理由分级保护。
- **组织 SaaS**：人数、群空间、授权工作流、匿名汇总报表、可信介绍运营、合规管理；数据共享边界与个人产品严格隔离。
- **开放技能和生态**：应用/连接器市场对每个 scope、动作、数据类实施逐项授权，插件签名和审计；插件不得读取所有私聊或代开外部账号。
- **商业实验**：冷启动按真实性、愿意邀请人、沟通收益和按月付费意愿检验，不使用历史 V21/V22 未获批准的 Dodo SKU/价格；不出售私人关系图谱与预测弱点；受商业与法务批准前保持 Checkout fail-closed。

## 14. 参考来源与证据级别

**同行评审 / 正式标准**
- EMNLP 2026, SMMU: https://aclanthology.org/2026.findings-emnlp.2434/
- EMNLP 2026, SocialArena: https://aclanthology.org/2026.emnlp-main.1060/
- Nature Human Behaviour 2026, Interaction with AI companions and psychological well-being: https://www.nature.com/articles/s41562-026-02516-2
- CHI 2026, Through the Looking-Glass: https://doi.org/10.1145/3772318.3790845
- ICML 2026, ZipMoE: https://proceedings.mlr.press/v306/yang26ds.html
- IETF RFC 9420 / RFC 9750: https://www.rfc-editor.org/rfc/rfc9420.html ; https://datatracker.ietf.org/doc/html/rfc9750

**预印本（尚须独立复现）**
- NICE: https://arxiv.org/abs/2605.29685
- Opal: https://arxiv.org/abs/2604.02522
- MemGate: https://arxiv.org/abs/2606.06054
- Edge MoE study: https://arxiv.org/abs/2606.21428
- Mi-Memory: https://arxiv.org/abs/2607.18975

**厂商/官方实践（不可视为独立实验）**
- Meta Private Processing: https://engineering.fb.com/2025/04/29/security/whatsapp-private-processing-ai-tools/
- Apple Foundation Models: https://developer.apple.com/documentation/foundationmodels
- Apple WWDC26 on-device/PCC: https://developer.apple.com/videos/play/wwdc2026/241/
- LINE CONVERGE 2026: https://www.linecorp.com/tw/pr/news/2026/1013-1/
- EU WhatsApp interop: https://about.fb.com/news/2025/11/messaging-interoperability-whatsapp-enables-third-party-chats-for-users-in-europe/
- Matrix specification: https://spec.matrix.org/latest/

**内部依据**：`HAI_ONE_VEC_V3_终极落地总方案.md`（2026-11-16，L0/L1/ODC/QE/VAL/VEC）、`02_PRODUCT_PRD.md`（真实社群关系与同意）、`Lokfeel_正反方辩论阶段性统一结论.txt`（Verified Introduction 垂类）、`STRATEGY_LOCK.md`、`V22_ACCEPTANCE_MATRIX.md`。本稿对各个不同阶段的目标进行分层，不宣称 V24 已获得业务 Owner 签字。
