# V20.3 · 44 — 交互状态矩阵（12 UI 语义 ← 真实后端枚举）

> 作战令 §2.2：「这是 UI 展示语义，**不是要求改写现有数据库枚举**」「必须建立从真实后端状态到 UI 状态的映射表」
> 「不得用前端计时器、随机数字、静态 JSON 或伪动画制造任务完成」。
> 本表所有后端枚举逐字摘自 `prisma/schema/*.prisma`，不新建状态机。

## 1. 真实后端枚举（逐字，带行号）

| 枚举 | 文件 | 值 |
|---|---|---|
| `AgentRunStatus` | `prisma/schema/agent.prisma:48` | `PROPOSED` `AWAITING_APPROVAL` `APPROVED` `REJECTED` `EXECUTED` `DEGRADED` `BLOCKED_QUOTA` `FAILED` |
| `AgentProviderKind` | `agent.prisma:70` | `OPENAI` / `WORKBUDDY` / `RULES` / `STUB`（`RULES`=根本没调模型，用于降级率可复算） |
| `MissionStatus` | `prisma/schema/connection.prisma:21` | `DRAFT` `ACTIVE` `PAUSED` `CLOSED` |
| `MissionParticipationStatus` | `connection.prisma:32` | `INTERESTED` `WITHDRAWN` `REMOVED` |
| `IntentStatus` | `connection.prisma:101` | `ACTIVE` `WITHDRAWN` |
| `ProposalDecisionKind` | `connection.prisma:272` | 提案裁决种类 |
| `ConsentState` | `prisma/schema/core.prisma:1265` | `CONSENT_NONE` `CONSENT_PENDING` `CONSENT_GRANTED` `CONSENT_DENIED` `CONSENT_EXPIRED` |
| `OutcomeVerificationLevel` | `prisma/schema/outcome.prisma:25` | `SELF_REPORTED` `COUNTERPARTY_CONFIRMED` `EXTERNALLY_VERIFIED` |
| 阶段机 | `src/lib/workflow/stage-machine.ts` | `PROPOSED → CONSENT_PENDING → INTRODUCED → COORDINATING → ACTION_COMPLETED → OUTCOME_RECORDED` |

**真相链**（`v20/13_EVIDENCE_TRUTH_MATRIX.md`）：前端「已批准 / 已执行 / 已验证」分别钉到
`AgentRun.status` + `AgentApproval.decision`、`AgentExecution`、`Outcome.verificationLevel` + `VERIFIED_LEVELS`。
`VERIFIED_LEVELS` 由 `isVerified()` **派生**，不手写字面量 → 不会漂移。

## 2. 12 个 UI 语义态映射表

| # | UI 语义 | 真实后端来源 | 触发条件 / 界面对照 | 判定 |
|---|---|---|---|---|
| 1 | `IDLE` | `MissionStatus.DRAFT`、`ConsentState.CONSENT_NONE` | 尚未提交意图 / 尚无待裁决 | IMPLEMENTED_VERIFIED |
| 2 | `UNDERSTANDING` | ⚠️ **无独立后端枚举** | `compileWorkspaceSpec(draft)` 是**纯前端编译**（`v20/01` A2）；真实语义是「前端本地编译中」，**不得伪装成服务端在思考** | **NOT_TESTED**（需 UI 明确标注「本地编译」） |
| 3 | `PLANNING` | `AgentRunStatus.PROPOSED` + 阶段机 `PROPOSED` | Agent 已提案、尚未请求授权 | IMPLEMENTED_VERIFIED |
| 4 | `READY` | `MissionStatus.ACTIVE`、`AgentRunStatus.APPROVED` | 已批准待执行 / 任务可执行 | IMPLEMENTED_VERIFIED |
| 5 | `RUNNING` | `AgentRunStatus.EXECUTED`（写入点 `executor.ts`）+ `AgentExecution` | 执行唯一写入点；`EXECUTED` 与库级记录一致 | IMPLEMENTED_VERIFIED |
| 6 | `AWAITING_CONSENT` | `AgentRunStatus.AWAITING_APPROVAL`、`ConsentState.CONSENT_PENDING`、阶段机 `CONSENT_PENDING` | 待授权；`v20/36`：**仅真实 Provider 成功路径可达** | IMPLEMENTED_VERIFIED（S1）/ **BLOCKED**（S2 真实 Provider） |
| 7 | `APPROVED` | `AgentRunStatus.APPROVED` + `AgentApproval.decision` | 裁决唯一行，`decision ≡ status`（`approval-consistency.test.ts`） | IMPLEMENTED_VERIFIED（S1） |
| 8 | `REJECTED` | `AgentRunStatus.REJECTED`、`ConsentState.CONSENT_DENIED` | 拒绝 / 撤销 | IMPLEMENTED_VERIFIED（S1） |
| 9 | `FAILED` | `AgentRunStatus.FAILED`、`BLOCKED_QUOTA`、`DEGRADED`；`AgentCall.ok=false` | `DEGRADED` 仍须走批准（降级不降低门槛）；失败也记账 | IMPLEMENTED_VERIFIED（S1） |
| 10 | `COMPLETED` | `MissionStatus.CLOSED`、阶段机 `ACTION_COMPLETED` / `OUTCOME_RECORDED` | ⚠️ **不等于 VERIFIED**：自报 ≠ 已验证 | IMPLEMENTED_VERIFIED |
| 11 | `VERIFIED` | `OutcomeVerificationLevel ∈ VERIFIED_LEVELS`（`COUNTERPARTY_CONFIRMED` / `EXTERNALLY_VERIFIED`）+ `OutcomeVerification` 行 | `SELF_REPORTED` **不算验证成功**（AC-15）；`verify` 仅 ADMIN+ | IMPLEMENTED_VERIFIED |
| 12 | `UNAVAILABLE` | 无凭据时 provider 返回 `unavailable`（`provider-mode` 单测） | 生产 + `AGENT_PROVIDER=stub` 硬抛错；缺凭据**不回退 stub** | IMPLEMENTED_VERIFIED（S1） |

