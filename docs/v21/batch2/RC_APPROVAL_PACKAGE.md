# V21 第二批 · RC 审批包（G01–G20 + 发布授权）

**结论：NO-GO**。本批把「意图理解 → 方案编辑 → 创建任务 → 批准执行 → 回执 → 第二人核验」在**本地隔离环境**真实跑通并留四重证据，但：**未推送、未部署、未改生产、未执行外部高风险动作、无真人样本、无 Figma 授权、无外部独立复核**，且 **G15 性能实测 9/9 页不达标**。本文件不构成发布批准。

| 项 | 值 |
|---|---|
| 基线 | 首批 `f666564`；远端 main `cad717e`；生产 `b50e53e`（healthy） |
| 本批分支 | `v21/batch2`（本地） |
| 发布候选 SHA | **`dbb95a7182256ed693e12066f630885f3082fa1d`**（短 `dbb95a7`，本地代码树；见 `RELEASE_CANDIDATE.md`）（**提交 ≠ 推送 ≠ 发布**） |
| 运行环境 | 本地 `next start 127.0.0.1:3214`，隔离库 `file:./ci-e2e.db`，模型键只注入进程 |
| 证据根 | `docs/v21/batch2/` + `docs/v21/evidence/independent/` |

## G01–G20 逐条（按证据闭环，不按页面数量）

| ID | 门禁 | 本批状态 | 证据 / 仍缺什么 |
|---|---|---|---|
| G01 | 环境/截图/候选/生产 SHA 对应 | **PARTIAL** | `C00_R_BASELINE.md`（四 SHA + 生产 health）、`visual-report.json` + `shots/` 18 张（6 视口 × 3 状态）；缺口：候选未部署，"候选=生产"对应不存在 |
| G02 | Figma 可编辑设计与 Tokens | **BLOCKED** | `FIGMA_MAPPING.md`：无 token / 文件 key / MCP；只交付源码推断的组件→语义→Token 映射，**未读 Figma API、未产 .fig** |
| G03 | Now 首屏主操作与空态五视口 | **LOCAL_EVIDENCE** | `visual-report.json` **PASS**：6 视口 `overflowPx=0`、`shots/now-*-*.png`；缺口：独立视觉评审 W01 |
| G04 | 10 人真人 ≥8 理解并完成 | **UNTESTED** | `G04_USABILITY_PROTOCOL.md` 仅协议/任务/统计工具；**无真人样本，不自签通过** |
| G05 | 真实 AI/规则来源 + stream 协议 | **LOCAL_EVIDENCE** | `closure.json`：真实 run（`providerKind=workbuddy`）+ SSE 编排阶段事件 4 帧（seq 递增、`Last-Event-ID` 续传只回新帧）；**明确不是模型 token 流**；缺口：模型逐 token 流仍未做（服务端本就不转发） |
| G06 | WorkspaceSpec 与可编辑计划 | **LOCAL_EVIDENCE** | 双重 zod 校验 + 四字段编辑 + 人话 diff + v1 版本表 + `409 SPEC_VERSION_CONFLICT` + EXECUTED 后 `409 MISSION_LOCKED`；**`owner` 如实显示「v1.2 暂无字段」，不伪造** |
| G07 | 真实任务创建/读取/状态连续 | **LOCAL_EVIDENCE** | `closure.json`：带真实 `sourceRunId` 创建、列表/详情可读、DB 直查；首批 `mission-loop.json` 状态机 |
| G08 | 幂等与重复事件去重 | **LOCAL_EVIDENCE** | 同键重放同一 run；E2E 重复点击只发 1 请求；重复核验 `409 VERIFICATION_ALREADY_RECORDED`；**R3 跨用户串台已修**（红队 C8 FAIL→PASS） |
| G09 | Agent 执行 server 证据、零伪成功 | **PARTIAL** | 真实 `approve/execute` → `EXECUTED` + `AgentExecution` 回执 + `TenantAuditEvent` + 阶段事件 + 第二人核验（四重证据，DB 逐表直查）；**缺口：执行效果闭集只有 IN_APP RECEIPT，未执行外部动作；不把回执写成成果达成** |
| G10 | 审批/撤销/跨租户隔离 | **PARTIAL** | 红队真实 HTTP：匿名 401、假租户 403、身份字段丢弃、MEMBER 403 零副作用、409 状态机；**缺口：R1 单一账号可自我审批（待 Owner 决策）、无 cancel/撤销端点、reject 未走完整实测** |
| G11 | 7 屏路由/返回刷新/任务连续 | **PARTIAL** | e2e-ci 全量 **125/125 passed**（含 2 条新竞态），8m30s；缺口：刷新/前进后退专项未逐一复核 |
| G12 | API 错误与 0/null 区分 | **LOCAL_EVIDENCE** | `GET /verification` 返回 `null` 非 `[]`；`parseListEnvelope` 四态使权限错误不映射空列表；400/403/409 负例 8 条；缺口：429/离线专项 E2E |
| G13 | 首屏无工程噪声、证据按需 | **LOCAL_EVIDENCE** | 首批 e2e 断言可见文本无 `/api/`；Inspector 默认收起；`UI_AUDIT.md` 逐项自查 |
| G14 | 无障碍/键盘/缩放 | **PARTIAL** | `visual-report.json` **PASS**：axe（390/1280 × 2 状态）**0 violations**、Tab 可达、CSS zoom 200% `overflowPx=0`；缺口：读屏（NVDA/VoiceOver）、焦点环、400% 缩放人工测试 |
| G15 | 真实浏览器性能 | **MEASURED_MISS** | `perf-trace.json` + `PERF_ANALYSIS.md`：Chrome Trace 9 页 ×3 轮，**9/9 MISS、0 ALL_MEET**；TBT 9/9 超 200ms（522–2712ms）、LCP 6/9 超 2500ms、CLS 3/9 超 0.1；脚本 `PERF_EXIT=0` 仅代表采集成功。**本地 lab ≠ 生产达标，也不因"不是生产"改判 PASS** |
| G16 | 多模态真伪标记与权限 | **PARTIAL** | 未接通入口不显示（延续首批）；缺口：显式断言与能力开关 |
| G17 | 注入/XSS/错误 JSON 负例 | **LOCAL_EVIDENCE** | 红队 C5/C6 真实 HTTP + D2 中文注入漏检修复 + 8 条核验负例；**已知局限：模式表可绕过、注入只告警/升级审批不阻断**（产品契约，不掩饰） |
| G18 | 能力开关/i18n/降级真实 | **PARTIAL** | 无凭据→规则 + 原因透出；阶段事件含 DEGRADED；缺口：i18n 与开关审计未做 |
| G19 | 旧 GA 不回归、唯一 SHA | **PARTIAL** | jest 全量 **159 suites / 2906 tests passed**（提交前复核 `JEST_FINAL_EXIT=0`）、tsc 0、`npm run build` 0、e2e-ci **125/125**；缺口：旧 GA 发布门禁未在生产候选复跑，远端 CI 未跑（未推送） |
| G20 | 独立 RC 与 Owner 批准 | **NO_GO** | 独立 QA 由本会话另一子代理真实复现（37 份原始响应），**但不是外部 Codex 独立评审**；未推送/未部署/未获批 |

