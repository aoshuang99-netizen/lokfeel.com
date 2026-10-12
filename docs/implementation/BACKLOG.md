# LokFeel Connection OS — 剩余任务总盘（T05–T12）

> **用途**：把「交付包执行规范」与「SaaS 战略方案 V1.0」对齐成一份可执行的剩余任务清单。
> 后续每个任务开工前先读本文件对应卡片，收尾后回填提交 SHA 与 AC 结论。
>
> | 项 | 值 |
> |---|---|
> | 真实仓库基线 | `0414186`（`main`，**已推送 GitHub + 已发布 Netlify 生产**，部署 `6acc9c781f2e` ready；本批生产复验 **T07 19/19 · T06 25/25 · T04 19/19 · 窗口期 13/13**） |
> | 上一发布基线 | `233669e`（T05 + T06）—— 再往前 `0c95b89`（T04）；T05/T06 曾长期带跳过标记未发版，已于 `233669e` 补齐 |
> | 已交付 | **T00 审计**（`3faf1e9`）、**T01 多租户底座**（`c5828ba`）、**T02 Mission Link**（`49ee97d`）、**T03 Intent / Member**（`877878e`）、**T04 Reciprocal Match**（`e3bc161` + `b4125eb`）、**T05 Consent & Trust**、**T06 Workflow Execution**、**T06+ 死信告警 / AC-10 生命周期**、**T07 Console Slice 1**（以上均已上线） |
> | 剩余 | **T07–T12，共 6 个任务** |
> | 规范来源 | `lokfeel_workbuddy_v1/`：`WORKBUDDY_MASTER_PROMPT.md`（主指令）、`tasks/T02–T12`、`docs/ACCEPTANCE_MATRIX.md`（AC-01~25）、`contracts/schema.sql`、`contracts/connection.openapi.yaml` |
> | 规划背景 | 《LokFeel SaaS 核心功能架构与开源技术集成方案 V1.0》：10 大模块 / 6 个自研引擎 / P0–P3 / 12 项 Codex 实施清单 |

---

## 1. 三源对齐：两套清单其实是同一件事

战略方案的「12 项 Codex 实施顺序」与交付包的 `T00–T12` **逐条一一对应**，不存在两套并行的路线。这意味着可以放心以交付包的任务卡为执行单位，同时用战略方案校验「是否偏离产品定位」。

| # | 战略方案 12 项清单 | 交付包任务 | 对应模块 | 状态 |
|---|---|---|---|---|
| 1 | 审计现有仓库与数据库，生成复用矩阵 | **T00** | — | ✅ 完成 |
| 2 | 建立 SaaS 多租户与角色权限 | **T01** | 09 Trust | ✅ 完成 |
| 3 | 实现 Mission / Intent / Offer 领域模型 | **T02 + T03** | 01 Mission Studio · 02 Member Intel | ✅ T02 ✅ / T03 ✅ |
| 4 | 实现双向匹配与候选解释 | **T04** | 03 Connection Engine | ✅ 完成 |
| 5 | 实现 Consent / Approval / Revocation | **T05** | 09 Trust | ✅ 完成 |
| 6 | 实现介绍工作流与任务恢复 | **T06** | 07 Workflow · 06 Comm Hub | ✅ 完成 |
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

## 3. 任务卡片（T05–T12；已交付的 T02/T03/T04 保留交付记录）

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

### T03 · Intent / Member — 成员意图与逐字段披露  ✅ **已交付**
- **目标**：成员自主提交/编辑/撤销 Intent·Offer·约束·有效期；逐字段选择可见范围；数据最小化。
- **依赖**：T02（`mission_id` 外键）
- **验收**：**AC-03 / AC-12**
- **交付**：`SocialIntent` 模型（`need`/`offer`/`constraints`/`disclosure`/`expires_at`）→ `/api/v1/intents` CRUD + 撤销
- **风险**：🟡 `constraints`/`disclosure` 是 JSON 语义但现网只能存 `String`（libSQL 无 `jsonb`）→ **codec 必须单点统一**，否则出现「有的存字符串、有的存对象」的静默腐化（见 `T01/DIALECT-DIFF.md`）
- **铁律**：未授权字段**不得进入 API 响应、向量索引、Agent 上下文**（AC-03 是 BLOCKER）

