# T09 · Agent Runtime —— Slice 2 交付记录（持久化 + HTTP + 审批）

> 计划见同目录 `plan.md`；Slice 1（纯内核）见 `slice-1.md`。
> 本文件只记录**已交付事实 + 证据 + 诚实修订**。
> 范围：`prisma/schema/agent.prisma`、`scripts/connection/migrate.mjs`（C6）、
> `src/lib/tenancy/capabilities.ts`、`src/lib/agents/*`、`src/app/api/v1/agents/*`、
> `tests/agents/*`。
> **不发版**：提交带 `[skip netlify]`，仅在本地与隔离库验证。

## 1. 交付物

| 文件 | 职责 | 关键设计 |
|---|---|---|
| `prisma/schema/agent.prisma`（新） | 3 个模型：`AgentRun` / `AgentCall` / `AgentApproval` | 纯新增、方言无关（无 `@db.*`）、软引用优先；`AgentRun.status` **落列**（"待我审批"必须能下推成 SQL 谓词）；`AgentCall` **独立表**（AC-20 要求**每次**调用可归因，挤进 run 的列会在重试场景**静默少算**） |
| `scripts/connection/migrate.mjs`（改） | 新增 **C6** 批次（3 表 + 14 索引 + 5 外键） | DDL 由 `prisma migrate diff` 生成后**逐字**拷入（与 C5 同一纪律）；`verify` 新增 **46 项**（列/索引/外键/反向断言 + 5 条一致性断言） |
| `src/lib/tenancy/capabilities.ts`（改） | 新增能力 `agent.run`（OPERATOR+）/ `agent.approve`（ADMIN+） | 🔴 **刻意分离**：同一角色不能既触发又批准 —— 否则 AC-08「注入不得绕过审批」在**制度层**被绕过（状态机依然正确，但"人工审批"退化成自我盖章） |
| `src/lib/agents/dto.ts`（新） | DTO 投影（**唯一**对外形状） | `rawText`（模型原文）**永不进 DTO**；`dedupeKey`/`requestHash` 不进；`execution.available` **恒 false**；内核小写枚举 ↔ Prisma 大写枚举的**唯一**映射（未知值抛错，不猜默认） |
| `src/lib/agents/runs.ts`（新） | 服务层：持久化 + 限额 + 审批 + 用量 | 幂等经 `withIdempotency`；限额 `loadLedger()` 读**本期**账本 → `runSkill({ledger})` **调用前**判定；审批只经 `approval.ts` 真相表；`status` 仅两处写入 |
| `src/lib/agents/index.ts`（新） | 服务层出口 | 与 `@/lib/agent`（内核）的目录边界即 A1/A2 的**执法点** |
| `src/app/api/v1/agents/runs/route.ts`（新） | `GET`（列表）/ `POST`（发起，**必须** `Idempotency-Key`） | 能力 `agent.run` |
| `src/app/api/v1/agents/runs/[runId]/route.ts`（新） | `GET` 单条详情（带逐次调用） | 列表精简 / 详情带明细，两个显式动作 |
| `src/app/api/v1/agents/runs/[runId]/{approve,reject}/route.ts`（新） | 人工裁决 | 能力 `agent.approve`；**不执行任何副作用** |
| `src/app/api/v1/agents/usage/route.ts`（新） | 本期用量与限额 | 假设随响应下发（T08 口径） |
| `tests/agents/*`（新，5 套 56 例） | 服务层 / HTTP / schema 漂移 / 审批一致性 / 执行不可达 | 见 §3 |

### 目录边界（本切片最重要的一条约定）

```
src/lib/agent/   （单数）= 无 IO 的策略内核 —— 受 check-agent-invariants 的 A1/A2 约束
src/lib/agents/  （复数）= 允许碰 DB 的服务层 —— 它 import 内核，反之不成立
```

把两者混进一个目录，A1/A2 立刻失效，而"内核无 IO"会**静默**退化成一句口头约定。
本切片的服务层全部落在**复数**目录，`check:agent-invariants` 仍只扫单数目录（8 文件）。

## 2. 门禁证据（2026-10-13）

