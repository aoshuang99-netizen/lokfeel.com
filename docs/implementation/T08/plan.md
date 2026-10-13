# T08 · Outcome & Billing — 成果验证、成本归因与订阅（开工方案）

> **状态**：🚧 **开工中（Slice 1 / Slice 2 已落地，均未发版）**。本文件是设计 + 切片计划 + 验收口径。
> **基线**：`95da9f1`（`main`，已发布 Netlify 生产，部署 `6accc4170828` ready @ 2026-10-12T11:27:19Z）。
> **AC-21 从开工起就是 `BLOCKED`** —— Creem 凭据缺失（用户已决定暂不提供）。
> 本文件把「沙箱能做到什么」与「只有真凭据才能做到什么」分开写，**不把沙箱结果冒充 PASS**。

## 0. 任务定义（来自 BACKLOG + 交付包 `tasks/T08_OUTCOME_BILLING.md`）

| 项 | 内容 |
|---|---|
| 目标 | 三级成果验证 + 漏斗/工时/成本 + 用量归集 + 支付沙箱 |
| 依赖 | **T05 / T06**（提案与阶段机是成果的挂载点） |
| 验收 | **AC-15**（Outcome 真实性：自报与双方确认分开，不把系统猜测计为已验证）· **AC-16**（商业指标：任务成本/人工工时/介绍漏斗**可复算**）· **AC-21**（账单：使用量可复算，退款/失败/升级/降级状态一致） |
| 交付 | `Outcome`（`verification_level ∈ {self_reported, counterparty_confirmed, externally_verified}`）+ `UsageRecord` + Creem 接入 |
| 风险 | 🔴 **Creem 凭据未提供 → AC-21 只能标 `BLOCKED`，不得标 PASS** |
| 铁律 | ① **自报结果不算验证成功**；② **指标必须可复算（SQL 对账）**；③ 权限只在服务端判定；④ 租户谓词不可省 |

**开工前必读（BACKLOG §7 指定）**：
- `T06/changes.md` §4.2（**失败三分法**：`retryable` / `permanent` / `superseded`）—— 成果链路也会失败，必须沿用同一分类，不另造一套；
- `T06/risks.md` **R7**（阶段超时只可见、**不自动推进**）—— 成果记录**不得**变成"到点自动打勾"的第二个超时器；
- `T05/changes.md` §3.6（`introduce` **刻意不带幂等键**：重复调用回 409 是正确结果）—— 成果上报同理，"再上报一次"要看语义，而不是无脑回放。

---

## 1. 🔴 最关键的取舍：「计费域」是新建还是复用

这是 T08 唯一会**污染既有生产语义**的地方，先定它。

### 现状（T00 审计 + 本轮勘察）

| 资产 | 位置 | 语义 |
|---|---|---|
| `Subscription` | `core.prisma:835` | `userId` + `SubscriptionPlan` + **Stripe** 字段 + `weeklyMatchLimit`/`canInitiateChat` |
| `Payment` | `core.prisma:870` | `userId` + **`stripePaymentIntentId`** + `amount`(USD) |
| `AnalyticsEvent` / `AnalyticsDailyAgg` | `core.prisma:952 / 1538` | **行为埋点**（`swipe.right` 之类），不是业务成果 |

三者都是**个人 B2C** 语义（"我的会员""我的付费"）。而 T08 要的是**组织级用量计费**：
"这个社群这个月用了多少介绍额度、产生了多少成本"。

### 决策

**新建独立的组织级计费域，不复用 `Subscription` / `Payment`。**

| | 既有（不动） | T08 新增 |
|---|---|---|
| 归属 | `userId`（个人） | **`organizationId`**（租户） |
| 网关 | Stripe | **Creem**（沙箱） |
| 状态机 | `ACTIVE`/`CANCELLED`… | `PENDING → SUCCEEDED / FAILED / REFUNDED`（**事件溯源**） |
| 单位 | 会员权益（能不能发起聊天） | **用量**（介绍次数 / 成果数 / 存储） |

