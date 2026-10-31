# 46 · Agent → Consent → Action → Verified Outcome（V19-83 · Batch 4）

- 日期：2026-10-31
- HEAD：`f0e53de`（分支 `v19/design-exploration`）
- 探针：`scripts/qa/v198-agent-consent-outcome.mjs`（真实 HTTP + 真实本地库 + 审计取证）
- 探针结果：**16 PASS / 1 BLOCKED_ENV / 0 FAIL**
- 集成单测实跑：`approval-consistency.test.ts` + `outbound-delivery.test.ts` → **32/32 PASS**；
  `workspace-spec/compile.test.ts` → **21/21 PASS**（offer 回归）
- 环境：本地生产构建（localhost:3000）+ `file:/tmp/v196-e2e.db`；三视角登录（owner/peer/outsider）

## 0. 执行摘要

Agent 运行的授权与执行链路在**无真实 LLM Provider** 的环境下表现出正确的诚实行为：

1. **Provider 缺失 → 明示降级**（`DEGRADED + PROVIDER_UNAVAILABLE`），绝不伪装为模型成功；
2. **高风险技能（INTRO_DRAFT）无降级路径 → `FAILED`（终态）** —— 宁可不产出，也不给未经验证的结果；
3. **批准不可绕过**：`DEGRADED→APPROVED` 的边在真相表中不存在，直批 API 返回 409；
4. 撤销/过期在**创建侧即刻生效**（400 拒绝发起新的对外送达）；
5. Outcome 的验证级别由服务端派生，自报≠验证，确认后 evidence/note 不外发。

## 1. 断言矩阵（A01–A12）

| # | 场景 | 结论 | HTTP | DB State | Audit | 备注 |
|---|------|------|------|----------|-------|------|
| A-01 | Provider 未配置 | **PASS** | 201，`status=DEGRADED`，`degradeCode=PROVIDER_UNAVAILABLE`，`providerKind=rules` | AgentRun 行一致 | `agent.run.degraded` ×1 | `/agents/usage` 诚实块 `provider=none / realCallsEnabled=false` |
| A-02 | 等待/未产出不伪装为执行中 | **PASS** | execute → 409 `STATUS_NOT_EXECUTABLE` | 状态仍 FAILED，AgentExecution 0 行 | 无 executed 事件 | 高风险 INTRO_DRAFT 无降级路径 → FAILED（终态） |
| A-03a | 批准不可绕过 | **PASS** | 对 DEGRADED 运行直批 → 409 | 状态不变 | 无 approved 事件 | `DEGRADED→APPROVED` 边不存在（注入不能绕过审批） |
| A-03b | Consent 批准全链路 | **BLOCKED_ENV** | — | — | — | `AWAITING_APPROVAL` 仅由真实模型成功路径产生（`runtime.ts` ⑦）；本地无凭据，**不伪造**。真相表与服务层由 `approval-consistency.test.ts` 实跑覆盖 |
| A-04 | Consent 拒绝 | **PASS** | reject → 200；execute → 409 | `REJECTED` + AgentApproval(decision=REJECTED, deciderRole=OWNER) | `agent.run.rejected` ×1 | |
| A-05 | Consent 撤销 | **PASS** | withdraw → 200；用过期授权创建对外送达 → 400 | SocialIntent `WITHDRAWN` + withdrawnAt | intent 迁移审计 | 执行侧 409 + AgentExecution 0 行；执行侧闸门（DISCLOSURE_EMPTY/收窄/整行删除）由 `outbound-delivery.test.ts` §348/363/379/394 覆盖 |
| A-06 | Consent 过期 | **PASS** | 过期后创建对外送达 → 400 | status 仍 `ACTIVE`，`expiresAt` 已过（与撤销的证据形态区分） | — | 错误文案「未向对手方披露任何字段（或已被撤销/过期）」 |
| A-07 | 重复裁决幂等 | **PASS** | 第二次裁决 → 409 | AgentApproval 仍 1 行（唯一索引） | 无重复事件 | 与批准侧同一机制（唯一裁决行 + 不可改判） |
| A-08 | 跨租户 | **PASS** | GET/approve → 404；列表零泄漏 | — | — | 复合租户谓词（`findRunRow(org,id)`） |
| A-09 | Action 失败可恢复 | **PASS** | 阻断态 execute → 409（非 500、非假成功）；重新发起 → execute 201 `EXECUTED` | AgentRun=EXECUTED + AgentExecution 行 + NotificationDelivery(SENT) | `agent.run.executed` ×1 | 恢复动作 = 重新发起（REJECTED/FAILED 无出边）。投递失败不改状态的顺序论证由 `execution-gated.test.ts` §320 覆盖 |
| A-09b | 副作用真实发生 | **PASS** | — | Notification 行（owner 收件箱） | — | IN_APP 投递真实落库 |
| A-09c | 重复执行幂等 | **PASS** | execute ×2 → `replayed=true, delivery=null` | NotificationDelivery 仍 1 行（dedupeKey=`agent-exec:<runId>`） | 无第二次 executed | |
| A-10 | Outcome 未验证 | **PASS** | POST → 201，`verificationLevel=SELF_REPORTED`，`verified=false` | Outcome 行 level=SELF_REPORTED | `outcome.reported` ×1 | 请求体没有 verificationLevel 字段（级别服务端派生） |
| A-11 | Evidence 缺失 | **PASS** | 列表 `verifications=[]`（缺失≠伪造 0）；自报人自确认 → 400；对手方确认 → 200 | OutcomeVerification(level=COUNTERPARTY_CONFIRMED, note/evidence 留库) | — | DTO 只回 `{level, at}` —— note/evidence 不外发 |
| A-11b | 外部核验 | **PASS** | verify → 200 `EXTERNALLY_VERIFIED`，`verified=true` | — | — | 运营核验路径 |
| A-12 | 刷新恢复 | **PASS** | 重新 GET run / outcomes | 与 DB 一致（EXECUTED / verified=true） | — | 服务端为唯一事实来源 |
| O-01 | 重复提交 Mission | **PASS** | 同幂等键 POST ×2 → 第二次重放同 id | Mission 仍 1 行 | — | 幂等键在 header，不在 body |

