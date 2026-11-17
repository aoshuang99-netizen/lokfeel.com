# LokFeel V25.1 | 模块化总目标、优先工程任务与可执行验收

生成日期：2026-11-17。**本包是工程任务书，不代表代码已执行/修改或生产门禁已通过。**

## 0 总目标 / 价值边界

建立同时服务 Personal / Business / Community/Developer 的开源生成式 AI 社交平台。共享实时通信、社交关系、双向 Consent、可替换 AI、记忆权限、社群和开放协议。个人数据与组织资产隔离。源代码/许可证开放不等于允许任意抓取个人聊天或自动训练。业务优先顺序：真实聊天与权限 > AI 生成体验 > 组织空间 > 自托管发行 > 开放生态 > Sparse MoE 科研。

**用户价值单位**：经过用户控制、实际发生的有意义沟通/关系协作（不能用网页返回 200、AI 出了一段文字或 Mission 状态 SUCCESS 代替）。

### 外部事实（截至本轮核查）
- GitHub `main`: `cad717e92542395e4346e49d388f09be78ec1557`，`protected=false`（2026-11-17 只读连接核查）。
- `LICENSE` 为 AGPLv3；商业授权、许可变更仍待相关权利人法律核实。
- `package.json` 已有 `check:selfhost`、`audit:open-source`、`check:openapi-contract`、`check:secrets` 等脚本。不能在未检查脚本内容时把存在当成已通过。
- WorkBuddy 报告生产 `b50e53e`、`checkoutReady=true` 且定价未批；这是**报告状态**，不是本轮独立重新访问支付 API 的结果；执行前重新读生产。
- WorkBuddy 报告 IM 媒体 grantedLevel 发送点未闭合；安全组需要亲自跑负例确认并以默认拒绝实现。

## 1 业务架构与账号域

```
Personal / Business / Community (self-hosted)
                ↓
Social Core: Identity · Chat · Relationship · Spaces · Consent
                ↓
Social Intelligence: Intent · Memory · Generation · Router · Agent
                ↓
Trust Boundary: Personal Vault | Shared Vault | Org Knowledge | Opt-in Research
                ↓
Open Platform: API/SDK · Model Adapters · MCP/A2A · License/SBOM
                ↓
Release & Evaluation: Tests · Threat Models · Independent Audit · Proven Outcomes
```

### 强制原则
- 企业管理员无权默认读取成员私人记忆；组织知识与个人 Vault 使用不同授权域，不能靠前端筛选实现。
- 服务端处理加密私聊必须有可信威胁模型和获授权的解密路径；无法做到时 AI 只能在端侧或获许可输入上工作，不许宣传“全端到端加密且云 AI 可任意读明文”。
- Agent 是真实社交的辅助工具，不替人无标识发言；外发必须有主体授权、幂等、回执。
- 社交专家路由是系统调度策略；Sparse MoE 是模型训练研究，不能用“六类专家提示词”冒充训练了 MoE。
- 当前 Chat/IM/Agent/Consent/Billing/Prisma 优先做资产适配，而不是大规模重建。

## 2 21 个子模块与结果门禁

