# T06 · tests — 测试与验证记录

> 目标：把 **AC-07 / AC-09 / AC-14 / AC-17** 各自钉在**可证伪**的断言上，
> 并写清"每条断言证的是哪一件事、以及它证不了什么"。

---

## 1. 分层与运行方式

| 层 | 位置 | 运行 | 需要 DB？ |
|---|---|---|---|
| 内核纯函数 | `tests/workflow/{job-core,stage-machine,notification-content}.test.ts` | `npx jest tests/workflow` | 否 |
| 服务层 | `tests/workflow/{delivery,runtime,workflow-service,hooks}.test.ts` | 同上 | 否（全 mock） |
| HTTP 装配 | `tests/workflow/workflow-api.test.ts` | 同上 | 否 |
| 端到端 + 故障注入 | `tests/e2e/workflow-execution.spec.ts` | `npx playwright test -c playwright.t02.config.ts` | **是**（隔离库） |

一键：`npx jest tests/workflow`（**8 套 / 169 用例，全绿**）。

### E2E 运行前置

```bash
E2E_DB_FILE=/tmp/t06-e2e.db node scripts/qa/seed-t02-e2e.mjs --reset   # 基线库（DDL 含 C3 表）
node scripts/qa/seed-t06-e2e.mjs                                        # T06 夹具
DATABASE_URL=file:/tmp/t06-e2e.db CRON_SECRET=dev-cron-secret npx next dev -p 3106
E2E_BASE_URL=http://localhost:3106 E2E_CRON_SECRET=dev-cron-secret \
E2E_OP_EMAIL=e2e.t06.op@example.test E2E_ADMIN_EMAIL=e2e.t06.admin@example.test \
E2E_MEMBER_EMAIL=e2e.t06.member@example.test E2E_PASSWORD='E2E-Test-Passw0rd!' \
E2E_DB_FILE=/tmp/t06-e2e.db \
npx playwright test -c playwright.t02.config.ts tests/e2e/workflow-execution.spec.ts
```

> **为什么 T06 E2E 用独立库**：被测的 cron tick 的 `reconcileMissingJobs()` 扫描**整个库**。
> 与 T05 同库时，T05 的 `cp_e2e_mutual`（已双方同意、未介绍）会被顺带介绍掉，
> 于是 T05 的 E2E 断言会因"跑过 T06"而失效 —— 那等于把两条用例绑在一起。

---

## 2. AC 逐条证据表

### AC-07 · 幂等（同一次业务动作只有一条任务 / 一条投递）

| 断言 | 文件 | 证什么 |
|---|---|---|
| 介绍任务是**提案级**键 `introduce:<proposalId>`，不含收件人 | `job-core.test.ts` | 通知双方不会退化成"介绍两次" |
| 通知类键含收件人 | `job-core.test.ts` | 不会退化成"只通知一个人" |
| 键不含时间戳/随机数 → 同输入同键 | `job-core.test.ts` | 幂等的前提 |
| 撞唯一键 → `created:false` 且**不 update** | `runtime.test.ts` | 关键：不用 upsert，否则已 SUCCEEDED 会被重置回 PENDING → 重发 |
| 已有 SENT/CAPTURED → `replayed:true`，不再发 | `delivery.test.ts` | 投递级幂等 |
| 已有 FAILED → **不**复用（应重投） | `delivery.test.ts` | "失败"不算"已投递" |
| 已存在 DEAD/CANCELLED 任务不被对账复活 | `hooks.test.ts` | 人处置过的任务自动化不捡回 |
| **E2E**：再跑一轮 tick → 投递数/介绍任务数/`introducedAt` 全不变 | `workflow-execution.spec.ts` | 真实 SQL 下的端到端幂等 |

### AC-09 · 消息合规

| 断言 | 文件 | 证什么 |
|---|---|---|
| 4 模板渲染结果**都含**身份声明后缀 | `notification-content.test.ts` | 不得静默冒充真人 |
| `RenderInput` 类型里没有 rationale/档案字段 | （类型层）+ 渲染产物不含受保护内容 | 想传也传不进来 |
| 受保护原文整段/截断片段混入 → 抛 `NotificationLeakError` | `notification-content.test.ts` | 抓 `includes()` 抓不到的截断泄漏 |
| 短于 12 字的巧合重合**不**误报 | `notification-content.test.ts` | 守卫可用性 |
| 泄漏时**发送前**抛错 → `notification.create` 未调用、`upsert` 未调用 | `delivery.test.ts` | 越界内容一条都不出街 |
| 站内信真实写 `Notification` 表 = `SENT` | `delivery.test.ts` | 不是假装发了 |
| 邮件无凭据 = `CAPTURED` + `capturedAt`，**不**标 SENT | `delivery.test.ts` | 不冒充已送达 |
| 泄漏失败归 `permanent` → 不重试到耗尽 | `runtime.test.ts` | 确定性失败不浪费重试额度 |
| **E2E**：4 条投递；IN_APP=`SENT`、EMAIL=`CAPTURED`；正文含声明、不含 rationale | `workflow-execution.spec.ts` | 真实落库的内容合规 |
| **E2E**：overview 的 `captured` 与 `sent` 是**独立桶** | `workflow-execution.spec.ts` | 不虚报"外部服务已接通" |