| 命令 | 结果 |
|---|---|
| `npx jest tests/agents` | **5 套 / 56 用例全通过**（服务层 24 · HTTP 14 · schema 漂移 11 · 审批一致性 4 · 执行不可达 3） |
| `npx jest`（全量） | **73 套 / 1377 用例全通过**（330s；Slice 1 时 68 套 / 1319） |
| `npx tsc --noEmit` | **exit 0**（0 error；5m26s） |
| ESLint（**目录级**：`src/lib/agents` · `src/app/api/v1/agents` · `tests/agents` · `capabilities.ts`） | **0 error / 0 warning** |
| `npm run check:agent-invariants` | **通过**（扫 8 文件；服务层在复数目录，**未**被纳入 —— 这正是设计） |
| `npm run verify:agent-invariants` | **通过**（A1–A4 变异各被捕获 `exit=1`，负向对照无误报） |
| `npm run check:ui-invariants` | 通过（R1–R7） |
| `npm run check:script-decls` | 通过（64 脚本 / 0 未声明引用） |
| `connection:migrate apply --batch=ALL` + `verify`（隔离库 `file:/tmp/c6-e2e.db`） | **205/205 全通过**（C0–C5 为 159；C6 新增 **46 项**） |
| `connection:migrate rollback --batch=C6 --yes`（隔离库） | **通过**：逆序删除 `AgentApproval → AgentCall → AgentRun`（外键顺序正确） |

### C6 `verify` 的 5 条**一致性断言**（不是"表存在"这一级）

| 断言 | 为什么必须有 |
|---|---|
| 终态（`APPROVED`/`REJECTED`）必有裁决行 | `status` 是列 ⇒ 存在"第二个事实来源"的风险 |
| `status` 与 `AgentApproval.decision` 同向 | 同上；防"状态说批准、裁决说驳回" |
| 待批态**无**裁决行 | 防出现"已裁决但仍显示待批" |
| **无 `EXECUTED` 行** | Slice 2 未注册执行器 —— 出现即代表有代码绕过了"执行不在本切片" |
| `costMicroCents` 与 `AgentCall` 合计一致 | 冗余列的**漂移对账**（写入非原子，漂移必须被发现而不是被容忍） |

## 3. 测试钉住的东西

| 套件 | 用例数 | 关键断言 |
|---|---|---|
| `tests/agents/runs-service.test.ts` | 24 | PROPOSED / AWAITING_APPROVAL / DEGRADED / FAILED / BLOCKED_QUOTA 五种落点；**失败也记账**（越界产出仍有 1 条 `ok:true` 调用）；幂等三态（同键同体回放且**不产生新调用** / 同键不同体 409 / 缺键 400）；限额**调用前**判定（预置账本 → `BLOCKED_QUOTA` 且账本**零新增**）；跨租户读/批 → 404；`rawText` 库里在、DTO 里没有；`execution.available` 恒 false；注入信号 → `requiresApproval` **升级** |
| `tests/agents/agents-api.test.ts` | 14 | 🔴 MEMBER → `agent.run` 403；🔴 OPERATOR 能跑**不能批**（双人复核）；匿名 401 且**不查库**；缺 `Idempotency-Key` → 400；首次 201 / 重放 200；未知 `status` → 400；详情 404；`PROPOSED` 直接 approve → 409 |
| `tests/agents/schema-drift.test.ts` | 11 | 读**真实 .prisma 文本**比对：`AgentRunStatus` ↔ `AGENT_RUN_STATUSES`、`AgentRiskLevel` ↔ `RISK_LEVELS`、`AgentProviderKind` ↔ `PROVIDER_KIND_TO_DB`；`EXECUTED` 在 run 状态里、**不在**决策枚举里；无 `@db.*`；三模型都带 `organizationId`；`Organization` 三条反向关系；软引用**不建 FK**；`@@unique([runId])` / `@@unique([organizationId,dedupeKey])` |
| `tests/agents/approval-consistency.test.ts` | 4 | 三条不变量在**混合操作之后**统一复验；**变异自证**（删裁决行 → 必抛；改 decision 与 status 不符 → 必抛） |
| `tests/agents/execution-unreachable.test.ts` | 3 | 静态：服务层/路由层源码里 `EXECUTED` **只出现在注释**；`status` 写入口**仅** `create` + `update`（无 `updateMany`/`upsert`）；动态：跑遍所有变更入口后库里无 `EXECUTED` |

