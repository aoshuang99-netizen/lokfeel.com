# T09 · Agent Runtime —— Slice 4 交付记录（执行器落地：`EXECUTED` 只有一条路径）

> 计划见同目录 `plan.md`；Slice 1（纯内核）见 `slice-1.md`；Slice 2（持久化 + HTTP + 审批）见 `slice-2.md`；
> Slice 3（真实 Provider + 对账 + 对抗/预算夹具）见 `slice-3.md`。
> 本文件只记录**已交付事实 + 证据 + 诚实修订**。
> 范围：`prisma/schema/{agent,tenancy}.prisma`（改）、`scripts/connection/migrate.mjs`（改，+C7）、
> `src/lib/agent/{execution.ts,index.ts}`（新/改）、`src/lib/agents/{executor.ts,dto.ts,runs.ts,index.ts}`（新/改）、
> `src/lib/tenancy/capabilities.ts`（改）、`src/lib/workflow/notification-content.ts`（改）、
> `src/app/api/v1/agents/runs/[runId]/execute/route.ts`（新）、
> `tests/agent/execution.test.ts`（新）、`tests/agents/execution-gated.test.ts`（新，**取代** Slice 2 的 `execution-unreachable.test.ts`）。
> **不发版**：提交带 `[skip netlify]`，仅在本地与隔离库验证。

## 1. 本切片解决的问题

Slice 2/3 交付后，`AgentRunStatus.EXECUTED` 是一个**不可达**的枚举成员：没有任何代码路径能写进去，
`execution.available` 恒 `false`，甚至有一条**阶段断言**钉住"库里 `EXECUTED` 必须为 0"。

那条断言的原文写着：**「接线执行器之后，本断言应被删除而不是被绕过」**。本切片就是把它接上，
并且**不降低**原来的保证强度 —— 把"不能执行"升级为"**只有一条路径**能执行，且路径上每一道门都还在"。

## 2. 交付物

