# T01 · DIALECT-DIFF — 方言差异清单与 PostgreSQL 兼容方案

> 基线 commit `3faf1e9`。本文回答 `MIGRATION_PLAN.md` §1 的 **Q1（数据层走哪条路）**
> 与 §6 的落地细节，是 T01 全部数据层工作的前置依据。
>
> **用户决策（2026-10-10）**：数据层 **迁 PostgreSQL（P2）**。

---

## 0. 结论先行

| 问题 | 结论 |
|---|---|
| 现在就要改 `provider` 吗？ | **不要。** T01 的租户底座（新增 3 表 + 加列）**在 libSQL 上即可完整落地并验证**，改 `provider` 会让整个 client 与 147 条既有路由同时换方言，收益为零、风险最大。 |
| PG 什么时候切？ | **M6**，独立批次。前置是 M0–M5 全部验收通过 + PG 实例就绪。 |
| 本轮要做什么？ | ① 把 schema 写成**方言无关**（不引入任何 `@db.*` 标注）；② 备好 **PG DDL 生成链路**（`migrate diff` 脚本）；③ 把差异**逐条记录**，使 M6 变成机械执行。 |

> 一句话：**T01 让 schema 具备可迁移性，M6 才执行迁移。** 这与主指令「不可破坏性」一致。

---

## 1. 差异总表（量化）

统计口径：`prisma/schema/*.prisma`（33 + 6 = **39** model，35 enum）对比 `contracts/schema.sql`。

| # | 维度 | libSQL（现网） | PostgreSQL（契约） | 影响面 | M6 改造动作 |
|---|---|---|---|---|---|
| D1 | 主键 | `String @id @default(cuid())` × **38** | `uuid DEFAULT gen_random_uuid()` | 38 张表、全部外键 | 保留 `cuid()`（PG 下落 `text`）**或** 换 `@db.Uuid` + `dbgenerated`（见 §3.1） |
| D2 | JSON 存储 | `String` 存 JSON 文本 × **30 字段** | `jsonb`（可索引/可查询） | Profile / PowerBoardRule / IMMessage / AuditLog 等 | 列类型改 `Json`，需同步改 **读写两侧** 序列化代码（见 §3.2） |
| D3 | 时间 | `DateTime` → sqlite `DATETIME`（无时区） | `timestamptz` | 全部 `DateTime` 列 | Prisma 自动映射；存量值均为 UTC ISO，语义一致 |
| D4 | 约束 | 几乎无 `CHECK`（靠应用层） | 契约 5 处 `CHECK` | 枚举列、`proposer<>candidate` | 手写原生 SQL 补 `CHECK`（Prisma schema 不支持表达） |
| D5 | 枚举 | Prisma `enum` × 35 → sqlite `TEXT` | 契约用 `text + CHECK` | 35 处 | Prisma 在 PG 下生成原生 `enum` 类型；与契约的 `text+CHECK` **语义等价、形式不同**，见 §3.3 |
| D6 | 向量 | 无 | 规划 `pgvector`（T04 语义召回） | T04 | M6 时 `CREATE EXTENSION vector` |
| D7 | 行级安全 | **无**（libSQL 无 RLS） | 契约注释要求 RLS 纵深防御 | T01 核心 | M5/M6 上 RLS 策略（见 §4） |
| D8 | 迁移机制 | `migrate diff` + 线上 `PRAGMA` 差集只补缺口；**禁止 `db push`**（P1013） | `prisma migrate deploy` | 全流程 | 切换后约束解除，需重新验证链路 |

---

## 2. 为什么不能「现在就切 provider」

`prisma/schema/core.prisma:9-11` 的 `datasource db { provider = "sqlite" }` 是**全局单值**，
Prisma 不支持 `provider = env(...)`。因此：

- 改 provider → `src/generated/**` 全量重写 → 147 条 API 路由 + 30 个页面同时换方言；
- 而 `src/lib/db.ts:158-201` 硬编码 `PrismaLibSql` adapter，改 provider 后必须同步改；
- 生产 Turso 上没有 PG 数据 → 改完即断服。

**所以**：`provider` 的切换必须与「数据搬迁」同批次完成，属于 **M6**，不在 T01。

> ✅ 已具备的条件：`@prisma/adapter-pg@^7.10.0` 与 `@types/pg@^8.23.1` **已在 `package.json` 中**
> （T00 审计时发现），M6 的适配器无需新增依赖。

---

## 3. 逐项改造方案

### 3.1 主键（D1）— 建议：**保持 `cuid()` 不变**

| 选项 | 说明 | 评价 |
|---|---|---|
| **A. 保留 `cuid()`** | PG 下落 `text` 列，值仍是 CUID 字符串 | ⭐ **推荐**。零代码改动、零外键风险；CUID 本身防碰撞、可按时间排序 |
| B. 换 `@db.Uuid` + `gen_random_uuid()` | 符合契约字面 | 38 表 + 全部外键需同步改；`src/generated` 类型从 `string` 变 `string` 但仍需全量回归；收益仅是「类型更贴契约」 |

