# LokFeel Connection OS — 剩余任务总盘（T02–T12）

> **用途**：把「交付包执行规范」与「SaaS 战略方案 V1.0」对齐成一份可执行的剩余任务清单。
> 后续每个任务开工前先读本文件对应卡片，收尾后回填提交 SHA 与 AC 结论。
>
> | 项 | 值 |
> |---|---|
> | 真实仓库基线 | `49ee97d`（`main`，**未推送**） |
> | 已交付 | **T00 审计**（`3faf1e9`）、**T01 多租户底座**（`c5828ba`）、**T02 Mission Link**（`49ee97d`） |
> | 剩余 | **T03–T12，共 10 个任务** |
> | 规范来源 | `lokfeel_workbuddy_v1/`：`WORKBUDDY_MASTER_PROMPT.md`（主指令）、`tasks/T02–T12`、`docs/ACCEPTANCE_MATRIX.md`（AC-01~25）、`contracts/schema.sql`、`contracts/connection.openapi.yaml` |
> | 规划背景 | 《LokFeel SaaS 核心功能架构与开源技术集成方案 V1.0》：10 大模块 / 6 个自研引擎 / P0–P3 / 12 项 Codex 实施清单 |

---

## 1. 三源对齐：两套清单其实是同一件事

战略方案的「12 项 Codex 实施顺序」与交付包的 `T00–T12` **逐条一一对应**，不存在两套并行的路线。这意味着可以放心以交付包的任务卡为执行单位，同时用战略方案校验「是否偏离产品定位」。

| # | 战略方案 12 项清单 | 交付包任务 | 对应模块 | 状态 |
|---|---|---|---|---|
| 1 | 审计现有仓库与数据库，生成复用矩阵 | **T00** | — | ✅ 完成 |
| 2 | 建立 SaaS 多租户与角色权限 | **T01** | 09 Trust | ✅ 完成 |
| 3 | 实现 Mission / Intent / Offer 领域模型 | **T02 + T03** | 01 Mission Studio · 02 Member Intel | 🟡 T02 ✅ / T03 ⬜ |
| 4 | 实现双向匹配与候选解释 | **T04** | 03 Connection Engine | ⬜ |
| 5 | 实现 Consent / Approval / Revocation | **T05** | 09 Trust | ⬜ |
| 6 | 实现介绍工作流与任务恢复 | **T06** | 07 Workflow · 06 Comm Hub | ⬜ |
| 7 | 实现 Outcome 与单位成本统计 | **T08** | 08 Outcome Intel | ⬜ |
| 8 | 完成 Community SaaS Console | **T07** | 全模块的门面 | ⬜ |
| 9 | 接入 LangGraph 与模型调用网关 | **T09** | 05 Agent Workforce | ⬜ |
| 10 | 实现 Community Bridge 与跨群权限 | **T10** | 04 Community Bridge | ⬜ |
| 11 | 接入 A2A / MCP 和开发者 SDK | **T11** | 10 Integrations | ⬜ |
| 12 | 完成 E2E、安全、负载与回归测试 | **T12** | — | ⬜ |

**6 个「值得长期自研」的引擎**（战略方案 §四）落点：Intent → **T03(+T09)**｜Reciprocal Connection → **T04**｜Consent & Trust → **T05(+T01)**｜Connection Orchestrator → **T06**｜Community Bridge → **T10**｜Outcome Learning → **T08**。

**10 大模块**中，战略方案 §一 明确「第一版优先做 01·02·03·07·08·09 的最小闭环」。本盘点的批次编排遵守该边界：**第一批次只覆盖这 6 个模块，04/05/06/10 排在 P1–P2。**

---

## 2. 现有资产盘点（决定「复用 / 重构 / 新增」）

`prisma/schema/` 共 **42 个模型**（core 33 + bot 6 + tenancy 3）。与业务闭环相关的现状：