| 文件 | 职责 | 关键设计 |
|---|---|---|
| `src/lib/agent/execution.ts`（新） | 内核：**执行计划真相表** + 唯一放行判据 | `EXECUTION_PLANS: Record<SkillKey, ExecutionPlan \| null>`（**显式写全** ⇒ 新增技能时编译器强制做一次"它有执行器吗"的决定）、`planExecution()`、`agentExecutionDedupeKey()`。🔴 `ExecutionPlan.recipient` 的类型是字面量 `'REQUESTER'` 而**不是**一个 id —— 收件人一旦可由请求体给出，"执行"就变成"把已批准的产出送到任意地址"，而那次批准覆盖的**不是**那个地址 |
| `src/lib/agents/executor.ts`（新） | 服务层：`EXECUTED` 的**唯一**写入点 | ①`can(ctx.role,'agent.execute')` 再判一次（直接调服务层的路径不该绕过角色判定）；②`row.execution` 存在 → **幂等返回**（放在判据**之前**：执行是终态，重复请求是"再问一次结果"，不是"再执行一次"）；③`planExecution()` 放行；④经 **T06 统一投递出口** `deliverNotification()` 产生副作用（拿到披露守卫 + 身份声明断言 + 投递幂等 + 投递留痕）；⑤**同一个事务**里写执行记录 + `status='EXECUTED'`；⑥审计只放枚举与布尔。抛出语义：404 / 403 / 409（带 `code`）/ 投递失败**原样抛且状态不变** |
| `src/app/api/v1/agents/runs/[runId]/execute/route.ts`（新） | HTTP 面 | `POST`，能力 `agent.execute`；首次 **201**、已执行 **200 + `replayed:true`** |
| `src/lib/agents/dto.ts`（改） | DTO 投影 | `executionOf()` **完全转发** `planExecution()`（不再写死 `false`）；新增 `code` / `kind` / `channel`；新增 `executionRecord`（执行实际发生了什么；`null` = 没执行过）。🔴 DTO 与执行器**共用同一个内核判据** ⇒ "界面说能执行、执行器说不给执行"在结构上不存在 |
| `prisma/schema/agent.prisma`（改） | schema | 新增 `enum AgentExecutionKind { RECEIPT }` + `model AgentExecution`（`@@unique([runId])` + 2 索引 + 2 强 FK；`recipientId`/`actorId`/`deliveryId` 软引用无 FK）；`AgentRun` 加 `execution AgentExecution?`。`channel` **复用** `NotificationChannel`（不新造枚举） |
| `scripts/connection/migrate.mjs`（改） | 迁移 | **C7 = `AgentExecution`**（纯新增单表）⇒ 断言 **205 → 219（+14）** |
| `src/lib/tenancy/capabilities.ts`（改） | 能力 | 新增 `agent.execute`（**OPERATOR+**）。🔴 门槛在**批准**那一环（`agent.approve` = ADMIN+）；若执行也要求 ADMIN，「运营发起 → 管理员批准 → 运营执行」这条正常动线就走不通 —— 执行是机械动作，不是决策 |
| `src/lib/workflow/notification-content.ts`（改） | 模板 | 新增 `agent.delivery`（内部回执）。🔴 **刻意不引用**目标文本 / 草稿正文 / **任务标题**：通知渠道多一个业务标识就多一个披露面 |
| `tests/agent/execution.test.ts`（新，18 例） | 内核判据 | 真相表完整性 / 取值闭集 / `recipient==='REQUESTER'` / 只注册了 `RECEIPT` / 待批拒绝（**含伪造裁决的反向对照**）/ 已批准但无裁决 → `APPROVAL_REQUIRED` / **与 `canExecute` 逐格一致**（遍历 8 状态 × 2 × `requiresApproval`）/ 纵深防御**单调性**（只在"更严"方向变化）/ 幂等键与时间无关 / 文案**不含 markdown 强调标记** |
| `tests/agents/execution-gated.test.ts`（新，A–E 五组） | 唯一的"唯一写入点"证据 | **A 静态**：`EXECUTED` 字面量在服务层与路由层**只允许出现在 `executor.ts`**；写入口计数固定（`create` ×1、`update` ×2、`updateMany`/`upsert` ×0）；DTO 与执行器**都**调 `planExecution(` 且**都**不自己比 `status === 'APPROVED'`。**B 服务层**：完整生命周期 / 幂等不产生第二次投递 / 纵深防御 / 角色 / **顺序论证** / 终态双向一致。**C 副作用形状**：收件人 = **发起人**（≠ 执行人）/ 渠道 / 模板 / 幂等键 / 通知体不含目标与草稿。**D 反向对照**。**E 路由** 401/403/201→200/404 |

### 2.1 为什么执行记录是**独立表**（而不是 `AgentRun` 上加两列）

1. `migrate.mjs` 的批次机制**只支持 `CREATE TABLE/INDEX IF NOT EXISTS`**，没有 `ALTER TABLE` 形态
   （文件头约束 1：**不改动既有表的任何列**）。给既有表加列会把这个"纯新增"的迁移纪律破掉 ——
   而在上线期间破掉它，代价是停机。
2. **只增不改**：执行是事件。列会被覆写（重试、误改），事件不会 —— 与 `AgentApproval` 同一取向。
   `@@unique([runId])` 让"一次运行只执行一次"成为**库级**保证，而不是靠调用方自觉：
   并发下第二条插入撞唯一键 ⇒ 服务层**读回胜者**并幂等返回，而不是把"重复执行"变成 500。
3. `AgentRun.executedAt` 这列**刻意不存在**（由 DDL 反向断言守着）：执行时间属于执行记录。

## 3. 🔴 顺序论证：为什么**先投递、后落库**

写在 `executor.ts` 的 ⑥ 注释里，并且是可测的（`deliver` 是注入点）：

- 若**先**改状态再投递：投递失败就会留下"**状态 EXECUTED、但什么都没发出**"的**假成功** ——
  而重试会因为状态是终态而被拒（`EXECUTED` **没有出边**），那条产出**永远发不出去**。