| ID | 模块 | 优先级 | 开发责任人 | 可验收成果 | 最严格门禁 |
|---|---|---|---|---|---|
| M00 | 事实源、发布止损与决策 | P0 | Release/Security | 产线错价/未经批准开通检查 | 明确生产/候选/主仓/预览 SHA；商业未批不得发起新的结账；所有敏感变更须审批 |
| M01 | 产品定义与共用领域协议 | P0 | Product/Architect | Personal / Business / Developer 使用同一版本化数据契约 | 三类客户各能完成一个典型场景；API 契约 diff 后无无意破坏；禁以 Mission 替代社交成果 |
| M02 | 身份、组织、真人真实性 | P0 | Backend/Security | 个人/企业双域及会话隔离；不假称未实施的真人核验 | 无授权跨用户/跨租户读取0；账号切换不串私聊/记忆；身份状态如实显示 |
| M03 | 聊天与实时消息 | P0 | IM Backend/Frontend | 双真实账号发送/接收/已读/离线重试可复核 | 两用户两设备消息对齐、顺序稳定、客户端消息幂等、无副作用重复0 |
| M04 | 多模态消息的授权执行点 | P0 | Security/IM | IMAGE/VOICE 发送时检查 grantedLevel | 未授权媒体 403 且 DB/队列/推送 0 写；撤回、并发、转发和重放不能绕过 |
| M05 | 关系图谱、身份可见性与同意 | P0 | Relationship/Security | 联系/引荐/共享许可显式状态 | 拒绝/撤销可即时阻断未执行动作；关系推测不得写成双方确认事实 |
| M06 | 社交生成模型与意图理解 | P0 | AI/Research | 私人意图、情境、沟通目的澄清 | 无证据不得断言对方情绪；≥150条独立双语评测及失败类型报告 |
| M07 | Private/Shared Relationship Memory | P0 | Privacy/Data | 个人记忆、双人同意共享、群共享、企业知识严格隔离 | 跨域检索 0；撤回后不能再被新推理访问；删除/导出/更正可测 |
| M08 | Social Intelligence Router & 模型适配 | P0 | AI Platform | 权限优先、可替换模型、预算/风险路由 | 无凭据时诚实降级；未获许可不得转私聊到云模型；记录 route_reason |
| M09 | 私有生成式沟通助手 | P0 | AI Product/Safety | 翻译、表达建议、沟通草稿/摘要 | AI 内容清楚标注；不替用户自动发送；跨语言误译敏感语义能提示不确定性 |
| M10 | Spaces 与双人/多人协作 | P1 | Frontend/Collab | 个人小群/企业 Space 的邀请/权限 | 退出或移除后无新消息和记忆访问；成员名单和组消息一致 |
| M11 | Agent/Consent/工具行为与真实回执 | P0 | Agent/Security | 批准前后动作分离，真实发送与回执绑定 | 0未授权外部发送；重复事件不重复执行；真实外部动作需 Provider receipt |
| M12 | Business SaaS 与企业治理 | P1 | Enterprise | 租户空间、组织 AI、管理员权限、企业审计 | 管理员不得读取成员个人 Vault；两企业交叉测试 0 泄漏 |
| M13 | 开放协议、API、SDK 与兼容 | P1 | Platform/DevRel | 开放消息/Agent/模型适配契约与 SDK | 独立样例客户端可调用；版本向后兼容；跨协议不绕过 Consent |
| M14 | 开源 Community Edition、自托管与许可 | P0 | Open Source/Legal/DevOps | 可运行社区版和贡献治理 | 两个独立干净环境无需 LokFeel Cloud 密钥即可聊天及本地 AI；许可裁决留痕 |
| M15 | 信任、安全、加密与反滥用 | P0 | Security/Privacy | 未授权泄露/骚扰/冒充、E2EE 声明审计 | 零重大越权、零真实密钥泄漏；没有端到端威胁验证不声称 E2EE |
| M16 | 商业订阅与多产品账本隔离 | P0 | Billing | 未批准价格不能购买，B2C/新 SaaS 不串 | 不重复入账、不串权益；沙箱 webhook 真投递、乱序与重试通过 |
| M17 | Personal/Business UX 与前端设计 | P0 | Design/Frontend | 四主入口、两个角色、真实交互、移动优先 | 非技术用户五秒识别主动作；7 视口零溢出、严重无障碍0 |
| M18 | 评测、MoE 科研与学习闭环 | P1 | ML Research/Independent QA | 模型路由 vs Sparse MoE 等预算实验 | 盲测无数据泄漏；质量/成本/隐私分别出报告，未胜强基线不得升级 |
| M19 | CI/CD、发布与生产可观测 | P0 | Release/QA | 唯一 RC SHA、受保护 main、preview、回滚、生产复验 | 所有适用强制门禁 PASS；实际生产 SHA 一致；48h 观察期有证据 |
| M20 | Personal + 企业试点与商业实证 | P1 | Product/Research | 真实用户社交与企业群落双试点 | 双端聊天/关系助益有真实观察；不拿模拟评价或消息数作真实满意度 |

## 3 第一批必须连续执行的依赖链（不允许写完计划就停）

**第 0 线：生产风险** `V25-01 → V25-02 → V25-33 → V25-34`。只读复核、最小 Hotfix、真实沙箱验证、取得授权后生产复验。没有 Owner 授权，停在生产写门，不阻塞其他可逆研发。

**第 1 线：隐私与真实聊天** `V25-05 → V25-07 → V25-09 → V25-10 → V25-12`。同意发送点和关系身份要先于 AI 自动介绍。

**第 2 线：社交 AI** `V25-13 → V25-14 → V25-17 → V25-18 → V25-19`。先真实模型和规则退路，再允许私人 AI 辅助沟通。

