# T06 · changes — 变更记录

> 基线 commit **`83f4be9`**（`docs(t05): 回填交付提交 SHA 75897d3`，`main`；T05 交付提交为 `75897d3`）。
> 任务：**`T06_WORKFLOW_EXECUTION` — 可靠介绍与跟进状态机**。
> 验收：**AC-07 / AC-09 / AC-14 / AC-17**。
> 前序交接（来自 T05 BACKLOG 卡片）：
> ① 介绍的执行**必须原样调用** `introduceConnection()` —— 不另写一份校验；
> ② `introduce` 端点**刻意不带幂等键**（重复调用 = "又要求介绍一次" → 409，是正确结果）；
> ③ T05 的 CAS 范式（`updateMany` 带原状态谓词）**必须保留**。

---

## 0. 两个开工前拍板（BACKLOG §6-⑤ 阻塞项）

| 决策 | 选择 | 未选项与理由 |
|---|---|---|
| 工作流引擎 | **自建 DB outbox** | Temporal：需要常驻进程，Netlify 免费计划**无此能力**（函数是临时的）→ 排除 |
| 消息通道 | **站内信 + 邮件沙箱** | 仅站内信：无法覆盖"外部通知"这一真实通道；真实外发：缺 `RESEND_API_KEY`，且主指令禁止把"想发"标成"已发" |

「沙箱」的含义：无凭据时**不发送**，但把"要发什么"完整落库（`status=CAPTURED` + `capturedAt`）。
于是内容合规与失败可恢复**能在没有外部凭据时被真实验证**；只有"真实外发"这一条标 BLOCKED。

---

## 1. 提交

| 项 | 值 |
|---|---|
| 交付提交 | `165ccf7` — `feat(t06): 可靠介绍与跟进状态机 —— outbox 引擎、统一投递出口与运营视图`（含 `[skip netlify]`） |
| 文档提交 | `4e47d70` — 四件套 / BACKLOG / 交付报告（含 `[skip netlify]`） |
| **发布提交** | **`233669e`** — `chore(release): 发布 T05 双边同意 + T06 工作流状态机 —— 生产迁移 C2/C3 已应用`（**不带**跳过标记 → 触发构建） |
| 生产部署 | `6acc86bb3a0a`，`ready` @ 2026-10-12 15:07 (CST)，域 `app.lokfeel.com` |
| 分支 | `main`（`allowed_branches=['main']`：推 main 才发版） |

> ⚠️ `[skip netlify]` 会被**扫描整条提交信息（含正文）** —— 发布提交正文里**别写出它**，否则自伤静默跳过构建。

---

## 2. 交付物清单

### 2.1 Schema（**C3 批次：纯新增 3 表 + 11 索引 + 4 外键**）

| 文件 | 规模 | 说明 |
|---|---|---|
| `prisma/schema/connection.prisma` | **+~230** | 4 枚举 + 3 模型：`WorkflowJobKind` / `WorkflowJobStatus` / `NotificationChannel` / `NotificationDeliveryStatus` / `WorkflowStage`；`WorkflowJob` / `NotificationDelivery` / `IntroductionWorkflow` |
| `prisma/schema/tenancy.prisma` | +9 | `Organization` 上 3 条反向关系 |
| `scripts/connection/migrate.mjs` | **+~130** | 注册 C3 批次（`ALL_BATCHES=['C0','C1','C2','C3']`）；`verify` 增 `4d)` 段 |

**为什么不复用现成枚举名**：初版把投递状态命名为 `MessageDeliveryStatus`，与
`core.prisma` 里既有的 IM 枚举**同名冲突**（Prisma 全局枚举命名空间）→ schema validate
直接失败。改为 `NotificationDeliveryStatus` / `NotificationChannel`（关联模型同名为
`NotificationDelivery`）。**这是 T06 唯一一次 schema 返工**。

**软引用 vs 外键**（C3 的核心设计，`verify` 有**反向断言**钉住）：

| 列 | 关系 | 理由 |
|---|---|---|
| `WorkflowJob.proposalId` / `.missionId` | **无 FK**（软引用） | 任务是被删除资源的**证据**，被删提案不应连带抹掉崩溃恢复的痕迹（AC-17 证据面） |
| `NotificationDelivery.recipientId` / `.missionId` | **无 FK**（软引用） | 投递记录是**审计面**，不是通讯录；删用户不抹投递历史 |
| `IntroductionWorkflow.proposalId` | **有 FK**（1:1，CASCADE） | 流程实例与提案是**同生共死**的：提案没了，流程无意义 |

