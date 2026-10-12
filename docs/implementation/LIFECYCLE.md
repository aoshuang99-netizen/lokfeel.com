# AC-10 · 数据生命周期（导出 / 删除 / 缓存与索引与任务清理）

> **状态**：🟡 **部分认领**。本文件把"**任务清理 + 通知保留期**"这一支做成可执行、可断言的东西；
> **导出**与**删除请求**两支**仍未闭合**（见 §5）。**不要把本文件的存在当作 AC-10 已闭合。**
>
> AC-10 原文（主指令验收矩阵）：`BLOCKER | 数据生命周期 | 导出、删除、缓存/索引/任务清理按政策生效 | 数据治理测试`

## 0. 为什么会有这个文件

`docs/implementation/BACKLOG.md` §5-① 记了两年的事：

> AC-10 在 T00–T12 中**无人认领**。T05 只认领了"满足阻断条件所需的那一小步"，
> 并主动记下了它与 AC-10 取向不一致的地方（`ProposalDecision` 是"当前表态"而非追加式流水；
> `writeTenantAudit` 带 `.catch()`，审计失败不影响业务）。
> **"导出 / 删除 / 缓存与索引清理"三条仍未认领** → 仍须在 T12 之前明确归属。

T06 又新增了**两张只增不减的表**（`WorkflowJob` / `NotificationDelivery`），
于是"没人清"的问题更具体了。本文件认领其中的**清理**一支。

---

## 1. 政策（唯一来源）

实现：`src/lib/lifecycle/policy.ts`（纯函数）→ 被执行层 `src/lib/lifecycle/sweep.ts` 调用。

| 实体 | 范围 | 默认保留 | 环境变量 |
|---|---|---|---|
| `WorkflowJob` | **终态**任务（SUCCEEDED / FAILED / DEAD / TAKEN_OVER / CANCELLED） | 90 天 | `LIFECYCLE_TERMINAL_JOB_DAYS` |
| `NotificationDelivery` | 僵死 **PENDING**（从未成功投出的半成品） | 7 天 | `LIFECYCLE_STALE_PENDING_DAYS` |
| `NotificationDelivery` | **证据**（SENT / CAPTURED / FAILED） | **730 天** | `LIFECYCLE_DELIVERY_EVIDENCE_DAYS` |
| `Notification` | **已读**站内信 | 60 天 | `LIFECYCLE_READ_NOTIFICATION_DAYS` |
| — | 单次每实体删除上限 | 500 | `LIFECYCLE_BATCH_SIZE` |

政策版本号写进报告（`LIFECYCLE_POLICY_VERSION`），便于事后回答"当时按哪版清的"。

### 🔴 三条不变式（有断言守）

1. **非终态任务永不被清**。`PENDING` / `RUNNING` 是"还没做完的事"，不是垃圾。
   它在**两个层面**被挡住：查询的候选范围只含终态（`TERMINAL_JOB_STATUSES`），
   判定函数 `shouldPurgeJob` 再挡一次 —— 双重保险，任一被改动都能从测试里看出来。
2. **未读站内信永不被清**（用户还没看见）。
3. **未知状态不清**。枚举漂移时宁可留下，也不要因为状态名对不上而误删。

---

## 2. ⚠️ 与 AC-09 的张力（必须显式记录）

`NotificationDelivery` 同时是 **AC-09 的证据面**（"要发什么"的内容快照）。
**清它 = 削弱证据**。因此默认策略：

- 证据窗口放得很长（**730 天**）；
- 真正每天会被清的主要是**僵死 PENDING**（半成品，不是证据）与旧的**已读**站内信。

> 若将来为省空间调小 `LIFECYCLE_DELIVERY_EVIDENCE_DAYS`，那是**一次合规决策**，
> 必须在本文件留痕 —— 不要悄悄改数字。

---

## 3. 🔴 一个必须记住的坑：库里的日期**格式不统一**

本机对生产库实测（2026-10-12）：

```
Notification.createdAt  = 2026-04-14T22:37:44.324Z        ← Z 结尾（早期脚本 / toISOString）
Prisma 写入的            = 2026-10-12T06:31:11.687+00:00   ← +00:00 结尾（当前 Prisma）
CURRENT_TIMESTAMP 风格    = 2026-10-12 06:31:11            ← 空格分隔、无毫秒（夹具曾误用）
```

