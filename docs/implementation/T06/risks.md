# T06 · risks — 风险与取舍

> 记录本刀的**真实风险**（不是"需要注意"的泛泛清单），每条含：风险、影响、已有缓解、**残余**。

---

## R1 · 钩子非事务性 → 存在"提案已建、任务没入队"的窗口 🔴 高

**风险**：钩子在业务写**之后**执行，不在同一事务里。进程崩 / DB 抖动 → 提案在那里，却永远不会被通知。

**影响**：静默丢消息（"连接已建立"没人知道）。

**缓解（两层）**：
1. 钩子**自身不抛错**：入队失败只记进 `HookResult.errors`，绝不让已成功的业务操作变成 500
   （否则用户以为提案没建成功 → 再点一次 → 更乱）。
2. **`reconcileMissingJobs()` 对账兜底**：tick 时扫描"已 `MUTUALLY_ACCEPTED` 但
   `introducedAt IS NULL`"的提案补入队。由于入队幂等，补入队**不会**复活被人为取消（`CANCELLED`）
   或已进死信（`DEAD`）的任务。

**残余**：对账粒度是**调度级**（免费计划小时级）→ 最少延迟约 1 小时。
**接受**：本任务是"可靠但不实时"的语义；`scripts/qa/seed-t06-e2e.mjs` + E2E 已把这条链路
走通并可重复验证。若将来退化为完全不可接受，把对账接进更细的调度（cron-job.org），**不改代码**。

---

## R2 · 全局 tick 会触及**所有租户**的待介绍提案 🟡 中

**风险**：`reconcileMissingJobs()` 不限租户（cron 天然是全局的）。一次 tick 可能介绍掉
多个租户里所有"已双方同意未介绍"的提案。

**影响**：产品上这是**期望行为**（运营的意图已经表达过，补一把）。但它让 **E2E 夹具的隔离**变脆：
若 T06 E2E 与 T05 E2E 同库，T05 的 `cp_e2e_mutual` 会被 T06 的 tick 顺手介绍掉。

**缓解**：T06 E2E 使用**独立库** `/tmp/t06-e2e.db`（`seed-t06-e2e.mjs` + `E2E_DB_FILE`）。
`seed-t02-e2e.mjs` 增加了向后兼容的 `E2E_DB_FILE` 覆盖（默认仍 `/tmp/t02-e2e.db`）。

**残余**：生产上"一次 tick 批量介绍"没有数量上限之外的节流（`limit: 20`）。
**接受**：`INTRODUCE_CONNECTION` 的每次执行都走 T05 的 AC-06 校验 + CAS，批量不等于越权。

---

## R3 · 邮件通道仅有沙箱证据，真实外发未验证 🟡 中

**风险**：无 `RESEND_API_KEY` → 所有邮件投递为 `CAPTURED`。**真实外发**从未跑过。

**影响**：AC-09 的"真实送达"这一条**无法**在无凭据时标 PASSED（主指令明确：只能标 MOCKED/BLOCKED）。

**缓解**：
- 代码路径已完整实现（`createResendSender` 走官方 HTTP API，非 2xx 抛错）；
- `resolveEmailSender` 对**误配的 key**（非 `re_` 前缀）返回 null → 落回沙箱，而**不是**拿它去发；
- 接上 key 的那一刻 `CAPTURED` 自动变 `SENT`，**零代码改动**。

**残余**：`RESEND_API_KEY` 缺失属**用户明确排除项**，本刀不动。

---

## R4 · 通知是"旁路渠道"，天然是披露风险面 🔴 高（已用三道防线压住）

**风险**：站内信/邮件绕开页面上的披露投影（`discloseSubject()`）—— 极易成为一次计划外披露。

**缓解（纵深防御）**：
1. **类型层**：`RenderInput` **没有** rationale / 档案字段 / 对侧姓名的位置；
2. **运行时**：`assertNoLeakage()` 用**最长公共子串**（≥12 字）检测，抓得住 `includes()` 抓不到的
   截断泄漏；命中即抛错，任务进 `FAILED`（内容确定性失败，不重试）；
3. **身份声明**：每条通知强制携带"由社群运营方通过 LokFeel 发出"，让"系统发出"与"真人私聊"
   在**文本层面**不可混淆。

**残余**：`missionTitle` 是唯一可传入的业务文本，其"公开性"由**调用方**保证
（当前只传 Mission 标题，分享页未注册访客可见）。若日后有人传私有字段进来，
`assertNoLeakage` 只在**它同时被登记为 protectedTexts** 时才拦得住 —— 这是守卫的已知边界。

---

## R5 · 无 `Idempotency-Key` 的 `introduce` 端点被重复点击 🟢 低

**风险**：`POST /connections/{id}/introduce` 刻意不带幂等键（T05 决定）。