- 先投递后落库的最坏情况是"消息已投递、状态还是 `APPROVED`"。这不是问题：投递本身**幂等**
  （`dedupeKey = agent-exec:<runId>`，与时间无关），重试命中既有记录并**不重发**，随后补上记录与状态。

⇒ 两个方向的代价不对称，故取后者。`tests/agents/execution-gated.test.ts` 用"投递失败 → 状态不变、可重试成功"把这条论证变成**真实用例**（否则它只能靠读代码相信）。

## 4. 诚实边界：本切片的效果是**内部回执**，不是"把介绍发给对手方"

收件人**恒为发起人**（`AgentRun.requestedBy`），渠道恒为站内信（`IN_APP`）。原因不是偷懒：

- `AgentRun` 只存 `subjectLabel` / `counterpartLabel` 这类**标签**（刻意的，见 `agent.prisma` 文件头）；
- "把 A 介绍给 B"里的 B 必须在**创建时**由服务端确定、并被**那一次批准**覆盖。
  若在执行时才由调用方传入收件人，就等于允许"**批准的是 A、发出去的是 B**" —— 审批会退化成橡皮图章。

⇒ 对外送达需要 target 身份 + T05 的 `discloseSubject()` 出口，属**下一片**。本切片把这个边界写成**类型与判据**
（`recipient: 'REQUESTER'`、`EXECUTION_KINDS = ['RECEIPT']`、单测断言"只注册了 RECEIPT"），
而不是只写在注释里。

## 5. 迁移 C7

| 项 | 结果 |
|---|---|
| 批次 | `C7 = { tables: ['AgentExecution'], label: 'T09 · Agent 执行记录（AgentExecution）' }` |
| 生成方式 | `prisma migrate diff --from-schema /tmp/lf-schema-pristine --to-schema prisma/schema --script` 原文抄录（仅把 `CREATE ...` 改为 `CREATE ... IF NOT EXISTS`） |
| 新增断言（14 条） | 表存在（11 列）· 3 索引（`runId` 唯一）· 2 外键（→ Organization / → AgentRun）· 关键列 NOT NULL · 软引用列可空 · `executedAt` DATETIME NOT NULL · **反向断言 ×2**（`recipientId`/`actorId`/`deliveryId` **无** FK；**无** `status`/`state` 列）· **双向一致性 ×2**（`EXECUTED ⇒ 必有 AgentExecution 行`；`AgentExecution 行 ⇒ 所属运行必为 EXECUTED`）· 行数可读 |
| 隔离库实测（全新库） | `apply --batch=ALL` **exit 0** → `verify` **✅ 219/219**（Slice 2/3 时为 **205/205** ⇒ **+14**） |

🔴 **阶段断言被"升级"而不是被删除**：Slice 2 的"一致性④ = `EXECUTED` 计数必须为 0"换成**双向一致**。
并保留诚实声明：**空库下两个方向都恒成立（0 与 0），没有判别力** —— 所以另配了"断言数 +14"与
服务层用例（真造出 `EXECUTED` 行）共同承担证据责任。

## 6. 门禁证据（2026-10-15）

| 命令 | 结果 |
|---|---|
| `npx jest tests/agent tests/agents` | **13 套 / 233 例全通过**（Slice 3 时两目录合计 12 套 / 195 例 ⇒ **+1 套 +38 例**） |
| `npx jest`（全量） | **86 套 / 1738 例全通过**（Slice 3 后基线 85 套 / 1699 例） |
| `npx tsc --noEmit` | **exit 0**（0 error；2m36s） |
| ESLint（**目录级**：`src/lib/agent` · `src/lib/agents` · `src/app/api/v1/agents` · `src/lib/workflow` · `src/lib/living/agents` · `src/components/living/agents` · `tests/agent` · `tests/agents` · `tests/living/agents`） | **0 error / 0 warning** |
| `npm run check:agent-invariants` | **通过**（扫 **9** 文件，含新增 `execution.ts`；A1–A5） |
| `npm run verify:agent-invariants` | **通过**（A1–A5 变异各被捕获 `exit=1`；负向对照未误报；收尾复验 `exit=0`） |
| `npm run check:ui-invariants` | 通过（R1–R10） |
| `npm run check:script-decls` | 通过（**70** 脚本 / 0 未声明引用） |
| 隔离库迁移 | **219/219**（见 §5） |