| 闭环环节 | 现有资产 | 行号 | 判定 |
|---|---|---|---|
| **Mission** | 无 | — | 🔴 **新增** |
| **Intent** | `Profile`（纯画像字段，不挂任务、无有效期、无披露范围） | `core.prisma:165` | 🟡 **重构/扩展** |
| **双向匹配** | `Match`（`senderId→receiverId` + `pitchMessage`，**实为单向投递**）、`MatchReaction` | `core.prisma:266,342` | 🔴 **新增**（现有保留为 B2C 通道） |
| **双方授权** | `ConsentRequest`、`ConsentGrant`、`/api/im/consent`（311 行） | `core.prisma:648,685` | 🟢 **复用**（本盘最成熟的积木） |
| **协调/连接** | `Conversation`、`IMMessage`、`MessageReceipt`、`UserPresence` | `core.prisma:369,506,576,617` | 🟢 **复用** |
| **审计** | `AuditLog`、`AdminAudit`、`TenantAuditEvent` | `core.prisma:760,883`；`tenancy.prisma:83` | 🟢 **复用** |
| **Outcome** | `AnalyticsEvent`/`AnalyticsDailyAgg`（行为埋点，非业务成果） | `core.prisma:936,1522` | 🔴 **新增** |
| **计费** | `Subscription`、`Payment` | `core.prisma:819,854` | 🟡 **复用+扩展**（缺用量归集） |
| **多租户** | `Organization`、`Membership`、`TenantAuditEvent` + `src/lib/tenancy/*` | `tenancy.prisma:39,57,83` | ✅ **T01 已建** |

**前端现状**：`(dashboard)` 14 页 + `(admin)` 20 页，**全是 B2C 交友形态**（chats/explore/matches/profile/subscription）。
→ **T07 不是从零盖楼，而是要在既有 B2C IA 之外开出「组织级 Console」**，两者不能混在同一导航里。

**API 现状**：147 条路由；`match`/`consent` 已有通道，`mission`/`intent`/`outcome`/`proposal`/`bridge`/`agent` **零路由**。

---

## 3. 剩余任务卡片（T02–T12）

> 每张卡片：**目标 · 依赖 · 验收 · 交付物 · 主要风险**。验收列括号内为 `ACCEPTANCE_MATRIX.md` 编号。

### T02 · Mission Link — 连接任务与免安装分享  ✅ **已交付**
- **目标**：Mission CRUD（目标/Offer/约束/成功标准/截止/限额）+ 移动优先分享页 + 未注册可预览、敏感动作需身份验证。
- **依赖**：T01 ✅（`organizationId` 第一天就带上，不再走加列批次）
- **验收**：**AC-11**
- **交付**：`Mission` 模型 → `/api/v1/missions`（POST/GET/PATCH/pause，带 `Idempotency-Key`）→ `/m/[token]` 分享页 → 加入动作
- **风险**：🔴 分享页是**匿名可达面**，必须限流 + 最小披露；RLS 未上，隔离只能靠应用层
- **铁律**：**无候选时不得伪造候选**（PRD 明确）

> **交付记录**（代码 `49ee97d` · 2026-10-10）
> - **三表已上生产**：`Mission` / `MissionParticipation` / `IdempotencyRecord`（C0，纯新增，`verify` **25/25**，全库 48 张表）
> - **回滚已实测**：一条命令，本地演练 45 → 42 表、既有业务数据**零丢失**（`T02/rollback.md` §3）
> - **测试**：`tests/connection` **130/130** ｜全量 jest **502/502** ｜ `tsc` **0 错误** ｜ 门禁全绿（geo 69 / pusher 48 / oauth 21 / gender 37 / ice 42）
> - **AC-11 ✅ 通过**：移动端 E2E（真实 Chrome + Pixel 5）**8/8**，含**真实登录 → 真实加入 → 刷新幂等（名额 1/5）**
> - 文档：`docs/implementation/T02/{changes,tests,risks,rollback}.md`
> - 🔧 顺带修复：`verify` 的孤儿断言此前用**全表行数**冒充孤儿数（空库假绿 / 非空库假红）→ 已补 `where` 形参并做「注入孤儿 → 精确报出 → 清理复原」负向自证
> - ⚠️ **交接 T04**：`candidates: never[]` 是**编译期**铁律保证；T04 返回真实候选时**必须同批**改造投影 + 页面分支 + E2E 断言

