# T08 · changes — 变更记录

> 基线 commit **`95da9f1`**（`main`，已推送 GitHub + 已发布 Netlify 生产，
> 部署 `6accc417082883b04320cd42` ready @ 2026-10-12T11:27:19Z）。
> 任务：**`T08_OUTCOME_BILLING` — 成果验证、成本归因与订阅**。
> 验收：**AC-15 / AC-16 / AC-21**。本切片（Slice 1）只认领 **AC-15**。
> 前序交接（来自 BACKLOG §7「T08 开工前必读」）：
> ① `T06/changes.md` §4.2 失败三分法；② `T06/risks.md` R7（阶段超时只可见、不自动推进）；
> ③ `T05/changes.md` §3.6（`introduce` 刻意不带幂等键）。

---

## 1. 提交（Slice 1）

> Slice 2 的提交见 **§7.1**（`584975a` / 文档 `ec0ddea`）。

| 项 | 值 |
|---|---|
| 交付提交 | **`b2a349d`** — `feat(t08): Slice 1 —— 三级成果验证 + 阶段机接线 + 成果屏`（含 `[skip netlify]`） |
| 文档提交 | **`b7dd62d`** — 四件套 / BACKLOG 回填（含 `[skip netlify]`） |
| 发布提交 | **无** —— 本切片**未发版**（纯新增，不含 schema 应用；见 §5） |
| 生产部署 | 仍为 `6accc4170828`，**未变**（`[skip netlify]` 生效） |
| 分支 | `main` |

> ⚠️ `[skip netlify]` 会被**扫描整条提交信息（含正文）** —— 发布提交正文里别写出它，
> 否则自伤静默跳过构建。本切片**不**发版，故交付提交带它。

---

## 2. 交付物清单

### 2.1 Schema（**C4 批次：纯新增 2 表 + 7 索引 + 3 外键**）

| 文件 | 规模 | 说明 |
|---|---|---|
| `prisma/schema/outcome.prisma` | **新建 ~155** | 1 枚举 + 2 模型：`OutcomeVerificationLevel` / `Outcome` / `OutcomeVerification` |
| `prisma/schema/tenancy.prisma` | +8 | `Organization` 上 2 条反向关系 + 软引用说明 |
| `scripts/connection/migrate.mjs` | **+~110** | 注册 `C4` 批次（`ALL_BATCHES=['C0'..'C4']`）；`verify` 增 `4e)` / `5d)` 两段 |
| `src/generated/*` | 重新生成 | Prisma client（含 `db.outcome` / `db.outcomeVerification`） |

**软引用 vs 外键**（C4 的核心设计，`verify` 有**反向断言**钉住）：

| 列 | 关系 | 理由 |
|---|---|---|
| `Outcome.proposalId` | **无 FK**（软引用） | 成果是被删除资源的**证据**：删提案不应抹掉"这里发生过一次成功连接" |
| `Outcome.reporterId` | **无 FK**（软引用） | 用户注销后，成果的**归属痕迹**仍应可审计 |
| `Outcome.counterpartyId` | **无 FK**（软引用） | 同上 |
| `OutcomeVerification.outcomeId` | **有 FK**（CASCADE） | 验证记录与成果**同生共死**：成果没了，它对谁都没意义 |
| `Outcome.organizationId` / `OutcomeVerification.organizationId` | **有 FK**（CASCADE） | 租户谓词必须真存在（T01 铁律） |

`migrate.mjs verify` 因此含**三条反向断言**：`Outcome.proposalId` / `.reporterId` /
`.counterpartyId` **必须没有**外键；以及一条**正向**断言：`OutcomeVerification.outcomeId`
**必须有** FK。只断言"有的都在"是盲的 —— 它抓不到"该软的地方被写成硬 FK"（T06 的原话）。

### 2.2 服务层 `src/lib/outcome/`（3 文件）

