# T08 · changes — 变更记录

> 基线 commit **`95da9f1`**（`main`，已推送 GitHub + 已发布 Netlify 生产，
> 部署 `6accc417082883b04320cd42` ready @ 2026-10-12T11:27:19Z）。
> 任务：**`T08_OUTCOME_BILLING` — 成果验证、成本归因与订阅**。
> 验收：**AC-15 / AC-16 / AC-21**。本切片（Slice 1）只认领 **AC-15**。
> 前序交接（来自 BACKLOG §7「T08 开工前必读」）：
> ① `T06/changes.md` §4.2 失败三分法；② `T06/risks.md` R7（阶段超时只可见、不自动推进）；
> ③ `T05/changes.md` §3.6（`introduce` 刻意不带幂等键）。

---

## 1. 提交

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
| **AC-16** 任务成本 / 人工工时 / 介绍漏斗**可复算** | ⬜ **未认领** | 属 Slice 2（`outcome-reconcile.mjs` SQL 对账） |
| **AC-21** 用量可复算；退款/失败/升降级状态一致 | 🔴 **BLOCKED** | 属 Slice 3；且 Creem 凭据缺失 → **真实扣款/退款永久 BLOCKED**，不得标 PASS（`risks.md` R1） |
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
| 全量 `jest` | **57 套 / 1111 passed**（Slice 1 前为 54 套 / 1052；`tests/outcome` 新增 3 套 59 例） |
| `eslint --max-warnings=0`（改动目录） | **0 error / 0 warning** |
| `check:script-decls` | 57 脚本，**0 未声明** |
| `connection:migrate plan --batch=C4` | ✅ SQL 合法（纯 `CREATE TABLE/INDEX IF NOT EXISTS`，无 ALTER/DROP） |