> 契约写 `uuid` 是其**独立新建**场景下的自然选择；本项目是**存量迁移**，
> 「保持主键不变」是 MIGRATION_PLAN §2.1「加列优先、不破坏既有」的直接推论。
> **如需严格对齐契约字面，请在 M6 前单独确认**（影响 38 表全量回归预算）。

### 3.2 JSON 字段（D2）— **30 个字段，M6 的最大工作量**

现存全部以 `String` 存 JSON 文本（例：`Profile.selectedTags String @default("[]")`）。
PG 下应迁为 `jsonb` 以获得索引与查询能力，但这会**同时改变读写两侧代码**。

**改造策略（三层，按风险从低到高）**：

| 层 | 动作 | 是否必须 |
|---|---|---|
| L1 | **新增**字段才用 `Json` 类型；既存 30 字段**暂不动** | ✅ 本轮生效 |
| L2 | M6 时对「查询密集」字段（如 `PowerBoardRule.paceConfig`）改 `jsonb`，其余保持 `text` | 可选 |
| L3 | 全量 30 字段改 `jsonb` + 全站 `JSON.parse/stringify` 收敛到统一 codec | 建议 M6 后独立批次 |

> ⚠️ **禁止**在无 codec 收敛的情况下批量改列类型 —— 会让「有的地方存字符串、有的地方存对象」，
> 是典型的静默数据腐化。**本轮 T01 不触碰任何既有 JSON 字段。**

### 3.3 枚举（D5）— 形式不同、语义等价，**无需改造**

- Prisma 在 PG 下为每个 `enum` 生成原生 `CREATE TYPE ... AS ENUM`；
- 契约用 `text + CHECK(role IN (...))`；
- 两者都保证「非法值写不进去」。**差异仅为存储形式**，不构成阻塞。
- 唯一注意：PG 原生 enum 的**增删值需要 `ALTER TYPE`**（比 `CHECK` 约束略麻烦）。
  M6 时若担心未来枚举演进成本，可显式改用 `String` + 原生 `CHECK`。

### 3.4 RLS（D7）— 见 §4

---

## 4. 隔离模型（T01 核心）

契约 `schema.sql:64-65` 明文要求：

> WorkBuddy MUST implement RLS / tenant middleware / access tests and **avoid trusting organization_id supplied by client**.
> Cross-tenant Bridge needs a separate opt-in permission model and MUST NOT query private rows directly.

**本项目的实现分两层，且本轮只交付第二层 + 第三层的预留：**

| 层 | 机制 | 生效时机 | 本轮状态 |
|---|---|---|---|
| **DB 级（RLS）** | `CREATE POLICY ... USING (organization_id = current_setting('app.tenant')::text)` | M6（libSQL 无 RLS，只能在 PG 上做） | 📄 **方案就绪，未启用** |
| **应用级（强制）** | `resolveTenant()` 只从**服务端会话**推导；所有跨租户查询必须带 `organizationId` 谓词；静态检查 + 负测兜底 | **本轮** | ✅ **交付** |
| 跨租户 Bridge | opt-in 视图，禁止直查私有行 | T10 | 未开始 |

> **关键原则（写入代码注释与测试断言）**：
> `organizationId` **永远不能**来自 `request.body` / `query` / 客户端 header。
> 只能由 `resolveTenant()` 从 NextAuth 会话 + `memberships` 表推导。

---

## 5. PG DDL 生成链路（M6 用，本轮先备好）

因为不能同时存在两个 `provider`，PG 目标 DDL 通过 **`migrate diff`** 从「同一份 schema + 空库」生成：

```bash
# 从空库到当前 schema 的 PG 全量 DDL（不连任何数据库）
npx prisma migrate diff \
  --from-empty \
  --to-schema-datamodel prisma/schema \
  --script > /tmp/pg-target.sql
```

> 注意：`--to-schema-datamodel` 读取 schema 的 **datasource provider** 来决定方言。
> 因此生成 PG DDL 前需临时把 `core.prisma` 的 `provider` 改为 `postgresql`
> **或在独立分支上操作**。该动作属于 M6，本轮**不执行**。

M6 的完整搬迁步骤（双写 → 回填 → 切读 → 回退）见 `MIGRATION_PLAN.md` §3.1 M6 行与 §4.1 L4。

---

## 6. 对 T01 的直接约束

| # | 约束 | 理由 |
|---|---|---|
| 1 | 新增模型**不得**使用 `@db.*` 原生类型标注 | 保持方言无关，两种 provider 都能生成 |
| 2 | 新增列**一律可空或带默认值** | 加列优先，不阻塞既有写入 |
| 3 | 不修改任何既有 JSON 字段的类型 | 见 §3.2 |
| 4 | 不修改 `datasource.provider` | 见 §2 |
| 5 | 迁移脚本必须**同时**给出 libSQL 与 PG 两份 SQL（PG 版仅存档演练，不执行） | 保证 M6 可机械执行 |

> ✅ 已核验：新增的 `prisma/schema/tenancy.prisma` 满足 1–4（无 `@db.*`、无必填新列于既有表、未动 provider）。

---

_产出：2026-10-10 · 基线 `3faf1e9` · 对应 `MIGRATION_PLAN.md` §1 / §2.1_