| 文件 | 作用 | 关键约束 |
|---|---|---|
| `verification.ts` | **纯函数内核**：级别顺序 / `isVerified` / `deriveVerificationLevel` / `VERIFIED_LEVELS` / `outcomeRoleOf` | **零 IO** → 可离线穷举 |
| `outcomes.ts` | 服务层：`reportOutcome` / `confirmOutcome` / `verifyOutcome` / `listOutcomes` / `getOutcomeById` / `toOutcomeDto` | 级别**从不**来自入参；每查询带 `organizationId` |
| `index.ts` | barrel 出口 | — |

**🔴 本切片最重要的设计决定：验证级别是「派生值」，不是可写入的字段。**

`Outcome.verificationLevel` 是**派生快照**，由 `deriveVerificationLevel()` 从
`OutcomeVerification` 记录集算出后写回。任何 `POST` 的请求体里**没有**这个字段的位置 ——
否则第一个越权的客户端就能"把自己标成已验证"，AC-15 当场失效。

`isVerified(level) = level !== 'SELF_REPORTED'` 是「算不算验证成功」的**唯一判据**，
被 UI、指标、SQL 下推（`VERIFIED_LEVELS`）共用。散落的 `=== 'EXTERNALLY_VERIFIED'`
式比较在新增第四级时会**静默漏算**，故一律禁止。

### 2.3 API（4 文件）

| 路径 | 方法 | 能力 | 说明 |
|---|---|---|---|
| `/api/v1/outcomes` | GET | `outcome.read`（**全员**） | 列表 + `?level=` / `?verified=1` / `?missionId=` / `?limit=`；响应带 `unverifiedCount` |
| `/api/v1/outcomes` | POST | `outcome.report`（**全员**） | 上报（自报）。服务层另判"你是不是这条提案的当事方" |
| `/api/v1/outcomes/{outcomeId}/confirm` | POST | `outcome.report`（**全员**） | **对手方确认**：上报人自己 → 400；第三方 → 403；重复 → 幂等回放 |
| `/api/v1/outcomes/{outcomeId}/verify` | POST | `outcome.verify`（**仅 ADMIN+**） | 外部核验；**不要求**是当事方 |
| `_shared/params.ts` | — | — | `outcomeIdOf(params)` |

**路径层数陷阱（本轮**又**踩了一次）**：`outcomes/[outcomeId]/confirm/route.ts` 引用
`_shared` 应为 `../../_shared/params`（**文件所在目录**到 `_shared` 的距离是**两级**），
初版按"4 段路径就写 3 个 `../`"的直觉写成 `../../../` → **tsc 报 `TS2307`**。
与 `T06/changes.md` §2.5 记的是**同一个坑**。API 单测（直接 import handler）永远是绿的，
**只有 tsc / E2E 能抓**。

### 2.4 阶段机接线（**补齐 T06 留下的唯一空洞**）

`WorkflowStage` 里的 `ACTION_COMPLETED` / `OUTCOME_RECORDED` 此前**只有定义、
没有任何触发点**（`T06/changes.md` 交接项 ①）。本切片接上：

| 触发 | 事件 | 走向 |
|---|---|---|
| 上报成果成功 | `applyEvent(stage, 'ACTION_COMPLETED')` | → `ACTION_COMPLETED`（**不是终态**） |
| 对手方确认 / 运营核验 | `applyEvent(stage, 'OUTCOME_RECORDED')` | → `OUTCOME_RECORDED`（**终态**） |

- 一律经 `advanceIntroductionWorkflow()`（T06 的 **CAS 推进 + `appendTimeline`**），**不另写一份**；
- 失败 `catch(() => {})` —— 与 T06 钩子同一取向：**不把已成功的业务操作变成 500**（见 `risks.md` R3）；
- 🔴 与 T06 `risks.md` **R7** 保持一致：**不做**"到点自动置为已完成"。
  成果是**人**声明的；没有声明就永远停在 `ACTION_COMPLETED`（在运营视图里显示为停滞）。

### 2.5 Console 屏 `src/app/console/outcomes/page.tsx`

**AC-18 七屏中的第 6 屏**（第 7 屏 Agents 仍等 T09 选型）。三个落点：