## 3. 六屏 → 状态归属（真实屏幕，非虚构）

| 屏 | 主导状态 | 组件 | 证据来源 |
|---|---|---|---|
| Now | `IDLE` / `READY` | `living-workspace.tsx` L678–717 `StatCard` | 三端点折算，`buildOsStages` 纯函数；读不到显示「—」不是 0 |
| Studio | `IDLE` → `UNDERSTANDING`(本地) → `PLANNING` | composer + `LivingCanvas` + `runCompile` | 成功**只认服务端 `mission.id`**，无 id 按失败 |
| Field | `READY` | `field-canvas.tsx` / `field-inspector.tsx` | 取数 + 纯函数装配 |
| Consent | `AWAITING_CONSENT` → `APPROVED`/`REJECTED` | `consent-gate.tsx` + `bridge-panel.tsx` | 只按服务端 `availableActions` 渲染按钮；四步进度比较常量不用状态字面量 |
| Agents | `PLANNING`…`FAILED` / `UNAVAILABLE` | `agents/agent-board.tsx` | 状态标签来自服务端 `statusLabel`/`statusHint`，**前端不自建第二套状态机** |
| Outcomes | `COMPLETED` → `VERIFIED` | `observatory/outcome-observatory.tsx` | `verificationLevel` 派生自 `OutcomeVerification`；三栏证据 |

## 4. 六项交互创新的真实现状（作战令 §2.3 要求「至少一个真实可运行场景 + Trace + API + DB」）

| 创新 | 代码现状 | 真实证据 | 判定 |
|---|---|---|---|
| Intent-first Entry | Studio composer 已实现 | `v20/01` A2；E2E `tests/e2e-ci/workspace-tabs.spec.ts` | IMPLEMENTED_UNVERIFIED（缺本轮 Trace） |
| Adaptive Focus Stage | `focusStage` + `buildOsStages` 已实现 | `v19/07` §3 差异裁决① | IMPLEMENTED_UNVERIFIED |
| Progressive Evidence | Inspector 抽屉 + Outcomes 三栏 | `v19/07` §1、`v20/01` A5 | IMPLEMENTED_UNVERIFIED |
| Human-in-the-Loop Consent | 服务端 `proposal.decide` 重新判定 | `v19/07` §1、`v20/13` | IMPLEMENTED_UNVERIFIED |
| Outcome-first Feedback | `SELF_REPORTED` 不算验证 | `v20/13` §0、`outcome/verification.ts` | IMPLEMENTED_VERIFIED（S1 单测） |
| **Continuity** | **本轮新增** `?view=` 深链接 + `popstate` 恢复 | `src/lib/living/workspace-view.ts`，14/14 单测 + tsc 0 + eslint 0 | **IMPLEMENTED_VERIFIED（代码）/ NOT_TESTED（Playwright Trace）** |

> ⚠️ 作战令要求每项有「真实可运行场景、视频或 Playwright Trace、API 和数据库证据」。
> 本轮**未跑浏览器 Trace**（登录态 D-06 BLOCKED），故除 S1 单测覆盖项外一律不标 PASS。
> 不把「代码存在」等同于「端到端验收通过」。

## 5. 严禁事项（继承既有纪律，本轮未违反）

- 不用 `setTimeout` 伪造执行成功（`living-workspace.tsx` 文件头硬约束 3）。
- 不把 `AWAITING_APPROVAL`（待批）直接跳到 `EXECUTED`（`approval.ts` 真相表无边，`adversarial-injection.test.ts`）。
- 不把模型输出等同于已执行动作、不把 Action 成功等同于 Outcome Verified。
- 不用空数据显示成功运行；`living-states.tsx` 空态明确「真实结果，不凑内容」。
- 本轮深链接改动**只改导航态**，不触碰任何业务状态或服务端数据。

## 6. 待补证据（复跑命令）

```bash
env -u NODE_OPTIONS npx jest tests/agents tests/agent tests/living/consent tests/outcome tests/tenancy/consent-revocation.test.ts --ci  # S1 708/708
env -u NODE_OPTIONS npx playwright test --config playwright.ci.config.ts    # 需登录态，D-06 解锁后
```
