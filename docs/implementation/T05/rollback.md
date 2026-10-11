# T05 · rollback — 回滚

> **一句话**：本刀是**纯新增**（两张新表 + 10 个索引，**无** ALTER / **无** DROP / **无** 数据订正），
> 迁移与回滚都**零停机**。默认回滚只需回滚代码；两张表留在原地即可（空表不影响任何既有查询）。

---

## 1. 与 T04 的关键差别：本刀**有 DDL**（T04 是零 DDL）

T04 是"往 `enum` 追加成员"，对 `TEXT` 列不产生任何 DDL 差异，所以它的回滚**没有数据库步骤**。
T05 不同 —— 它真的建了两张表。因此本文件必须给出**可执行的** DDL 回滚路径，
而不是像 T04 那样写"本刀零 DDL，无数据库回滚"。

| 项 | T04 | T05 |
|---|---|---|
| 迁移性质 | 零 DDL（枚举成员不落 DDL） | **纯新增**（2 表 + 10 索引） |
| 上线是否需要窗口 | 不需要 | 不需要（新建表不锁既有表） |
| 回滚是否需要 DDL | 不需要 | 可选（见 §3 / §4） |
| 数据丢失风险 | 无 | 仅在选方案 B（DROP）时才有 |

迁移文件：`prisma/migrations/20261011170000_t05_connection_consent/migration.sql`（72 行）。
内容为 `npx prisma migrate diff --script` 的**原样抄录**（不手写猜测，保证 Prisma client
与真实表结构不漂移）。已逐行核对：**无** `ALTER`、**无** `DROP`、**无** `UPDATE`。

---

## 2. 正向迁移（幂等）

```bash
# 只读预演：打印将要执行的 SQL，不产生任何写操作
node scripts/connection/migrate.mjs plan --batch=C2

# 执行（需要显式 --yes；脚本默认只读）
node scripts/connection/migrate.mjs apply --batch=C2 --yes

# 对账
node scripts/connection/migrate.mjs verify
```

**幂等机制**：`migrate.mjs` 不依赖"跑过一次"的记忆，而是每次用
`PRAGMA table_info("<表>")` 读**实际**表结构，与目标定义求差集，**只补缺口**。
因此重复 `apply` 是安全的，且**不会**因为"DDL 里没有 `IF NOT EXISTS`"而报错。

> ⚠️ 判"表是否存在"必须看 `PRAGMA table_info()` 返回的**行数**：
> 对不存在的表它返回**空集而不是报错**，而 `[]` 在 JS 里是 truthy ——
> 只看返回值真假会把"不存在"判成"存在"（本仓已踩过）。

批次顺序：`ALL_BATCHES = ['C0', 'C1', 'C2']`（apply 按数组顺序，rollback 逆序）。
C2 内部也有依赖方向：`ProposalDecision` 的外键指向 `ConnectionProposal`。

---

## 3. 回滚方案 A（默认）：**只回滚代码，保留两张表**

适用：新功能出问题，需要立刻回到 T05 之前的线上行为。

```bash
# 在 main 上，撤销 T05 的交付提交
git revert --no-edit <T05 交付提交 SHA>
# 或整体回退到基线
git reset --hard cca7b80          # ⚠️ 仅在确认无其他人基于 T05 提交时使用
```

**为什么默认不删表**：

1. 两张表在回滚后的代码里**无人读取**，留着不产生任何行为差异 ——
   它们是纯粹的"死数据"，不会让任何既有查询变慢（无外键指向它们以外的热点表）。
2. **删表是不可逆的**；而回滚往往是因为"先回退再修再前滚"，
   届时若数据已丢，用户此前表达过的同意/拒绝就永久消失了 —— 而那是**同意记录**，
   在合规语境下恰恰是最不该丢的一类数据。
3. 再次前滚（重新发布 T05）时，`@@unique([missionId, proposerId, candidateId])`
   会让旧的提案行被复用/冲突 —— 因此**前滚前应先评估**这批历史行是否仍是有效业务事实。

**预期效果**：`/m/<token>/proposals` 变成 404；候选页的"发起连接"表单消失；
`/m/<token>` 上的"我的连接 →"链接消失；`posts /connections/{id}/consent|revoke|introduce`
全部 404。**用户数据与档案披露不受影响**。

---