1. **徽章由服务端下发的 `verified` 派生** —— 本屏**不自己比较级别字面量**
   （`SELF_REPORTED` 永远显示"仅自报"，永远不会变成绿色"已验证"）；
2. **「确认成果」按钮只在 `canConfirm === true` 时渲染**（服务端按"我是对手方 且 尚未确认"算出），
   **「外部核验」只在 `canVerify === true`**（按 `outcome.verify` 能力）——
   不存在"点了必然 400/403 的按钮"。不可确认时**不渲染禁用按钮**，只在角色标签说明原因；
3. **上报入口有真实数据面** —— 从 `GET /api/v1/connections/proposals?states=MUTUALLY_ACCEPTED`
   取"我参与、已介绍、尚无成果"的连接作为**可选列表**。没有它，"上报成果"就得让用户手填
   `proposalId` —— 那是个假入口。

`console-shell.tsx` 的 `CONSOLE_NAV`：`outcomes` → `ready: true`，gate `outcome.read`（**读**能力，
所有成员都有；能不能确认/核验由页面降级渲染）。

### 2.6 测试

| 文件 | 用例 | 覆盖 |
|---|---|---|
| `tests/outcome/verification.test.ts` | 22 | 纯函数：`isVerified` 负向 / 派生穷举 3×3×3 / 未知值 / 角色 |
| `tests/outcome/outcomes.test.ts` | 22 | 服务层：前置权限 / 自报不算验证 / 自我确认拒绝 / 幂等 / 阶段机接线 / 隐私边界 |
| `tests/outcome/outcomes-api.test.ts` | 15 | HTTP：401/403/400/201/200/500 全谱系 + 能力边界负向 |

---

## 3. AC 对照

| AC | 结论 | 证据 |
|---|---|---|
| **AC-15** 自报与双方确认分开，不把系统猜测计为已验证 | **PASS** | ① `isVerified('SELF_REPORTED') === false`（判据本身，有负向断言）；② 级别**不可入参**（请求体塞 `verificationLevel` 无效，有用例）；③ **自我确认被拒**（上报人 → 400，API 层同样）；④ UI 徽章与指标共用一个判据；⑤ 上报只推进到 `ACTION_COMPLETED`，**没有任何**"自动置为已验证"的代码路径 |
| **AC-16** 任务成本 / 人工工时 / 介绍漏斗**可复算** | **PASS**（Slice 2） | `scripts/qa/outcome-reconcile.mjs` 用**原始表 SQL** 独立算出 API 下发的**全部 14 个可比字段**并逐项相等（`exit 0`）：全租户 14/0、任务内 14/0；**变异自证**（篡改计数/假设）→ `exit 1`；负向（`verifiedLevels` 含 `SELF_REPORTED`、缺 `--api`）→ `exit 1` |
| **AC-21** 用量可复算；退款/失败/升降级状态一致 | ✅ **沙箱部分 PASS / 🔴 真实扣款 `BLOCKED`**（Slice 3，见 §8） | ① **用量可复算**：`billing-reconcile.mjs` 用原始表 SQL 独立复算 `totals` / `totalUnits` / `limits` / 账本行自洽 / 无悬空来源 → **65/0**，exit 0；② **状态一致**：三层取证（SQL 聚合 + 账本合法性不变量 + 派生复算），夹具走遍**升级→降级→失败→退款**；③ **非法迁移写入前被拒**（`REFUNDED → SUCCEEDED` → 409）；④ **变异自证 10/10**；⑤ 🔴 **真实扣款/退款 = `BLOCKED`**（无 Creem 凭据）：`realChargesEnabled` 恒 `false`、事件一律 `CAPTURED`，对账硬断言"`gatewayStatus=SUCCEEDED` 计数为 0" |
| **AC-18**（增量） | 🚧 **第 6 屏就绪** | `/console/outcomes` 可达且无空按钮（动作按钮由 `canConfirm`/`canVerify` 派生）；**七屏仍差 Agents**（等 T09） |

---

## 4. 与契约的偏离 / 需要留意

1. **一条提案只落一份成果**（`Outcome.proposalId` 唯一）。与"`OUTCOME_RECORDED` 是终态"
   的语义一致；多条成果需改阶段机可回退，属更大改动（见 `risks.md` R6）。