> **交付记录**（代码 `877878e` · 2026-10-10）
> - **表已上生产**：`SocialIntent`（C1 批次，纯新增，`verify` **42/42**，全库 49 张表，既有 48 表零列改动）
> - **回滚已实测**：本地副本 `rollback --batch=C1` → `verify` 25/35 `exit=1` → 业务数据**零丢失** → 重新 apply 复原 42/42（`T03/rollback.md` §3）
> - **测试**：`tests/connection` **241/241**（T02 130 + T03 111）｜全量 jest **620/620** ｜ `tsc` **0 错误** ｜ 门禁全绿（geo 69 / bot 111 / pusher 48 / oauth 21 / gender 37 / ice 42）
> - **AC-12 ✅ 通过**：移动端 E2E 真实登录 → 加入 → 提交 → 预览 → 编辑 → 撤销（含"刷新后输入框仍是改后正文"证真实落库）
> - **AC-03 ✅ 通过（限"API 响应"这条下游）**：白名单投影让未授权字段的**键不存在**；受保护字段（`email`）结构性不可授权/不可导入；**另两条下游（向量索引、Agent 上下文）在 T03 无落点**，已登记 R1 交接 T04/T09
> - 文档：`docs/implementation/T03/{changes,tests,risks,rollback}.md` ｜报告：`LokFeel-T03-IntentMember-2026-10-10.html`
> - 🔧 顺带修复：`stableStringify` 把 `Date` 序列化成 `{}`（幂等误判重放）；**`public/sw.js` 缓存所有 `/api/`**（写完读到旧值 + 个人数据落盘，反向则"放开授权后界面不更新"）
> - ⚠️ **交接 T04**：`discloseSubject()` 是**披露的唯一出口**；T04 若新增候选/档案输出通道，**必须经它投影**，不得自己拼对象。R1/R2 必读。

### T04 · Reciprocal Match — 双向检索与可解释排序  ✅ **已交付**
- **目标**：硬门控（tenant/consent/block）→ 候选召回 → 互补分排序 → 输出理由与证据，不输出伪造概率。
- **依赖**：T03 ✅
- **验收**：**AC-13**
- **交付**：`/api/v1/connections/candidates`；召回/排序/解释三层分离
- **风险**：🔴 **pgvector 当前不可用**（libSQL）→ 一期只能「结构化过滤 + 关键词」，语义召回须等 **M6 迁 PG**；AC-13 的可复现性靠**固定测试集**兜底
- **铁律**：权限过滤必须在**召回与排序之前**，不是之后筛掉

