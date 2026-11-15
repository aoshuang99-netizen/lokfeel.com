# C05 · Prisma 迁移与数据完整性（V21 第三批）

> **结论**：迁移文件已生成并通过隔离库验证（18/18 gate PASS，脚本退出码 0）。
> **未对生产库执行任何迁移**；生产执行需 Owner 单独授权（见 §7）。
> 唯一未闭环项不是本次变更引入的：本仓 `prisma/migrations` 的历史文件无法在 SQLite 上重放（§4），
> 因此 `prisma migrate deploy` **不能**用于从零构建或推进生产库，如实记录在报告 `knownLimitations`。

| 项 | 值 |
| --- | --- |
| 迁移版本 | `20261115120000_v21_batch2_execution_loop` |
| 迁移目录 | `prisma/migrations/20261115120000_v21_batch2_execution_loop/` |
| 前向 SQL | `migration.sql`（3,500 B，sha256 见报告 `migration.files`） |
| 回滚 SQL | `down.sql`（2,441 B，只删 3 张新表，**不删列**） |
| 验证脚本 | `scripts/qa/v21-batch3-migration-compat.mjs` |
| 验证报告 | `docs/v21/batch3/migration-report.json` |
| Prisma / Node | `@prisma/client` 7.10.1 · Node v22.22.2 · SQLite（libSQL/Turso 兼容） |

---

## 1. 变更内容（纯新增）

### 1.1 新增表（3）

| 表 | 用途 | 唯一键 |
| --- | --- | --- |
| `MissionSpecRevision` | C04 字段级编辑的版本留痕 | `@@unique([missionId, version])` |
| `ExecutionVerification` | G09 独立成果核验 | `@@unique([missionId, runId])` |
| `AgentRunStageEvent` | C03 编排阶段事件（非 token 流） | `@@unique([runId, seq])` |

三张表都只存 `organizationId` 字符串作为**软引用**，刻意不建 `Organization` 外键关系
（理由见 `prisma/schema/v21.prisma` 抬头注释：避免改动本批次之外的既有模型）。
租户隔离由服务端 `where: { organizationId, ... }` 谓词保证。

### 1.2 新增列（2，均可空）

| 表 | 列 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `Mission` | `sourceRunId` | `TEXT` | 无（NULL） | 指向派生出该任务的 `AgentRun`，软引用 |
| `IdempotencyRecord` | `actorId` | `TEXT` | 无（NULL） | 幂等键发起人，纵深防御，不参与唯一约束 |

旧行一律为 `NULL`，**没有任何回填**。

### 1.3 新增索引（6）

| 表 | 索引 | 唯一 | 列 |
| --- | --- | --- | --- |
| `MissionSpecRevision` | `MissionSpecRevision_missionId_version_key` | ✅ | `missionId, version` |
| `MissionSpecRevision` | `MissionSpecRevision_organizationId_missionId_version_idx` | — | `organizationId, missionId, version` |
| `ExecutionVerification` | `ExecutionVerification_missionId_runId_key` | ✅ | `missionId, runId` |
| `ExecutionVerification` | `ExecutionVerification_organizationId_missionId_idx` | — | `organizationId, missionId` |
| `AgentRunStageEvent` | `AgentRunStageEvent_runId_seq_key` | ✅ | `runId, seq` |
| `AgentRunStageEvent` | `AgentRunStageEvent_organizationId_runId_seq_idx` | — | `organizationId, runId, seq` |

无 `DROP`、无重建、无 `UPDATE`/`DELETE`/`INSERT`；两条 `ALTER TABLE` 均为 `ADD COLUMN`（脚本 M01 静态断言）。

---

## 2. SQL 的权威来源（可复现）

`migration.sql` 不是手写猜测，而是 Prisma 生成后原样抄录：

```bash
# 1) 构造「迁移前快照」：当前 prisma/schema 去掉 v21.prisma，
#    并去掉 Mission.sourceRunId / IdempotencyRecord.actorId 两行
#    （脚本 M02 自动完成，产物 /tmp/v21-batch3-compat/schema-before）

# 2) 生成增量 SQL
npx prisma migrate diff \
  --from-schema /tmp/v21-batch3-compat/schema-before \
  --to-schema prisma/schema \
  --script
```

验证脚本 M03 会重新执行上述 diff，并把结果与 `migration.sql` **逐句比对**（去注释与空行）：

