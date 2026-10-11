# T04 · rollback — 回滚

> **一句话**：本刀（第二刀）**零 DDL**，回滚 = 回滚代码；**没有**数据库步骤。
> 第一刀（内核 `e3bc161`）同样零 DDL（纯新增模块，无表结构变化）。

---

## 1. 为什么没有数据库回滚步骤

`CANDIDATE` 是通过向 `enum DisclosureAudience` **追加成员**实现的，而：

1. Prisma 在本仓把枚举列落成 **`TEXT`**（方言无关 schema，无 `@db.*`）；
2. libSQL 的 `CREATE TABLE` 对 `TEXT` 列**不生成 CHECK 约束**（已实测 DDL 原文核实）；
3. `SocialIntent.disclosure` 存的是一个 JSON 文本，其**值是档位名字**，列类型与取值域都不受枚举声明约束。

因此 `prisma migrate diff` 对本刀**输出为空** —— 新旧 schema 在 DDL 层面完全相同。

**实测证据**（不是推理）：

```bash
# 取 T04 第一刀时的 schema 快照
mkdir -p /tmp/t04-schema-old && cp prisma/schema/*.prisma /tmp/t04-schema-old/
git show e3bc161:prisma/schema/connection.prisma > /tmp/t04-schema-old/connection.prisma

# 旧 schema → 现 schema（Prisma 7 的参数是 --from-schema / --to-schema）
npx prisma migrate diff --from-schema /tmp/t04-schema-old --to-schema prisma/schema \
  --script --exit-code
# → exit 0（空差异），输出全文仅一行：`-- This is an empty migration.`

# 负向对照：证明这个检查**不是恒真空跑**
npx prisma migrate diff --from-schema /tmp/t04-schema-old --to-empty --script --exit-code
# → exit 2（差异非空），229 行、46 条 DROP TABLE
```

`--exit-code` 的取值约定：**空差异 = 0 / 有差异 = 2 / 错误 = 1**。
两条命令的 exit 分别是 `0` 与 `2`，因此第一条的"空"是真结论，不是命令没生效。

**没有迁移脚本，就没有迁移回滚脚本。** 这是"零 DDL 方案"最大的运维收益：
发布与回滚都不需要窗口期、不需要锁表、不需要数据订正。

---

## 2. 代码回滚

### 2.1 回滚到 T04 第一刀（保留内核，撤掉候选装配/API/页面与 CANDIDATE 档）

适用场景：候选通道出问题，但内核（`recall.ts`）本身没问题。

```bash
# 在 main 上
git revert --no-edit <第二刀的提交 SHA>
# 或整体回退到第一刀
git reset --hard e3bc161
```

**预期效果**：`/api/v1/connections/candidates` 与 `/m/<token>/matches` **消失**（404），
`/m/<token>` 上的候选入口链接消失；意图表单的档位回到三项。

### 2.2 回滚到 T03（撤掉整个 T04）

```bash
git revert --no-edit e3bc161 <第二刀的提交 SHA>
# 或
git reset --hard 877878e      # T03 收尾提交
```

此时 `/m/<token>/matches` 与候选 API 全部消失，披露档位回到 `SELF/ORGANIZER/COUNTERPARTY`。

### 2.3 回滚后**必须**做的三件事（否则"回滚成功"是假的）

| # | 动作 | 为什么 |
|---|---|---|
| 1 | `npx prisma generate` | `src/generated/**` 是入库的生成物，回滚代码时它可能没跟着回滚 → 类型与运行期不一致 |
| 2 | `npx tsc --noEmit` | 生成物与源码不同步时，**只有 tsc 会报**（运行期往往静默降级） |
| 3 | `npx jest tests/connection` | 确认回滚后连接域测试仍绿（290 → 回滚到 T03 时应为 286） |

---

## 3. 🔴 回滚后**不能**忘记的一件事：库里可能已存在 `CANDIDATE` 值

**这是唯一的、真正需要留意的点。**

零 DDL 的双刃剑：既然**不需要**迁移就能新增枚举值，那么回滚时**也不会有**任何
数据库步骤去清理已经写入的 `CANDIDATE`。

**如果**在 T04 生效期间有用户把某个字段的档位选成了「同任务的伙伴」，
库里就会留下 `{"displayName":"CANDIDATE"}` 这样的记录。回滚到 T03 后：

- `isAudience('CANDIDATE')` → `false`；
- `decodeDisclosure` 走 **fail silent**：不认识的档位被**丢弃**；
- 结果 = 该字段退化为 `SELF`（**不披露**）。

**即：回滚方向是 fail-closed，不会造成越权披露，只会"用户之前开放的字段悄悄收紧了"。**
这是刻意选择的方向（写路径 fail loud / 读路径 fail silent，见 T03 `changes.md` §3.3、§3.4）。

### 3.1 排查受影响的行

```sql
SELECT id, "userId", "missionId",
       json_extract("disclosure", '$."displayName"') AS display_name_audience,
       json_extract("disclosure", '$."city"')        AS city_audience
FROM   "SocialIntent"
WHERE  "disclosure" LIKE '%CANDIDATE%';
```

### 3.2 两种处置（按需二选一）

- **保持现状（推荐）**：不做任何操作。用户下次编辑意图时，那些字段会显示为"仅自己"，
  重新选择即可。**不会丢失任何内容字段**（`need`/`offer` 不受影响，它们是参与匹配的字段，不走披露表）。
- **主动降级（仅在有明确运维要求时）**：把 `CANDIDATE` 改写为 `COUNTERPARTY` 或直接删除该键。

  ```sql
  -- ⚠️ 先备份：sqlite3 "$TURSO" ".backup /tmp/disclosure-before-t04-rollback.db"
  -- 示例：把 displayName 的 CANDIDATE 改成 COUNTERPARTY
  UPDATE "SocialIntent"
  SET    "disclosure" = json_set("disclosure", '$."displayName"', 'COUNTERPARTY')
  WHERE  "disclosure" LIKE '%"displayName":"CANDIDATE"%';
  ```

  ⚠️ **不要**做"整表重建"式的写入。建议逐条读取 → 在应用层用 `normalizeDisclosure()` 重新规范化 → 写回。
  这样能复用与写路径完全相同的校验，避免手工 JSON 拼接造出脏值。

---

## 4. 回滚的**不可逆**部分

| 项 | 是否可逆 | 说明 |
|---|---|---|
| `CANDIDATE` 档位的**授权选择** | ⚠️ 部分 | 如 §3 所述：回滚后这些选择会被**丢弃**（退化为 SELF），**无法自动恢复**。若之后又重新上 T04，用户需要重新勾选。 |
| `need` / `offer` 正文 | ✅ 完全可逆 | 它们不依赖 T04，T03 就在存。 |
| 候选的**计算结果** | ✅ 无需回滚 | 候选是**读时计算**的派生结果，不落任何表。回滚后没有"残留的候选数据"。 |
| 审计事件（若有） | ✅ 追加写 | 不涉及回滚。 |

---

## 5. 发布前建议的"可回滚性"检查

```bash
# ① 确认本刀确实零 DDL（exit 0 = 差异为空 = 通过；2 = 有差异 = 需人工复核）
npx prisma migrate diff --from-schema /tmp/t04-schema-old --to-schema prisma/schema \
  --script --exit-code

# ② 确认回滚目标提交存在且可编译
git log --oneline -3
git stash list                  # 工作树必须是干净的
```
