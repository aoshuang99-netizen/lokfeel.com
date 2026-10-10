# T03 · rollback — 回滚步骤与演练记录

> 目标：**一条命令**把 T03 的 schema 变更退回迁移前状态，且**既有业务数据零丢失**。
> 演练在本地副本库上完成（不触碰生产），全流程可复现。

---

## 1. 批次结构（决定回滚顺序）

| 批次 | 表 | 归属 | 外键依赖 |
|---|---|---|---|
| `C0` | `Mission` / `MissionParticipation` / `IdempotencyRecord` | T02 | — |
| `C1` | `SocialIntent` | **T03** | → `Organization` / `Mission`(C0) / `User` |

`apply` 按 **C0 → C1**，`rollback` 按 **C1 → C0 逆序**（先删引用方，否则被外键挡住）。
两个批次**互不依赖**，因此可以只回滚 T03（`--batch=C1`）而保留 T02 的表。

---

## 2. 回滚命令

```bash
# 只回滚 T03（推荐：保留 T02 的三张表）
node scripts/connection/migrate.mjs rollback --batch=C1 --yes

# 回滚整个 Connection OS（T02 + T03）
node scripts/connection/migrate.mjs rollback --batch=ALL --yes

# 对账（回滚后**预期失败** —— 失败即"已回到迁移前"）
node scripts/connection/migrate.mjs verify
```

指定其他库（演练/其他环境）：加 `--url=file:/tmp/xxx.db`。
**不带 `--yes` 不产生任何写操作**（默认只读）。

**内置数据保护**：`rollback` 在删表前会**自动导出该表的数据**到
`.rollback-backup-<Table>-<timestamp>.json`（仅当表非空），并在日志中打印路径。
这是"删表不可避免会丢该表数据"的兜底，不是备份替代品。

---

## 3. 演练记录（本地副本，2026-10-10）

副本：`/tmp/t03-rollback.db`（由 E2E 夹具库复制，含真实 C0 + C1 表与种子数据）。

| # | 步骤 | 命令 | 结果 |
|---|---|---|---|
| ① | 备份 | `cp /tmp/t03-rollback.db /tmp/t03-rollback.bak.db` | 1,220,608 bytes |
| ② | 回滚前对账 | `migrate.mjs verify --url=…` | ✅ **42/42**，exit 0 |
| ③ | 回滚 C1 | `migrate.mjs rollback --batch=C1 --yes --url=…` | ✅ exit 0；**自动备份** `SocialIntent` 1 行 → `.rollback-backup-SocialIntent-1791629216133.json`；`SocialIntent 已删除` |
| ④ | 回滚后对账 | `migrate.mjs verify --url=…` | ✅ **按预期失败**：`25/35`，exit **1**（10 项 SocialIntent 断言全红，其余 25 项仍绿） |
| ⑤ | 业务数据核对 | 逐表 `COUNT(*)` | ✅ **零丢失**（见下表） |
| ⑥ | 重新应用 | `migrate.mjs apply --batch=C1 --yes --url=…` | ✅ exit 0 |
| ⑦ | 恢复后对账 | `migrate.mjs verify --url=…` | ✅ **42/42**，exit 0 |

### ⑤ 业务数据核对（回滚前后逐表对比）

| 表 | 回滚前 | 回滚后 | 判定 |
|---|---:|---:|---|
| `Organization` | 1 | 1 | ✅ 不变 |
| `User` | 2 | 2 | ✅ 不变 |
| `Membership` | 2 | 2 | ✅ 不变 |
| `Mission`（C0） | 2 | 2 | ✅ 不变 |
| `MissionParticipation`（C0） | 1 | 1 | ✅ 不变 |
| `IdempotencyRecord`（C0） | 0 | 0 | ✅ 不变 |
| `SocialIntent`（C1） | 1 | 表不存在 | 预期：C1 被回滚 |

**结论**：回滚 `C1` 只影响 `SocialIntent` 本身；C0 的表与其数据、以及租户/用户/成员关系**完全未受影响**。

> ⚠️ 注意 `SocialIntent` 的**行数据随表消失**（这是 `DROP TABLE` 的语义，不是缺陷）。
> 需要保留时用 ③ 自动导出的 JSON，或事先做库级备份。

---

## 4. 前置条件与注意事项

1. **回滚前先备份**：`migrate.mjs` 的自动导出只覆盖"将被删除的表"，不覆盖其他表。
   生产回滚前应有库级快照（Turso 侧快照或 `cp`/dump）。
2. **应用代码需同时回退**：`SocialIntent` 表删掉后，T03 的 API 路由（`/api/v1/intents*`、
   `/api/v1/missions/[missionId]/intents`）与意图页会因查询不存在的表而 500。
   **回滚顺序**：先回退应用（部署上一个版本）→ 再删表。
3. **`prisma db push` 依旧不可用**（远程 Turso P1013）—— 迁移与回滚都只走 `migrate.mjs`。
4. **只在必要时回滚**：C1 是纯新增（`CREATE TABLE IF NOT EXISTS`），对既有表零改动，
   正常情况应向前修复而不是回退。

---

## 5. 生产现状

`SocialIntent` 已在生产库应用（`apply --batch=C1 --yes`，随后 `verify` 42/42，全库 49 张表，
`SocialIntent` 0 行）。**尚未回滚过生产**——演练均在本地副本完成。