**不复用的三条理由**：
1. **语义不同**：把"社群订阅"塞进 `Subscription` 会让"这个用户是不是会员"这条既有查询**悄悄包含社群订阅**，这是最典型的污染方式；
2. **网关不同**：`Subscription` 的 `stripeCustomerId`/`stripePriceId` 是 `@unique` 列，混入 Creem 数据会迫使写空值，此后无法区分"没订阅"与"非 Stripe 订阅"；
3. **可回滚性**：独立域意味着 T08 的全部 schema 可以整批 `rollback`（`migrate.mjs` 逆序 DROP），不触碰既有表 —— 这是 §5 迁移策略的前提。

`AnalyticsEvent` 也**不复用**：它是"用户做了什么"的行为流，T08 要的是"业务产出了什么"的账。混流会让漏斗指标被埋点噪声污染。

---

## 2. 三级成果验证 —— 怎么让"自报不算验证"成为**可断言的判据**

### 2.1 模型：验证级别是**派生值**，不是可写入的入参

AC-15 的字面要求是「自报与双方确认**分开**，不把系统猜测计为已验证」。若 `verificationLevel`
是一个 `POST` 入参，那么第一个越权的客户端就能"把自己标成已验证" —— 这正是要防的。

故采用**事件溯源 + 纯派生**：

```prisma
enum OutcomeVerificationLevel {
  SELF_REPORTED          // 仅上报方陈述 —— 🔴 不算验证成功
  COUNTERPARTY_CONFIRMED // 对手方确认
  EXTERNALLY_VERIFIED    // 外部证据核验（运营，outcome.verify）
}

model Outcome {
  id             String  @id @default(cuid())
  organizationId String
  proposalId     String  // 软引用（同 WorkflowJob.proposalId 的取向）
  missionId      String  // 软引用：租户内筛选
  reporterId     String  // 软引用：**不进 DTO**
  counterpartyId String  // 软引用：**不进 DTO**
  summary        String  // 上报方陈述（自报内容）
  verificationLevel OutcomeVerificationLevel @default(SELF_REPORTED) // 派生快照，只由服务层写
  occurredAt     DateTime
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  verifications  OutcomeVerification[]
  @@index([organizationId, verificationLevel])
  @@index([organizationId, createdAt])
}

/// 每一次"确认/核验"是一条不可变记录 —— 级别由记录集派生
model OutcomeVerification {
  id             String @id @default(cuid())
  organizationId String
  outcomeId      String
  level          OutcomeVerificationLevel
  actorId        String?  // 确认/核验人；系统核验为 null
  evidence       String?  // 证据摘要（脱敏后落库）
  note           String?
  createdAt      DateTime @default(now())
  outcome Outcome @relation(fields: [outcomeId], references: [id], onDelete: Cascade)
  @@unique([outcomeId, level, actorId]) // 幂等：同一人对同一级别的确认只算一次
  @@index([organizationId, createdAt])
}
```

**单一判据**（抽成纯函数，执行点与界面共用，杜绝"界面说已验证、接口说没有"的漂移）：

```ts
// src/lib/outcome/verification.ts —— 零 IO，可离线穷举
export function deriveVerificationLevel(
  verifications: readonly { level: OutcomeVerificationLevel }[]
): OutcomeVerificationLevel

// AC-15 的字面判据，全项目只此一处
export function isVerified(level: OutcomeVerificationLevel): boolean  // level !== 'SELF_REPORTED'
```

### 2.2 三个决策点

1. **`SELF_REPORTED` 是默认值也是"下限"** —— 上报即得，但它**不是**验证成功。
   所有"已验证成果数 / 验证率"指标**必须**经 `isVerified()`，不得直接比较 enum 字面量
   （否则日后加第四级时，散落的 `=== 'EXTERNALLY_VERIFIED'` 会静默漏算）。
2. **对手方确认不允许"自我确认"** —— `counterpartyId === actorId` 时拒绝（400）。
   否则单方就能把自己的自报抬成"双方确认"，AC-15 立刻失效。
3. **`EXTERNALLY_VERIFIED` 只走 `outcome.verify`（ADMIN+）** —— 与 `workflow.manage`
   同一取向：它决定"这条成果算不算数"，是管理动作，取严。

### 2.3 隐私边界（沿用 T05/T07 的投影纪律）

`Outcome` 的 DTO **不含** `reporterId` / `counterpartyId` / `evidence` 原文。对侧看到的是**角色**：