## 4. 回滚方案 B（需要连数据一起清）：**删表**

适用：迁移本身出错（表结构与代码不一致）、或需要把环境彻底还原成 T05 之前的样子。

### 4.1 用官方脚本（推荐 —— 它**先备份行再删**）

```bash
node scripts/connection/migrate.mjs rollback --batch=C2 --yes
```

**实测输出**（在 `/tmp/t05-drill2.db`（种子的**副本**）上执行，非任何真实库）：

```
目标库：file://
命令：rollback

◀ 回滚 batch=C2（逆序：C2）
  💾 ProposalDecision 有 6 行，已备份 → .rollback-backup-ProposalDecision-<ts>.json
  ✅ ProposalDecision 已删除
  💾 ConnectionProposal 有 6 行，已备份 → .rollback-backup-ConnectionProposal-<ts>.json
  ✅ ConnectionProposal 已删除

回滚完成。运行 `verify` 应**失败**（即已回到迁移前状态）。
```

回滚后 `probe` 复核：

```
── 批次 C2 目标表状态（T05 · 双边同意（ConnectionProposal / ProposalDecision））──
  ⬜ ConnectionProposal       不存在
  ⬜ ProposalDecision         不存在
```

> ✅ **脚本会先把行导出成 JSON 再删表**（备份文件落在 CWD）。
> 这意味着方案 B 也不是"无条件数据丢失"—— 但备份是**文件**，
> 恢复需要人工介入，不要把它当作可靠的回滚机制。

### 4.2 DDL 的等价形式（供离线/受限环境使用）

顺序**必须**先子表后父表（`ProposalDecision` → `ConnectionProposal`），否则外键悬念：

```sql
DROP TABLE IF EXISTS "ProposalDecision";
DROP TABLE IF EXISTS "ConnectionProposal";
```

**实测演练**（`scripts/qa/drill-t05-rollback.mjs`，在种子库副本上执行）：

```
── ① 演练库现状（回滚前）──
   ConnectionProposal 行数 = 6
   ProposalDecision 行数 = 6

── ② 执行回滚 DDL（顺序：先子表后父表，避免外键悬念）──
   DROP TABLE ProposalDecision → ok
   DROP TABLE ConnectionProposal → ok

── ③ 回滚后核对 ──
   ConnectionProposal 行数 = ERR:SQLITE_ERROR: no such table: ConnectionProposal（期望 ERR）
   ProposalDecision 行数 = ERR:SQLITE_ERROR: no such table: ProposalDecision（期望 ERR）
   SocialIntent 行数 = 11（期望仍是原值）
   MissionParticipation 行数 = 10（期望仍是原值）
   User 行数 = 9（期望仍是原值）
   Mission 行数 = 3（期望仍是原值）
```

③ 的后四行是**反向自证**：回滚只动了它该动的两张表。
没有这四行，"回滚成功"这句话就只是一个断言 —— 它也可能顺手清掉了别人的数据。

脚本可复跑（幂等，只动 `/tmp/t05-drill.db` 这个副本）：

```bash
cp /tmp/t02-e2e.db /tmp/t05-drill.db
node scripts/qa/drill-t05-rollback.mjs
```

---

## 5. 回滚检查清单

| # | 动作 | 判据 |
|---|---|---|
| 1 | 回滚代码（方案 A） | `/m/<token>/proposals` → 404；`/connections/*/consent` → 404 |
| 2 | 若选方案 B：先备份 | `migrate.mjs rollback` 输出里两条 `💾 ... 已备份 → *.json` |
| 3 | probe 复核 | C2 两张表显示 `不存在` |
| 4 | verify 应**失败** | `migrate.mjs verify` 返回非 0（证明真的回到了迁移前） |
| 5 | 既有功能抽查 | 分享页 `/m/<token>`、候选页 `/m/<token>/matches`、意图页仍 200 |
| 6 | **不要**在回滚后立即前滚 | 先评估 §3 第 3 条的"旧提案行是否仍是业务事实" |

---

## 6. 一句话给值班的人

> T05 回滚**不需要**配合任何数据订正。先 `git revert` 代码（30 秒生效），
> 只有当你要把环境**彻底还原**时才 `migrate.mjs rollback --batch=C2 --yes`
> —— 而它会先把行备份成 JSON。**两种情况下用户档案与披露设置都不会被触碰。**