> **交付记录**（第一刀内核 `e3bc161` · 第二刀装配与档位 `b4125eb` · 2026-10-10）
>
> **决策（用户选定 A）**：引入更窄的 `CANDIDATE` 披露档位（`SELF < ORGANIZER < COUNTERPARTY < CANDIDATE`），
> 默认 `SELF`、成员逐字段主动开启；召回走**结构化路径**，语义召回留待 M6 迁 PG。
>
> - **零 DDL 已实测**：新增枚举成员**不产生任何 schema 差异** ——
>   `prisma migrate diff --from-schema <T04 前> --to-schema prisma/schema --script --exit-code` → **exit 0**，
>   输出全文仅 `-- This is an empty migration.`；**负向对照** `--to-empty` → exit 2 / 229 行 / 46 条 DROP，
>   证明该检查**不是恒真空跑**。因此**无需迁移脚本，也无需回滚脚本**。
> - **🔴 档位次序的推导结论（最容易搞反的一处）**：记 `C` = 已同意对手方集合，`P` = 同任务互补伙伴集合，
>   则 **`C ⊆ P`** → "给已同意者看" ⊂ "给伙伴看" → **`CANDIDATE` 比 `COUNTERPARTY` 更宽，必须追加在末尾**。
>   写反会让**尚未同意的人**看到用户只授权给已同意对手方的字段（静默越权披露）。
>   已用三层锁死：真相表注释 + `field-catalog.test.ts` 次序不变量断言 + `candidates.test.ts` **变异自证**。
> - **测试**：`tests/connection` **290/290**（T03 286 → 本刀 +4）｜全量 jest **669/669** ｜ `tsc` **0 错误** ｜
>   ESLint（T04 面）0 error 0 warning ｜ `check:script-decls` 45 脚本全通过
> - **AC-13 ✅ 通过**：移动端 E2E（真实 Chrome + Pixel 5）**3/3** ——
>   匿名重定向；候选页渲染（依据含命中原词、双向互补正文、无横向滚动）；🔒 页面与 API **双重值级扫描**
> - **AC-03 ✅ 新通道合规**：T03 交接的「新通道必须经唯一出口」已兑现 ——
>   内核**删除** `subject` 占位并**去掉行类型泛型**，投影唯一发生在 `candidates.ts` 的 `discloseSubject(..., 'CANDIDATE')`
> - **交付物**：`src/lib/connection/candidates.ts`（新）· `/api/v1/connections/candidates`（新）·
>   `/m/[token]/matches`（新，纯 RSC）· `scripts/qa/seed-t04-e2e.mjs`（新夹具，**追加式**不污染 T02/T03）
> - 文档：`docs/implementation/T04/{changes,tests,risks,rollback}.md` ｜报告：`LokFeel-ConnectionOS-T04双向匹配-2026-10-10.html`
> - 🔧 顺带修复：`recall.ts` 删除死泛型参数 `R`（`subject` 占位删除后已无引用，且它会留下"把行里字段塞进候选"的类型便道）；
>   `DisclosureSummary.byAudience` 键集补齐为三键
> - ⚠️ **交接 T05**：候选页**刻意不放**"建立连接"按钮（双边同意属 T05）；被门控行**只给原因码与计数**，
>   不得为了"解释得更清楚"而回填对方内容。`consent`/`revoke` 执行时**必须**再过一次 `discloseSubject()`。
> - ⚠️ **交接 T09**：AC-03 的另两条下游（向量索引、Agent 上下文）在 T09 有落点，注入前**必须**经同一出口。
> - ⚠️ **交接 T12**：`AUDIENCE_OPTIONS` 与意图表单的「诉求正文可见性声明」目前靠文件头注释约束；
>   建议在端到端门禁里加断言（删掉那句声明不会让任何现有测试变红）。

### T05 · Consent & Trust — 双边同意、审批、撤销
- **目标**：提案双方分别 accept 才可介绍；reject 即关闭；revoke 取消待发并阻止后续动作。
- **依赖**：T04（提案实体）；`ConsentRequest`/`ConsentGrant` 可复用
- **验收**：**AC-04 / AC-05 / AC-06**
- **交付**：`ConnectionProposal` + `ProposalDecision` 模型；`/api/v1/connections/{id}/consent|revoke`
- **复用**：`ConsentRequest:648` / `ConsentGrant:685` / `/api/im/consent`
- **铁律**：单方同意**不得**触发介绍；**执行时**必须再校验一次授权与过期（AC-06 是 race condition 测试）

