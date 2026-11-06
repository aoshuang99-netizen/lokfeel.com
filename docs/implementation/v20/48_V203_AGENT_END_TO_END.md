# V20.3 · 48 — Agent 业务端到端（S1 PASS / S2·S3 BLOCKED）

> 作战令 §7：「沙箱和真实 Provider 分开验收」「生产禁止 Stub Provider」「不允许把模型输出等同于已执行动作」
> 「不允许把 Action 成功等同于 Outcome Verified」「真实 Provider 至少一条经授权的端到端闭环通过」。
> 继承 `v20/36_V202_AGENT_REAL_E2E.md`、`35_V202_BACKEND_RUNTIME_ACCEPTANCE.md`、`13_EVIDENCE_TRUTH_MATRIX.md`。

## 1. 分层结论（不伪绿）

| 层 | 验收内容 | 判定 | 证据 |
|---|---|---|---|
| S1 隔离沙箱 | 真实 HTTP + 独立库 + 显式 stub | **PASS 708/708（39 套件）** | `v20/36` §S1，本地实跑 ~17.5s |
| S2 真实 Provider | 至少一条经授权端到端闭环 | **BLOCKED** | 缺 `WORKBUDDY_LLM_*` / `OPENAI_API_KEY`（CF Secrets） |
| S3 生产业务验证 | 真实用户授权 + 真实 Outcome | **BLOCKED** | 缺 D-10 授权与真实用户授权 |
| 运行时验收（DB/Auth/Cache/OAuth） | 真实调用 | **BLOCKED** | `v20/35`：缺 Turso/Upstash/NEXTAUTH/OAuth 凭据 |

## 2. S1 已覆盖场景（`v20/36`，逐条对应作战令清单）

- 显式 stub 安全边界：生产 + `AGENT_PROVIDER=stub` **硬抛错**；缺凭据返回 `unavailable`，不回退 stub。
- 人工批准 / 待批：`runtime` 产出 `AWAITING_APPROVAL`；`approval` / `execution-gated` 覆盖批准、拒绝、撤销、过期、幂等。
- 裁决一致性：`APPROVED` 有且仅有一条裁决行且 `decision ≡ status`（含变异自证）。
- 无批准不能执行：`AWAITING_APPROVAL → EXECUTED` 边不存在（对抗注入测试）。
- 降级不降低门槛：`DEGRADED` 仍须批准；`PROPOSED → APPROVED` 无边。
- 无证据不能显示 Verified：`outcome/verification` 单测，`SELF_REPORTED` 不算验证。
- 未校验文本永不渲染：`runtime.ts` 只交 zod 校验后 payload，`rawText` 仅审计。
- 执行双门：`planExecution`（状态机 + 真实裁决行）+ `planOutboundDelivery`（披露授权/撤销/收窄）。
- 幂等：`dedupeKey = agent-exec:<runId>`，重放仅一次投递。
- 跨租户隔离：`organizationId` 强制过滤。

## 3. 十条闭环要求逐项判定（作战令 §7）

| # | 要求 | 判定 | 证据 |
|---|---|---|---|
| 1 | HTTP 真实调用 | PASS (S1) | 独立库 + 真实 HTTP |
| 2 | Provider 实际状态 | **BLOCKED (S2)** | `AgentProviderKind` 枚举真实，但真实 Provider 未跑 |
| 3 | Consent 审批 | PASS (S1) | `approval-consistency` |
| 4 | Action 执行 | PASS (S1) | `executor.ts` + `AgentExecution` |
| 5 | Outcome 回写 | PASS (S1) | `outcomes.ts` |
| 6 | Evidence 追溯 | PASS (S1) | `OutcomeVerification` 行集合 |
| 7 | 幂等 | PASS (S1) | `runs-service.test.ts` |
| 8 | 跨租户隔离 | PASS (S1) | `tests/tenancy/*` |
| 9 | 失败恢复 | PASS (S1，状态分支) | `FAILED`/`DEGRADED`/`BLOCKED_QUOTA` 分支 |
| 10 | 刷新恢复 | **部分**：业务态来自端点重取；本轮新增导航态 `?view=` 恢复 | `43` §5；Playwright Trace **NOT_TESTED** |

## 4. 不变量：三条红线（未被本轮改动触碰）

1. 模型输出 ≠ 已执行动作 —— `AgentCall` 记账，状态机边把守。
2. Action 成功 ≠ Outcome Verified —— `verificationLevel` 派生，`verify` 仅 ADMIN+。
3. 生产禁止 Stub —— `provider-mode` 单测硬保证。

## 5. 本轮改动影响

`G-03` 深链接**零 API、零 Schema、零业务状态变更**，不进入 Agent 主链，不影响 S1 结果。
本轮**未重跑** S1 全套（仅跑新增的 `workspace-view.test.ts` 14/14）；S1 708/708 为 `v20/36` 历史实跑证据，
未在本轮复验，故本文件对 S1 标「PASS（继承证据）」而非「本轮 PASS」。

## 6. 解锁 S2 / S3 的条件

- S2：在 Cloudflare Secrets 注入 `WORKBUDDY_LLM_ENDPOINT` / `KEY` / `MODEL`（或 `OPENAI_API_KEY`），
  跑 `verify:agent:connectivity:server`，再跑一条经授权的 runtime→awaiting approval→approve→execute→outcome 闭环。
- S3：D-10 授权 + 真实用户授权 + 真实 Outcome 记录与 Evidence。
- 二者均需 `35` 所列 DB / Auth / Cache 凭据同时可用。

## 7. 复跑

```bash
env -u NODE_OPTIONS npx jest tests/agents tests/agent tests/living/consent tests/outcome tests/tenancy/consent-revocation.test.ts --ci
```
