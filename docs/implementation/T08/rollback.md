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

### 2.2 Slice 3（用量计费）的回滚面 —— 🔴 **有写路径，且账只增不减**

`Slice 3` **有 schema 变更（C5）**，且有**三个写入面**：`collectUsage`（归集）、
`appendBillingEvent`（事件追加）、`startCharge`（款项，沙箱）。

| 资产 | 回滚方式 | 副作用 |
|---|---|---|
| `src/lib/billing/**`（6 文件） | `git revert` 或 `git checkout <基线> -- src/lib/billing` | 无（旧代码不读 C5 表） |
| `src/app/api/v1/billing/**`（5 路由） | 同上 | 5 个端点 404 |
| `src/lib/tenancy/capabilities.ts` 的 2 条能力 | 同上 | 能力矩阵回到 Slice 2 状态（`billing.*` 消失） |
| `scripts/qa/{seed-t08-billing,emit-billing,billing-reconcile}` | 同上（纯工具） | 无 |
| `package.json` 的 3 条脚本 | 同上 | 无 |
| `tests/billing/**` + `capabilities.test.ts` | 同上 | 无 |
| **C5 两张表** | 见 §3 | 🔴 **DROP 会删掉已入账的用量与事件** |

🔴 **回滚代码不会撤销已写入的账**（这是**对的**）：`UsageRecord` / `BillingEvent` 是
**只增不改的账**，"这个月用了 5 次介绍"是一个**已发生的事实**。回滚代码只是把
"继续记账的能力"撤掉，不改变已记下的账（与 §5 的"阶段不回退"同一取向）。

⚠️ **但要注意一个非对称**：代码回滚后不再有归集，于是**新产生的用量不会被记账**。
若之后又把代码恢复回来，`collectUsage` 的幂等扫描会**自动补齐**这段空档
（这正是"扫描式归集"的收益）—— 但 `BillingEvent`（订阅/款项）**没有**这条路：
它的事件来自调用方，不来自扫描。故若期间发生过管理动作且未入账，**无法自动补**。
⇒ **回滚 Slice 3 前，先确认「期间没有未入账的计费管理动作」**。

---

## 3. schema 回滚（C4 / C5）

```bash
# ① 先看会删什么（只读）
node scripts/connection/migrate.mjs probe

# ② 逆序 DROP（需 --yes）。批次可单独指定，也可同时：
node scripts/connection/migrate.mjs rollback --batch=C4 --yes
node scripts/connection/migrate.mjs rollback --batch=C5 --yes
```

`rollback` 的行为（继承 T01/T02 的实现）：

1. **逆序**删表 —— C4 先 `OutcomeVerification` 再 `Outcome`（否则被外键挡住）；
   C5 先 `BillingEvent` 再 `UsageRecord`（C5 内部无相互依赖，顺序仍按注册表逆序）；
2. 删之前若表里**有数据**，先导出到 `.rollback-backup-<table>-<ts>.json`；
3. 只删指定批次，**不碰**其他批次与任何既有表。

回滚后 `verify` 应当**部分失败**（对应批次的表/索引断言转红）—— 这正是"确实回滚了"的
正向证据，不是错误：

```bash
node scripts/connection/migrate.mjs verify   # 期望：C4/C5 段全红，C0–C3 段全绿
```

> 💡 **顺序建议**：C4 与 C5 相互独立（C5 两表只指向 `Organization`），
> 但 `UsageRecord` 的 `sourceId` 语义上指向 C4 的成果/提案 —— 那是**软引用**，
> 所以**先回滚 C5 再回滚 C4** 更符合"从外层往里拆"的直觉（不是硬约束）。

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

### 4.1 C5 的两张表（Slice 3）

`UsageRecord` / `BillingEvent` 同法导出（把表名换掉即可）。**关系是软引用**（无 FK）：
`UsageRecord.sourceId` 指向 C4 的 `Outcome`/`ConnectionProposal`，`BillingEvent.chargeId`
只是账内的键。因此恢复顺序上**先恢复原始表（C4/C2）、再恢复账**更容易核对，
但**没有**数据库层面的强约束会挡住顺序。

🔴 **导账之前先确认它是不是"当前事实"**：账是只增的，导出的是一个**时刻快照**；
若期间还有归集/事件写入，快照会与库不一致（对账脚本的"无悬空来源"断言正是查这个）。

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
- [ ] 决定是"补修复"还是"整体回滚"（前者优先 —— 回滚会丢已推进的阶段 + 停止记账）
- [ ] **Slice 3 专属**：确认"期间没有未入账的计费管理动作"（见 §2.2 的非对称说明）
- [ ] 代码回滚提交（未发版 → 跳过标记；已发版 → 不带跳过标记）
- [ ] 复跑四门禁（`tsc` / `jest` / `eslint` / `check:script-decls`）
- [ ] 若需 DROP 表：先 `probe` → `rollback --batch=C5 --yes`（如需）→ `rollback --batch=C4 --yes` → `verify`（期望对应段红）
- [ ] 有数据时先导出（§4 / §4.1）
- [ ] 记录本次回滚的原因与 SHA（回填到 `changes.md`）