> **交付记录**（本刀 `75897d3` · 2026-10-11 · 分支 `main`）
>
> **三条 AC 全部通过**：AC-04 单方同意不介绍 ✅ ｜ AC-05 拒绝与撤销 ✅ ｜ AC-06 执行时校验（CAS）✅
>
> - **门禁**：`tsc --noEmit` **0 错误** ｜ `jest tests/connection` **373/373**（T04 290 → 本刀 **+83**：纯内核/服务层 49 + HTTP 层 34）｜
>   `jest`（全量）**752/752**（T04 669 → +83）｜ ESLint（T05 面）**0 error / 0 warning** ｜ `check:script-decls` **49 脚本**通过
> - **AC-04 ✅**：`CONSENT_PENDING` **跨越第一次 accept**；只有双方均已同意（`MUTUALLY_ACCEPTED`）才可介绍。
>   状态机抽成**纯函数内核**（`resolveStatusAfterDecision()` 等）—— 12 个 0.3 秒的断言，且**任何调用方都绕不过它**。
> - **AC-05 ✅**：REJECT / REVOKE 立即终态并写 `closedAt`；终态后**任何**表态一律 **409**（**不是**幂等成功）。
>   🔧 本刀修掉一处装配缺陷：同意过之后**只保留「撤回」**（原同时给「拒绝」+「撤回」→ 不同决策记录、相同终态，审计被覆盖）。
> - **AC-06 ✅（race condition 落点）**：介绍是唯一**执行点**，在执行那一刻重查①提案仍 `MUTUALLY_ACCEPTED`/未过期/未介绍 ②双方 `SocialIntent` 仍 `ACTIVE`；
>   用 `updateMany({ introducedAt: null, status: 'MUTUALLY_ACCEPTED' })` 做 **CAS 写入** —— "先查再写"在并发下会双写，条件更新不会。
> - **移动端 E2E（真实 Chrome + Pixel 5）7/7**：匿名重定向 ｜ 分区渲染（文案不把「双方同意」说成「已连接」）｜
>   单方同意仍待决 ｜ 双方同意仍非连接 ｜ 运营介绍 200 + 重复介绍 409 ｜ 拒绝/撤回进终态 ｜ 档位随阶段升级（含值级扫描）。
> - **T04 回归 15/15（独立复验）**：T05 改动的 ④ 三条断言（`matches-connect-note` / `matches-view-proposals` 可见、`propose-open` 不存在）全部成立。
>   ⚠️ `candidate-match.spec.ts` 的 **UI 登录腿**在本机 dev 下不稳（登录页受控组件 hydration 竞态）→ 新增
>   `scripts/qa/verify-t04-candidate-regress.mjs`（用 `ctx.request` 登录）作为**可复跑**的等价取证。
> - **迁移 C2（纯新增）**：`ConnectionProposal` + `ProposalDecision`（2 表 + 10 索引，**无** ALTER/DROP/数据订正）→ 迁移与回滚**零停机**。
>   ✅ **生产库已应用**（2026-10-12，`apply --batch=C2 --yes`）—— 与 C3 同批上线；迁移前后快照对照「既有表行数全部未变」。回滚演练见 `T05/rollback.md`。
> - **交付物**：`src/lib/connection/proposals.ts`（纯内核 + 服务层，新）· `proposal-input.ts`（新）·
>   `/api/v1/connections/{proposals, introductions}` 与 `/api/v1/connections/{connectionId}/{consent,revoke,introduce}`（新）·
>   `/m/[token]/proposals`（新，三分区）· `matches` 页接入「我的连接」+ 运营「发起连接」·
>   `scripts/qa/seed-t05-e2e.mjs`（新夹具，**独立 Mission** `mission_e2e_t05`）
> - 文档：`docs/implementation/T05/{changes,tests,risks,rollback}.md` ｜ 报告：`LokFeel-T05-ConsentTrust-2026-10-11.html`
> - 🔧 顺带修复：`proposal-actions.tsx` / `propose-button.tsx` 的 `window.location.href = …` → `router.push()`（消 `react-hooks/immutability` **error** 与 no-location-assign **warning**）
> - ⚠️ **交接 T06**：T06 的投递钩子**必须原样调用** `introduceConnection()`（AC-06 的两段校验 + CAS 已封好），**不得另写一份校验** —— 那正是 AC-06 最容易被绕开的路径。`introduce` **刻意不带幂等键**（重复调用 409 是正确结果）。
> - ⚠️ **交接 T12**：把 E2E 登录统一切到 `ctx.request` 手法（消除登录页与本用例无关的抖动）；
>   `T05/tests.md` §7.3 的判据原则（**断言"刷新后仍成立的"而非"用户能看到的"**）应写进端到端门禁规范。

### T06 · Workflow Execution — 可靠介绍与跟进状态机 ✅ 完成
- **目标**：`Created → Discovering → Proposed → Consent Pending → Introduced → Coordinating → Action Completed → Outcome Recorded`
- **依赖**：T05
- **验收**：**AC-07 / AC-09 / AC-14 / AC-17**
- **交付**：outbox + 幂等键 + 重试 + 超时 + 死信 + 人工接管；邮件沙箱
- **待决策**：~~**DB 任务队列 vs Temporal**~~ → **已拍板：DB outbox**（Temporal 需常驻进程，Netlify 免费计划无此能力）。消息通道 = **站内信 + 邮件沙箱**
- **铁律**：故障注入下**无重复消息**；仅用官方授权渠道，禁止静默冒充真人

