# MIGRATION_PLAN — 兼容 / 回滚 / 数据迁移

> 基线 commit `6085d31`。本计划遵守主指令的**不可破坏性**要求：
> 任何一步都必须**可回滚**、**不中断现有生产**、**可重跑**。

---

## 1. 决策点一：数据层方言（必须先定，阻断后续一切）

| 现状 | 目标契约 | 冲突点 |
|---|---|---|
| `prisma/schema/core.prisma:10` → `provider = "sqlite"`，运行在 **Turso/libSQL** | `contracts/schema.sql` → **PostgreSQL**（`gen_random_uuid()` / `jsonb` / `timestamptz` / `CHECK` / `CREATE EXTENSION pgcrypto`） | 三方差异 |

**差异明细**

| 维度 | libSQL/sqlite（现网） | PostgreSQL（契约） |
|---|---|---|
| 主键 | `String @id @default(cuid())` | `uuid DEFAULT gen_random_uuid()` |
| JSON | **`String` 存 JSON 文本**（如 `Profile.selectedTags`、`PowerBoardRule.paceConfig`） | `jsonb`（可索引、可查询） |
| 时间 | `DateTime`（无时区语义） | `timestamptz` |
| 约束 | 几乎无 `CHECK`；靠应用层 | 契约大量用 `CHECK(... IN (...))` |
| 枚举 | Prisma enum → 文本 | 契约用 `text + CHECK` |
| 向量 | 无 | 规划 `pgvector`（T04） |
| RLS | 无（libSQL 无 RLS） | 依赖 `tenantId` 列 + RLS 纵深防御（见 §2.2） |

### 1.1 三个候选路线

| 路线 | 说明 | 优点 | 代价 | 建议 |
|---|---|---|---|---|
| **P1. 保持 libSQL，Postgres 仅作"契约语义"** | 不加 PG，只在应用层模拟 `jsonb`/`CHECK`/RLS | 零迁移风险；与现网一致 | 无法用 `pgvector` / RLS / `jsonb` 索引；AC-01 的「DB 级隔离」证据弱 | 仅当 T04 放弃向量检索时 |
| **P2. 迁移到 PostgreSQL（自托管/托管）** | 新增 PG 数据源，按契约落表 | 契约原样落地；RLS 可用；pgvector 可用 | **唯一会触碰线上数据**的路径，需双写/回填/切读/回退 | ⭐ **推荐**（若 T04 需要语义检索） |
| **P3. 迁到 Neon/Supabase 等托管 PG** | 托管 PG + 连接池 | 运维轻 | 地区/合规/延迟；成本 | 备选 |

> ⚠️ **记忆约束**：本项目对远程 Turso **禁止 `prisma db push`**（会 P1013 失败），
> 现行做法是 `migrate diff` 生成 SQL + 线上 `PRAGMA` 差集**只补缺口**。
> 若走 P2，这条约束随之失效，须另行验证 PG 迁移链路。

### 1.2 本计划采取的立场（待用户在 T01 开始时确认）

**默认走 P2，但按 §2 的「加列优先、双写过渡」执行**；若用户选 P1，则本文件的 §3 数据迁移降级为「仅应用层约束补齐」，§2.2 的 RLS 改为纯应用层强制 + 负测。

---

## 2. 兼容策略（Compatibility）

### 2.1 加列优先（Additive-first）

对既有 39 个 model 的 tenant 化，**一律先加可空列**，绝不先加 `NOT NULL`：

```
阶段 1  ADD COLUMN organization_id  (NULL 允许)   ← 不破坏任何既有查询
阶段 2  回填存量数据到"默认租户"
阶段 3  代码双读（有则用，无则回落默认租户）
阶段 4  观察期后加 NOT NULL + 索引 + FK
阶段 5  加 RLS 策略
```

任何阶段中断，生产都仍可运行 —— 这是「可回滚」的前提。

### 2.2 隔离模型

- 采用契约注释推荐的做法（`contracts/schema.sql:64-65`）：
  **`tenantId` 列 + 应用层强制 + DB 级 RLS 纵深防御**。
- **绝不信任客户端传来的 `organization_id`**（契约明文要求）→ tenant 只能从**服务端会话**推导。
- 跨租户 Bridge **不得直接查私有行**，必须走 opt-in 视图（T10）。

### 2.3 对外契约兼容

- 新 API 一律挂 `/v1`（对齐 `connection.openapi.yaml:7`），与既有 `/api/*` 并存，**不修改既有路径语义**。
- 既有 `/api/*` 保持可用；迁移完成后按「无流量 → 下线」次序收敛（对应 `REUSE_MATRIX.md` D4）。

---

## 3. 数据迁移（Migration）

### 3.1 迁移批次（每批独立可回滚）

