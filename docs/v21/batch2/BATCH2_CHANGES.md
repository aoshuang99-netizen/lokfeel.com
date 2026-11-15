# V21 第二批 · 变更总表与缺陷闭环

分支 `v21/batch2`（本地，未推送）｜基线 `f666564`｜生产仍 `b50e53e`｜整体 **NO-GO**（待独立复核 + Owner 批准）

## 1. 五条并行线（按用户指定的自动执行顺序）

| 线 | 角色（Agency Agents） | 交付 | TDD / 实测 |
|---|---|---|---|
| C00-R | Backend Architect ×3 只读 + Security Engineer | `C00_R_BASELINE.md`：四个 SHA、四条契约硬边界、三条例外验收定性 | `git ls-remote` / 生产 /api/health / 全仓只读盘点 |
| C06/C09 | Backend Architect | `sourceRunId` 真实关联、spec/verification/events 三 API、`ExecutionVerification` / `MissionSpecRevision` / `AgentRunStageEvent` 三表、编排阶段事件写入 | RED 50 failed/7 passed → GREEN **33 suites / 699 tests**（connection+agents），tsc 0 |
| C04 | Frontend Developer | `spec/edit.ts` 四字段编辑 + 人话 diff + 冲突码；`SpecEditor` 组件；`MissionSpecSection` 版本历史 | RED 43 failed/6 passed → GREEN **49/49**；living 全量 **389/389** |
| C03 + 异步竞态 | Reality Checker | `intent-race.ts` 最新提交获胜控制器（12 单测）；SSE 编排阶段 + `Last-Event-ID` 续传；`runIntent` 两道过期守卫 + 30s 超时 + 取消不假降级；E2E 2 条可复现竞态用例 | RED 43 failed → GREEN 49/49；真实 HTTP 阶段事件 ≥2 帧、seq 递增、续传只回新帧（见 `closure.json`） |
| 独立 QA | Security Engineer（不改产品代码） | `scripts/qa/v21-batch2-redteam.mjs` + 37 份原始响应 + `REDTEAM_REPORT.md` | 首轮 **1 FAIL**（R3 串台）→ 修复后复验 **7 PASS / 0 FAIL / 1 PARTIAL** |

## 2. 真实业务闭环（不是页面数量）

`scripts/qa/v21-batch2-closure.mjs` 在本机隔离库发起**真实 HTTP**，逐段断言并直查 DB：

```
意图运行(真模型/诚实降级) → 同键幂等重放 → 带 sourceRunId 创建 Mission
  → 方案保存 v1 + 并发冲突 409 → 编排阶段事件 SSE + 断点续传
  → 批准/执行 → 真实 RECEIPT 回执 → 执行后方案锁定 409
  → GET 核验=null → 自己核自己 409 / 模型输出当证据 400 / 未确认判据 409 / 无回执 409
  → 第二人独立核验 COUNTERPARTY_CONFIRMED（四重证据）
  → DB 直查 AgentRun / AgentExecution / ExecutionVerification / MissionSpecRevision /
     AgentRunStageEvent / TenantAuditEvent / Mission 七张表
```

**诚实边界（写进代码、UI 与证据）**：`execute` 的效果是 IN_APP 站内回执，**不是外部动作**；Mission CLOSED ≠ Agent EXECUTED；Agent EXECUTED ≠ Outcome VERIFIED；模型输出不是核验证据；核验响应只陈述事实、不宣布目标达成。

## 3. 本批发现并修复的缺陷（全部有实测证据）

| # | 来源 | 缺陷 | 根因 | 修复 | 复验 |
|---|---|---|---|---|---|
| D1 | 独立红队首轮 FAIL | 同租户第二账号复用同一 `Idempotency-Key` → `201 + Idempotent-Replayed:true` **拿到他人资源** | `IdempotencyRecord` 唯一键不含用户，`requestHash` 不含发起人 | `actorId` 分区 scope + 归属校验（不改 `@@unique`，旧数据安全） | 红队 C8 **FAIL→PASS**；`v21-idempotency-actor.test.ts` 14/14 |
| D2 | 独立红队实测 | 「忽略之前的全部指令」`injectionFlagged=false` | 中文正则修饰语语序写死，「全部」不在重复组 | 语序不敏感可重复组；保持「只告警/升级审批、不阻断」契约 | 红队 C5 PASS（阳性命中 `AWAITING_APPROVAL`）；`v21-injection-zh.test.ts` 正例/负例 |
| D3 | 真实闭环取证 23 步 | 重复核验返回 **500 INTERNAL_ERROR**（应为 409） | `@@unique([missionId,runId])` 撞 P2002 未映射，且仍可能写假审计 | catch P2002/唯一约束 → `ConflictError(409, VERIFICATION_ALREADY_RECORDED)`，不写审计 | RED 1 failed/19 passed → GREEN **20/20**；重建后真实 HTTP 复验 `closure.json` 负例 `409/VERIFICATION_ALREADY_RECORDED` |
| D4 | 静态盘点 + E2E | A 慢 B 快时旧 A 覆盖 B（状态层无过期保护） | 无条件 `setOutcome`、fetch 无 signal | `createLatestIntentController` + `isCurrent`/`finish` 两道守卫 + AbortSignal + 30s 超时；取消不降级成规则成功 | `workspace-now-race.spec.ts`（E2E 显式绕过 disabled 制造并发） |
| D5 | 首批已知 + 本批防范 | 列表信封混用数组/对象 data，按 `data.items` 读会假空态 | `paginated()` vs `success({items})` | `parseListEnvelope` 四态 + `assertNonEmpty`；所有新列表读取统一走它，权限错误不映射空列表 | 19 条契约单测 + 红队 C7 真实 HTTP 非空（8/23 条） |