### AC-14 · 介绍工作流端到端

| 断言 | 文件 | 证什么 |
|---|---|---|
| 阶段机 `PROPOSED→CONSENT_PENDING→INTRODUCED→COORDINATING→ACTION_COMPLETED→OUTCOME_RECORDED` 可一路推进 | `stage-machine.test.ts` | 全链路骨架 |
| 创建钩子：建流程实例 + 通知被介绍方 | `hooks.test.ts` | 第一段 |
| 表态钩子：单方 ACCEPT 仍是 `CONSENT_PENDING`，**不排介绍** | `hooks.test.ts` | AC-04 在 T06 侧不被破坏 |
| 双方同意 → 排入介绍（提案级） | `hooks.test.ts` | 第二段 |
| 介绍成功 → 推进 `INTRODUCED` + 双方各一条**延迟 3 天**跟进 | `hooks.test.ts` / `runtime.test.ts` | 第三段 |
| 同步介绍端点也调 `onConnectionIntroduced` | `connections/{id}/introduce` 路由 | 否则同步介绍不产生跟进 |
| **E2E**：提案 → 介绍落地 → 流程 `INTRODUCED` | `workflow-execution.spec.ts` | 端到端真值 |

### AC-17 · 崩溃恢复（故障注入下无重复消息且可接管）

| 断言 | 文件 | 证什么 |
|---|---|---|
| 租约未过期的 RUNNING **不可**被领取 | `job-core.test.ts` | 防止把在跑的任务抢走 → 重复投递 |
| ★ 租约**已过期**的 RUNNING **可**被领取 | `job-core.test.ts` | 崩溃恢复路径 |
| 五种终态一律不可领取（尤其 DEAD 不复自动活） | `job-core.test.ts` | 死信要人处置 |
| CAS 未命中（count=0）→ 安静跳过，不算错误 | `runtime.test.ts` | 双 worker 抢同一行只有一个成功 |
| retryable 预算耗尽 → `DEAD` + `deadLetteredAt` | `runtime.test.ts` | 有界重试 |
| permanent → `FAILED`（不因 attempts 变 DEAD） | `runtime.test.ts` | 确定性失败立即停 |
| superseded → `CANCELLED`（**不是** FAILED） | `runtime.test.ts` | 三分法不被压成两分法 |
| 收尾 CAS 未命中（被接管）→ `LOST`，不覆盖他人结论 | `runtime.test.ts` | 人的处置优先 |
| `takeOverJob` 需 `workflow.manage`；已终态 → 409 | `runtime.test.ts` / `workflow-api.test.ts` | 接管闸门 |
| `requeueJobManually` 只对 DEAD/FAILED/TAKEN_OVER，重置 attempts=0 | `runtime.test.ts` | 只有人能重置预算 |
| `cancelJobsForProposal` 只碰 PENDING/RUNNING/DEAD | `runtime.test.ts` | 已 SUCCEEDED 的事实不可撤 |
| **E2E**：故障注入（提案已双方同意、**无 job**）→ tick 对账补入队 → 下一轮执行完成 | `workflow-execution.spec.ts` | 真实的"漏了就捡回来" |
| **E2E**：已撤销提案的 PENDING 任务 → tick 后 `CANCELLED`，零投递 | `workflow-execution.spec.ts` | AC-05 |
| **E2E**：死信两轮 tick 后仍 DEAD；OPERATOR 403 → ADMIN 200；重复 takeover 409；requeue 后 PENDING 且 attempts=0；再 requeue 409 | `workflow-execution.spec.ts` | 完整的接管/重试链 |

---

## 3. 负向验证（"能证明它失败"）

| 验证 | 做法 | 结果 |
|---|---|---|
| 泄漏守卫**确实在拦** | 把 rationale 同时当作 `missionTitle` 与 `protectedTexts` → 期望抛错 | 抛 `NotificationLeakError`，且 `notification.create` 未被调用 |
| 短路泄漏检测会漏 | 断言 `includes(rationale)` 为 **false**（截断 18 字），再断言最长公共子串 ≥ 18 | 证明"用 includes 会漏" |
| 邮件沙箱**不是**假成功 | 断言 `status === 'CAPTURED'` 且 `sentAt === null`、`providerMessageId === null` | 与 `SENT` 可区分 |
| 幂等**不是** upsert 重置 | 冲突路径断言 `workflowJob.updateMany` **未被调用** | 排除"重置为待办"的实现 |
| 退避抖动**不是**死代码 | `rand=0` 与 `rand=1` 给出**不同**值 | 抖动确实生效 |
| 路径层数缺陷**被 tsc 抓住** | C3 路由初版 `../../_shared` → `TS2307` | 已修为 `../../../_shared` |