- 期望 sha256：`b70b37dade13a846e6c253003f60bf58413d9774746fe9a014f9852d3e2fa868`
- 实际 sha256：`b70b37dade13a846e6c253003f60bf58413d9774746fe9a014f9852d3e2fa868`
- 结论：**完全一致（含语句顺序）**

快照的构造方式等价于「已应用完 T05 之前的全部迁移」，且不含本次增量，因此 diff 里不会混入其它漂移。

---

## 3. expand → compat → contract

| 阶段 | 本批次做法 | 状态 |
| --- | --- | --- |
| **expand** | 只加表 / 加可空列 / 加索引；不改既有列语义、不删任何东西 | 本迁移 |
| **compat** | 新旧代码与同一份 schema 并存：新列全可空、新表只被新代码读写；旧 Prisma Client 的 `SELECT` 不引用新列，`INSERT` 不写新列 → 落 `NULL`，语义安全 | 已验证（M11–M15） |
| **contract** | **本批次不做**。物理删除列在 SQLite 上等于重建表（§6），收益极低（两列均可空、无索引、无外键），风险极高；保留列不影响旧代码 | 明确推迟，无时间表 |

`down.sql` 只覆盖 expand 阶段的「删新表」；contract 阶段不提供假回滚。

---

## 4. 为什么不用 `prisma migrate deploy` 建库（已实测）

`prisma/migrations` 里的历史文件是**变更记录**，不是可重放脚本
（`20261010150000_t01_tenancy/migration.sql` 抬头原文：「本文件是变更记录，不是可重复执行的迁移脚本」）。
其中三个文件是 PostgreSQL 方言：

- `20250413130000_add_product_optimization_features`：`DO $$ … CREATE TYPE …`
- `20250425170000_add_gallery_photos`：`TEXT[] DEFAULT ARRAY[]::TEXT[]`
- `20260428130000_add_card_verification`：`ADD COLUMN IF NOT EXISTS` / `TIMESTAMP(3)`

实测（脚本 L01 探针，隔离库 `/tmp/v21-batch3-compat/v21-mig-deploy-probe.db`）：

```
DATABASE_URL=file:/tmp/v21-batch3-compat/v21-mig-deploy-probe.db npx prisma migrate deploy
→ exit 1
Error: P3018
Migration name: 20250413130000_add_product_optimization_features
Database error: near "DO": syntax error
```

同理，`prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema` 也会失败
（P3006，shadow DB 上重放同一文件时报同样的 `near "DO"`）。
**这是仓库既有状态，不是本迁移引入的**；报告把它单列为 `knownLimitations[0]`
（`classification: PRE_EXISTING_ENVIRONMENT_CONSTRAINT`、`introducedByThisChange: false`、含原始输出），
不计入本次 18 项 gate，也不掩盖。

因此验证脚本采用的等价路径是：

```
迁移前 schema 快照 --(migrate diff --from-empty)--> 基线 SQL（63 张表）
        → 应用到 /tmp 干净库 → 应用本次 migration.sql → 断言
```

这既走了 Prisma 自己的 DDL 生成器，又保证「起点 = 历史迁移的终态」。

---

## 5. 验证命令与实测结果

运行（仓库根目录）：

```bash
node scripts/qa/v21-batch3-migration-compat.mjs
```

| # | 命令 / 步骤 | 退出码 | 结果 |
| --- | --- | --- | --- |
| 1 | `node scripts/qa/v21-batch3-migration-compat.mjs` | **0** | **PASS 18/18**，`docs/v21/batch3/migration-report.json` |
| 2 | `npx prisma validate` | 0 | `The schemas at prisma/schema are valid`（M16） |
| 3 | `npx prisma migrate diff --from-schema <快照> --to-schema prisma/schema --script` | 0 | 与 migration.sql 逐句一致（M03） |
| 4 | `DATABASE_URL=file:/tmp/…/v21-mig-clean.db npx prisma db execute --file …/migration.sql` | 0 | 干净库应用成功（M05） |
| 5 | `DATABASE_URL=file:/tmp/…/v21-mig-legacy.db npx prisma db execute --file …/migration.sql` | 0 | 旧数据库应用成功（M12） |
| 6 | `DATABASE_URL=file:/tmp/…/v21-mig-deploy-probe.db npx prisma migrate deploy` | 1 | 失败，历史 PG 迁移；见 §4（L01，非 gate） |

18 项 gate 明细（全部 PASS）：