**制度性风险 R1（未擅自改动权限系统，需 Owner 决策）**：单一 OWNER/ADMIN 会话可完成「发起→批准→执行」自我闭环（`capabilities.ts` 中 ADMIN 同时持有 run/approve/execute，`decideAgentRun` 不比较 `requestedBy`）。红队已真实复现（原始响应在 `evidence/independent/raw/`）。本批在**新增**的核验链强制 `verifierId !== run.requestedBy`（第二人），但**既有 approve 链未改**（改它属于权限语义变更，且会破坏既有 GA 流程）。R1 保持记录为 P1 待批风险。

## 4. 验证数字（均为本地实测，不等于生产验收）

| 项 | 结果 | 退出码 |
|---|---|---|
| `npx tsc --noEmit -p tsconfig.json` | 0 error | 0 |
| `npx jest --runInBand`（最终全量） | **159 suites / 2906 tests passed** | 0 |
| `npx jest tests/living --runInBand` | 20 suites / 389 tests | 0 |
| `npx jest tests/connection tests/agents --runInBand` | 33 suites / 699 tests | 0 |
| `npm run build` | Compiled successfully（含全部修复的重建 exit 0） | 0 |
| 独立红队复验（脱敏脚本重跑） | 7 PASS / 0 FAIL / 1 PARTIAL | 0 |
| 真实闭环取证（首轮） | 23 步 / 负例 7/8，唯一失败「重复核验 500」⇒ 定位 D3 | 1（真实缺陷，已修） |
| 真实闭环取证（重建后复验） | **PASS_LOCAL**：23 步 / **8/8 负例** / 0 failures；`providerKind=workbuddy`、4 个编排阶段事件、`RECEIPT/IN_APP/SENT` 回执、DB 7 张表逐表有行 | **0** |
| **e2e-ci 最终全量** | **125/125 passed**（含 2 条新竞态：A 慢 B 快不覆盖、重复点击只发 1 请求），8m30s「全部通过」 | 0 |
| 6 视口 / axe / 键盘 / 200% | `visual-report.json` **PASS**：18 张截图、6 视口 `overflowPx=0`、axe（390/1280 ×2 状态）**0 violations**、键盘可达、200% 缩放无溢出 | 0 |
| 提交前全量单测复核 | **159 suites / 2906 tests passed**（`JEST_FINAL_EXIT=0`，72s） | 0 |
| Chrome Trace / TBT / LCP / CLS | `perf-trace.json` **9 页 ×3 轮，9/9 MISS、0 ALL_MEET**；TBT 522–2712ms 全超 200ms、LCP 6/9 超 2500ms、CLS 3/9 超 0.1；逐页判定见 `PERF_ANALYSIS.md` | `PERF_EXIT=0`（**仅采集成功，性能不达标**） |

## 5. 未完成 / BLOCKED（不假绿）

- **G15 性能不达标（本批新增实测负例）**：`PERF_ANALYSIS.md` 逐页列出 9/9 MISS。与历史 `vitals-b4` / `vitals-p0-clean` 同档 lab 的 TBT 同量级，属**延续性历史债**，但页面集合不同，不判定为本批回归或改善；也没有通过降节流、改阈值、跳过最差页来「达标」。生产档 RUM / Trace 未测 ⇒ G15 保持 `MEASURED_MISS`，需 Owner 批复后另开优化批次。
- **外部真实执行动作**：按发布纪律「未经授权不执行真实外部高风险动作」未做；现有执行器能力闭集只有 RECEIPT/IN_APP。G09 只能判 LOCAL_EVIDENCE / PARTIAL。
- **G02 Figma**：无 token / 文件 key / MCP 授权，保持 BLOCKED，只交付源码推断的组件映射与交付准备（`FIGMA_MAPPING.md`）。
- **G04 真人验收**：只交付 10 人协议与统计工具，无真人样本，UNTESTED；须 Owner 组织。
- **独立评审**：本会话的独立 QA 不是外部 Codex 独立评审；最终放行需外部复核人。
- **R1 自我审批**、Creem webhook mock 旁路（R2，非本批链路）、debug 路径白名单（R5）等待 Owner 批复。