> **回填**：提交 `c127d18`（推 main 成功）；`verify:no-release --commit=c127d18` **exit 0** ——
> 最新部署仍为 `f6630ea6b`（2026-10-13），即 `[skip netlify]` 生效、生产**未被触发**。

## 7. 🐛 本轮拦下的真实问题（**全部门禁首轮抓出**）

首轮定向测试 **10 套失败 / 124 例红**。逐条归因后分四类，**没有一条是"改测试让它变绿"**：

| # | 问题 | 性质 | 处置 |
|---|---|---|---|
| ① | `EXECUTION_PLANS[*].description` 含 markdown 强调标记（`**`），而它就是 DTO 的 `execution.reason`，`agent-board.tsx` **原样渲染** ⇒ 界面上会显示字面星号 | **真实缺陷**（正是 P2 门禁 R9 与 `verify:p2:e2e` 要挡的那一类） | 三条描述全部去标记；并**新增两条单测**钉住"计划描述与拒绝原因都不含 `**`"（否则下次有人顺手加粗就又漏了） |
| ② | `agent.delivery` 模板会渲染 `missionTitle`（`（任务：…）`） | **真实缺陷**（多一个业务标识就多一个披露面） | 与 `operator.attention` 同一处置：**即便传了也不渲染**。写死比"依赖调用方传 null"更强 —— 后者在下一个调用方手里就失效 |
| ③ | `_fake-db.ts` 的安装器**硬解引用** 4 个新命名空间（`agentExecution` / `notificationDelivery` / `notification` / `organization`）⇒ 所有**没走执行路径**的旧测试一起红 | **测试脚手架缺陷** | 安装前先补齐命名空间与方法（各测试文件刻意只声明它用到的部分）。不碰这些表的测试照旧；一旦真走到那里，报错仍是"xxx is not a function"，**不会静默通过** |
| ④ | `schema-drift.test.ts` 从 barrel `@/lib/agents` import ⇒ 连带拉进 `executor.ts` → `@/lib/workflow` → … → `next-auth`（纯 ESM）⇒ jest CJS 运行时报 "Test suite failed to run" | **测试引入路径缺陷** | 改为直接 import 具体模块 `@/lib/agents/dto`（与 `tests/living/agents/types.test.ts` 同一取向）。**注意**：这不是"barrel 坏了"，而是"测试不该为一个常量拉进整个世界" |
| ⑤ | `tests/agent/execution.test.ts` 的"判据同源"断言拿 `canTransition(status,'EXECUTED')` 当基准 ⇒ `requiresApproval=false` + `APPROVED` 这一格**假红** | **断言基准选错** | 基准换成 `canExecute(status, requiresApproval)`（真正的唯一判据），并**新增**一条"纵深防御只会更严、绝不更宽"的单调性断言（把原来那句注释里的承诺变成可测性质） |
| ⑥ | `execution-gated.test.ts` 断言 `recipientId === 'u_requester'`（执行人）| **断言写错**（且方向反了） | 收件人是**发起人** `u_1`，执行人是 `u_requester` —— 两者**必须不同**。改成断言 `recipientId === 'u_1' && !== 'u_requester'`，并补上"执行记录把两个身份分开记"，把这条分离变成**双向证据** |

## 8. 连带修正的既有断言（同一提交内完成，避免留下假绿）