2. **列表无分页**（`limit ≤ 200`，响应无 `total`/`truncated`）—— 与 T07 的 `pipeline`
   不同。Slice 2 引入聚合端点时一并补（`risks.md` R8）。
3. **`occurredAt` 可回填**，但硬约束"不得早于介绍时间"（→ 400）。`createdAt`
   （系统看见的时间）与 `occurredAt`（业务时间）分开存，指标口径必须明确取哪个（R7）。
4. **`summary` 对全员可见**（`outcome.read` 是 SELF_SERVICE）；**userId 一律不进 DTO**
   （只给 `myRole`），`evidence` / `note` **一律不外发**（R5）。
5. **阶段不回退**：回滚代码不会把已推进的阶段退回去 —— `ACTION_COMPLETED` 表达的是
   已发生的事实。详见 `rollback.md` §5。

---

## 5. 为什么本切片**不发版**

- **纯新增、无既有表变更**：C4 只在 `plan` 阶段预览过 SQL，**生产库尚未创建这两张表**；
- 若现在发版，线上运行时第一步就会查 `Outcome` → 表不存在 → 500
  （与 T06 §5.1 的教训同型）。因此**发版必须与"apply C4"绑定**，顺序固定为：

```
db-snapshot → plan --batch=C4 → apply --batch=C4 --yes → verify → 发布提交（不带跳过标记）
```

- 本切片交付提交带 `[skip netlify]` → **生产零改动**，published 仍为 `6accc4170828`。
- 是否发版（以及何时）由用户拍板。

---

## 6. 门禁

| 检查 | 结果 |
|---|---|
| `tsc --noEmit` | **0 error** |
| 全量 `jest` | **59 套 / 1145 passed**（Slice 2 前为 57 套 / 1111；`tests/outcome` 新增 2 套 34 例） |
| `eslint --max-warnings=0`（改动目录） | **0 error / 0 warning** |
| `check:script-decls` | 59 脚本，**0 未声明** |
| `connection:migrate plan --batch=C4` | ✅ SQL 合法（本切片**无 schema 变更**，未新增批次） |
| `outcome-reconcile.mjs`（AC-16） | ✅ **14/14 一致**（全租户 + 任务内各一遍）；变异自证与两条负向均 `exit 1` |

---

## 7. Slice 2 —— 商业指标（**认领 AC-16**）

> 目标：**介绍漏斗 / 人工工时 / 任务成本**经 `GET /api/v1/outcomes/metrics` 下发，
> 且每个数字都能被原始表 SQL 独立复算。

### 7.1 提交

| 项 | 值 |
|---|---|
| 交付提交 | **`584975a`** — `feat(t08): Slice 2 —— 商业指标 + SQL 对账（AC-16）`（含 `[skip netlify]`） |
| 文档提交 | **`ec0ddea`** — 四件套 / BACKLOG 回填（含 `[skip netlify]`） |
| 发布提交 | **无** —— 未发版（同 §5：C4 未应用到生产） |
| 生产部署 | 仍为 `6accc4170828`，**未变** |

### 7.2 交付物

| 文件 | 规模 | 说明 |
|---|---|---|
| `src/lib/outcome/metrics.ts` | **新建 ~300** | **纯函数内核**：`computeOutcomeMetrics` / `percent` / `round1` / `round2` / `unitsOf` / `METRIC_ASSUMPTIONS`；**零 IO** |
| `src/lib/outcome/metrics-service.ts` | **新建 ~120** | 服务层：`collectOutcomeMetricCounts`（8 条 `count`）+ `getOutcomeMetrics` |
| `src/app/api/v1/outcomes/metrics/route.ts` | **新建 ~40** | `GET`，能力 `outcome.read`（**全员**，同 `plan.md` §6） |
| `src/lib/outcome/index.ts` | +40 | barrel 增补 |
| `scripts/qa/outcome-reconcile.mjs` | **新建 ~330** | **SQL 对账**：原始表独立复算 + 逐字段比对 + 变异可检 |
| `scripts/qa/emit-outcome-metrics.mts` | **新建 ~110** | 指标输出器（service 模式 / http 模式）；**被 tsc 覆盖**（`include: **/*.mts`） |
| `scripts/qa/seed-t08-metrics.mjs` | **新建 ~280** | 计数**完全已知**的夹具（含噪声行 + 第二条 Mission） |
| `tests/outcome/metrics.test.ts` / `metrics-api.test.ts` | **新建 19 + 15** | 内核与端点 |
| `package.json` | +4 | `test:outcome` / `metrics:seed` / `metrics:emit` / `metrics:reconcile` |

