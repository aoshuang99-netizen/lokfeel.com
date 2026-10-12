# T06 · rollback — 回滚预案

> 原则：**先停副作用，再退代码，最后退 schema**。T06 引入的是一张**新增的**可靠链路，
> 它挂在 T05 的业务写之后（`await onX(...).catch(()=>{})`）—— 因此**回滚代码即可让链路静默失效**，
> 不需要同时回滚 schema。
>
> 📌 **当前生产状态（2026-10-12 起）**：C2 + C3 **已应用到生产 Turso**，
> 且代码**已发版**（发布提交 `233669e`）。也就是说 **L1 现在是"改一行 + 一次构建"**，
> 不再是"零成本"：任何一条 L1/L2 都要走一次发版并复验窗口期。
> 反过来，**L4（退 schema）现在才真正有代价** —— 生产表里可能已有投递留痕。

---

## 0. 一句话：出问题时最该先做什么

| 症状 | 第一动作 |
|---|---|
| cron tick 报错刷屏 | 从 `netlify/functions/cron-runner.ts` 的 `CRON_PATHS` **移除** `/api/cron/workflow-tick`（一提交即停，不需回滚引擎） |
| 运营看到大量 DEAD / 通知未发 | 访问 `GET /api/v1/workflow/overview` 看 `deliveries` 与 `needsAttention`，逐条 `takeover`/`requeue` |
| 疑似通知内容越界 | 立即确认 `NotificationDelivery` 里是否有含 rationale 的 `body`；有则停 tick（同上）并排查模板 |

---

## 1. 回滚层级

### L1 · 停驱动（**秒级，首选**）

不做任何代码回滚，只让 cron 不再触达引擎：

```ts
// netlify/functions/cron-runner.ts
const CRON_PATHS = [
  // '/api/cron/workflow-tick',   ← 注释掉这一行
  ...
]
```

效果：**不再有新的领取/执行/对账**。已在 `PENDING` 的任务停在原地（无害，
它们只是"还没发"）。已 `RUNNING` 的任务会在租约（60s）后回到可领取池 —— 但因无人领取，
会一直待着。

> 此时业务侧钩子仍在入队（不报错），所以**队列会继续增长**但不执行。
> 若要连入队也停掉，见 L2。

### L2 · 停钩子（退回 T05 行为，数据面无损）

把 4 个 T05 路由里的钩子调用注释掉即可（**只动语句，不动 import**，便于快速恢复）：

| 文件 | 注释掉 |
|---|---|
| `connections/proposals/route.ts` | `await onProposalCreated(...)` |
| `connections/{id}/consent/route.ts` | `await onConsentDecided(...)` |
| `connections/{id}/revoke/route.ts` | `await onConsentDecided(...)` |
| `connections/{id}/introduce/route.ts` | `await onConnectionIntroduced(...)` |

**效果**：系统行为**精确退回 T05**（提案/表态/撤销/介绍全部照常，只是不再入队与通知）。
**数据面无损** —— 因为 `WorkflowJob` / `NotificationDelivery` / `IntroductionWorkflow`
三张表是**纯新增**的，T05 的任何读写都不依赖它们。

### L3 · 退代码

```bash
git revert <T06 交付 SHA>          # 或
git revert <T06 交付 SHA> <T06 文档 SHA>
```

因为 C3 是**纯新增**（无 ALTER / 无 DROP 既有列），退代码后**残留的 3 张表不影响任何既有功能**：
- 没有代码读它们；
- 它们的 FK 只指向 `Organization` / `ConnectionProposal`（`ON DELETE CASCADE`），
  删除组织/提案时会连带清理，不会挡住任何既有删除。

> ⚠️ `git revert` 之后再推 `main` 会**触发 Netlify 构建**。若只是想让线上停副作用，
> 用 L1/L2（改一行 + `[skip netlify]`）比整刀 revert 更快、风险更小。

### L4 · 退 schema（**通常不需要**）

只有确认这三张表本身有害（例如占了额度）才做：

```bash
# 逆序删表（C3 → 无后继依赖，可直接删）
node scripts/connection/migrate.mjs rollback --batch=C3 --yes
```

`rollback` 会**逆序**删除 C3 的三张表（先删 `IntroductionWorkflow`（有 FK 到 C2），
再删 `NotificationDelivery` / `WorkflowJob`）。**不会**触碰 C0–C2 的任何表或列。

> 🔴 **回滚 C3 会永久丢失**：所有投递留痕（`NotificationDelivery`，AC-09 的审计面）、
> 所有任务历史（`WorkflowJob`，AC-17 的证据面）、所有流程时间线（`IntroductionWorkflow`）。
> 因此它是**最后手段**，且执行前应先 `dump` 三张表（AC-17 要求"故障可恢复"，
> 把证据本身删掉就无从复盘的）。

---

## 2. 前置检查（回滚前）

```bash
# 1) 三张表当前规模（决定是否值得退 schema）
sqlite3 /tmp/t06-e2e.db 'SELECT COUNT(*) FROM WorkflowJob;'   # 本地
# 生产（Turso）：用 migrate.mjs probe
node scripts/connection/migrate.mjs probe

# 2) 是否有 DEPLOY 窗口期的同源问题（T05 的坑）
node scripts/qa/verify-public-origin.mjs
```

---

## 3. 回滚后必须复验

| 项 | 命令 / 动作 | 期望 |
|---|---|---|
| 业务链路未受影响 | 跑 T05 E2E（`tests/e2e/consent-trust.spec.ts`） | 全绿 |
| 类型 | `npx tsc --noEmit` | 0 error |
| 单测 | `npx jest tests/workflow tests/connection` | 若已退代码，则 T06 用例应随之消失；T05 用例必须全绿 |
| cron 不再触达 | 观察一轮 `netlify/functions/cron-runner` 日志 | 无 `workflow-tick` 条目 |
| 数据库无残留改动 | `node scripts/connection/migrate.mjs verify` | C0–C2 段全绿；C3 段按是否回滚表而绿/缺 |

---

## 4. 明确**不**回滚的东西

| 项 | 理由 |
|---|---|
| `capabilities.ts` 的 `workflow.read` / `workflow.manage` | 纯新增能力，只影响 T06 路由；被注释掉路由后无消费方。留着是为了 L1/L2 快速恢复 |
| `seed-t02-e2e.mjs` 的 `E2E_DB_FILE` 覆盖 | 向后兼容（默认值不变），去掉反而多一次改动风险 |
| `tenancy.prisma` / `connection.prisma` 的反向关系字段 | 与表同进退；只退代码时它们无害（Prisma client 会重生成，但只要不 `db push` 就不会碰库） |

---

## 5. 危险动作清单（**禁止**）

1. 🔴 **禁止 `prisma db push`** 处理任何"表不存在"的问题 —— 对远程 Turso 会 `P1013` 失败（本项目既有约束）。
   一律走 `node scripts/connection/migrate.mjs apply --batch=C3 --yes`（幂等、只补缺口）。
2. 🔴 禁止在回滚时删除 `WorkflowJob` 中 `status IN ('PENDING','RUNNING')` 的行而不做记录 ——
   那些是"还没落地"的业务动作，删掉等于静默丢消息。
3. 🔴 禁止用 `rm` / `sqlite3` 直接改 T06 相关表（本机删除守卫会介入；且绕过 `migrate.mjs` 的差集校验）。