> **交付记录**
> - 提交：`165ccf7`（`feat(t06): 可靠介绍与跟进状态机 —— outbox 引擎、统一投递出口与运营视图`，含 `[skip netlify]`）
> - 文档：`docs/implementation/T06/{changes,tests,risks,rollback}.md`
> - 迁移：**C3 批次**（`WorkflowJob` / `NotificationDelivery` / `IntroductionWorkflow`；纯新增，无 ALTER/DROP）
>   ✅ **生产库已应用**（2026-10-12，与 C2 同批）：`verify` **107/107** 全绿（含软引用反向断言）；
>   迁移前后快照 `User` 12922 / `Profile` 11887 行数未变 → **零影响**
> - **发版**：**`233669e`** —— `chore(release): 发布 T05 双边同意 + T06 工作流状态机 —— 生产迁移 C2/C3 已应用`。
>   本次打破 T02 以来的 `[skip netlify]` 惯例，推**不带跳过标记**的发布提交（C2 + C3 应用到生产后才发版），
>   把积压的 T05 + T06 一起带上生产。部署 `6acc86bb3a0a` 于 2026-10-12 15:07 (CST) `ready`。
>   发版后复验：`verify-t06-prod` **25/25**（含带真实 `CRON_SECRET` 在生产实跑驱动器 → 200 + tick 结构化摘要）、
>   `verify-t04-prod` **19/19**、`verify-public-origin` **13/13（窗口期内，0 泄漏）**。
>   🟡 **发现既有环境缺口**：生产库里**不存在** `qa.male@ / qa.female@lokfeel.com`（`probe-qa-login.mjs` 直连比对确认），
>   因此 `verify-login-realpath` 12 项失败属**本刀之前就存在**的取证盲区（同源守卫未 403、cookie host 断言反而通过，
>   非发布窗口期故障）。修复 = 重跑 `scripts/qa/create-qa-accounts.mjs`（需单独授权，会向生产写 2 个测试用户）。
> - 代码：`src/lib/workflow/`（8 文件 / 2731 行）、5 个 API 端点、4 个 T05 路由接钩子、能力矩阵 +2
> - 测试：`tests/workflow/`（8 套 / **169 用例**）+ `tests/e2e/workflow-execution.spec.ts`（AC-07/09/14/17 故障注入）
> - 门禁：`tsc --noEmit` **0 error**；`jest tests/workflow tests/connection tests/tenancy` 全绿；`eslint` 0 error / 0 warning；`check:script-decls` ✅；`connection:migrate verify` **107 项** ✅
>   （注：早前记的「108 项」是把脚本末尾的 `✅ 全部通过` 汇总行也数进去了 —— 脚本自报 `107/107`，以脚本为准）
> - 结论：**AC-07 / AC-09 / AC-14 / AC-17 全部 PASS**。真实邮件外发 = `BLOCKED`（缺 `RESEND_API_KEY`，用户明确排除；接上 key 后 `CAPTURED` 自动变 `SENT`，零代码改动）
> - 交接 T07/T08：① 阶段机的 `ACTION_COMPLETED` / `OUTCOME_RECORDED` **尚无自动触发点**，等 T08 的"成果记录"入口；
>   ② 运营视图 API（`/api/v1/workflow/*`）已就绪，T07 的 Console 可直接消费；
>   ③ 死信**无主动告警推送**（只有 `needsAttention` 列表 + 审计事件），若需要应由 T07 接一个告警任务（见 T06 `risks.md` R9）。


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
| P0 基础（多租户/身份/权限/成员数据） | T01 ✅ + T03 ✅ | ✅ |
| P0 核心（Mission/Intent/Matching） | T02 ✅ / T03 ✅ / T04 ✅ | 🟢 闭环 |
| P0 安全（Consent/审批/审计） | **T05 ✅** | ✅ |
| P0 执行（介绍与跟进工作流） | **T06 ✅** | ✅ |
| P0 商业（Outcome/账单/用量） | T08 + T07 | ✅ |
| P1 Agent（意图提取/草稿/协调） | T09 | ✅ |
| P1 网络（Community Bridge） | T10 | ✅ |
| P2 生态（A2A/MCP/SDK） | T11 | ✅ |
| **P3 多模态（语音/视频 Twin）** | **无对应任务** | ⚠️ 见 §5-③ |

---

## 5. 缺口与冲突（两份文档对不上的地方）