三者都是 TEXT，**字符串比较只在跨日时安全**：同一天内 `Z` 与 `+00:00` 排在
`...T06:31:11.687` 的毫秒位之后，看起来一致；但空格格式的 `' '`(0x20) < `'T'`(0x54)，
落在**与截止时刻同一天**时排序会错。

**处理方式**：判定不在 SQL 里做，改成
**取候选（状态过滤 + 按 `createdAt` 升序 + 上限）→ 用 `Date` 解析后由纯函数判定 → 按 id 删**。
于是：判据只有一个来源、日期比较与存储格式无关、查询条件退化为纯粹的"候选范围"。

（生产上这条不会造成实际损失，因为所有窗口都 ≥ 7 天；但它解释了为什么实现要绕这一下。）

---

## 4. 怎么跑 / 怎么复跑

### 4.1 生产（只读先看）

```bash
node scripts/qa/lifecycle-sweep.mjs            # dry-run（默认，不写库）
node scripts/qa/lifecycle-sweep.mjs --apply    # 真删
# 或：npm run lifecycle:sweep / npm run lifecycle:sweep:apply
```

### 4.2 自证夹具（证明"命中数"不是假绿）

生产库里当前命中为 0，**不能**证明逻辑正确（也可能是查询写错）。夹具造出
必然该清 / 必然不该清的样本：

```bash
node scripts/qa/seed-lifecycle-e2e.mjs
DATABASE_URL=file:/tmp/lifecycle-e2e.db node scripts/qa/lifecycle-sweep.mjs
DATABASE_URL=file:/tmp/lifecycle-e2e.db node scripts/qa/lifecycle-sweep.mjs --apply
```

**2026-10-12 实测结果**（与期望逐一吻合）：

| 阶段 | WorkflowJob | NotificationDelivery | Notification |
|---|---|---|---|
| dry-run 命中 | 1（终态·200d） | 2（僵死 PENDING·30d + SENT·800d） | 1（已读·100d） |
| apply 实删 | 1 | 2 | 1 |
| apply 后复跑 | 0 | 0 | 0 |

同时验到两条**负向**结论：`PENDING` 任务（4000 天前）**扫描时就不在候选里**、
未读站内信（4000 天前）**同样不在候选里** → 二者都活了下来。

### 4.3 单测

```bash
npx jest tests/lifecycle        # 13 用例：政策窗口 + 三条不变式
```

### 4.4 cron 端点（线上自动跑）

```
POST /api/cron/lifecycle-sweep           # 真删
POST /api/cron/lifecycle-sweep?dry=1     # 只统计
Authorization: Bearer $CRON_SECRET
```

已注册进 `netlify/functions/cron-runner.ts` 的 `CRON_PATHS`。
保留期以**天**计，小时级调度绰绰有余。

---

## 5. ❌ 仍开放（不要因为上面打了勾就当作 AC-10 已闭合）

| 支 | 状态 | 说明 |
|---|---|---|
| **任务清理** | ✅ 本文件 | `WorkflowJob` 终态 + 投递 + 站内信 |
| **缓存/索引清理** | 🟡 部分 | 目前无独立缓存层与向量索引（T04 用结构化过滤，没有 embedding 索引）；M6 迁 PG+pgvector 后**必须重新评估**这一支 |
| **导出**（数据可携带） | ❌ 未实现 | 需 org/user 级导出入口 + 格式定义 + 权限校验 |
| **删除请求**（被遗忘权） | ❌ 未实现 | 需 `User` 硬删的级联核对（含 T06 新表的**软引用**：`WorkflowJob.proposalId` / `NotificationDelivery.recipientId` 无 FK，删人不自动清理） |
| `ProposalDecision` 追加式改造 | ❌ 未实现 | T05/R7 已记：当前是"当前表态"而非不可抵赖流水 |

> 已核实一点：`NotificationDelivery` **不落 PII**（不存邮箱地址、不存 rationale 全文），
> 因此"删除请求"即使不清这张表，也不构成 PII 残留 —— 但**审计痕迹的留存期**仍需在一次合规评审里定下来。

---

## 6. 变更记录

| 日期 | 变更 |
|---|---|
| 2026-10-12 | 首次认领「任务清理 + 通知保留期」支：`policy.ts` / `sweep.ts` / cron 端点 / CLI / 自证夹具 / 13 单测。导出与删除请求仍开放。 |