### T03 · Intent / Member — 成员意图与逐字段披露
- **目标**：成员自主提交/编辑/撤销 Intent·Offer·约束·有效期；逐字段选择可见范围；数据最小化。
- **依赖**：T02（`mission_id` 外键）
- **验收**：**AC-03 / AC-12**
- **交付**：`SocialIntent` 模型（`need`/`offer`/`constraints`/`disclosure`/`expires_at`）→ `/api/v1/intents` CRUD + 撤销
- **风险**：🟡 `constraints`/`disclosure` 是 JSON 语义但现网只能存 `String`（libSQL 无 `jsonb`）→ **codec 必须单点统一**，否则出现「有的存字符串、有的存对象」的静默腐化（见 `T01/DIALECT-DIFF.md`）
- **铁律**：未授权字段**不得进入 API 响应、向量索引、Agent 上下文**（AC-03 是 BLOCKER）

### T04 · Reciprocal Match — 双向检索与可解释排序
- **目标**：硬门控（tenant/consent/block）→ 候选召回 → 互补分排序 → 输出理由与证据，不输出伪造概率。
- **依赖**：T03
- **验收**：**AC-13**
- **交付**：`/api/v1/connections/candidates`；召回/排序/解释三层分离
- **风险**：🔴 **pgvector 当前不可用**（libSQL）→ 一期只能「结构化过滤 + 关键词」，语义召回须等 **M6 迁 PG**；AC-13 的可复现性靠**固定测试集**兜底
- **铁律**：权限过滤必须在**召回与排序之前**，不是之后筛掉

### T05 · Consent & Trust — 双边同意、审批、撤销
- **目标**：提案双方分别 accept 才可介绍；reject 即关闭；revoke 取消待发并阻止后续动作。
- **依赖**：T04（提案实体）；`ConsentRequest`/`ConsentGrant` 可复用
- **验收**：**AC-04 / AC-05 / AC-06**
- **交付**：`ConnectionProposal` + `ProposalDecision` 模型；`/api/v1/connections/{id}/consent|revoke`
- **复用**：`ConsentRequest:648` / `ConsentGrant:685` / `/api/im/consent`
- **铁律**：单方同意**不得**触发介绍；**执行时**必须再校验一次授权与过期（AC-06 是 race condition 测试）

### T06 · Workflow Execution — 可靠介绍与跟进状态机
- **目标**：`Created → Discovering → Proposed → Consent Pending → Introduced → Coordinating → Action Completed → Outcome Recorded`
- **依赖**：T05
- **验收**：**AC-07 / AC-09 / AC-14 / AC-17**
- **交付**：outbox + 幂等键 + 重试 + 超时 + 死信 + 人工接管；邮件沙箱
- **待决策**：**DB 任务队列 vs Temporal**（战略方案给 Temporal，PRD 明确「早期一个可靠的数据库任务队列就足够」）
- **铁律**：故障注入下**无重复消息**；仅用官方授权渠道，禁止静默冒充真人

### T07 · SaaS Console — 社群经营工作台
- **目标**：Dashboard / Missions / Members / Connections / Agents / Outcomes / Settings 七屏，真实 API、无空按钮。
- **依赖**：T02/T03/T04/T08 的数据面（**壳可先行，数据后接**）
- **验收**：**AC-18**
- **交付**：在既有 `(dashboard)` 之外新增组织级 IA（建议 `/console/*`），复用现有布局与鉴权原语
- **风险**：🟡 与既有 B2C 页面**共存** → 必须做明确的「个人态 vs 组织态」导航分层，否则用户看不懂