① **AC-10（数据生命周期：导出/删除/缓存与索引与任务清理）在 T00–T12 中无人认领。**
主指令把它写成上线阻断条件，但 13 个任务卡里没有一条明确承接。**建议挂到 T05**（Trust 模块）作为子项，否则 T12 必然卡在「BLOCKER 无主」。
   > **T05 交付后的更新（⚠️ 仍未闭合）**：T05 **只认领了"满足阻断条件所需的那一小步"**，
   > 并**主动记下了它与 AC-10 取向不一致的地方** ——
   > `ProposalDecision` 是"**当前**表态"（`upsert` 覆盖）而非追加式流水；
   > `writeTenantAudit(...)` 带 `.catch(() => {})`，即**审计写入失败不影响业务**。
   > 这与 AC-10 的"不可抵赖"取向相反，已在 `T05/risks.md` **R7** 记为需在合规评审时
   > 改为「事务内写入 + 追加式决策表」的待消解项。
   > **"导出 / 删除 / 缓存与索引清理"三条仍未认领** → 仍须在 T12 之前明确归属，不要因为
   > T05 打了勾就当作 AC-10 已闭合。
   > **2026-10-12 更新（部分认领，⚠️ 仍未闭合）**：新增 `docs/implementation/LIFECYCLE.md`，
   > 认领了「**任务清理 + 通知保留期**」这一支 —— `src/lib/lifecycle/{policy,sweep}.ts`
   > （纯函数判定 + 受限批量删除）+ `/api/cron/lifecycle-sweep` + CLI + **自证夹具** + 13 单测。
   > T06 新增的两张只增不减的表（`WorkflowJob` / `NotificationDelivery`）自此有了保留策略。
   > ❌ **「导出」与「删除请求」两个入口仍未实现**；「缓存/索引清理」待 M6 迁 PG+pgvector 后重新评估。
   > ⇒ **AC-10 仍是未闭合项**，只是从"整条无主"变成"一支已认领"。

② **AC-25（真实付费试点）本质不是研发任务。** 需要真实客户与续费数据，代码侧只能产出「可复算的数据通道」，验收结论必然停留 `BLOCKED`。**不要为了凑绿而在 T12 虚报。**

③ **P3 多模态（语音/视频 Twin）无对应任务。** 现网已有 WebRTC + TURN（前序 P1-6 交付），可视作**已部分覆盖**；战略方案本就要求「文本闭环验证后再接入」。**判定：不单列任务，保持现状。**

④ **PostgreSQL 迁移是跨任务的前置底座，但没有独立立项。** 战略方案与交付包都指向 PG + pgvector，而现网是 libSQL/Turso。它同时卡住 **T04 的语义召回**和 **AC-01 的「DB 级隔离」证据**。已在 `T01/risks.md` 标为残留风险，**建议作为 M6 独立推进**，不要藏在 T04 里。
   > **T04 交付后的更新**：T04 已用「结构化过滤 + 词元互补」交付 AC-13（用户确认的过渡方向），
   > 因此 **M6 不再阻塞 T04**，但它仍是 **T04/risks.md R1（语义召回）** 与 **R2（DB 级隔离）** 的唯一消解路径。

⑤ **工作流引擎选型两份文档不一致**（战略方案 → Temporal；PRD → 允许先用 DB 队列）。~~T06 开工前必须先决策~~
   > **T06 已拍板（开工前）**：选 **DB outbox**。判据是**平台约束而非偏好** —— Temporal 需要常驻进程，
   > 而 Netlify 免费计划的函数是临时的（无长驻 worker）；且 PRD 明确"早期一个可靠的数据库任务队列就足够"。
   > 替换点已隔离在 `src/lib/workflow/runtime.ts` 的驱动器接口，日后若要换引擎不必动业务层。
   > 消息通道同批拍板为 **站内信 + 邮件沙箱**。

⑥ **Agent 运行时技术栈分叉**：战略方案 → Python + LangGraph；现有仓 → 纯 TS。**T09 开工前必须决策**（见 §6-⑥）。

---

## 6. 待决策清单（阻塞点）

