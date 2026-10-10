# T02 · rollback — 回滚方案（含**实测演练**）

> 主指令要求「迁移可回滚」。本任务已在本地库副本上完成一次**完整演练**（见 §3），**不是纸面方案**。

---

## 1. 分级回滚

| 级别 | 触发 | 动作 | 恢复目标 |
|---|---|---|---|
| **L1 代码回滚** | 新版本异常 | Netlify 回滚到上一 ready deploy | 分钟级 |
| **L2 特性回滚** | 分享页被滥用 / 不想对外 | 把 Mission 置 `PAUSED`/`CLOSED`（**保留数据**），或关 `publicPreview` | 分钟级 |
| **L3 迁移回滚** | C0 出问题 | `node scripts/connection/migrate.mjs rollback --batch=C0 --yes` | 分钟级 |
| **L4 数据回滚** | 误删分享任务 | 用 `rollback` 自动落盘的 JSON 备份恢复 | 分钟级 |

> **本任务的"首选回滚"其实是 L2，不是 L3**：分享页的开关是状态字段，
> 不需要动 schema。L3 只在"整批表要下线"时才用。

---

## 2. 回滚操作（一条命令）

```bash
# 预览将做什么（只读）
npm run connection:probe

# 完整回滚 C0（逆序删表：IdempotencyRecord → MissionParticipation → Mission）
node scripts/connection/migrate.mjs rollback --batch=C0 --yes

# 回滚后确认（**应失败**，代表已回到迁移前）
npm run connection:verify
```

### 逆操作的顺序与保护

| 步骤 | 动作 | 保护 |
|---|---|---|
| 1 | `DROP TABLE IF EXISTS "IdempotencyRecord"` | `IF EXISTS`；存在即删 |
| 2 | `DROP TABLE IF EXISTS "MissionParticipation"` | **有数据时先备份到 `.rollback-backup-*.json` 再删** |
| 3 | `DROP TABLE IF EXISTS "Mission"` | 同上 |

> ⚠️ **顺序不可颠倒**：必须先删子表（含外键指向 `Mission` 的两张），再删 `Mission`，
> 否则在启用 FK 强制的实例上会被拒绝（本库 FK **确实是强制的**，见 `tests.md` §4）。

> ⚠️ **删表不会静默丢数据**：`rows > 0` 时先把整表 `SELECT *` 落成 JSON 备份，
> 打印备份文件名后才执行 `DROP`。这条不是可选项 —— "回滚"不应该等于"丢数据"。

---

## 3. 实测演练记录（2026-10-10 · 本地库副本）

**演练环境**：`/tmp/t02-rollback.db`（由已完成 C0 的夹具库 `/tmp/t02-e2e.db` 复制而来，**生产未被触碰**）

### 回滚前

```
发现 45 张表
── C0 目标表状态 ──
  ✅ Mission                已存在 (列 17, 行 2)
  ✅ MissionParticipation   已存在 (列 8, 行 1)
  ✅ IdempotencyRecord      已存在 (列 8, 行 0)

业务数据：Organization 1 · User 2 · Membership 2
```

### 执行 `rollback --batch=C0 --yes`

```
◀ 回滚 batch=C0（逆序删表，先子后父）
  ✅ IdempotencyRecord 已删除
  💾 MissionParticipation 有 1 行，已备份 → .rollback-backup-MissionParticipation-*.json
  ✅ MissionParticipation 已删除
  💾 Mission 有 2 行，已备份 → .rollback-backup-Mission-*.json
  ✅ Mission 已删除
```

### 回滚后

| 检查 | 结果 |
|---|---|
| 表总数 | **45 → 42**（恰好减少 C0 的三张）✅ |
| 三表状态 | ⬜ 全部「不存在」✅ |
| `verify` | ❌ **0/19** 全项失败，**真实 exit=1** ✅（正确代表「已回到迁移前」） |
| **业务数据完整性** | `Organization=1 · User=2 · Membership=2` —— **与回滚前逐字一致，零丢失** ✅ |
| 备份可用性 | 两个 JSON 备份均落盘（`Mission` 1,628 B · `MissionParticipation` 297 B）✅ |

> **结论：回滚链路完整可用，且不损失任何既有业务数据。**
> 原因：C0 只新建三张表，**从未触碰任何既有表的列**。
> （演练产物用完即删，未进入提交。）

---

## 4. 生产回滚的前提与注意

| # | 事项 |
|---|---|
| 1 | **生产库当前已是「迁移后」状态**（C0 已执行，`verify` 25/25，三表均 0 行）。若要回滚生产，直接执行 §2 的命令即可（本地已验证同一套代码路径） |
| 2 | 回滚前先跑 `npm run connection:probe` 留档（记录列/行数），作为回滚后的对照基线 |
| 3 | ⚠️ **生产库若已有真实 Mission 数据，回滚会把它们移出 schema**——数据会先备份成 JSON，但**分享链接会立即失效**（`/m/<token>` 全部 404）。这是有意的：宁可失效也不静默丢数据 |
| 4 | ⚠️ 回滚 `Mission` 会级联影响 `MissionParticipation`（子表先删，故无悬挂） |
| 5 | **回滚锚点**：迁移前状态 = 三表均不存在（T01 的 `probe` 输出即为留证；C0 是本轮唯一新增批次） |

---

## 5. 与既有回滚资产的关系

| 资产 | 用途 |
|---|---|
| `scripts/tenancy/migrate.mjs rollback` | T01 的 L3 入口（tenancy 三表） |
| `scripts/connection/migrate.mjs rollback` | **本任务新增**，Connection OS 的 L3 入口（C0 三表） |
| Netlify 上一 ready deploy | L1 代码回滚锚点（站点 `c46478e9-7ac8-4bcf-9052-7638b04fef83`） |
| `safety/pre-p1p2-20260930`（分支） | 上一轮改造的安全回滚分支，与本任务无关 |

> 两套 migrate 脚本**互不覆盖**：tenancy 批次（M0–M2）与 connection 批次（C0）作用于不同表集，
> 可独立回滚，互不干扰。

---

_产出：2026-10-10 · 演练环境：本地库副本（生产未被本次演练触碰） · 代码提交 `49ee97d`_