**第 3 线：数据/企业隔离** `V25-15 → V25-16 → V25-25 → V25-26`。成员个人记忆不进入组织 AI。

**第 4 线：开源发行和发布治理** `V25-29 → V25-30 → V25-39 → V25-40`。AGPLv3 当前事实，许可证换版单独法律审批。

**第 5 线：视觉与质量** `V25-35 → V25-36 → V25-41/42`。不能让 Figma 缺连接器阻止代码端的浏览器与无障碍验收。

## 4 每张任务卡的统一验收格式

机器卡见 `V25_1_MODULE_TASKS.json`。WorkBuddy 必须按以下结构逐卡出证据，**真实未测不得自动升级**：

```
TASK_ID | MODULE | BASE_SHA | CODE_SHA | DIFF | API_CONTRACT
TEST_COMMAND | EXIT_CODE | TEST_COUNT | NEGATIVE_CONTROL
BROWSER_OR_PROVIDER_PROOF | DATA_SCOPE | CONSENT_REF
INDEPENDENT_REVIEWER | EVIDENCE_SHA256 | VERDICT | NEXT_ACTION
```

有效状态：`TODO → CODE_COMPLETE → LOCAL_TESTED → INDEPENDENTLY_VERIFIED → PREVIEW_VERIFIED → PRODUCTION_VERIFIED`。`PASS_CODE_ONLY/PARTIAL/BLOCKED/NOT_TESTED` 不能算 GA PASS。

## 5 统一发布硬门（ALL applicable PASS 才进入 READY_FOR_APPROVAL）

| Gate | 不可豁免的验证 |
|---|---|
| G00 | 唯一战略、Personal/Business/Builder 场景、真值表经 Owner 确认 |
| G01 | 生产定价/checkout 未批准禁售，服务端与 UI 一致 |
| G02 | 真实双用户端到端聊天，消息幂等/重连/权限样本有实证 |
| G03 | Consent、媒体权限、私人/企业关系记忆跨域越权 0 |
| G04 | AI 生成内容来源如实，不能冒充真人，模型故障诚实降级 |
| G05 | 社会意图评测、隐私对抗负例满足预注册判据 |
| G06 | Personal/Business/社区核心场景分别端到端可用 |
| G07 | Community Edition 两个独立干净环境自托管真实成功 |
| G08 | AGPLv3/依赖许可/SBOM 已审查，不擅自换许可 |
| G09 | 外部 Agent 操作无未批准副作用，实际回执与授权关联 |
| G10 | 设计/语言/交互一致，屏幕尺寸和无障碍规定通过 |
| G11 | 原 9 页性能门禁不放宽，TBT≤200ms/LCP≤2.5s/CLS≤0.1（预注册同配置） |
| G12 | GitHub main 真保护、远端 CI、独立 QA、SHA 固定与 Preview 一致 |
| G13 | 数据迁移备份恢复演练、Provider 沙箱、支付对账和安全审计通过 |
| G14 | 10+ 真实个人用户可用性试点，2 家企业试点为目标，未取得则 NOT_TESTED |
| G15 | Owner 批准唯一 RC 才进行生产迁移与部署；生产逐路由复验及 48h 观察 |

必要注意：长程社会理解能力的阈值需要先建立人工标注基线，不能提前写成“准确率≥95%”等缺证据假绿。产品指标含理解率、同意率、误披露率、消息投递质量、人工时间、用户信任、被打扰次数；不以日活或 AI 回复数单独论成功。

## 6 外部审批集中单（不能代填）

U-1 生产未批定价止损及指定 hotfix SHA；U-2 产品品牌和第一试点人群；U-3 真正启用的个人/企业首发场景；U-4 AGPLv3 及后续商业许可策略；U-5 外部 Provider/模型调用、现实用户外发/真实扣款权限；U-6 分支保护与部署通道；U-7 生产 Bot 策略；U-8 独立验收人、真人和企业试点。安全默认拒绝是工程硬约束，**不属于可以选关闭的产品功能**。

## 7 WorkBuddy 命令与停止条件

立即从最新本地 HEAD 和远端/生产真相重建，再依赖图推进。发现工具缺失先寻找已授权 CLI/API 替代，不等于整项业务失败。生产写、真实支付、对外真人消息、法律许可变更、私人数据导出必须由授权主体批准；其余可逆代码/单测/隔离测试/Preview 可继续。不得自行推 main，不得通过 `[skip netlify]` 或伪造 CI 规避发布治理。