| 批次 | 内容 | 前置 | 回滚 |
|---|---|---|---|
| **M0** | 建 `organizations` / `memberships` + 1 个「默认租户」承接存量 | 无 | `DROP TABLE`（无外键指向时） |
| **M1** | 既有表加 `organization_id`（可空） | M0 | `DROP COLUMN` |
| **M2** | 回填：全部存量行 → 默认租户 | M1 | 置回 NULL |
| **M3** | 新建闭环表：`missions` / `social_intents` / `connection_proposals` / `proposal_decisions` / `outcomes` / `audit_events` | M0 | `DROP TABLE`（新表，无存量数据） |
| **M4** | 既有 `Conversation` 增加 `proposal_id`（可空，关联 M3） | M3 | `DROP COLUMN` |
| **M5** | 加 `NOT NULL` + 索引 + FK + RLS | M2,M4 + 观察期 | 逐个 `DROP CONSTRAINT`（保守：保留列） |
| **M6** | （若 P2）libSQL → PostgreSQL 搬迁 | M5 | 保留 libSQL 只读副本直至验收 |

### 3.2 迁移脚本规范

- 每个批次提供 `--dry-run` 与 `--apply` 两个入口（与既有 `scripts/chat-merge/*.ts` 风格一致）。
- 幂等：以唯一锚点判定「已迁/未迁」，重复执行不产生副作用。
- 每批产出 `verify` 子命令，输出可断言的对账数字（行数、空值数、孤儿数）。
- **不设人为时间上限**；观察期长度由对账为准，不以"跑完了"为准。

### 3.3 对账口径（示例）

| 检查 | 断言 |
|---|---|
| 回填完整性 | `COUNT(*) WHERE organization_id IS NULL` = 0 |
| 孤儿 | 每条 proposal 的 `mission_id` / 两端 `person_id` 均存在 |
| 租户一致性 | 任一可跨租户查询的 SQL **必须**带 `organization_id` 谓词（静态检查） |
| 审计连续 | `audit_events` 无断链（若沿用哈希链） |

---

## 4. 回滚（Rollback）

### 4.1 分级回滚

| 级别 | 触发 | 动作 | 恢复时间目标 |
|---|---|---|---|
| L1 代码回滚 | 新版本异常 | Netlify 回滚到上一 ready deploy | 分钟级 |
| L2 特性回滚 | 新闭环入口异常 | 关闭新入口开关（env flag），保留数据 | 分钟级 |
| L3 迁移回滚 | M5/M6 出问题 | 执行该批次的逆向 SQL（列保留，仅去约束） | 小时级 |
| L4 数据回滚 | M6（PG 搬迁）验收失败 | 切回 libSQL 只读副本并恢复写入 | 小时级 |

### 4.2 回滚锚点

- **发布前**记录当前部署 ID 与 commit SHA（本项目 Netlify 站点 `c46478e9-7ac8-4fb…`）。
- **DB 变更前**：对受影响表做逻辑导出快照，落盘路径写入该任务 `rollback.md`。
- 已知历史锚点：`safety/pre-p1p2-20260930`（前次改造的安全回滚分支）。

### 4.3 回滚演练

T12 必须**实际演练**至少一次 L2 与一次 L3 回滚，并留下日志；不得只写文档。

---

## 5. 执行顺序与依赖

```
T00 审计（本文件产出）  ← 当前
   │
   ├─► T01 身份/多租户  ◄── 【最长路径，最早启动】
   │        └─ M0→M2→M5
   │
   ├─► T02 Mission Link ─┐
   ├─► T03 Intent       ─┼─► T04 双向匹配 ─► T05 同意/审计 ─► T06 介绍工作流
   │                     │                                        │
   │                     └────────────────────────────────────────┴─► T08 Outcome/计费
   │                                                                  │
   ├─► T07 SaaS Console  ◄────────────────────────────────────────────┘
   │
   ├─► T09 Agent Runtime ──► T10 Community Bridge ──► T11 Open SDK
   │
   └───────────────────────────────────────────► T12 全面验收（AC-01~25）
```

**必须遵守**：T01 的租户底座未就绪前，T02–T08 的**落库设计不得定稿**（否则要返工加 tenant）。
可按依赖并行，但**必须有单一契约与集成验收**（主指令第「实施顺序」节）。

---

## 6. 本文件的未决项（需用户确认）

| # | 待确认 | 影响 |
|---|---|---|
| Q1 | 数据层走 **P1 / P2 / P3** 哪条？ | 决定 T04 是否能用 pgvector、AC-01 是否可出 DB 级证据 |
| Q2 | 首个付费试点是否在本轮内**真接通** Creem 生产凭据？ | 决定 T08 是 PASS 还是 **BLOCKED** |
| Q3 | 性别词表统一口径（`MAN/WOMAN` vs 存量 `MALE/FEMALE`） | 决定是否需要数据迁移（当前产品未决） |
| Q4 | 是否允许在现网库上执行 M5（加 `NOT NULL` + RLS） | 影响停机窗口与回滚复杂度 |

> 上述未决项**不阻断 T00 结论**；T00 的产出（审计三件套）已按「不虚报」原则完成。

---

_产出：2026-10-10 · 基线 `6085d31`_
