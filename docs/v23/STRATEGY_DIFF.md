# R00 | V23 战略差异清点（原事实 / 当前偏航 / 拟修正 / 待 Owner 决策）

依据：作战包 `01 §0` 历史两条产品定义、`00 §01`、V22 `STRATEGY_LOCK.md` / `W02_LIVE_AUDIT.md`，以及本轮三条只读源码盘点。状态：**OWNER_REVIEW_REQUIRED**，不把关系悄悄换回通用目标。

| # | 维度 | ① 原事实（有来源） | ② 当前偏航（V22 / 现网代码） | ③ 拟修正（V23） | ④ 待 Owner 决策 |
|---|---|---|---|---|---|
| 1 | 产品类别 | 2026-09-07：Verified Relationship Introduction Platform；V21：以真实社群关系与双方同意为核心的生成式工作台 | V22 把默认用户改成「有数字事务要完成的个人」，主线 `Goal→Task→Approval→Action`；根 metadata 仍为 `Connection OS for AI-native teams` | 冻结为 AI-Native Relationship & Generative Social Platform | **批准 V23 一级定位** |
| 2 | 价值单位 | `Verified Introduction`（有资格核对、双方意愿、授权范围、实际引荐证据） | `WorkspaceSpec / Mission / AgentRun / Verified Outcome`；首页 Hero `See what actually happened` 指站内执行回执 | 唯一价值单位回到 `Verified Introduction`；Agent 可生成介绍文案但必须服务于一个 `Introduction ID` | 接受「站内执行 ≠ 业务成功」的验收口径 |
| 3 | 首个场景 | 婚恋 / 值得见面的高信任成人关系介绍（历史最早有依据） | V22 场景为 `For one person / For a small team / For a relationship`，关系仅第三位 | V1 聚焦成人长期关系优质介绍；社群 SaaS 为同构第二试点；其他社交场景列 P2 | **确认首个商业场景**（是否采用本建议） |
| 4 | 两产品线 | V21 已有组织态 Console 与租户隔离；早期 B2C 交友线 | 一个 UI 同时面向个人、组织、开发者、Hlua 会员；`/hlua` 中文旧权益与 SaaS 混语 | B2C Relationship / B2B Social SaaS 分产品；首页、导航、会员权益、定价、增长数据隔离 | 确认 B2B 试点范围与隔离标准 |
| 5 | 用户首屏主动作 | 表达「想建立什么关系、如何保护隐私」 | `/` 主 CTA：`What do you want to get done?` → `/register?goal=` → `/workspace?view=now` | 唯一主动作：告诉 LokFeel 你想结识什么样的人；已登录首屏：下一次值得回应的真实连接 | 批准首页 Hero 文案（中英）与用户测试口径 |
| 6 | 一级导航 | 早期：探索 / 匹配 / 连接 / 聊天 / 资料 | 工作区一级为「开始 / 我的任务 / 待我确认 / 成果」，关系网络与同意收进二级「更多」 | 消费者：`发现适合的人 / 我的介绍 / 消息 / 关系进展 / 安全与设置`；7 个 `?view=` key 保兼容但不作新客一级导航 | 无（工程可自主执行） |
| 7 | 真人供给 | 要求真实参与者、双方认可、结果追踪 | `analytics-report.tsx` 全假统计卡、`avatar-utils.ts` 库存人像兜底、`explore` 缺字段回填 `age=25 / score=85`、`profile/[id]` 10 张 Unsplash 假照片 + 恒显 Identity Verified、`isBot` 会话 simulate real human behavior | 零供给诚实空态；未核验不显示 verified；删除/隔离假真人、假分、假照片、假统计；bot 明确标识 | 确认是否保留既有 bot 模块（现网 health `botModule.enabled=true`） |
| 8 | 双向同意 | 双方选择权、拒绝后不受打扰 | 服务端**已有** `ConnectionProposal + ProposalDecision + discloseSubject` 双向不变量（可 REUSE）；但 `Block` 全仓只有 CRUD，**无任何业务路径的拉黑拦截**；同意撤销/过期的独立二次校验缺失 | 复用双向状态机；补 `isBlockedEitherWay` 到提案/候选/介绍/消息；补 `bothConsentStillValid`；事务型 outbox | 无（安全不变量，工程可自主执行） |
| 9 | 结果证据 | 自报 / 双方确认 / 外部证据分级 | `ExecutionVerification`、`OutcomeVerification` 三级派生已存在，但易被误读为关系成功；无独立 `RelationshipOutcomeEvidence` 事件流 | 建立「不可混用」映射 + 负例门禁；`Mission CLOSED / Agent EXECUTED` 触发 V23 gate FAIL | 无 |
| 10 | 定价与商业 | 历史 `$49–99` / `$199–399` / `$999–1999` 均为实验假设 | **现网 LIVE**：`/pricing` 显示 `$89/$199/$449`；plans API `checkoutReady=true` / `APPROVED` / `live_mode`；本地 `6bab34c` 已 fail-closed 但未部署 | D1 未批一律 fail-closed（SSR + JSON + checkout）；现网做最小可逆热修复候选，不擅自改生产 | **定价与商业门处置方式**（热修复 / 摘除支付密钥） |
| 11 | 版本事实 | — | 远端 `cad717e`、生产 `b50e53e`、本地 `6bab34c` 三者不一致；main 未保护；Preview `NOT_AVAILABLE` | V23 独立分支、唯一 RC SHA、保护 main、required CI、先迁移后发版 | **发布治理授权**（Q03/Q06） |
| 12 | 验收方式 | 真实参与者 / 双向接受 / 介绍送达 / 真实互动 / 后续反馈 | 2,925 Jest、Agent 执行成功、页面 200、12/12 HTML 绿 | 18 门 S00–S17；至少 10 次真实双方同意介绍样本（执行目标）；10 名真人用户测试；独立 Reviewer 复跑 | 真人试点与外部执行器授权 |

## 差异清点结论

- **不是「页面不够好看」，是产品类别错**：V22 把关系与社交降为附属场景，因此 30 个页面反复改文案仍不像关系产品。
- **不是「全部推倒重写」**：盘点显示双向同意状态机、租户守卫、IM、幂等、outbox、三级证据派生、fail-closed 定价门均已存在且可 REUSE（见 `ASSET_INVENTORY.md`），V23 应当把它们降为关系业务的技术底座。
- **真实阻断在现网与真人**：生产未批准定价 + checkoutReady、0 真双向同意介绍、0 真人访谈、0 独立复核，均不能靠改 UI 消除。
- 上表第 ④ 列共 5 项 Owner 决策，已汇总到 `OWNER_DECISIONS.md`，**一次性提交，不逐条反复提问**；其余工程项不等待签字。