`migrate.mjs` 的 `verify` 因此含**反向断言**：`WorkflowJob.proposalId` **必须没有**外键、
`NotificationDelivery.recipientId` **必须没有**外键、`IntroductionWorkflow.proposalId` **必须有**。
（只断言"有的都在"是盲的 —— 它抓不到"该软的地方被写成硬 FK"。）

### 2.2 运行时内核与引擎 `src/lib/workflow/`（8 文件，**2731 行**）

分层的依赖方向**单向无环**（`index.ts` 文件头有图）：

```
job-core（纯函数）  stage-machine（纯函数）  notification-content（纯函数）
      ↑                    ↑                        ↑
  workflow（阶段持久化） ──► runtime（引擎） ◄── delivery（投递出口）
                                   ↑
                               hooks（业务钩子）
```

| 文件 | 行数 | 作用 | 关键约束 |
|---|---|---|---|
| `job-core.ts` | 299 | **纯函数内核**：幂等键、退避、租约、可领取性、失败三分法、阶段超时 | **零 IO、零 Prisma 依赖** → 离线穷举分支 |
| `stage-machine.ts` | 132 | 阶段状态机：`applyEvent` / `appendTimeline` / `STAGE_ORDER` | **阶段只前进不回退** → 重复事件天然幂等 |
| `notification-content.ts` | 197 | 渲染 + **披露边界守卫**：`assertNoLeakage`（最长公共子串）、身份声明后缀 | `RenderInput` **没有** rationale/档案字段的位置 |
| `delivery.ts` | 309 | **统一投递出口**：站内信真实落库 / 邮件沙箱捕获 / 幂等前置查 / 发送前守卫 | 所有对外通知**必须**经此，否则绕开守卫 |
| `runtime.ts` | 1004 | 引擎：入队 / CAS 领取 + 租约 / 执行 / 收尾五态 / 人工接管 / tick | 介绍**原样调用** `introduceConnection()` |
| `workflow.ts` | 328 | 阶段持久化（幂等创建 / CAS 推进 / 时间线）、运营视图聚合 | **不依赖** runtime（避免与 hooks 成环） |
| `hooks.ts` | 322 | 4 个业务钩子 + `reconcileMissingJobs` 对账 | **不抛错**；入参只有 `{id, organizationId}`，内部重读 |
| `index.ts` | 140 | barrel 出口 | — |

### 2.3 统一投递出口（AC-09 的落点）

`deliverNotification()` 的五步顺序（每一步都不能省）：

1. **幂等前置查**：同键已有 `SENT`/`CAPTURED` → 直接返回（`replayed:true`）；
2. **渲染**：只用 `RenderInput` 允许的字段；
3. **守卫**：`assertNoLeakage` + 身份声明断言 —— 都在**发送之前**；
4. **发送**：站内信写 `Notification` 表；邮件解析 sender，无凭据 → 沙箱捕获；
5. **留痕**：`NotificationDelivery` upsert（含 CAPTURED 的内容快照）。

两道**纵深防御**：
- **类型层**：`RenderInput` 没有 `rationale` 的位置 —— 想传也传不进来；
- **运行时**：`assertNoLeakage()` 用**最长公共子串**（≥ 12 字）检测，能抓住
  `includes()` 抓不到的"截断后泄漏"（有人把 rationale 截 20 字塞进正文）。

### 2.4 能力矩阵（`src/lib/tenancy/capabilities.ts` +2 能力）

| 能力 | 归属 | 理由 |
|---|---|---|
| `workflow.read` | OPERATOR+ | 运营需要看见"哪些通知卡住了"，但**不能**决定放不放行 |
| `workflow.manage` | ADMIN+ | 接管/重试会决定"一条消息是否出街" → 管理动作，取严（与 `outcome.verify` 同一取向） |

### 2.5 API 路由（2 文件主体 + 1 cron + 1 helper，272 行）

| 路径 | 方法 | 能力 | 说明 |
|---|---|---|---|
| `/api/v1/workflow/jobs` | GET | `workflow.read` | 列出任务；`?status=` 逗号分隔，未知值 400 |
| `/api/v1/workflow/overview` | GET | `workflow.read` | 四件事：计数 / 需人处置 / 停滞阶段 / 投递计数（**captured 单列**） |
| `/api/v1/workflow/jobs/{jobId}/takeover` | POST | `workflow.manage` | 人工接管（可选 note ≤500）；409 = 已终态 |
| `/api/v1/workflow/jobs/{jobId}/requeue` | POST | `workflow.manage` | 手动重试（DEAD/FAILED/TAKEN_OVER → PENDING，attempts 归零） |
| `/api/cron/workflow-tick` | GET/POST | `CRON_SECRET` | 驱动器：领取→执行→收尾；随后对账 |