### T08 · Outcome & Billing — 成果验证、成本归因、订阅
- **目标**：三级成果验证 + 漏斗/工时/成本 + 用量归集 + 支付沙箱。
- **依赖**：T05 / T06
- **验收**：**AC-15 / AC-16 / AC-21**
- **交付**：`Outcome`（`verification_level ∈ {self_reported, counterparty_confirmed, externally_verified}`）+ `UsageRecord` + Creem 接入
- **风险**：🔴 **Creem 凭据未提供（你已决定暂不提供）→ AC-21 只能标 `BLOCKED`，不得标 PASS**
- **铁律**：自报结果**不算**验证成功；指标必须可复算（SQL 对账）

### T09 · Agent Runtime — 结构化意图与沟通建议
- **目标**：LLM 输出 schema 校验 + 提示注入防御 + 人工批准节点 + 模型成本限额 + 失败降级。
- **依赖**：T03
- **验收**：**AC-08 / AC-20**
- **交付**：意图抽取 / 介绍草稿 / 协调建议 三类技能 + 成本归集
- **待决策**：🔴 **技术栈分叉**——战略方案给的是 **Python + LangGraph**，而现有仓是**纯 TypeScript**。引入第二语言运行时的运维代价需你拍板（替代方案：TS 内用既有编排原语实现，先不引 LangGraph）
- **铁律**：**LLM 不做最终权限判断**；Agent 不得自主发送高风险消息

### T10 · Community Bridge — 跨社群授权与连接
- **目标**：双群主合作协议 + 成员逐个 opt-in + 跨群最小披露 + 拒绝/撤销。
- **依赖**：T05 / T02
- **验收**：**AC-19**
- **交付**：`CommunityBridge`（可共享任务类型 / 可披露字段 / 有效期 / 撤销）+ 双边审批
- **铁律**：**无跨群默认共享**；不得直接查询对方私有行

### T11 · Open SDK — 标准互操作与开源准备
- **目标**：A2A / MCP 适配 + OpenAPI 固化 + SDK 示例 + 许可证审计。
- **依赖**：T04 / T05 的 API 面稳定后
- **验收**：**AC-22**
- **交付**：适配层 + 示例 + 贡献指南
- **铁律**：外部示例可运行；**越权必须失败**；开源仓**无凭据**

### T12 · Release E2E — 全链路验证与上线门禁
- **目标**：Playwright E2E + API + 权限 + 对抗 + 迁移 + 故障 + 负载 + 计费 + 回滚演练。
- **依赖**：全部
- **验收**：**AC-01 ~ AC-25** 逐条 PASS/FAIL/BLOCKED；另含 **AC-23 / AC-24 / AC-25**
- **交付**：`FINAL_ACCEPTANCE_REPORT.md`（含命令、日志位置、提交 SHA、风险、上线建议）
- **铁律**：**所有 BLOCKER 必须 PASS**；缺外部凭据的流程只能 `MOCKED`/`BLOCKED`

---

## 4. 批次编排（按依赖 + 战略方案 P0→P3）

```
批次 A ─ P0 核心闭环 ───────────────────────────── 串行，最关键路径
   T02 Mission Link ──▶ T03 Intent ──▶ T04 Match
                                            │
批次 B ─ P0 安全 / 执行 ──────────────────────┤
   T05 Consent ──▶ T06 Workflow              │
                     │                       │
批次 C ─ P0 商业 ────┴──▶ T08 Outcome/Billing ──▶ T07 Console
                                                    │
批次 D ─ P1 ────────────────────────────────────────┤
   T09 Agent Runtime  ‖  T10 Community Bridge       │
                                                    │
批次 E ─ P2 ────────────────────────────────────────┤
   T11 Open SDK                                     │
                                                    ▼
批次 F ─ 门禁 ────────────────────────────────  T12 Release E2E
```

**可并行点**：T07 的页面壳可与 T05/T06 并行（先接空态）；T09 与 T10 互不依赖，可并行。
**硬串行点**：T03 必须在 T02 之后（`mission_id` FK）；T04 必须在 T03 之后（无 Intent 无候选）；T12 必须最后。

**与战略方案 P0–P3 的一致性校验**：

