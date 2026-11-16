# LOKFEEL V23 | 全站路由、发布与验收硬门

状态：计划基准。当前工作区与生产的每条状态以新取证为准；**不得从文件里已有 React 组件推断线上已上线**。

## A. 30 个路由/视图改造矩阵（逐项有截图、文案、功能、端点、结果）

| # | 地址/视图 | V23角色 | 必须整改与实际验收 | 原代码可复用资产 |
|---:|---|---|---|---|
| 01 | `/` | 社交首页 | 5秒答出是真人关系/可信引荐；无通用任务OS术语；唯一关系 CTA | `(landing)/page.tsx` |
| 02 | `/product` | 产品解释 | 双向同意、可信引荐、真实进展；已支持/计划中边界同屏 | `(public)/product` |
| 03 | `/solutions` | 使用场景 | 婚恋/高信任介绍主场景；社群SaaS另组；不混企业任务清单 | `(public)/solutions` |
| 04 | `/how-it-works` | 三步流程 | 说明真实资料→双方认可→真实介绍与后续 | `(public)/how-it-works` |
| 05 | `/stories` | 案例与边界 | DEMO 不能混作真实客户；真实介绍数据须有可审核同意与证据 | `(public)/stories` |
| 06 | `/pricing` | 商业诚信 | D1 未批无价格及订阅 CTA；用户理解 B2C 与 SaaS/旧Hlua差别 | `(public)/pricing` |
| 07 | `/about` | 品牌与信任 | 解释为何致力真实连接；公司主体必须核实 | `(public)/about` |
| 08 | `/help` | 帮助 | “怎么开始/怎么拒绝/怎么撤回/如何举报/怎么退款”可操作 | `(public)/help` |
| 09 | `/contact` | 沟通 | 联系地址/邮箱/响应时限不得编造，表单可提交 | `(public)/contact` |
| 10 | `/support` | 支持/转址 | 唯一 canonical 帮助入口，无内容冲突 | `(public)/support` |
| 11 | `/faq` | FAQ/转址 | 与 Help/收费及安全规则一致，无旧成人/成员权益误导 | `(public)/faq` |
| 12 | `/terms` | 用户条款 | 自有业务边界、主体与关系服务风险描述真实 | `(public)/terms` |
| 13 | `/privacy` | 隐私 | 关系资料按身份、目的、租户、披露人分级，跨用途不得默认共享 | `(public)/privacy` |
| 14 | `/refunds` | 退款 | 真实收费模式、退费条件和提供者能力一致 | `(public)/refunds` |
| 15 | `/login` | 进入产品 | 进入关系产品，不是注册通用 Agent OS；登录继续原始目标 | `(auth)/login` |
| 16 | `/register` | 新用户 | 渐进建档，未授权关系敏感数据不写明文URL | `(auth)/register` |
| 17 | `/dashboard/onboarding` | 建档 | 5-8 个高信息价值问题，懂为何要问，身份/意愿状态分明 | `(dashboard)/dashboard/onboarding` |
| 18 | `/dashboard` | 用户首屏 | 下一位值得回应的人/介绍状态，不是四大系统计数 | `(dashboard)/dashboard/page.tsx` |
| 19 | `/dashboard/explore` | 发现 | 只显真人合规候选；无库存诚实告知 | `(dashboard)/dashboard/explore` |
| 20 | `/dashboard/matches/[id]` | 候选详情 | 推荐理由/硬冲突/本人许可范围/接受或拒绝可用 | `(dashboard)/dashboard/matches/[id]` |
| 21 | `/dashboard/connections` | 我的介绍 | 提案、双方同意、发送、确认、后续状态分明 | `(dashboard)/dashboard/connections` |
| 22 | `/dashboard/chats` | 交流 | 站内聊天、举报/拉黑；非法跨场景数据不可见 | `(dashboard)/dashboard/chats` |
| 23 | `/dashboard/profile` | 我的资料 | 身份证据级别、意愿与隐私授权、删除/撤回 | `(dashboard)/dashboard/profile` |
| 24 | `/workspace?view=now` | SaaS/专业概览 | 值得审核的真实关系介绍，不是通用Goal Agent入口 | `living-workspace.tsx` `now` |
| 25 | `/workspace?view=studio` | 引荐方案 | 只用于介绍方案编辑、双方理由与授权；隐藏Compiler | `studio` |
| 26 | `/workspace?view=field` | 关系网络 | 仅授权范围内成员及有来源边；无虚构关系 | `field` |
| 27 | `/workspace?view=consent` | 双向认可 | 两侧同意与字段授权、撤销全功能 | `consent` |
| 28 | `/workspace?view=outcomes` | 关系进展 | 交流、会面、双方反馈与证据等级 | `outcomes` |
| 29 | `/workspace?view=agents` | AI辅助（高级） | 筛选、推荐原因、草稿、人工复核，不宣传外部完成 | `agents` |
| 30 | `/workspace?view=missions` | 运营工作项（高级） | 引荐及跟进任务可追溯，不是对新用户主价值 | `missions` |