```ts
myRole: 'REPORTER' | 'COUNTERPARTY' | 'OBSERVER'  // 而不是 userId
```

理由与 T05 的 `ProposalDecision.note` 一致：返回 userId 就等于把"谁跟谁连接了"这条
关系数据披露给了租户内的任意 `outcome.read` 持有者（MEMBER 起即有）。

---

## 3. 阶段机接线（T06 留下的**唯一空洞**）

`WorkflowStage` 里 `ACTION_COMPLETED` / `OUTCOME_RECORDED` 两个阶段**只有定义、没有任何触发点**
（`T06/changes.md` 交接项 ①，本轮全仓搜索确认）。T08 负责把它们接上：

| 触发 | 事件 | 走向 |
|---|---|---|
| 上报成果成功落库 | `applyEvent(stage, 'ACTION_COMPLETED')` | → `ACTION_COMPLETED` |
| 对手方确认**或**运营核验通过 | `applyEvent(stage, 'OUTCOME_RECORDED')` | → `OUTCOME_RECORDED`（终态） |

- 一律经 `advanceWorkflowStage()`（T06 的 **CAS 推进** + `appendTimeline`），**不另写一份**；
- 阶段机注释保证**只前进不回退**，重复事件天然幂等 → 与 T06 的幂等键取向一致；
- 🔴 与 **R7** 保持一致：**不做"到点自动置为已完成"**。成果是**人/对手方**声明的，
  没有声明就永远停在 `ACTION_COMPLETED`（在运营视图里显示为停滞，由人处置）。

---

## 4. 切片计划

| 切片 | 内容 | 验收落点 | 前置 |
|---|---|---|---|
| **1** 🚧 | **Outcome 域**：C4 迁移（`Outcome` / `OutcomeVerification`）+ 三级验证服务（派生判据 / 自我确认拒绝 / 租户隔离 / 审计）+ API（`GET /api/v1/outcomes` · `POST …/report` · `…/{id}/confirm` · `…/{id}/verify`）+ **阶段机接线** + Console `/console/outcomes` 屏 | **AC-15** | 无 |
| 2 | ✅ **商业指标**：介绍漏斗（各阶段计数）+ 人工工时（T06 接手/人工介入）+ 任务成本，全部经 `/api/v1/outcomes/metrics` 下发，并配 **SQL 对账脚本**（`scripts/qa/outcome-reconcile.mjs`）逐项复算 | **AC-16** | Slice 1 |
| 3 | **用量归集 + 订阅/限额 + 支付沙箱**：`UsageRecord` + 组织订阅状态机（**事件溯源**）+ Creem 适配器（**无凭据 → 沙箱捕获，`status=CAPTURED`**） | **AC-21（沙箱部分；真实扣款/退款 `BLOCKED`）** | Slice 1 |
| 4 | Playwright 覆盖 AC-18 的 Outcomes 屏（七屏补第 6 屏）+ 无空按钮负测 | AC-18 增量 | 1 |

> 排序理由是**依赖可用性**：Slice 2/3 都读 Slice 1 的 `Outcome` 表；Slice 4 在屏实现之后。
> Slice 1 完成后 `/console/outcomes` 从"施工中"变可用 —— 这是 **AC-18 七屏中的第 6 屏**
> （第 7 屏 Agents 仍等 T09 选型）。

---

## 5. Schema 与迁移策略（C4 批次）

- **新增文件** `prisma/schema/outcome.prisma`（领域独立，便于整批回滚）；
- `Organization` 上加 2 条反向关系（`outcomes` / `outcomeVerifications`）；
- 在 `scripts/connection/migrate.mjs` 注册 **`C4` 批次**（`tables: ['Outcome','OutcomeVerification']`），
  SQL 只用 `CREATE TABLE/INDEX IF NOT EXISTS`（**纯新增，无 ALTER/DROP**）；
- `verify` 增 **C4 段**，含**反向断言**：`Outcome.proposalId` / `Outcome.reporterId`
  **必须没有外键**（软引用 —— 成果是被删资源的证据，不该随用户/提案消失），
  `OutcomeVerification.outcomeId` **必须有** FK 且 `CASCADE`（与 `IntroductionWorkflow.proposalId` 同取向）。
  只断言"有的都在"是盲的，它抓不到"该软的地方被写成硬 FK"（T06 的原话）。