**路径层数陷阱（本刀唯一被 tsc 抓到的缺陷）**：C3 路由在
`workflow/jobs/[jobId]/takeover/`（**4 段**），而 `_shared` 在 `workflow/_shared`，
相对路径应为 `../../../_shared/params`。初版照抄 T05 的 `../../_shared`（那是 3 段路径下正确的），
tsc 报 `TS2307: Cannot find module`。**记录在案**：路径形状类的错误只有 tsc/E2E 能抓，
API 单测（直接 import handler）永远是绿的。

### 2.6 T05 路由接钩子（4 文件，业务写之后调用）

| 路由 | 钩子 | 时机 |
|---|---|---|
| `connections/proposals` POST | `onProposalCreated` | `created(resource)` 之后（重放路径同样调用，入队幂等） |
| `connections/{id}/consent` POST | `onConsentDecided(ACCEPT/REJECT)` | `decideProposal` 之后 |
| `connections/{id}/revoke` POST | `onConsentDecided(REVOKE)` | `revokeProposal` 之后 |
| `connections/{id}/introduce` POST | `onConnectionIntroduced` | `introduceConnection` 之后 |

**依赖方向**：钩子写在**路由层**而不是 T05 的服务层 —— 那会让 T05 依赖 T06 的队列。
`await onX(...).catch(() => {})`：入队是**尽力而为**（非事务），失败只记进 `HookResult.errors`，
绝不把已成功的业务操作变成 500（否则用户会以为提案没创建成功，于是再点一次）。

### 2.7 cron 注册（`netlify/functions/cron-runner.ts` +1 路径）

`CRON_PATHS` 追加 `/api/cron/workflow-tick`。免费计划**只保证小时级** ——
因此引擎的**正确性不依赖调度频率**：晚一点跑只是慢一点，不会漏、不会重复（幂等键 + 租约兜底）。

### 2.8 测试与夹具

| 文件 | 行数 | 覆盖 |
|---|---|---|
| `tests/workflow/job-core.test.ts` | 271 | 幂等键 / 退避 / 租约 / 可领取性 / 三分法 |
| `tests/workflow/stage-machine.test.ts` | 147 | 阶段单调性 / 幂等 / 时间线 |
| `tests/workflow/notification-content.test.ts` | 173 | 模板 / 身份声明 / 泄漏检测 |
| `tests/workflow/delivery.test.ts` | 221 | 站内信落库 / 邮件沙箱 / 幂等 / 发送前守卫 |
| `tests/workflow/runtime.test.ts` | 638 | 入队 / CAS 领取 / 执行分支 / 五态收尾 / 接管 / tick |
| `tests/workflow/workflow-service.test.ts` | 212 | 幂等创建 / CAS 推进 / 停滞检测 |
| `tests/workflow/hooks.test.ts` | 229 | 4 钩子的翻译逻辑 + 对账 |
| `tests/workflow/workflow-api.test.ts` | 290 | 4 路由的状态码全谱系 + 能力关卡 |
| `tests/e2e/workflow-execution.spec.ts` | 372 | **AC-07/09/14/17 的端到端 + 故障注入** |
| `scripts/qa/seed-t06-e2e.mjs` | 331 | 独立库 `/tmp/t06-e2e.db` 夹具 |

**单测合计 8 文件 / 169 用例**（全部离线，无需数据库）。

---

## 3. AC 对照

| AC | 证据 |
|---|---|
| **AC-07 幂等** | `job-core` 键形状（介绍=提案级、通知=含收件人）+ `enqueueJob` 撞唯一键返回 `created:false`（**不 upsert 重置**）+ `deliverNotification` 幂等前置查；E2E「再跑一轮 tick → 投递/任务数不变」 |
| **AC-09 消息合规** | `RenderInput` 无 rationale 位 + `assertNoLeakage`（发送前）+ 强制身份声明；站内信真实落库 `SENT`、邮件 `CAPTURED`（不冒充）；overview 的 `captured` 单列 |
| **AC-14 端到端** | 钩子链：创建→表态→双方同意→介绍→跟进；阶段机 PROPOSED→…→OUTCOME_RECORDED；E2E 恢复链路完整落地 |
| **AC-17 崩溃恢复** | CAS 领取（`updateMany` 带原状态/原租约）+ 租约 60s + 终态不复活 + 死信人接管 + `reconcileMissingJobs` 对账补偿；E2E 故障注入（无 job → 两轮 tick 恢复） |

---

## 4. 与契约的偏离 / 需要留意

1. **投递通道**：邮件走**沙箱**（无 `RESEND_API_KEY`），`status=CAPTURED`。
   接上真实 key 的那一刻，"CAPTURED" 自动变 "SENT" —— 代码无需改。