| 文件 | 原口径 | 现口径 |
|---|---|---|
| `tests/agents/runs-service.test.ts` | `execution.available` 恒 false；裁决不写 `EXECUTED`（措辞"本切片无执行器"） | 低风险 `PROPOSED` 即可执行（`available:true` + `kind/channel` + `executionRecord === null`）；裁决仍不写 `EXECUTED`，但理由是"批准与执行是两步"，并补 `fake.executions` 为空 |
| `tests/agents/adversarial-injection.test.ts` | 待批 ⇒ `available === false` | 同前，**加** `code === 'STATUS_NOT_EXECUTABLE'` 与 `fake.executions` 为空（注入不可能触发执行） |
| `tests/agents/schema-drift.test.ts` | 3 个模型带 `organizationId`；3 条反向关系 | **4 个模型 / 4 条反向关系**；新增 `AgentExecutionKind ↔ EXECUTION_KINDS` 漂移守卫、`AgentExecution.runId` 唯一、渠道复用 `NotificationChannel`、三条软引用无 FK。另把"整份 schema 全文 `toMatch`"改为**按 model 取块**（`@@unique([runId])` 在两张表上都有，全文匹配分不清是哪张表的保证） |
| `tests/workflow/notification-content.test.ts` | 模板数 `toHaveLength(5)` | **6**（+`agent.delivery` 登记断言与渲染断言） |
| `tests/living/agents/{types,board}.test.ts` | 注释与夹具仍写"无执行器" | 改为"由服务端执行计划下发"；夹具文案换成真实可复现的拒绝原因；**新增** `EXECUTED` 文案断言（必须点明"高风险要先批准"） |
| `src/lib/living/agents/{types.ts,board.ts}`、`src/components/living/agents/agent-board.tsx` | 注释与 `APPROVED`/`EXECUTED` 文案写"本切片没有执行器" | 更正为"批准不等于执行：还需一次显式的执行动作"／"低风险可直接执行，高风险先经批准" |
| `scripts/qa/agent-reconcile.mjs` | 逐运行断言 `available === false`；契约字段集不含 `executionRecord`；诚实条款"无任何 EXECUTED 运行"；变异项"available 置 true" | 改为**结构一致性**（`available ⇔ code===null ⇔ kind/channel` 且 `(status==='EXECUTED') ⇔ executionRecord 非空`）；字段集补 `executionRecord`；诚实条款换成 **`EXECUTED ⇔ 有 AgentExecution 行` 双向一致 + 缺表即报**（缺 C7 的旧库不能"空集一致"地静默通过）；变异项改为**取反**（原变异在"本来就 true"的运行上不产生变化，等于没有牙齿） |
| `scripts/qa/verify-p2-workspace-e2e.mts` | "批准后 `available` 仍 false，但换成『未注册执行器』措辞" | 批准后**转为可执行**（`available === true && kind === 'RECEIPT'`）；另加"未执行 ⇒ `executionRecord === null`" |
| `docs/implementation/T09/plan.md` | 执行器列为"待接线" | 标记 Slice 4 已交付 |

## 9. 未做（下一片）

1. **对外送达**（把已批准介绍真的发给对手方）：需要 target 身份 + T05 的 `discloseSubject()` 出口，
   且必须有"批准时就把收件人确定下来"的机制（否则就是 §4 那个橡皮图章问题）。
2. **真实端点连通性**（沙箱探不了外网）—— **发版前必验**。
3. 第 7 屏 Agents 屏（前端 P2 的 `agent` 节点）。
4. 组织级真实额度配置；AC-03 的"Agent 上下文"下游接线。

## 10. 回滚

- **代码**：`execute` 路由是纯新增；`executor.ts` / `execution.ts` 是纯新增文件。
  回滚 = 删路由目录与两个新文件，并把 `dto.ts` 的 `executionOf()` 改回返回"不可执行"+ 原因。
- **迁移 C7**：`rollback --batch=C7` 删 `AgentExecution` 表（不删 `AgentRun`）。与 T08 同口径：**不删业务表**。
- 判据：C7 之前的一切（C0–C6）不受影响 —— 本切片**没有**改动任何既有表的列。