## 2. BLOCKED_ENV 的精确边界（不伪造声明）

**A-03b（批准全链路 AWAITING_APPROVAL → APPROVED → EXECUTED → 对外送达）**：

- `AWAITING_APPROVAL` 的唯一写入点是 `src/lib/agent/runtime.ts:352`（**真实模型成功**且 `requiresApproval=true`）；
- 本地（及本探针环境）无 `OPENAI_API_KEY` / WorkBuddy 云端凭据；INTRO_DRAFT 无规则式降级路径 → 落 `FAILED`（终态，无出边）；
- 因此「批准 → 撤销后执行被拒（DISCLOSURE_EMPTY）」的**执行侧**断言无法在 API 层真实走通 —— 按执行令标记 **BLOCKED_ENV**，不用 mock Provider 成功补齐；
- **已被实跑覆盖的部分**：
  - 真相表（含 `AWAITING_APPROVAL→APPROVED`、`AWAITING_APPROVAL→EXECUTED` 边不存在）：`tests/agents/approval-consistency.test.ts`（含变异自证）；
  - 执行侧撤销/收窄/删除闸门（409 DISCLOSURE_EMPTY / DISCLOSURE_NARROWED / 保守不送）：`tests/agents/outbound-delivery.test.ts` §348/363/379/394；
  - 投递失败 → 状态不变、可重试：`tests/agents/execution-gated.test.ts` §320。
- **解除条件**：接入真实 LLM Provider（生产已具备 WorkBuddy 云端算力路径）后在预发/生产复跑本探针。

## 3. 真实闭环正例（本轮最关键的产品证据）

A-09 给出了一条**完整的真实执行链**（无 Provider 参与、无 mock）：

```
INTENT_EXTRACTION 运行（DEGRADED，规则式，诚实标注）
  → POST /agents/runs/{id}/execute
  → NotificationDelivery(dedupeKey=agent-exec:<runId>, status=SENT, channel=IN_APP)
  → AgentRun.status=EXECUTED（唯一写入点 executor.ts）
  → AgentExecution 行 + TenantAuditEvent(agent.run.executed)
  → Notification 行（发起人收件箱）
  → 重复 execute → replayed=true，零新增投递
```

## 4. 过程中发现并澄清的行为（非缺陷，但需产品知悉）

1. **一人一任务只有一份意图**（`intents.ts` ④：已存在 → 409，不静默覆盖）。探针因此将四条 INTRO_DRAFT 挂同一意图，断言按「撤销最后」排序。
2. **FAILED 是终态**：拒绝/批准/执行对 FAILED 运行一律 409。「重新发起」是唯一恢复路径（A-09 验证）。
3. **IN_APP 通知不带 organizationId**（`delivery.ts:194`）——审计按 userId + 时间窗取证；如需按租户统计通知，需后续补列。
4. **Outcome 上报前置**：提案必须 `introducedAt != null` 且双方为当事人；本探针以夹具种子落库提案（提案生命周期属 T05 验收域），已如实标注。

## 5. 探针工程纪律（防假绿）

- **自清理**：开跑先按上次 state 文件清理残留（崩溃安全）；幂等键带运行级唯一后缀（`TAG`），跨次重跑绝不重放旧运行；
- **三面取证**：每条断言同时核对 HTTP / DB / 审计（空集恒真防护：审计计数显式 ≥1）；
- **清理模式**：`--cleanup --db=<file>` 精确删除夹具（含按固定 id/标题兜底），拒绝远程库；
- 退出码：0=全过 / 1=有 FAIL / 2=环境前置失败。

## 6. 复跑方式

```bash
# 需本地生产构建服务跑在 :3000（DATABASE_URL=file:/tmp/v196-e2e.db）
node scripts/qa/v198-agent-consent-outcome.mjs --db=file:/tmp/v196-e2e.db
node scripts/qa/v198-agent-consent-outcome.mjs --cleanup --db=file:/tmp/v196-e2e.db

# 引用的集成单测
node node_modules/jest/bin/jest.js tests/agents/approval-consistency.test.ts tests/agents/outbound-delivery.test.ts
```