| # | 决策项 | 阻塞 | 需要什么 |
|---|---|---|---|
| ① | 是否执行 **M5**（加 `NOT NULL` + FK + RLS） | 停机窗口 | 你的授权 + 维护时段 |
| ② | 是否现在做 **M6（迁 PostgreSQL）** | 语义召回（T04/R1）、AC-01 硬证据 | PG 连接串 |
| ③ | 主键策略：保持 `cuid()` 还是改 `@db.Uuid` | 38 表回归范围 | 一次拍板 |
| ④ | T00–T04 提交**是否推送到公开仓库** | — | 你的决定（含生产迁移记录与披露模型） |
| ⑤ | ~~**T06 工作流引擎**：DB 队列 vs Temporal~~ | — | ✅ 已拍板：**DB outbox**（见 §5-⑤ 更新） |
| ⑥ | **T09 Agent 运行时**：TS 内编排 vs Python/LangGraph 独立服务 | T09 架构 | 一次拍板 |
| ⑦ | Creem 凭据是否提供 | AC-21 | 已决定暂不提供 → 保持 `BLOCKED` |

---

## 7. 下一个动作

**T06 已交付并上线 → T07 Slice 1 已上线（`0414186`）**；T07 后续 Slice 与 T08 待开工。

> 🟡 **三个待拍板项仍未定**（都不阻塞当前主线）：① AC-10 自动清理是否开启（`LIFECYCLE.md` §4.4）；
> ② 分钟级调度走哪条路（`SCHEDULING.md`，涉及 CI 额度成本）；③ T09 Agent 运行时选型。

理由：

1. **T06 把"流程"接上了**：提案 → 双方同意 → 介绍 → 跟进 现在有可靠的 outbox 驱动、
   幂等键、重试/死信/人工接管；运营视图 API（`/api/v1/workflow/*`）已就绪，
   但**只有 API，没有界面** —— T07 的 Console 是最自然的消费方（`needsAttention` /
   `stalled` 正好是"运营待办"列表的数据源）。
2. **T08 是 T06 的下游闭环**：阶段机的 `ACTION_COMPLETED` / `OUTCOME_RECORDED`
   目前**没有自动触发点** —— 它们等的是 T08 的"成果记录"入口。两个任务都可先做，
   但 **T08 会让 T06 的阶段机真正完整**。
3. **决策点仍然到期的是 §6-⑥**（T09 Agent 运行时技术栈：TS 内编排 vs Python/LangGraph）——
   那是 T09 开工前的阻塞项，**不**影响 T07/T08。

**T07 开工前必读**：
- `T06/changes.md` §2.5（运营视图的四个面：计数 / 需人处置 / 停滞 / 投递计数）与
  `T06/risks.md` **R9**（死信**无主动告警推送** —— 若 Console 想要"红点"，
  需要一个告警任务，且要小心"用通知管道通知自己"的回路）。

**T08 开工前必读**：
- `T06/changes.md` §4.2（失败三分法）与 `T06/risks.md` **R7**（阶段超时只可见、不自动推进）；
- `T05/changes.md` §3.6（`introduce` 刻意不带幂等键的语义）。

> ✅ **2026-10-12 已部分认领**：AC-10 的「任务清理 + 通知保留期」一支落到
> `docs/implementation/LIFECYCLE.md`（`src/lib/lifecycle/*` + cron 端点 + 自证夹具 + 13 单测）。
> T06 新增的 `WorkflowJob` / `NotificationDelivery` 自此有保留策略（终态任务 90 天 /
> 证据 730 天 / 僵死 PENDING 7 天 / 已读站内信 60 天）。
> 🔴 清理作业**默认不随 cron 自动跑**（删除不可逆，需运营方显式开启；开启方式见
> `LIFECYCLE.md` §4.4，当前生产命中 0）。
> ❌ **「导出」与「删除请求」仍未实现** → **AC-10 仍未闭合**，T12 前必须补齐，否则仍会卡在
> 「BLOCKER 无主」。另见 §5-① 的完整交代。

**2026-10-12 · T07 开工（Slice 1）**：新增组织态 IA `/console/*`
（`docs/implementation/T07/plan.md`）—— 骨架 + 无组织说明页 + Dashboard（消费
`/api/v1/workflow/overview` 的真实数据）+ 个人态侧边栏入口。
**AC-18 未认领**（七屏未齐，导航里未实现的入口渲染为不可点的"施工中"而非死链）。

