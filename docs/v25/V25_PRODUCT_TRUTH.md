# V25_PRODUCT_TRUTH | 唯一产品真值源（Product Architect 维护）

状态：**DRAFT · OWNER_REVIEW_REQUIRED**（V25 为 Owner 战略指令，但产品真相需签字后才冻结）。
基线 `07486db` · 2026-11-17 · 本文件是 V25 所有对外 Claim 与 UI 文案的唯一判据；旧 V22/V23 状态页不得替代。

## 0. 版本继承与冲突（不得静默覆盖）

| 版本 | 一级定位 | 价值单位 | 状态 | V25 处置 |
|---|---|---|---|---|
| V22（`6bab34c`） | AI-native Connection OS / 通用 ONE Goal | Verified Outcome | 战略归零第一批，整体 NO_GO | 作废一级叙事；安全修复与失败记录保留 |
| V23（`07486db`） | AI-Native Relationship & Generative Social Platform | Verified Introduction | 第一批本地 NO_GO（D-1~D-7 未批） | **关系/双向同意/证据分级资产全部 REUSE**；「婚恋引荐=唯一首场景」放宽为关系域之一 |
| V24（作战包，未编码） | AI-native Social Network + Social Intelligence Platform | CMI（Consented Meaningful Interaction） | STRATEGY_PROPOSED / ENGINEERING_NO_GO | 四条社交原语、四域隔离、SIR、强基线对照全部继承 |
| V25（本轮总令） | **Open AI Social Platform** | CMI + 开放生态（Personal / Business / Developer） | 用户下发，未获生产授权 | 唯一新需求源；V21–V24 代码、测试、安全门禁继承不重置 |

**关键冲突须 Owner 明示，不得由工程推断：**
1. 品牌品类从 `AI-Native Relationship & Generative Social Platform`（V23 冻结）升维为 `Open AI Social Platform`（V25）。改 `brand.ts` / 首页 / 公开页属大范围对外表达变更，**须 D-1 批复后执行**。
2. V23 首个场景建议「成人长期关系优质介绍」；V24 §0.3/V25 §六建议「跨语言个人 + 跨地域企业/专业社群」。属场景优先级变更，非能力删除——须 D-2 批复。
3. V23 D-4（生产泄价止损）在 V24/V25 中被继承为「现存待处置高风险」，**未因版本升级自动解决**（A00 复核仍在）。

## 1. 开放核心分层（V25 §一/§三/§四）

```
Personal：Chats / People / Spaces / My AI   ┐
Business：Spaces / Members / Connections /   ├─ 共用版本化 Open Social Core
          Agents / Insights                  ┘
Community / Self-hosted：同一核心代码 + 本地模型/云连接可选
Developer：协议 Schema · SDK · MCP/A2A · 模型 Adapter · 插件市场
可信基础：Privacy · Consent · Evidence（不因产品线或部署形态降级）
```

**铁律**：企业购买不得获得员工私人关系记忆；个人身份与组织身份可关联，密钥/授权/存储/查询范围必须分离（`A01 §5` 的 `discloseSubject` 默认拒绝是现成底座）。

## 2. Claim 登记（对外表达 ↔ 真实对象 ↔ 证据）

| ID | 对外文案 | 真实对象（源码已核实） | 证据级别 | 状态 |
|---|---|---|---|---|
| K-01 | 「真实聊天、可由本人最后确认」 | `Conversation`/`IMMessage`（`core.prisma:385`）+ `im/send:17` 幂等/seq | TESTED_LOCAL（单测 + e2e） | **available** |
| K-02 | 「双方同意才共享联系方式/介绍」 | `ConnectionProposal`/`ProposalDecision`（`connection.prisma:290`）+ `discloseSubject:207` | TESTED_LOCAL | **available** |
| K-03 | 「AI 建议不替真人发言、不自动外发」 | 三权分立 `agent.run`/`approve`/`execute` + EMAIL CAPTURED（`delivery.ts:217`） | TESTED_LOCAL | **available** |
| K-04 | 「自报不等于已验证」 | `outcome/verification.ts:50,68` 三级 + 第二人核验 | TESTED_LOCAL | **available** |
| K-05 | 「已有 MCP/A2A 开放接口」 | `api/mcp/route.ts:75,137,156,163` + `api/v1/a2a/tasks/route.ts` | TESTED_LOCAL | **available**（示例 SDK，无正式包） |
| K-06 | 「可按自己的方式部署社交空间」 | `LICENSE`（AGPLv3）+ `docs/SELF-HOSTING.md` + `Dockerfile` | CODE_ONLY（无两套干净环境实测） | **NOT_TESTED** |
| K-07 | 「理解你的关系、跨语言帮你表达」 | 3 技能中 `INTRO_DRAFT`/`COORDINATION_ADVICE` 存在；无 SMMU 类评测 | PARTIAL | **gated**（不得宣称效果） |
| K-08 | 「开源可审计的 Consent/Memory/Router」 | Consent 可审计；**Memory 加密库 MISSING**、SIR 未独立实现 | GAP | **BLOCKED_UNTIL_FIXED** |

## 3. 禁止对外表达

| ID | 禁 Claim | 理由 | 现况 |
|---|---|---|---|
| X-01 | 「端到端加密」「比 WhatsApp 更安全」 | 无审计的 E2EE 实现；`encryptionMode:"SERVER"`（`im/send:138`） | 源码实证不支持 |
| X-02 | 「企业管理员可见成员私人关系记忆」 | V25 铁律明禁；`discloseSubject` 默认拒绝 | 若实现即 P0 BLOCKER |
| X-03 | 「已验证关系成功 / 真实介绍已送达 N 次」 | 0 真实试点样本；EMAIL 默认 CAPTURED | 无样本 |
| X-04 | 未批价格 `$89/$199/$449`、`checkoutReady` | D1 未批；生产仍泄价（A00） | **生产 LIVE 命中** |
| X-05 | `MCP/A2A/Token/WorkspaceSpec/Mission pipeline` 作为消费者首屏 | 内部实现；V24/V25 明禁 | 个人首页须避开 |
| X-06 | 旧品牌 `LokFee!` / `Connection OS` / `Find Real Love` | V23/V24 已冻结作废 | 公开面部分残留（U07 范围） |
| X-07 | Bot 冒充真人、`isBot` 会话 simulate real human | 生产 health `botModule.enabled=true`（A00） | 与真人对立，须标注或关闭 |

## 4. 不可混用映射（验收硬判定）

| 概念 A | 概念 B | 判定 |
|---|---|---|
| `CMI`（双方认可的有效互动） | 消息条数 / Agent 调用 / Mission CLOSED | 不可混用；后者是站内事件 |
| `Introduction`（双方同意后的真实介绍） | `Match`（Legacy B2C 推荐） | 不可混用；B2C 线 DEPRECATE |
| `OUTCOME_PROVIDER_PROVEN` | `RECEIPT / CAPTURED / Agent EXECUTED` | 站内回执不是外部送达或关系结果 |
| `Open Core`（可审计开源实现） | `Cloud 商业托管` | 许可与部署边界分别标注，不得混称「全开源」 |
| 开源软件 / 开放权重 / 开放协议 | 三者互不等价 | 模型可下载 ≠ 可商用；源码可见 ≠ OSI 开源 |