## 本批已闭合的真实业务能力（不按页面数量汇报）

| 能力 | 真实证据（HTTP 请求 + 回执 + DB + 审计） |
|---|---|
| 意图理解 → 真实 proposal | `closure.json`：`providerKind=workbuddy`、`runStatus=PROPOSED`、proposal 过 `WorkspaceSpecSchema`；同键重放返回同一 runId |
| 方案字段级编辑与版本化 | `MissionSpecRevision` v1 + 人话 diff；`409 SPEC_VERSION_CONFLICT`；执行后 `409 MISSION_LOCKED` |
| 批准 → 执行 → 回执 | `approve` → `execute` → `AgentRun=EXECUTED` + `AgentExecution` 回执（`RECEIPT/IN_APP/SENT`） + `TenantAuditEvent` + 4 个 `AgentRunStageEvent` |
| 第二人独立成果核验 | `ExecutionVerification=COUNTERPARTY_CONFIRMED`，第二人、`criteria` 全确认、以真实回执为证据；模型输出被 `400 MODEL_OUTPUT_NOT_EVIDENCE` 拒绝 |
| 四重证据 | DB 直查 7 张表：`AgentRun=1, AgentExecution=1, ExecutionVerification=1, MissionSpecRevision=1, AgentRunStageEvent=4, TenantAuditEvent=4, Mission=1` |

**最终复验**：`closure.json` → `PASS_LOCAL`，23 步 / **8/8 负例** / 0 failures；独立红队 → **7 PASS / 0 FAIL / 1 PARTIAL**；凭据复扫 0 命中。

**必须并列的诚实边界**：`Mission CLOSED ≠ Agent EXECUTED`；`Agent EXECUTED ≠ Outcome VERIFIED`；现有 `execute` 唯一副作用是 IN_APP 站内回执，**不是外部动作**；核验响应只陈述事实、不宣布目标达成。

## 本批未达标 / 未测项（不放水清单）

