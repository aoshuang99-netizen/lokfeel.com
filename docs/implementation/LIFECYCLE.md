# AC-10 · 数据生命周期（导出 / 删除 / 缓存与索引与任务清理）

> **状态**：✅ **四支已闭合**（任务清理 / 缓存 / 导出 / 删除请求），逐条证据见 §5 与 §4.5。
> **索引**一支记 `N/A`：本仓不存在独立搜索或向量索引（Discover 走结构化 SQL 过滤，无 embedding），
> 故"索引清理"当前**无可失效对象** —— 这是**核实后的结论**，不是"忘了做"。M6 迁 PG + pgvector 后**必须重评**。
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
npx jest tests/lifecycle        # 政策窗口 + 三条不变式 + 账号政策 + 缓存键单一来源
```

### 4.5 账号级：导出 / 删除 / 缓存（AC-10 的后三支）

与 §1 的清理支同一套分层（**政策是纯函数，IO 只在服务层**）：

| 层 | 文件 | 职责 |
|---|---|---|
| 政策（纯函数，零 IO） | `src/lib/lifecycle/account.ts` | 导出脱敏清单 · `ERASURE_ACTIONS` 动作清单 · 销号补丁 |
| 缓存键（纯函数，零依赖） | `src/lib/cache-keys.ts` | 用户维度缓存键的**单一来源**（写入侧与删除侧引用同一份） |
| 服务（IO） | `src/lib/lifecycle/export.ts` / `erasure.ts` | 导出聚合 · 删除计划与执行 |
| 接口 | `GET /api/v1/me/export` · `GET`/`POST /api/v1/me/erasure` | **仅需登录**；**不接受** `?userId=` |

#### 口径（每条都是"为什么不是另一种做法"）

- **导出只有自己**：`userId` 来自服务端会话。写成 `?userId=` 就把"猜 id 读别人数据"变成一条可尝试的路径 ——
  而这条路径正是 AC-01（多租户隔离）/ AC-02（未授权访问）要堵死的。
- **导出不经过 `discloseSubject()`**：披露投影管的是"给别人看什么"，导出是**自己看自己**，方向相反；
  共用出口反而会把"对自己也要脱敏"混进来。唯一剔除的是**凭据**
  （`password` / `tokenVersion` / `botConfig` —— 落到用户手里就不再是口令）与**内部运营备注**（`adminNotes`）。
- **导出显式声明未覆盖面**（`meta.uncovered`）：IM / 匹配史 / 计费流水属别的域。
  宁可声明，也不给一份"看起来完整"的导出物。
- **删除 = 匿化 + 状态收窄，不是裸删**。三条理由：
  ① `User.deletedAt` 全仓**无任何业务查询在读**（只置软删标记等于没删）；
  ② `Profile.profileStatus` 才是各查询面的**实际闸门**（发现/匹配/候选都以 `APPROVED` 为条件），
     置 `DEACTIVATED` + `isApproved=false` 后**无需改动任何查询**；
  ③ 硬删会打断**对方**的记录（`ConnectionProposal` / `Outcome`）并抹掉审计（`AuditLog` / `TenantAuditEvent`）。
- **非空列用中性哨兵**：`age→0`、`gender→PREFER_NOT_TO_SAY`、`sexuality→''`、`relationshipGoal→NOT_SURE`。
  这些列不允许 null，留原值等于留下一份粗粒度画像（年龄 + 性别 + 性取向是准标识符组合）。
- **执行顺序：先关闸门（DEACTIVATED）再清正文**。失败方向落在"更不可见"一侧；
  反过来会留下"PII 已清、但仍被召回"的窗口。
- **两段式**：`planErasure()` 只读（可任意次调用）→ `executeErasure()` 需显式 `?apply=1`。
  删除不可逆，默认档位必须是"只看不动"。

#### 🔴 缓存：AC-10 点名的那一支（原判 🟡，核实后是**真缺口**）

原 §5 记的是"目前无独立缓存层与向量索引" —— **前半句是事实错误**：
`src/lib/cache.ts` 只是 `src/lib/redis-cache.ts` 的**别名**，服务端有 4 处用户维度缓存：
`auth:user:` / `settings:` / `discover:profile:` / `who-liked-me:`。
其中 `who-liked-me:<viewerId>` 缓存的是**别人的**
`displayName / avatar / age / city / gender / relationshipGoal`
（见 `src/app/api/who-liked-me/route.ts`）。

⇒ **"删了库"不等于"删干净了"**：库已匿化而缓存未失效时，被销号者会在**别人的**"谁喜欢过我"
列表里继续以原昵称出现 —— 最多 90 秒（TTL 60s + jitter 30s），而且**没有任何报错**。
所以缓存失效是 `executeErasure()` 的**第 ⑧ 步**，不是收尾的"顺手一清"：

- **本人键**：按精确键失效（`auth:user:` / `settings:` / `discover:profile:` / `discover:exclude:`）；
- **`who-liked-me:`**：按前缀**全局**失效 —— 它的键属于他人，按被销号者的 id **找不到**。
  销号是低频事件，全局失效换来的是"确实清干净"。

键定义集中在 `src/lib/cache-keys.ts`，写入侧（`auth.ts` · `discover` · `settings` · `who-liked-me` · `matches/react`）
一律引用 `CACHE_KEYS`；并有单测断言"**全仓不得再出现裸键模板串**"（漂移防线）。

⚠️ **仍存在的边界（诚实声明，不当作已解决）**：
- 内存降级路径只能清**本进程**的映射；生产用 Upstash（本仓已配），`DEL` / `SCAN` 跨实例生效。
- `/api/who-liked-me` 还设了 `Cache-Control: private, max-age=60, stale-while-revalidate=120`，
  即**浏览器**里也可能残留约 3 分钟；服务端无失效手段，只能靠 TTL 收敛。

#### 取证（可复跑）

```bash
npx jest tests/lifecycle              # 政策 + 不变式 + 账号政策 + 缓存键单一来源
npm run verify:ac10:lifecycle         # 真 dev server + 真隔离库 + 真会话 + 逐表库状态断言
```

### 4.4 cron 端点（**就绪，默认不自动跑**）

```
POST /api/cron/lifecycle-sweep           # 真删
POST /api/cron/lifecycle-sweep?dry=1     # 只统计
Authorization: Bearer $CRON_SECRET
```

🔴 **默认不随 cron 自动跑** —— 删除不可逆，按约定需运营方**显式开启**：

| 触发方式 | 当前状态 | 如何开启 |
|---|---|---|
| `netlify/functions/cron-runner.ts`（小时级） | 🚫 `CRON_PATHS` 里**已注释** | 取消 `"/api/cron/lifecycle-sweep",` 那行注释并重新发版 |
| `.github/workflows/scheduler.yml` | 🟡 仅手动 dispatch，且带 `?dry=1` | 去掉 `?dry=1` 即为真删（注意 GH Actions 额度，见 `SCHEDULING.md`） |

在此之前，可手工 `GET /api/cron/lifecycle-sweep?dry=1` 观察命中数（只统计、不写库）。
保留期以**天**计，小时级调度绰绰有余。

---

## 5. 四支状态（已闭合，逐条可复跑）

| 支 | 状态 | 证据 |
|---|---|---|
| **任务清理** | ✅ | §4.1–4.4：`policy.ts` / `sweep.ts` / cron 端点 / 自证夹具 / 单测 |
| **缓存清理** | ✅ | §4.5：`executeErasure()` 第 ⑧ 步 + `cache-keys.ts` 单一来源 + E2E 的缓存回执断言 |
| **索引清理** | **N/A** | 本仓**无**独立搜索/向量索引（已核实：Discover 走结构化 SQL 过滤，无 embedding）⇒ 当前无可失效对象。M6 迁 PG + pgvector 后**必须重评** |
| **导出**（数据可携带） | ✅ | §4.5：`GET /api/v1/me/export` + `export.ts` + `account.ts` |
| **删除请求**（被遗忘权） | ✅ | §4.5：`GET`/`POST /api/v1/me/erasure`（两段式）+ `erasure.ts` + `account.ts` |

### 明确**不在**本支范围（不要读成"已覆盖"）

| 项 | 说明 |
|---|---|
| IM 会话 / 消息、匹配史、计费流水 | 属 B2C / 计费域；导出物里以 `meta.uncovered` **显式声明** |
| `ProposalDecision` 追加式改造 | T05/R7 已记：当前是"当前表态"而非不可抵赖流水 |
| `WorkflowJob.proposalId` / `NotificationDelivery.recipientId` 的**软引用** | 无 FK，删人**不**自动清理。已核实两表**不落 PII**（不存邮箱、不存 rationale 全文）⇒ 不构成 PII 残留；但其**留存期**仍需在一次合规评审里定下来 |
| 浏览器端 HTTP 缓存（`/api/who-liked-me`） | 见 §4.5 末的边界声明，服务端无失效手段，靠 TTL 收敛 |

---

## 6. 变更记录

| 日期 | 变更 |
|---|---|
| 2026-10-12 | 首次认领「任务清理 + 通知保留期」支：`policy.ts` / `sweep.ts` / cron 端点 / CLI / 自证夹具 / 13 单测。导出与删除请求仍开放。 |
| 2026-10-16 | 闭合后三支：新增账号级政策 `account.ts`、缓存键单一来源 `cache-keys.ts`、服务层 `export.ts`/`erasure.ts`、接口 `/api/v1/me/export` 与 `/api/v1/me/erasure`（两段式）；`executeErasure()` 新增**第 ⑧ 步缓存失效**；写入侧统一改引 `CACHE_KEYS`；补单测与 E2E（`verify:ac10:lifecycle`）。同时**订正**原 §5 中"本仓无独立缓存层"的**事实错误**。 |