- **本切片不动生产库**：代码与迁移脚本同批提交，带 `[skip netlify]`；生产迁移在**发版时**按
  `db-snapshot → plan → apply C4 → verify → 发布提交` 的固定顺序做（T06 §5.1 的教训：
  先发版会让运行时第一步就查不存在的表）。

---

## 6. 权限口径（与 T01 能力矩阵对齐，**已预留、无需新增**）

| 动作 | 能力 | 谁有 |
|---|---|---|
| 看成果列表 / 指标 | `outcome.read` | **全员**（SELF_SERVICE） |
| 上报成果（自报） | `outcome.report` | **全员** |
| 对手方确认 | `outcome.report` | **全员**（服务层另加"不得自我确认"） |
| 外部核验（抬到 `EXTERNALLY_VERIFIED`） | `outcome.verify` | **仅 ADMIN+** |

> ⚠️ 沿用 T07 的教训：`withTenant` 对能力数组是 **`some()`（任一满足）**。
> 成果列表若写成 `['outcome.read','outcome.report']` 不会更严（两者同为全员），
> 但**核验端点必须单 gate `outcome.verify`**，负向断言 `OPERATOR → 403` 护住。

---

## 7. AC 对照

| AC | 判据 | 证据形式 |
|---|---|---|
| **AC-15** | 自报与双方确认**分开**；**不把系统猜测计为已验证** | ① `deriveVerificationLevel` 纯函数穷举测试；② `isVerified('SELF_REPORTED') === false` 负向断言；③ **自我确认被拒**（400）；④ UI 徽章由同一判据派生；⑤ 阶段机只在上报/确认后推进，**无自动置位** |
| **AC-16** | 任务成本 / 人工工时 / 介绍漏斗**可复算** | ✅ **PASS（Slice 2）**：`GET /api/v1/outcomes/metrics` 下发的**每个数字**都被 `scripts/qa/outcome-reconcile.mjs` 用**原始表 SQL** 独立算出同一个值（全租户 14/0、任务内 14/0，`exit 0`）。**变异自证**：篡改计数或假设 → `exit 1`；负向：`verifiedLevels` 含 `SELF_REPORTED` 或缺 `--api` → `exit 1`。口径：**无时间窗口**（R10）+ **快照式漏斗** + **假设随响应下发**（R12） |
| **AC-21** | 使用量可复算；退款/失败/升级/降级状态一致 | Slice 3：用量复算同上；状态一致性 = **事件溯源 + 非法迁移拒绝 + 幂等键**。🔴 **真实扣款/退款 = `BLOCKED`**（无 Creem 凭据），沙箱只证明"要发出去的请求是什么" |

---

## 8. 变更记录

| 日期 | 变更 |
|---|---|
| 2026-10-13 | **开工**：读出 T08 的 AC-15/16/21 与依赖（T05/T06），确认阶段机 `ACTION_COMPLETED`/`OUTCOME_RECORDED` 无触发点、能力矩阵已预留 `outcome.*`、`/console/outcomes` 导航已占位。定下两条关键取舍：① **计费域新建**（不复用 B2C 的 `Subscription`/`Payment`）；② 三级验证用**事件溯源 + 纯派生**，使"自报不算验证"成为可断言判据。规划 4 个切片。 |
| 2026-10-13 | **Slice 1 落地**：C4 迁移（`Outcome` / `OutcomeVerification`）+ 三级验证服务 + 4 个 API + **阶段机接线**（补齐 T06 的触发点空洞）+ Console `/console/outcomes` 屏。**AC-15 认领**；AC-16/21 待 Slice 2/3。 |
| 2026-10-13 | **Slice 2 落地**：`/api/v1/outcomes/metrics`（`outcome.read` 全员）+ 纯函数指标内核（零 IO）+ **SQL 对账**（`outcome-reconcile.mjs`，原始表独立复算 14 项）+ 计数已知的夹具 + 输出器。**AC-16 认领**。三个口径决定：**不做时间窗口**（避 DateTime 格式混排的静默错算，R10）、**快照式漏斗**（一条 SQL 可复算）、**假设随响应下发**（不藏在代码里，R12）。本地实跑：全租户 14/0、任务内 14/0、变异自证与两条负向均 exit 1。 |