| 战略方案阶段 | 对应任务 | 一致？ |
|---|---|---|
| P0 基础（多租户/身份/权限/成员数据） | T01 ✅ + T03 | ✅ |
| P0 核心（Mission/Intent/Matching） | T02 / T03 / T04 | ✅ |
| P0 安全（Consent/审批/审计） | T05 | ✅ |
| P0 执行（介绍与跟进工作流） | T06 | ✅ |
| P0 商业（Outcome/账单/用量） | T08 + T07 | ✅ |
| P1 Agent（意图提取/草稿/协调） | T09 | ✅ |
| P1 网络（Community Bridge） | T10 | ✅ |
| P2 生态（A2A/MCP/SDK） | T11 | ✅ |
| **P3 多模态（语音/视频 Twin）** | **无对应任务** | ⚠️ 见 §5-③ |

---

## 5. 缺口与冲突（两份文档对不上的地方）

① **AC-10（数据生命周期：导出/删除/缓存与索引与任务清理）在 T00–T12 中无人认领。**
主指令把它写成上线阻断条件，但 13 个任务卡里没有一条明确承接。**建议挂到 T05**（Trust 模块）作为子项，否则 T12 必然卡在「BLOCKER 无主」。

② **AC-25（真实付费试点）本质不是研发任务。** 需要真实客户与续费数据，代码侧只能产出「可复算的数据通道」，验收结论必然停留 `BLOCKED`。**不要为了凑绿而在 T12 虚报。**

③ **P3 多模态（语音/视频 Twin）无对应任务。** 现网已有 WebRTC + TURN（前序 P1-6 交付），可视作**已部分覆盖**；战略方案本就要求「文本闭环验证后再接入」。**判定：不单列任务，保持现状。**

④ **PostgreSQL 迁移是跨任务的前置底座，但没有独立立项。** 战略方案与交付包都指向 PG + pgvector，而现网是 libSQL/Turso。它同时卡住 **T04 的语义召回**和 **AC-01 的「DB 级隔离」证据**。已在 `T01/risks.md` 标为残留风险，**建议作为 M6 独立推进**，不要藏在 T04 里。

⑤ **工作流引擎选型两份文档不一致**（战略方案 → Temporal；PRD → 允许先用 DB 队列）。**T06 开工前必须先决策**，否则会做出无法复用的实现。

⑥ **Agent 运行时技术栈分叉**：战略方案 → Python + LangGraph；现有仓 → 纯 TS。**T09 开工前必须决策**（见 §6-⑥）。

---

## 6. 待决策清单（阻塞点）

| # | 决策项 | 阻塞 | 需要什么 |
|---|---|---|---|
| ① | 是否执行 **M5**（加 `NOT NULL` + FK + RLS） | 停机窗口 | 你的授权 + 维护时段 |
| ② | 是否现在做 **M6（迁 PostgreSQL）** | T04 语义召回、AC-01 硬证据 | PG 连接串 |
| ③ | 主键策略：保持 `cuid()` 还是改 `@db.Uuid` | 38 表回归范围 | 一次拍板 |
| ④ | T00/T01 提交**是否推送到公开仓库** | — | 你的决定（含生产迁移记录） |
| ⑤ | **T06 工作流引擎**：DB 队列 vs Temporal | T06 实现形态 | 一次拍板 |
| ⑥ | **T09 Agent 运行时**：TS 内编排 vs Python/LangGraph 独立服务 | T09 架构 | 一次拍板 |
| ⑦ | Creem 凭据是否提供 | AC-21 | 已决定暂不提供 → 保持 `BLOCKED` |

---

## 7. 下一个动作

**建议立即开工 T02（Mission Link）**，理由：
1. 它是 P0 核心闭环的第一个实体，`organizationId` 从第一天带上，无需再走加列批次；
2. 它是 T03/T04 的硬前置，越早开始关键路径越短；
3. 它的分享页会第一次暴露**匿名可达面**，正好把 T01 未能覆盖的 **HTTP 层 E2E 负测**补齐。

开工前无需等待任何决策项（①–⑦ 均不阻塞 T02）。

---
*本文件由 T00/T01 交付后盘点生成；每个任务收尾时回填提交 SHA 与 AC 结论。*