---

## 4. 本层**证不了**的（交给谁 / 为什么）

| 项 | 为什么本层证不了 | 交给 |
|---|---|---|
| 真实 SQL 的 CAS 是否真的阻止双写 | 单测是 mock 的 `updateMany`，只断言"把哪些谓词交给了 CAS" | Postgres/libSQL 的真实并发（M6 后补 + E2E 观察） |
| 真实邮件外发 | 无 `RESEND_API_KEY` → 恒为沙箱 | 接上 key 后端到端复验 |
| 退避在**小时级**调度下的实际观感 | Netlify 免费计划只保证小时级 | cron-job.org 细粒度（不改代码） |
| 中间件/geo 与工作流端点的交互 | 非本任务范围 | T01 的 CN geo-block 既有 E2E |

---

## 5. 门禁

| 门禁 | 命令 | 结果 |
|---|---|---|
| 类型 | `npx tsc --noEmit` | ✅ **0 error** |
| 单测 | `npx jest tests/workflow` | ✅ 8 套 / **169 passed** |
| 全量回归 | `npx jest --maxWorkers=2` | ✅ **46 套 / 921 passed**（T05 时 752 → 本刀 +169） |
| 复用回归 | `npx jest tests/connection` `npx jest tests/tenancy` | ✅ 全绿（钩子接入未破坏 T05 / T01） |
| Lint | `npm run lint` | 见 §6 |
| 脚本声明 | `npm run check:script-decls` | ✅（`.mjs` 是 tsc 死角，故有此独立守卫） |
| 迁移对账 | `node scripts/connection/migrate.mjs verify` | ✅ **107 项**（C0–C3；脚本自报 `107/107`） |
| E2E | 见 §1 | 需本地 dev + CRON_SECRET；**未在 CI 跑**（8G 本机内存约束） |

> 📌 计数口径：早前记的「108 项」是把脚本末尾的 `✅ 全部通过`**汇总行**也 `grep -c '✅'` 数了进去。
> 脚本自报 107，以脚本为准。（本条即"统计口径也算判据"的一个小实例。）

## 6. Lint

见 §5 实际输出；新增源码与测试均以 `/* eslint-disable @typescript-eslint/no-explicit-any */`
只在**测试文件**顶部开启（mock 需要），源码不引入 any。

## 7. 生产上线复验（新增，2026-10-12）

单测与 E2E 都跑在**本地隔离库**上 —— 它们能证明逻辑正确，**不能**证明线上部署真的包含这些代码。
本刀为此补了生产侧复验脚本，并把判据设计成"能证伪"的：

| 脚本 | 覆盖 | 结果 |
|---|---|---|
| `scripts/qa/verify-t06-prod.mjs`（**新**，`npm run verify:t06-prod`） | 健康 + DB 可达；4 个 T06 端点 + 2 个 T05 端点匿名全拒；cron 守卫；披露负测；窗口期域名扫描；**真实 `CRON_SECRET` 实跑驱动器** | ✅ **25/25** |
| `scripts/qa/verify-t04-prod.mjs` | T04 页面/接口回归 + 披露负测 + 窗口期 | ✅ 19/19 |
| `scripts/qa/verify-public-origin.mjs` | OAuth/登录跳转一律落在公开域名 | ✅ 13/13（窗口期内，0 泄漏） |
| `scripts/qa/verify-login-realpath.mjs` | 真实登录路径（自定义端点 + 同源守卫 + 会话下发） | ❌ 12 失败 → **既有环境缺口**，见 `changes.md` §5.4 |
| `scripts/qa/probe-qa-login.mjs`（**新**，`npm run qa:probe:login`） | 直连生产库 + bcrypt 比对，**定性**登录失败的真因 | ✔ 定位出：生产库无 QA 账号 |
| `scripts/qa/db-snapshot.mjs`（**新**，`npm run qa:db:snapshot`） | 迁移前后基线快照 + `diff` 主动证伪 | ✅ 49 → 54 表，既有表行数未变 |

### 判据为什么必须这样设计

1. **"返回 200"证明不了任何事** —— 公开页永远 200。故对**受保护**端点断言 `401 + application/json`：
   401 说明"路由在 + 鉴权生效"；若拿到 Next 的 HTML 404，反而是"代码没上线"的铁证。
2. **只有 cron 实跑能证明运行时读得到新表**：`runWorkflowTick()` 第一步查 `WorkflowJob`，
   表不存在必然 500。所以"带真实 `CRON_SECRET` → 200 + 结构化 tick 摘要"是本刀最硬的一条线上证据。
3. **验证一个失败要先分清它的成因**：登录 401 既可能是窗口期故障、也可能是凭据过期。
   只看状态码分不出来 → 于是新增 `probe-qa-login.mjs` 从库里取哈希本地比对，把结论钉死。

