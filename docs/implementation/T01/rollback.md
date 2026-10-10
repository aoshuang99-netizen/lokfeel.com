# T01 · rollback — 回滚方案（含**实测演练**）

> 主指令要求「迁移可回滚」，`MIGRATION_PLAN.md` §4.3 要求 T12 必须**实际演练**。
> 本任务已提前在本地库上完成一次完整演练（见 §3），**不是纸面方案**。

---

## 1. 分级回滚

| 级别 | 触发 | 动作 | 恢复目标 |
|---|---|---|---|
| **L1 代码回滚** | 新版本异常 | Netlify 回滚到上一 ready deploy | 分钟级 |
| **L2 特性回滚** | 新闭环入口异常 | 关闭 env flag，保留数据 | 分钟级 |
| **L3 迁移回滚** | M0–M2 出问题 | `npm run tenancy:rollback`（见 §2） | 分钟级 |
| **L4 数据回滚** | M6（PG 搬迁）失败 | 切回 libSQL 只读副本并恢复写入 | 小时级 |

**本任务只涉及 L3**（M0–M2 是本轮唯一执行的迁移）。

---

## 2. 回滚操作（一条命令）

```bash
# 预览将做什么（只读）
npm run tenancy:probe

# 完整回滚（M2⁻ → M1⁻ → M0⁻ 逆序）
node scripts/tenancy/migrate.mjs rollback --batch=ALL --yes

# 只回退某一批
node scripts/tenancy/migrate.mjs rollback --batch=M2 --yes   # 仅把回填值置空
node scripts/tenancy/migrate.mjs rollback --batch=M1 --yes   # 仅删列
node scripts/tenancy/migrate.mjs rollback --batch=M0 --yes   # 仅删三表

# 回滚后确认（应**失败**，代表已回到迁移前）
npm run tenancy:verify
```

### 各批次逆操作细节

| 批次 | 逆操作 SQL | 幂等性 |
|---|---|---|
| **M2⁻** | `UPDATE "X" SET "organizationId" = NULL WHERE "organizationId" = 'org_default'` | 天然幂等 |
| **M1⁻** | `DROP INDEX IF EXISTS "X_organizationId_idx"` + `ALTER TABLE "X" DROP COLUMN "organizationId"` | 先查 `PRAGMA` 判断列是否存在 |
| **M0⁻** | `DROP TABLE IF EXISTS "TenantAuditEvent"` → `"Membership"` → `"Organization"` | `IF EXISTS` |

> ⚠️ **M0⁻ 的顺序不可颠倒**：必须先删两张子表，再删 `Organization`，
> 否则在启用 FK 强制的实例上会被拒绝。

---

## 3. 实测演练记录（2026-10-10 · 本地库副本）

**演练环境**：`/tmp/t01-rollback.db`（从已完成 M0–M2 的演练库复制而来）

### 回滚前

```
Organization     已存在 (列 6, 行 1)
Membership       已存在 (列 7, 行 0)
TenantAuditEvent 已存在 (列 8, 行 0)
11 张业务表       均有 organizationId
```

### 执行 `rollback --batch=ALL --yes`

```
[M2⁻] 置空   Block 1 行、Conversation 2 行、PowerBoardRule 1 行（其余 0）
[M1⁻] 移除   11/11 表 organizationId 列全部成功
[M0⁻] 删除   TenantAuditEvent / Membership / Organization 三表
```

### 回滚后

| 检查 | 结果 |
|---|---|
| 三表状态 | ⬜ 全部「不存在」✅ |
| 11 表列状态 | ⬜ 全部「缺 organizationId」✅ |
| **数据完整性** | `User=2 · Conversation=2 · Block=1 · PowerBoardRule=1` —— **与迁移前完全一致，零丢失** ✅ |
| `verify` | ❌ 7 项未通过 → 正确代表「已回到迁移前」✅ |

> **结论：回滚链路完整可用，且不损失任何业务数据。**
> （因为 M1 只加可空列、M2 只改新列的值，原始业务字段从未被触碰。）

---

## 4. 生产回滚的前提与注意

| # | 事项 |
|---|---|
| 1 | **本轮生产已是「迁移后」状态**。若要回滚生产，直接执行 §2 的 `rollback --batch=ALL --yes` 即可（本地已验证同一套代码路径） |
| 2 | 回滚前建议先跑 `npm run tenancy:probe` 留档（记录当前列/行数），作为回滚后的对照基线 |
| 3 | 回滚 M0 会**删除** `Membership` 表 —— 若届时已有真实成员数据，需先导出（`SELECT * FROM "Membership"`） |
| 4 | 回滚不会影响任何既有业务表的数据列（`organizationId` 是唯一被删的列，且它是本轮新加的） |
| 5 | **回滚锚点**：迁移前的状态已留证于 `changes.md` §3（三表不存在、11 表无列） |

---

## 5. 与既有回滚资产的关系

| 资产 | 用途 |
|---|---|
| `safety/pre-p1p2-20260930`（分支） | 上一轮改造的安全回滚分支，与本任务无关 |
| Netlify 上一 ready deploy | L1 代码回滚锚点（本项目站点 `c46478e9-7ac8-4bcf-9052-7638b04fef83`） |
| `scripts/tenancy/migrate.mjs rollback` | **本任务新增**，L3 迁移回滚入口 |

---

_产出：2026-10-10 · 演练环境：本地库副本（生产未被本次演练触碰）_