### 7.3 🔴 三个口径决定（口径不写明 = 数字不可复算）

1. **不做时间窗口**（`basis.scope = 'all-time'`）。库里的 DateTime 是 TEXT 且格式不统一
   （`...Z` / `...+00:00` / 空格分隔），跨格式的**范围比较**会给出**静默错误**的计数 ——
   那正好摧毁 AC-16。时段口径与 `UsageRecord` 一起做（`risks.md` R10）。
   唯一的收窄是 `?missionId=`（**格式无关**的等值过滤）。
2. **漏斗是"当前状态快照"**，不是历史队列：`mutuallyAccepted` **包含已介绍的**；
   `REVOKED` **不计入任何一档**（哪怕曾双方同意）。理由：这是**一条 SQL 能算出的**口径；
   历史队列需要事件日志（不在本切片）。**每一档都能被原始表 SQL 复算** —— 这是 AC-16 的前提。
3. **假设随响应下发**（`basis.assumptions`：单价 4 项 + 每次介入分钟数）。
   它们是**占位假设**（`risks.md` R12），不是财务事实；下发它们是为了让"这个数字怎么来的"
   一眼可见，并让对账脚本**从响应读**而不是自带一份常量 —— 否则改代码不改脚本会让两边同时错。

### 7.4 AC-16 的证据（可复跑）

```
seed-t02 --reset --regenerate   →  seed-t08-metrics  →  emit-outcome-metrics  →  outcome-reconcile
```

| 场景 | 结果 |
|---|---|
| 全租户 `org_e2e` | **14 通过 / 0 不一致**（提案 9 / 待表态 3 / 同意 5 / 已介绍 4 / 成果 4 / 已验证 2 / 接管 1 / 死信 2；成本 3580 分） |
| 任务内 `mission_t08_metrics` | **14 通过 / 0 不一致**（7 / 2 / 4 / 3 / 3 / 1；成本 2640 分） |
| **变异自证**（`proposals=999` + `introduction` 单价改 1） | **exit 1**，4 处不一致；SQL 侧用**被篡改的假设**算出 1143 分 ≠ API 2640 分 ⇒ 证明脚本真的在**读响应里的假设** |
| 负向（`verifiedLevels` 含 `SELF_REPORTED`） | **exit 1**（在"载荷自洽性"一步拦下） |
| 负向（缺 `--api`） | **exit 1**（可操作的报错） |

### 7.5 踩坑记录

**对账脚本的第一版把 workflow 计数摊进了漏斗。** `expectedFunnel()` 写了 `{ ...counts }`，
而 `counts` 里还有 `takeovers` / `deadLettered` —— 于是 SQL 侧多出两个键，与 API 的
`funnel` 不等。**是脚本自己新加的"字段集一致"断言把它抓出来的**（只比对共同字段会让
"API 多下发一个没人复算的数字"静默通过）。
教训：**形状也是契约**；比对要覆盖**两个方向**的字段集差异，而不是只比共同字段。

---

## 8. Slice 3 —— 用量归集 + 订阅限额 + 支付沙箱（**认领 AC-21 的沙箱部分**）

> 目标：**使用量可复算** + **退款/失败/升级/降级状态一致**。
> 🔴 **真实扣款 / 退款 = `BLOCKED`**（无 Creem 凭据）——**沙箱结果不得冒充 PASS**。

### 8.1 提交