**必须额外审查**：`/dashboard/chats/[roomId]`、`/dashboard/subscription*`、`/dashboard/settings`、`/checkout/success`、`/hlua`、`/api/payments/dodo/plans`、`sitemap.ts`、`proxy.ts`、SEO/JSON-LD、OG 图片和老品牌 Footer；它们不是被遗漏的安全豁免，而是旧业务与新业务隔离专项。

每条路由必须记录：`prodUrl / prodSha / sourcePath / proposedComponent / apiEndpoint / visibleClaims / primaryCTA / role/permissions / loading-empty-error / locale / screenshotBefore / screenshotAfter / keyboard / axe / perf / E2E / verdict`。

**匿名访问的七个工作区 view 一旦重定向到登录页，只能说明登录保护有效，不意味着工作区已被测试。** 必须用受控 QA 账户/预览隔离环境分别测 Consumer 与 SaaS Role，且不得上传真实会话 Cookie。

## B. 18 个 V23 发布硬门（严格取代 V22 的通用 OS 指标）

| Gate | 验收内容 | 定量/定性标准 |
|---|---|---|
| S00 | 战略 | Owner 签定“真实关系 / 双向介绍”主线、首个 MVP 场景及非目标；公开 Claim 100% 在册 |
| S01 | 源码/生产基线 | 远端、候选、预览、生产 SHA 与数据库迁移版本四类准确可追溯 |
| S02 | 关系模型 | Domain 合同/迁移/租户权限/去重通过，旧数据不丢、不跨用途共享 |
| S03 | 真人与核验 | 无冒充真人、未核验不显示已核验；成人与身份风险处理通过 |
| S04 | 关系意图 | AI/规则来源、可编辑、关键追问、失败/竞态/幂等通过 |
| S05 | 候选供应 | 真实授权供给，缺人不造假；供给覆盖及缺失可量化 |
| S06 | 推荐质量 | 明显硬冲突不被推荐；解释来自有来源字段；有规则/人工基线 |
| S07 | 双向同意 | 双方未同意不得发送/披露，撤回/并发/越权零绕过 |
| S08 | 真实引荐 | 真实 Provider/Human 回执可追；重复投递零重复，至少有非模拟案例 |
| S09 | 交流/跟进 | 真人消息/见面/后续状态，举报/拉黑正常；站内执行≠真人结果 |
| S10 | Outcome | 一方自报、双方确认、外部事实区分，缺证据不得 VERIFIED |
| S11 | 隐私与安全 | 跨租户、目的外使用、未授权接触、敏感数据泄漏均 0 成功 |
| S12 | 用户体验 | 10 人≥8 人5秒辨识真实连接，≥8 人无提示完成意愿/介绍操作；7视口/axe/键盘/缩放通过 |
| S13 | 商业/支付 | 未批 D1 不卖；真实 Dodo 沙箱事件→账本→权益+退款对账，法律主体真实 |
| S14 | 指标/增长 | 分母、窗口、真实供给、双向接受率与投诉可查；NO_SAMPLE 不计通过 |
| S15 | 性能 | 9/9 TBT≤200ms，LCP≤2.5s，CLS≤0.1，原节流、≥3轮、原始 trace 齐全 |
| S16 | 独立 CI/迁移/发布治理 | 独立 Reviewer、branch protection、required CI、Preview、数据库恢复演练全部通过 |
| S17 | 生产发布与回归 | Owner 仅批准指定 RC；生产 SHA 匹配、关系业务全链生产复验、48h监控 |

**门禁不能从通用 Agent 旧测试自动继承 PASS**；保留旧安全、CI、计费测试并在 V23 候选上全量复跑。`PASS_CODE_ONLY / PARTIAL / BLOCKED / NOT_TESTED / NO_SAMPLE` 不能计为 PASS。

## C. 发布工作流

0. 取证：生产仅 GET 和明确授权的安全账号操作，源码与旧业务数据库只读清点。
1. 开发：`v23/relationship-reset` 独立分支，停用无关特性；小批次提交，可 revert，不碰生产配置。
2. 领域迁移：先在脱敏历史库/影子库验证 expand/compatibility/rollback 与隐私边界，避免删表覆盖旧数据。
3. UI：Consumer / SaaS / Developer 三套体验边界明确；同一国际化规则，技术信息后置。
4. 内测：双独立用户、真实双向允许的社交引荐；B2B SaaS 组织另测。不得使用虚构真实用户冒充验证。
5. 独立审核：Codex/第三方 reviewer 复跑测试及源码，修复后重新审查新 SHA。
6. Preview：唯一 SHA，生产相同 flags 与合规脱敏数据，验收 30 个路由与 18 个硬门。
7. Owner 审批：价格、法律、营销声明、真实对外联系和迁移/发布分别授权。
8. 部署：受控迁移→发布（只有获批 SHA）→G13 实际生产回读→48h 只读监控/关键报警/应急停止对外介绍。

### 管理职责禁止越权

**WorkBuddy**：可以自主审计、修代码、跑沙箱、做实验、出 RC 报告；不得改价格批准、代填法律主体、擅自收款、向真人自动发陌生消息、绕过 Consent、推生产。

**Codex 独立审核**：必须读取不同执行记录并复跑；同工作会话“另一个子代理”不算独立。

**Owner**：决定首个市场/合规标准/价格与生产发布。必要外部输入未就绪时仅阻塞对应节点，不阻止其他工程。