**缓解**：T05 的 CAS（`updateMany({introducedAt: null})`）+ `already_introduced` blocker；
第二次调用 → 409 `already_introduced`。T06 侧 `translateIntroduceError` 把它归为 **superseded**
（**不是**失败）→ 任务记 `CANCELLED`。
**并且**：若上一次是"介绍成功、通知阶段失败"，任务重试到这里时
`handleIntroduce` 会**补投递**而不是判 superseded —— 否则"连接已建立"会永远没人知道。

**残余**：无（两处都已覆盖并有断言）。

---

## R6 · 未知错误默认 `retryable` 的取舍 🟡 中

**风险**：默认 `retryable` 意味着一个"其实是永久性"的未知错误会被重试 5 次才进死信，
占用额度并延迟暴露。

**为什么仍这样选**：反向（默认 permanent）会让**一次网络抖动永久放弃一条真实通知**，
而且没人会发现（任务显示"已失败"而非"待重试"）。代价有上限：`maxAttempts` 兜底 → 进 `DEAD` 等人。

**残余**：重试日志会包含一些注定失败的条目。
**缓解**：对**已知**的确定性失败（无邮箱、载荷非法、内容泄漏、非双方同意）显式抛
`JobFailure('permanent')`，不走默认。

---

## R7 · 阶段超时只是"可见"，不会自动推进 🟡 中

**风险**：`isStageTimedOut`（默认 7 天）只在运营视图里把停滞的连接标出来，
**不会**自动做任何补救（不会自动关闭、不会自动重新介绍）。

**影响**：一个卡在 `COORDINATING` 的连接会一直在"停滞"列表里，直到有人处理。

**接受**：这是刻意的 —— 自动关闭一个真实连接是产品决策，不该由基础设施代做。
`ACTION_COMPLETED` / `OUTCOME_RECORDED` 目前**没有自动触发点**（需要 T07/T08 的"结果记录"入口），
因此阶段机当前的自然终态是 `INTRODUCED`/`COORDINATING`。

---

## R8 · 免费计划的调度粒度 🟡 中

**风险**：Netlify 免费计划只保证**小时级** cron。租约 60s、退避 30s 起步的设计在小时级下
"抖动"意义变小。

**缓解**：引擎**正确性不依赖调度频率** —— 晚一点跑只是慢一点，不会漏、不会重复
（幂等键 + 租约 + 终态不可复活）。`runWorkflowTick` 自带 **8s 时间预算**主动收手，
避免函数被平台硬杀（那会既无报告也无收尾）。

**残余**：重试的**实际延迟**以小时计。需要更实时时，用外部 cron 打同一端点。

---

## R9 · 死信接管是"人肉兜底"，无告警推送 🟡 中

**风险**：任务进 `DEAD` 后，只有运营**主动**打开 `/api/v1/workflow/overview` 才看得见
`needsAttention`。没有主动告警（邮件/IM 通知运营）。

**缓解**：`getWorkflowOverview` 把 `DEAD`/`TAKEN_OVER`/`FAILED` 归入 `needsAttention`，
并写 `workflow.dead_lettered` 审计事件（可被审计面消费）。

**残余**：**无推送**。若需要，应在 T07+ 接一个"运营告警"任务（把 overview 的
`needsAttention` 非空当作触发条件）—— 本刀不做，避免把通知管道用在自身上造成回路。

---

## R10 · 路径形状类缺陷只有 tsc / E2E 能抓 🔴 高（过程风险）

**事实**：`workflow/jobs/[jobId]/takeover/route.ts` 的 `_shared` 相对路径初版写成
`../../_shared`（照抄 T05 的 3 段路径写法），而 C3 是 **4 段** → 应为 `../../../_shared`。
tsc 报 `TS2307`。

**为什么值得记**：T05 已经因为"API 单测直接 import handler、URL 不参与路由匹配"
连错 3 次路径而单测全绿。本刀的教训是同一件事的另一面：
**相对 import 路径**至少还有 tsc 兜底，而**路由路径的形状**（段数/中间段）
只有 **E2E 打真实 URL** 能证。

**缓解**：C3 的 4 路由在 `workflow-api.test.ts` 的 `describe` 名里写的是**真实路径**，
并在文件头显式声明"本层证不了路径形状"；真实形状由 `workflow-execution.spec.ts` 用
`ctx.request.post('/api/v1/workflow/jobs/.../takeover')` 覆盖。

---

## R11 · `NotificationDelivery` 与 `Notification` 双写不是原子的 🟢 低

**风险**：站内信流程先写 `Notification`（用户可见），再 upsert `NotificationDelivery`（审计）。
两者之间崩溃 → 用户看到了消息，但审计里没有这条投递。

**影响**：审计面少一条；**用户不会重复收到**（因为下一次重试时，`Notification` 已存在
但 `NotificationDelivery` 没有 → 会**再写一条** `Notification`）。

**残余**：极端情况下站内信可能**重复**一条。**接受**：站内信重复的代价远低于漏发；
且窗口极窄（两次写之间）。若将来要严格，应把两者放进同一事务（libSQL 支持）——
本刀未做，因为当前 `Notification` 表无幂等键，同事务也无法完全消除重复。