| ID | 断言 | 实测 |
| --- | --- | --- |
| M01 | migration.sql 纯新增 | forbidden=0，ALTER=2（均 ADD COLUMN），非 ADD COLUMN=0 |
| M02 | 迁移前快照可构造 | 8 个 `.prisma`，裁剪 2 行 |
| M03 | 与 Prisma 生成结果一致 | sha256 相同 |
| M04 | 干净库应用基线 | 63 表，新表 0，`Mission` 17 列（无 `sourceRunId`） |
| M05 | 干净库应用新迁移 | `db execute` exit 0 |
| M06 | 3 张新表 + 列语义 | 缺失表=无，语义不符=无 |
| M07 | 2 个新列可空 | `notnull=0`、`dflt_value=null` |
| M08 | 6 条索引 + 列序 | 6/6 |
| M09 | 唯一约束真实生效 | 3/3 重复插入被 SQLite 拒绝 |
| M10 | 相对基线纯新增 | +3 表 / +2 列 / 丢失 0 表 0 列；63 → 66 表 |
| M11 | 旧库 + 旧数据写入 | Mission/IdempotencyRecord 均写入，旧表无新列 |
| M12 | 旧数据迁移后仍可读 | 字段逐一比对一致 |
| M13 | 旧行新列为 NULL | `sourceRunId=null`、`actorId=null` |
| M14 | 新列可写、旧行不增不减 | 写入成功，Mission 行数仍为 1 |
| M15 | 旧库新表可用 | 各插入 1 行成功 |
| M16 | `prisma validate` | exit 0 |
| M17 | `src/generated` 含 3 张新表 + 2 个新字段 | 缺失=无 |
| M18 | `down.sql` 无假回滚 | 仅 3 条 `DROP TABLE`（均为新表），`DROP COLUMN`=0 |

报告中每项都带**真实 SQLite 查询结果**（`PRAGMA table_info`、`PRAGMA index_list`/`index_info`、
`sqlite_master` 清单、插入冲突的原始报错），不是人工填写的通过标记。
报告同时记录全部 8 条子命令的 `command / exitCode / stdout / stderr`。

隔离性：所有库在 `/tmp/v21-batch3-compat/` 下，每次运行前重建；`ci-e2e.db` 未被读写
（运行前后 mtime 保持 `2026-11-15 17:34:31`）。

---

## 6. 备份与回滚（SQLite 的真实限制）

### 6.1 回滚能做什么

`down.sql` 只做一件事：按任意顺序 `DROP TABLE IF EXISTS` 三张新表
（三者之间无外键依赖）。删表会丢失这三张表的留痕数据 —— 回滚前必须备份。

### 6.2 回滚**不能**做什么（不写假回滚）

SQLite 的 `ALTER TABLE … DROP COLUMN`（3.35+ 才支持）在本项目不可用为回滚手段：

1. 失败模式随版本与 libSQL/Turso 实现漂移（索引 / 视图 / 触发器 / 生成列引用都会挡）；
2. 语义是**整表重建**（建新表 → 拷数据 → 删旧表 → 改名 → 重建索引）。`Mission` 带多条外键、
   多列索引、`@updatedAt` 语义，`IdempotencyRecord` 带唯一键 + 组织外键；任何一步中断都会留下半张表；
3. 收益为零：两列均**可空、无默认值、无索引、无外键**，旧 Prisma Client 既不读也不写，保留完全无害。

因此 `down.sql` **刻意不包含** `DROP COLUMN`，只在注释里写明：生产回滚用**备份恢复**；
若确需物理移除列，走维护窗口 + SQLite 官方 12 步表重建流程（人工、有演练、有备份）。

### 6.3 生产回滚顺序

1. 先回滚**应用代码**到不引用新表/新列的版本（新列可空，旧代码可直接跑在新 schema 上）；
2. 若仍需删表：备份 → `down.sql` → 校验旧表行数与索引未变；
3. 若 schema 本身要回到迁移前：**用迁移前备份整库恢复**，不要手工删列。

---

## 7. 生产执行前必须做的事

> ⚠️ 本节是**待办清单**，不是已完成的记录。C05 只在 `/tmp` 隔离库上验证。

1. **Owner 单独书面授权**：说明目标库（Turso 主库/分支）、窗口、执行人、回滚责任人。
   未获授权前不得对生产执行任何 DDL。
