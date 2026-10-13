# T08 · rollback — 回滚步骤

> 基线 `95da9f1`。本文分两层：**代码回滚**（随时可做）与 **schema 回滚**（C4 批次）。
> 判据永远是"回到那个能跑的状态"，不是"回到那个好看的 diff"。

---

## 1. 回滚决策树

```
出问题了
├─ 只是代码行为不对（API 5xx / 界面错）
│   ├─ 已发版 → 补一个 revert 提交（不带跳过标记）→ 触发构建
│   └─ 未发版 → git revert（或 checkout 到基线）即可，生产未受影响
└─ 表结构导致的问题
    ├─ 表里**没有** T08 产生的行 → 直接 `rollback --batch=C4`（DROP 两张表）
    └─ 表里**已有** T08 产生的行 → 先导出快照，再 DROP（脚本会先备份到
        `.rollback-backup-<table>-<ts>.json`，见 §3）
```

**T08 Slice 1 的 schema 是 C4 纯新增**：`Outcome` / `OutcomeVerification` 两张表，
不改任何既有表。因此**代码回滚不需要动 schema** —— 旧代码不查这两张表，多两张空表无害。
这使"先回滚代码、再从容决定要不要 DROP 表"成为可能。

---

## 2. 代码回滚

```bash
cd <repo>
git log --oneline -5                      # 找到 T08 的提交
git revert <sha>                          # 生成一个反向提交（保留历史）
# 或（未发版时更简单）：
git checkout 95da9f1 -- src/lib/outcome src/app/api/v1/outcomes src/app/console/outcomes
```

回滚后必须复跑门禁（**顺序执行**，别并发 —— 8G 机上 jest 与 eslint 会互相挤爆内存）：

```bash
npx tsc --noEmit                          # 期望 0 error
npx jest                                  # 期望全绿
node ./node_modules/eslint/bin/eslint.js src/app/console src/app/api/v1/outcomes src/lib/outcome --max-warnings=0
npm run check:script-decls
```

### 2.1 Slice 2（指标）的回滚面 —— 更简单

`Slice 2` **零 schema 变更**（没有新批次、没有新表），全部是**新增只读代码**：

| 资产 | 回滚方式 | 副作用 |
|---|---|---|
| `src/lib/outcome/metrics*.ts` + `route.ts`（metrics） | `git revert` 或 `git checkout <基线> -- <路径>` | 无（无写入路径） |
| `scripts/qa/{seed-t08-metrics,emit-outcome-metrics,outcome-reconcile}` | 同上（纯工具） | 无 |
| `package.json` 的 4 条脚本 | 同上 | 无 |
| `tests/outcome/metrics*.test.ts` | 同上 | 无 |

⚠️ **指标端点没有任何写路径** —— 回滚它不会留下不一致的状态（不像 Slice 1 会推进阶段）。
唯一遗留：若已有人把指标用于外部报表，回滚后该端点 404。因此**优先修而不是回滚**。

---

## 3. schema 回滚（C4）

```bash
# ① 先看会删什么（只读）
node scripts/connection/migrate.mjs probe

# ② 逆序 DROP 两张表（需 --yes）
node scripts/connection/migrate.mjs rollback --batch=C4 --yes
```

`rollback` 的行为（继承 T01/T02 的实现）：

1. **逆序**删表 —— 先 `OutcomeVerification` 再 `Outcome`（否则被外键挡住）；
2. 删之前若表里**有数据**，先导出到 `.rollback-backup-<table>-<ts>.json`；
3. 只删 C4 批次的表，**不碰** C0/C1/C2/C3 与任何既有表。

回滚后 `verify` 应当**部分失败**（C4 的表/索引断言转红）—— 这正是"确实回滚了"的
正向证据，不是错误：

```bash
node scripts/connection/migrate.mjs verify   # 期望：C4 段全红，C0–C3 段全绿
```

---

## 4. 数据抢救（表已有 T08 数据时）

`rollback` 自带的备份是**逐表 JSON**，但它是"删前兜底"，不是常规导出。规范做法：

```bash
# 用只读 SQL 导出（经 libSQL）
node -e "
const {createClient}=require('@libsql/client');
const c=createClient({url:process.env.DATABASE_URL,authToken:process.env.TURSO_AUTH_TOKEN});
c.execute('SELECT * FROM \"Outcome\"').then(r=>{
  require('fs').writeFileSync('outcome-export.json', JSON.stringify(r.rows,null,2));
  console.log('rows:', r.rows.length);
}).finally(()=>c.close());
" 
```

> ⚠️ **libSQL 的 `execute()` 返回 `{ rows }` 而不是数组** —— 写成 `(await execute())[0]`
> 会恒为 `undefined`（本项目已踩过 5 次的坑，见 MEMORY）。

`OutcomeVerification` 同法导出。两表的关系是 `OutcomeVerification.outcomeId → Outcome.id`，
按此顺序导入即可恢复。

---

## 5. 回滚**不**能恢复的东西

| 项 | 说明 |
|---|---|
| 已推进的阶段 | `IntroductionWorkflow.stage` 被 T08 推到了 `ACTION_COMPLETED` / `OUTCOME_RECORDED`。阶段机**只前进不回退**（`applyEvent` 的设计），因此回滚代码后这些连接仍停在推进后的阶段 —— 它们不会自己退回去 |
| 审计事件 | `outcome.reported` / `outcome.confirmed` / `outcome.externally_verified` 已写入 `TenantAuditEvent`，**按设计保留**（审计是旁路，不该被业务回滚抹掉） |
| 通知投递 | 若 T08 后续切片引入了通知，投递记录同样按 T06 的取向保留（审计面） |

**为什么阶段不回退是"正确"的**：`ACTION_COMPLETED` 表达的是"这次连接确实推进到了行动完成"，
这是一个**已发生的事实**。回滚代码只是把"记录新事实的能力"撤掉，不改变已发生的事。
若业务上确认某条记录是误报，应由人在数据层显式修正（并留痕），而不是让回滚脚本静默改历史。

---

## 6. 回滚清单（逐项打勾）

- [ ] 确认问题出在 T08（而不是 T07/T06 的既有行为）
- [ ] 决定是"补修复"还是"整体回滚"（前者优先 —— 回滚会丢已推进的阶段）
- [ ] 代码回滚提交（未发版 → 跳过标记；已发版 → 不带跳过标记）
- [ ] 复跑四门禁（`tsc` / `jest` / `eslint` / `check:script-decls`）
- [ ] 若需 DROP 表：先 `probe` → `rollback --batch=C4 --yes` → `verify`（期望 C4 段红）
- [ ] 有数据时先导出（§4）
- [ ] 记录本次回滚的原因与 SHA（回填到 `changes.md`）