2. **失败是三类不是两类**：`retryable` / `permanent` / `superseded`。
   `superseded`（提案已被介绍/已撤销）**记 CANCELLED 而非 FAILED** —— 它不是失败，
   是"目标已由别的路径达成"。只分两类会让它在监控里长得和"数据损坏"一样。
3. **未知错误默认 `retryable`**（而非 permanent）：投递类失败绝大多数是暂时性的，
   且 `maxAttempts` 兜底。反向默认会让一次网络抖动**永久**放弃一条真实通知，且无人发现。
4. **`operatorContext` 以发起提案的运营身份执行**：队列**不产生新权限**。
   若该运营已离职/降级 → `permanent` → FAILED 等人工接管，而不是由"系统"越权代做。

---

## 5. 生产上线记录（与 T05 同批）

### 5.1 为什么是"先迁移、后发版"这个顺序

C3 是**纯新增**但**代码依赖它**：发版后线上运行时第一步就查 `WorkflowJob`。
若先发版，那么从构建完成到迁移完成之间的所有 `workflow-tick` 都会 500
（cron 由平台按小时触发，窗口不可控）。所以顺序固定为：

```
基线快照 → 只读 plan → apply C2 → apply C3 → verify → 发布提交（不带跳过标记）
```

### 5.2 迁移取证

| 步骤 | 命令 | 结果 |
|---|---|---|
| 迁移前基线 | `node scripts/qa/db-snapshot.mjs before`（**新脚本**） | 49 表；`User` 12922 · `Profile` 11887 · `Organization` 1 · `Membership` 0 |
| 只读预览 | `migrate.mjs plan --batch=C2` | 仅 `CREATE TABLE/INDEX IF NOT EXISTS`，**无** ALTER / DROP |
| 应用 C2 | `migrate.mjs apply --batch=C2 --yes` | ✅ 12 条语句全 ok |
| 应用 C3 | `migrate.mjs apply --batch=C3 --yes` | ✅ 13 条语句全 ok |
| 对账 | `migrate.mjs verify` | ✅ **107/107**（含软引用**反向**断言） |
| 迁移后对照 | `node scripts/qa/db-snapshot.mjs diff before after`（**新脚本**） | ✅ 49 → 54 表；新增仅 C2/C3 五张；**既有表行数全部未变** |

> `db-snapshot.mjs diff` 会**主动证伪**：若出现预期外的新增表、任何表消失、或既有表行数变化，
> 它 exit 1 并列出差异 —— 把"零影响"从一句声明变成一条可复跑的判据。

### 5.3 发布与线上复验

| 项 | 结果 |
|---|---|
| 发布提交 | `233669e` → Netlify 部署 `6acc86bb3a0a` `ready` @ 2026-10-12 15:07 (CST) |
| `verify-public-origin`（窗口期内） | ✅ **13/13**，0 处部署专用域名泄漏 |
| `verify-t06-prod`（**新脚本**） | ✅ **25/25** |
| `verify-t04-prod`（回归） | ✅ **19/19** |
| `verify-login-realpath` | ❌ 12 项失败 → 见下 5.4（**既有环境缺口**，非本刀回归） |

`verify-t06-prod` 覆盖：健康与 DB 可达；T06 四个运营端点 + T05 两个连接端点**匿名全拒**（401+JSON，
用来**反证**路由确实已注册 —— 404 HTML 就说明代码没上线）；cron 守卫（无 token / 错 token 一律 401）；
披露负测（匿名响应体不得含 `dedupeKey` / `payload` / `recipientId` 等字段名）；窗口期域名泄漏扫描。

### 5.4 🟡 发现：生产库里没有 QA 账号（本刀之前就存在）

`verify-login-realpath` 12 项失败，但**根因不是发布窗口期**：
同源守卫**没有** 403（端点正常处理了请求并回业务 401 `Invalid email or password`），
cookie host 断言反而**通过**。为定位，新增 `scripts/qa/probe-qa-login.mjs`：
它**本地直连生产库**取 `User.password` 哈希并用 bcrypt 实比对。结论确定：

- `qa.male@lokfeel.com` / `qa.female@lokfeel.com` **在库里不存在** → 本地密码再怎么对也没用；
- `User` 12922 行、未软删 12922 行、`Membership` 0 行 —— 本次发版**未删除任何用户**。

即：**"真实登录路径"这一层复验，在本刀之前就已无法取证**（账号被早前的清理脚本删掉了）。
修复 = 重跑 `scripts/qa/create-qa-accounts.mjs`（幂等、会向生产写 2 个测试用户）—— 属生产写入，需单独授权。
⇒ 这是本项目 QA 体系的一个**结构性盲区**：清理脚本把复验的前置条件也清掉了，两者没有联动。