2. **备份并验证可恢复**：Turso 分支快照或 `turso db shell <db> .dump > backup.sql`；
   记录备份 sha256 与恢复演练结果（只备份不演练等于没备份）。
3. **只读预检**（不写库）：确认 3 张新表不存在、2 个新列不存在、6 个索引名未被占用；
   记录 `Mission` / `IdempotencyRecord` 行数作为执行后对账基线。
4. **选低峰窗口 + 串行**：SQLite 写锁是库级的；`CREATE TABLE`/`ADD COLUMN` 虽快，
   但需避免与长事务/大批量写入并发。禁止与 `db push`、其它迁移脚本并行。
5. **按序执行 `migration.sql` 一次**：本文件**不是幂等脚本**（`CREATE TABLE` 无 `IF NOT EXISTS`），
   重复执行会报 "table already exists"。执行方式：
   `DATABASE_URL=<生产 URL> npx prisma db execute --file prisma/migrations/20261115120000_v21_batch2_execution_loop/migration.sql`
6. **对账**：执行后重跑 `PRAGMA table_info` / `index_list`，确认 3 表 + 2 列 + 6 索引；
   行数与第 3 步一致（纯新增不应改变任何既有行数）。
7. **`_prisma_migrations` 记账**：由于 `prisma migrate deploy` 不可用（§4），
   若团队要求迁移历史可查，需在变更窗口内单独插入一条 `20261115120000_v21_batch2_execution_loop`
   记录（`checksum` = `migration.sql` 的 sha256，见报告）。**不要**用 `migrate resolve --applied`
   在未实际执行 DDL 的库上打勾。
8. **回滚演练**：在预发/分支库上跑一次 `down.sql`，确认删表后应用仍可用。
9. **监控**：执行后观察 5xx、`SQLITE_BUSY`、Prisma `P2021`（表不存在）/`P2022`（列不存在）。
10. **CI 侧**：`ci-e2e.db` 等既有测试库由主代理管理，本次**未执行** `db push`/`migrate dev`；
    若测试库需要新表，由主代理在服务停止后统一应用，避免与运行中的服务抢锁。

---

## 8. 风险与未闭环项

| 风险 | 等级 | 说明 / 缓解 |
| --- | --- | --- |
| **SQLite 列无法安全回滚** | 中 | 见 §6.2。缓解：两列可空无害；真要回退用备份恢复。这是本任务最需要 Owner 知情的点。 |
| **历史迁移不可重放** | 中（既有） | `migrate deploy` 报 P3018、`migrate diff --from-migrations` 报 P3006，在 SQLite 上必然失败。缓解：生产走单文件 `db execute` + 人工记账；中期建议做一次「squash 基线」治理（独立任务）。 |
| **迁移非幂等** | 低 | 只能执行一次；重复执行报错但不破坏数据。缓解：执行前只读预检 + 执行后对账。 |
| **新增 `migration_lock.toml`** | 低 | 仓库此前缺失该文件，导致 Prisma CLI 无法识别 provider（`Could not determine the connector`）。本次补 `provider = "sqlite"`，属 Prisma 标准元数据，不影响运行时代码。 |
| **为新表补 `Organization` 外键** | 低（有意为之） | 三张新表用软引用；租户隔离靠服务端谓词。若未来要加 FK，需单独迁移并在 `Organization` 加反向关系。 |
| **生产未执行** | — | 本任务**没有**连接生产库、没有执行任何 DDL、没有推送 git。 |

**BLOCKED 声明**：本次没有因失败而 BLOCKED 的 gate；唯一失败项是 §4 的历史迁移重放探针，
属于**既有环境约束**，已在报告 `knownLimitations` 中带原始输出记录，并明确「不由本次变更引入」。
若要把「生产可用 `prisma migrate deploy`」作为验收条件，则该项应判 **BLOCKED**，需另立迁移基线治理任务。

---

## 9. 复现与产物

```bash
# 验证（隔离库，退出码 0 = 18/18 PASS）
node scripts/qa/v21-batch3-migration-compat.mjs

# 产物
#   docs/v21/batch3/migration-report.json   ← 逐项 PASS/FAIL + PRAGMA/sqlite_master 实测
#   /tmp/v21-batch3-compat/                 ← 基线 SQL、期望 SQL、两个隔离库、deploy 探针库
```

```bash
# 只读复核（不写库）
node -e 'const r=require("./docs/v21/batch3/migration-report.json");console.log(r.status, r.summary)'
```