| 项 | 值 |
|---|---|
| 交付提交 | 见 §8.6（`feat(t08): Slice 3 …`，含 `[skip netlify]`） |
| 文档提交 | 见 §8.6 |
| 发布提交 | **无** —— 未发版（同 §5：C4 **与** C5 均未应用到生产） |
| 生产部署 | 仍为 `6accc4170828`，**未变** |

### 8.2 交付物

| 文件 | 规模 | 说明 |
|---|---|---|
| `prisma/schema/billing.prisma` | **新建 ~200** | 4 枚举 + 2 模型：`UsageUnit` / `BillingPlan` / `BillingEventType` / `BillingGatewayStatus` + `BillingEvent` / `UsageRecord` |
| `prisma/schema/tenancy.prisma` | +4 | `Organization` 上 2 条反向关系 |
| `scripts/connection/migrate.mjs` | **+~120** | 注册 **C5 批次**（`ALL_BATCHES=['C0'..'C5']`）；`verify` 增 **`4f)` C5 段**（含 4 条**反向断言**） |
| `src/lib/billing/plans.ts` | **新建 ~140** | 方案目录 + `PLAN_LIMITS`（**占位假设**）+ 升降级**由方案序推导** |
| `src/lib/billing/subscription.ts` | **新建 ~420** | **纯函数内核**：`reduceBillingEvents` + 两层迁移表 + 全序比较；**零 IO** |
| `src/lib/billing/usage.ts` | **新建 ~240** | 纯函数内核：单元词表（**与指标同源**）/ 期次 / 聚合 / 限额判定 |
| `src/lib/billing/creem.ts` | **新建 ~200** | **沙箱适配器**：无凭据 → `CAPTURED`；有凭据未接入 → **501** |
| `src/lib/billing/service.ts` | **新建 ~500** | **唯一 IO 层**：`listUsageFacts` / `collectUsage` / `getUsageSummary` / `getSubscription` / `appendBillingEvent` / `startCharge` |
| `src/lib/billing/index.ts` | **新建** | barrel 出口 |
| `src/app/api/v1/billing/**`（5 路由） | **新建 ~420** | `usage`(GET) · `subscription`(GET) · `subscription/events`(POST/GET) · `usage/collect`(POST) · `charges`(POST) |
| `scripts/qa/seed-t08-billing.mjs` | **新建 ~330** | 计数已知夹具 + **账本已知序列**（覆盖 升级/降级/失败/退款）+ 两类噪声 |
| `scripts/qa/emit-billing.mts` | **新建 ~130** | 计费输出器（**含归集幂等自证**：连跑两次，第二次必须 `inserted=0`） |
| `scripts/qa/billing-reconcile.mjs` | **新建 ~560** | **SQL 对账**：用量复算 + 账本合法性 + 派生复算 + **变异自证 10 例** |
| `src/lib/tenancy/capabilities.ts` | +6 | `billing.read`（OPERATOR+）/ `billing.manage`（ADMIN+） |
| `tests/billing/*.test.ts` | **新建 87** | 订阅内核 34 + 用量内核 23 + API 30 |
| `tests/tenancy/capabilities.test.ts` | +1 例（8 断言） | 计费能力边界（MEMBER 读不到 / OPERATOR 只读 / ADMIN+ 动账） |
| `package.json` | +3 | `billing:seed` / `billing:emit` / `billing:reconcile` |

### 8.3 🔴 四个关键设计

**① 状态是派生值，不落列（与 Slice 1 的 `verificationLevel` 同取向）**

`BillingEvent` 是**不可变日志**；当前方案 / 状态 / 每笔款项的生命周期**全部**由
`reduceBillingEvents(events)` 折叠得出。**没有** `status` 列 —— `migrate verify` 里有一条
**反向断言**钉住这件事（`BillingEvent` 不得出现 `status`/`state` 列）。

理由：一个 `status` 列就是**第二个事实来源**。它迟早与事件集不一致，而**不一致的那一刻
没有任何东西会报错** —— 报表照常输出，只是数字悄悄错了。这正是 AC-21 要防的。