### 两个"措辞正确性"修复（写测试时抓到）

1. `prisma/schema/agent.prisma` 的文件头与 `status` 字段注释原写"只经 `transitionRun()` 修改"
   —— 但**代码里没有这个函数**（实际是 `createAgentRun()` 落初值 + `decideAgentRun()` 裁决）。
   已改为**两处写入点**的准确描述。**失准的注释比没有注释更危险**（它会让人以为存在一个不存在的守门人）。
2. `schema-drift` 首版把"不含 `@db.*`"直接对**含注释**的 schema 文本断言 ——
   而文件名头恰好**写着**「不含任何 `@db.*` 原生类型标注」，于是断言被自己的注释绊倒。
   改为先剥注释再断言。（同类坑：本仓此前在 `check-agent-invariants` 也踩过"字面量出现在注释里"。）

## 4. 🔴 未覆盖 / 诚实声明

1. **真实模型调用未接线**：`resolveProvider()` 在有 `OPENAI_API_KEY` 时仍返回 `unavailable`
   （真实 HTTP 实现属 **Slice 3**）。因此当前所有模型路径在**生产**都会**明示降级**，
   不会假装成功。这与 T08 Creem 沙箱同一取向。
2. **执行仍不可达**：本切片**没有**注册执行器。批准只把状态写成 `APPROVED`；
   "把消息发出去 / 把资料披露出去"要有 T05 披露出口 + T06 投递出口。
   `execution.available` 恒 `false`（原因字符串随 DTO 下发，前端据此禁用按钮）。
3. **组织级真实额度未接线**：`DEFAULT_QUOTA`（500 分 / 20 次高成本调用）是**占位假设**，
   随 `agentUsage()` 响应的 `assumptions` 一起下发 —— 不是财务事实。
4. **`DEGRADED → APPROVED` 不在真相表内**（`DEGRADED` 只能到 `AWAITING_APPROVAL` / `REJECTED` …）。
   因此"对一条 `DEGRADED` 运行直接批准"会 409。当前**不可达**（唯一有规则式兜底的
   `INTENT_EXTRACTION` 是低风险、`requiresApproval=false`），故不构成缺口；
   但若将来给高风险技能加降级路径，需要同时补上 `DEGRADED → AWAITING_APPROVAL` 的**服务端迁移点**。
5. **`subjectLabel` 是标签而非档案**：真实字段披露要经 `discloseSubject()` 投影（AC-03），
   属后续接线。本切片的 prompt 里**没有任何主体档案数据**。
6. **真实 OpenAI 成本对账（Slice 3）与对抗夹具（Slice 3）未做**。

## 5. 回滚

- **代码**：删除 `src/lib/agents/**`、`src/app/api/v1/agents/**`、`tests/agents/**`，
  还原 `capabilities.ts` 的两行能力与 `migrate.mjs` 的 C6 段、删除 `prisma/schema/agent.prisma` 与
  `tenancy.prisma` 的三条反向关系。三个 API 目录消失后，`/api/v1/agents/*` 自然 404。
- **数据库（首选，与 T08 同口径）**：**停用路由 + 保留表** —— C6 是纯新增，留着三张空表
  对既有功能零影响，也避免了任何数据丢失的可能。
- **数据库（重手段，需显式确认）**：`node scripts/connection/migrate.mjs rollback --batch=C6 --yes --url=<...>`
  —— 逆序删 `AgentApproval → AgentCall → AgentRun`（表内有数据时**先备份 JSON 再删**，已本地验证）。
  只有在确实要把 schema 恢复到 C5 状态时才用。
- **能力矩阵**：`agent.run` / `agent.approve` 若整块回退，注意同步改
  `tests/tenancy/capabilities.test.ts` 的 T09 两组断言（否则"已定义但谁也拿不到"断言会红）。