1. **G15 性能 9/9 MISS**（新增实测负例，见 `PERF_ANALYSIS.md`）；历史 TBT 债维持 P1。
2. **G09 PARTIAL**：无外部执行器；需 Owner 授权才能新增真实外部动作。
3. **G02 BLOCKED / G04 UNTESTED / G20 未做**：Figma 凭据、10 名真人、外部 Codex 复核。
4. **R1 自我审批**未改（改权限语义需 Owner 决策）；reject/cancel 完整实测、429/离线 E2E、i18n 与能力开关审计、读屏/400% 人工测试均未做。
5. **远端 CI / Preview / 回滚演练 / 生产迁移**：因未推送、未部署，全部未执行。

## 发布控制（唯一授权需求）

未经 Owner 明确批准，**不执行**以下任一项：推送远端 / 推 main / 触发 Netlify 构建或 Preview / 生产部署 / 生产数据库迁移 / 真实外部动作或扣款。

### 🔴 与首批不同的发布风险：本批**含 Prisma 变更**

新增 3 张表（`MissionSpecRevision`、`ExecutionVerification`、`AgentRunStageEvent`）与 2 个可选列（`Mission.sourceRunId`、`IdempotencyRecord.actorId`），且 `src/generated` 生成产物随提交（CI 不重跑 `prisma generate`）。

- **铁律：先迁移后发版**。必须在生产库执行 `prisma db push` / 等价 DDL 后再切流，否则旧代码读不到新表会 500。
- 新增对象均为**纯新增 + 可选列**，旧代码不读它们，理论上可先保留；但这不能替代回滚演练。
- 回滚方案（**尚未验证**）：Netlify 回滚至 `b50e53e` + 确认 `IdempotencyRecord.actorId` 分区 scope 与旧记录的兼容行为（旧记录 `actorId=NULL` 不再被回放，会新建独立资源 —— 安全但改变重放语义，须在回滚说明里写明）。

### Owner 需集中批复的 9 项

1. 是否批准推送 `v21/batch2` 并走远端 CI / 独立 PR / Preview。
2. 生产迁移窗口与执行人（含回滚演练）。
3. **R1 自我审批**处置：是否要求 `approver !== requestedBy`（改权限语义，影响既有流程）。
4. 是否授权**新增真实外部执行器**（当前只有 IN_APP RECEIPT，G09 因此只能 PARTIAL）。
5. Figma 授权（文件 key + token / MCP），解 G02。
6. 10 名真人测试的组织与时间（G04）。
7. **G15 已实测 9/9 MISS**：性能门槛维持 P1 不放水的前提下，是否批准先带债发布，或先开性能优化批次；生产档 RUM/Trace 验收口径需一并确定。
8. Creem webhook mock 旁路（R2）与 debug 路径白名单（R5）的修复排期。
9. 外部独立复核人（G20）。

## 证据索引

| 证据 | 路径 |
|---|---|
| 基线与契约硬边界 | `docs/v21/batch2/C00_R_BASELINE.md` |
| 变更总表与 D1–D5 缺陷闭环 | `docs/v21/batch2/BATCH2_CHANGES.md` |
| 真实闭环（HTTP+DB+Audit+阶段事件） | `docs/v21/batch2/closure.json` |
| 独立红队首轮（含 FAIL 原始证据） | `docs/v21/evidence/independent/redteam-round1-before-fix.json` |
| 独立红队复验（7 PASS / 0 FAIL） | `docs/v21/evidence/independent/redteam-results.json`、`REDTEAM_REPORT.md`、`raw/` |
| 视觉 / a11y | `docs/v21/batch2/visual-report.json`、`shots/` |
| 性能 Trace 原始数据 | `docs/v21/batch2/perf-trace.json` |
| **性能逐页判定与不放水声明** | `docs/v21/batch2/PERF_ANALYSIS.md` |
| 真人协议 / Figma 映射 / UI 审计 | `docs/v21/batch2/{G04_USABILITY_PROTOCOL,FIGMA_MAPPING,UI_AUDIT}.md` |
| 可重放脚本 | `scripts/qa/v21-batch2-{closure,visual,perf}.mjs`、`v21-batch2-redteam.mjs` |
| 测试命令与退出码 | `docs/v21/batch2/TEST_COMMANDS.md` |

## 发布候选 SHA 回填

本批代码与证据在**本地分支 `v21/batch2`** 提交（未推送）。首个提交包含全部代码、测试、证据与审批包；紧随其后的**纯文档提交**回填该 SHA，两提交之间无代码差异，可用 `git diff <SHA> HEAD -- '*.ts' '*.tsx' '*.mjs' '*.prisma'` 复核为空。具体 SHA 见 `docs/v21/batch2/RELEASE_CANDIDATE.md`。