**② 非法迁移在**写入前**被拒（AC-21 点名的 `REFUNDED → SUCCEEDED`）**

两层同名规则，缺一不可：

| 层 | 规则 | 防的是什么 |
|---|---|---|
| **款项层** | `PENDING → {SUCCEEDED, FAILED}`、`SUCCEEDED → REFUNDED`、`FAILED`/`REFUNDED` 终态 | 「同一笔款项被重复标记成功」 |
| **订阅层** | `SUBSCRIPTION_ALLOWED_FROM`：退订/退款后除"重新开通"外一律拒绝 | 「退订之后又收到一笔成功款」 |

服务层写入前先 `reduceBillingEvents(已有 + 候选)` 折叠一次，不通过就**不写**
（绝不"先写库再校验"—— 那会让非法事件**永久留在账本里**）。

**③ 期次（`periodKey`）是账单的一等概念，落列**

`UsageRecord.periodKey`（`YYYY-MM`，UTC 自然月）。归集与限额都按它分组，**对账退化为纯等值比较**。

为什么不让对账脚本去 `WHERE occurredAt >= ? AND < ?`：库里的 DateTime 是 TEXT 且**历史上
出现过格式混排**（`T08/risks.md` R10 —— Slice 2 的"不做时间窗口"就是为此）。把**可复算的数字**
押在"字符串字典序恰好等于时间序"上是脆的。

**④ 账本自带幂等：`dedupeKey` 唯一约束 + `requestHash` 指纹**

两者与 HTTP 层的 `Idempotency-Key` **并存而不互替**：

- `dedupeKey` 唯一 → **即使调用方没带幂等头，账也不会重复**（账本层的自保，脚本/回填同样受保护）；
- `requestHash` 指纹 → 防的**不是重复，而是"旧键被复用于新意图"**：只按唯一约束处理会
  **静默返回旧事件**，而调用方以为新动作生效了。命中时同指纹 → 回放；**不同 → 409**；
  原事件有指纹而本次没给 → **409**（否则"不带指纹"就成了绕过指纹的后门）。

### 8.4 归集为什么是「幂等扫描原始表」而不是侵入业务路径

备选方案是在 T05 的 `introduceConnection`、T08 的 `reportOutcome` 等**业务执行点**内联写账。
那样更"实时"，但代价三重：① 要改已上线的生产代码路径（引入回归面），而账本**不是业务的前置条件**；
② 只要有一处漏接（新加的第四个入口），账就**静默**少一笔且无人报警；③ 历史数据要另写回填脚本 ——
于是"实时写入"与"回填"两套逻辑并存。

改为**幂等扫描**后：任意时刻重跑都收敛到同一状态（**可回填、可修复**），业务路径**一行不动**；
而 AC-21 的"可复算"反而更强 —— 归集走 Prisma + 纯内核，对账走**原始 SQL**，
**两条独立路径算出同一个数才算数**（与 AC-16 同一手法）。

### 8.5 AC-21 的证据（可复跑）

```
seed-t02 --reset --regenerate  →  seed-t08-billing  →  emit-billing  →  billing-reconcile
```