**2026-10-12 · T07 Slice 1 + T06+ 已发版** —— 发布提交 `0414186`（正文**不带**
跳过标记），Netlify 部署 `6acc9c781f2e` **ready**，一次性把积压的 T06+（死信告警 /
AC-10 生命周期 / 调度方案）与 T07 Slice 1 一起上线（**无 schema 变更**，
C2/C3 已在 `233669e` 应用到生产）。
生产复验：`verify:t07:prod` **19/19** · `verify:t06:prod` **25/25** · `verify:t04:prod` 19/19 ·
窗口期 `verify-public-origin` **13/13**（0 泄漏）。
🔴 AC-10 端点**已上线但默认只统计**：生产 dry-run `scanned/match/purged` 全 0；
`cron-runner.ts` 里该路径保持注释、GH Actions 步骤带 `?dry=1` —— 自动清理需运营方**显式开启**（`LIFECYCLE.md` §4.4）。

**R8（调度粒度）**：给出三条路与成本对比（`docs/implementation/SCHEDULING.md`
+ `.github/workflows/scheduler.yml`，**默认未开启定时** —— 是否用掉 GitHub Actions
免费额度属成本决策）。

---

## 8. 已交付任务的验证口径（可复跑）

| 任务 | 类型检查 | 单测 | 门禁 | E2E |
|---|---|---|---|---|
| T02 | `tsc` 0 错误 | `tests/connection` 130 · 全量 502 | 全绿 | 移动端 8/8（真实 Chrome） |
| T03 | `tsc` 0 错误 | `tests/connection` 241 · 全量 620 | 全绿 | 移动端 AC-12 + AC-03 |
| T04 | `tsc` 0 错误（4m22s） | `tests/connection` **290** · 全量 **669** | `check:script-decls` 45 通过 · ESLint 0/0 | 移动端候选页 **3/3** · 生产复验 **19/19**（`verify-t04-prod.mjs`） |
| T05 | `tsc` 0 错误 | `tests/connection` **373** | ESLint 0/0 | 移动端 AC-04/05/06（`consent-trust.spec.ts`） |
| T06 | `tsc` 0 错误（9m20s） | `tests/workflow` **169** · 全量 **921** · `tests/connection` 373 · `tests/tenancy` 49 | `check:script-decls` 50 通过 · ESLint 0/0 · `connection:migrate verify` 108 项 | API 级 **8/8**（`workflow-execution.spec.ts`，含故障注入；**可重复执行**） |
| T06+ · 邮件通道就绪度 | — | — | `npm run verify:email:channel`（凭据分类 + **契约漂移检查**） | 真实外发仍 **BLOCKED**（无 `RESEND_API_KEY`） |
| T06+ · 死信主动告警（R9） | `tsc` | `tests/workflow/alerts.test.ts` **11** | ESLint 0/0 | 防回路断言：告警**不产生 WorkflowJob** |
| T06+ · AC-10 生命周期清理 | `tsc` | `tests/lifecycle` **13** | ESLint 0/0 | **自证夹具**：`seed-lifecycle-e2e.mjs` + `lifecycle-sweep.mjs`（dry-run 命中 1/2/1 = 期望；apply 后复跑 0；`PENDING` 与未读项存活） |
| T07 · Console Slice 1 | `tsc` 0 错误 | — | ESLint 0/0 · `check:script-decls` 57 通过 | 生产复验 **19/19**（`verify-t07-prod.mjs`：`/console` 匿名 307 跳登录、lifecycle 端点 dry 只统计、0 泄漏）；AC-18 **未认领** |

> **T04 的零 DDL 结论可用一条命令复核**（Prisma 7 参数为 `--from-schema/--to-schema`）：
> ```bash
> npx prisma migrate diff --from-schema <T04 前的 schema 快照> --to-schema prisma/schema \
>   --script --exit-code          # → exit 0（空差异）
> npx prisma migrate diff --from-schema <同上> --to-empty --script --exit-code
>                                 # → exit 2（负向对照，证明检查非恒真）
> ```
> 详见 `T04/rollback.md` §1。

---
*本文件由 T00/T01 交付后盘点生成；每个任务收尾时回填提交 SHA 与 AC 结论。*
*最近回填：T02（`49ee97d`）、T03（`877878e`）、T04（`e3bc161` + `b4125eb`）、T05、T06 · 2026-10-12*