| 场景 | 结果 |
|---|---|
| **归集幂等自证** | 连续两次 `collectUsage`：第一次 `inserted=21`，第二次 **`inserted=0` / `skipped=21`** |
| 用量复算（当期 `2026-10`） | **65 通过 / 0 不一致**，exit 0 —— 原始表 SQL 独立算出 `total` 四单元（6/4/5/2）、`totalUnits=17`、四条 `limits`、账本行自洽（期次/幂等键/来源类型/数量）、**无悬空来源** |
| 状态一致（升级→降级→失败→退款全走遍） | 终态 `plan=STARTER` / `status=REFUNDED` / `paid=3000` / `refunded=2000` / `net=1000` / `DOWNGRADE` / `charges=[SUCCEEDED, FAILED, REFUNDED]`，全部由**三层独立取证**复算一致（SQL 聚合 / 账本合法性不变量 / 派生复算） |
| 🔴 **变异自证 10/10** | 篡改 `totals` / `totalUnits` / `limits.used` / `limits.exhausted` / `unitMapping` / `paidTotal` / `eventCount` / `status` / 方向 / 款项状态 —— **全部被抓** |
| 正向：上期 `2026-09` | **65 通过 / 0 不一致**，exit 0（证明按期归集是真的在跑） |
| 负向：拿**当期**响应去对账**上期** | **exit 1**，9 处不一致，且指名 `totals.proposal API=6 账本=1` |
| 期次过滤承重 | 全期 7/5/6/3 vs 当期 6/4/5/2 ⇒ 跨期行确实存在且被正确排除 |
| 租户谓词承重 | 跨租户 `org_t08_other` 的 1 提案 / 1 成果 / 1 事件**未**计入 |
| 🔴 沙箱诚实断言 | `gatewayStatus='SUCCEEDED'` 的事件数 **= 0**；`realChargesEnabled === false`；`mode='sandbox'` ⟺ 缺凭据 |
| **C5 verify** | 本地夹具库 `159/159` 全绿；**变异自证**：给 `sourceId` 补 FK + 给 `BillingEvent` 加 `status` 列 → 两条反向断言**都报警** |

### 8.6 踩坑记录（三个，都值得记）

**① tsc 抓到 1 个类型错误，而 jest 全绿。**
`appendBillingEvent` 里 `currency: candidate.currency` —— 内核类型是 `string | null`
（允许缺币种），而 Prisma 的 `currency` 因 `@default("USD")` 是**非空** `string`。
ts-jest **只转译不做全量类型检查**，所以 87 个用例全绿也照样漏掉 `TS2322`。
教训：**jest 绿 ≠ 类型对**；`tsc --noEmit` 不可省（Slice 3 的 87 例曾"全绿"）。

**② 对账脚本第一版把"同一时刻的两种写法"判成了不一致。**
库里存 `2026-01-15T12:01:00.000+00:00`（Prisma/夹具统一写 `+00:00`），
而服务层 DTO 经 `toISOString()` 归一为 `...Z`。字符串比较 → **6 处误报**。
修法是加 `sameTs()`：按**解析后的时刻**比较。这正是 R10 警告的同一类陷阱
（把时间语义押在字符串上），本轮以另一种形式又踩了一次 —— 好在被自己抓出来。
⚠️ 顺带确认：`BillingEvent` / `UsageRecord` 的实际存储格式**是统一的 `+00:00`**，
`periodKey` 的 `substr(...,1,7)` 归一也因此对 `Z` 与 `+00:00` 两种写法都成立。

**③ C5 的 `verify` 断言第一版把 `quantity`（INTEGER）与 `occurredAt`（DATETIME）
混进了"TEXT NOT NULL"组** → 该行**恒假**（本地 verify 一条红：`UsageRecord 关键列均为 NOT NULL`）。
C4 段之所以没踩，是因为它列的全是 TEXT 列。教训：**按类型分组断言**，
别把不同 SQL 类型的列塞进同一个正则。

### 8.7 与契约的偏离 / 需要留意

1. **限额与单价都是占位假设**（`PLAN_LIMITS`）—— 不是商业事实（`risks.md` R13，与 R12 同纪律）。
2. **只支持全额退款**：部分退款需要一张退款明细表，不在本切片范围 → 明确 **400** 拒绝，
   而不是模糊处理（`risks.md` R14）。
3. **`UsageRecord.quantity` 目前恒为 1**：保留字段是为了将来"一次介绍覆盖 N 位成员"不必改表。
4. **期次用 UTC 自然月**（不是租户本地月）：跨时区用"本地月"会让同一租户在不同机器上
   得到不同的期次边界 —— 而账单必须**只有一个边界**（`risks.md` R15）。
5. **`billing.read` 只到 OPERATOR+**（与 R11 对成本可见性的取舍**刻意不同**：
   用量直接对应账单金额）。
6. **归集是"扫描式"的**：若原始行被**硬删除**，账会失去依据。本仓的提案/成果/验证
   没有硬删除路径，且账本行一旦写入不会被删 → 该风险当前**不可达**（`risks.md` R16）。
