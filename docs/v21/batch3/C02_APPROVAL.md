# V21 第三批 · C02 审批权隔离（R1 职责分离）

**裁决：本地 HTTP 层已复验通过（6/6）。** 不是「代码里写了 if」，是拿真实会话打真实端点、并把原始响应与库内副作用一起落盘。

| 项 | 值 |
|---|---|
| 服务端规则 | 发起人不得批准自己发起的运行；批准超 24h 失效；执行侧复检两者的**历史**与**时效** |
| 策略版本 | `v21.3-separation-of-duties`（写入审计 `safeMetadata.policyVersion`） |
| 单测 | `npx jest tests/agents --runInBand` → **14 suites / 254 tests / exit 0** |
| 真实 HTTP | `env -u NODE_OPTIONS node scripts/qa/v21-batch3-r1-http.mjs` → **6 PASS / 0 FAIL / 0 BLOCKED / exit 0** |
| 证据 | `docs/v21/batch3/evidence/c02-r1-http-20261115104137.json`（21 KB，含逐请求原始响应 + 库内计数读数） |

## 1. 六个用例实测结果

| 用例 | 场景 | 期望 | 实测 |
|---|---|---|---|
| R1-1 | OWNER 发起 → **OWNER 自己批准** | 403 `SELF_APPROVAL_FORBIDDEN` 且零副作用 | 403；状态仍 `AWAITING_APPROVAL`；裁决行 **0**；`agent.run.approved` 审计 **0** |
| R1-2 | 同一运行 → **ADMIN2 批准** → ADMIN2 执行 | 批准 200、首次执行 201、二次 200 `replayed:true` | 全中；执行记录只有 **1** 条（重复执行不产生第二次投递） |
| R1-3 | 库里已有**旧策略自批**（`actorId = 发起人`）+ `APPROVED` | 执行 403，零投递 | 403 `SELF_APPROVAL_FORBIDDEN`；执行记录 **0**；状态仍 `APPROVED` |
| R1-4 | 批准由另一主体做出，但 `decidedAt` = 25h 前 | 执行 409 `APPROVAL_EXPIRED`，零投递 | 409；执行记录 **0** |
| R1-5 | 另一租户的运行 → 本租户 ADMIN 批准 | 404（不泄露存在性） | 404；该运行裁决行 **0** |
| R1-6 | MEMBER 会话批准他人发起的运行 | 403（缺 `agent.approve`） | 403；裁决行 **0** |

## 2. 为什么这 6 条能证明「不是只靠角色名」

- **两个真实会话**：`owner` 来自 `.qa-authed-e2e.local.json`，`admin2` / `member` 由脚本按 `seed-authed-e2e-user.mjs` 的 schema 造在**同一租户**里（否则 403 可能来自「不同租户」而不是「职责分离」，判据会被污染）。
- **两个真实端点**：`POST /api/v1/agents/runs/{id}/approve` 与 `/execute`，走 `withTenant()` → 能力判定 → 服务层复判的完整链路。
- **副作用单独取证**：每条用例都回查 `AgentRun.status`、`AgentApproval` 计数、`AgentExecution` 计数、`TenantAuditEvent` 计数 —— 「返回 403 但库里已经写了一半」这种假绿被单独排除。
- **正向控制**：R1-2 证明规则不是「一律拒绝」（否则前 5 条也会过）。

## 3. 诚实边界（必须一起读）

1. **run 行是预置的**：`POST /runs` 会发起**真实模型调用**，本地没有 `WORKBUDDY_LLM_*` 凭据，所以脚本直接往本地隔离库 `ci-e2e.db` 写 `AgentRun` 行。被测对象是 **`approve` / `execute` 的授权判定**，不是创建路径。这一点写在脚本头与证据 JSON 的 `honesty` 字段里。
2. **只代表本地隔离环境**（`http://127.0.0.1:3214` + `ci-e2e.db`）；不是生产、不是远端 CI。
3. **执行副作用只是站内回执**（`kind=RECEIPT` / `channel=IN_APP`）：证明「批准→执行」链路可达，**不**证明任何外部服务收到或完成了动作（C03 仍 BLOCKED）。
4. **未覆盖**：并发两次批准（靠 `AgentApproval.runId` 唯一键 → 409，只在单测里覆盖）、批准后撤销（产品暂无「撤销批准」动作）、以及跨进程时钟漂移。这些不写在「已通过」里。

## 4. 复现

```bash
# 前置：本地生产构建已在 3214 端口运行（隔离库 ci-e2e.db）
bash /tmp/nr.sh 'env -u NODE_OPTIONS node scripts/qa/v21-batch3-r1-http.mjs'
# 退出码：0=无 FAIL；1=至少一条 FAIL；2=环境级阻断（如 OWNER 登录失败）
```

> 结论口径：**本地实测**。G12/R1 的门禁结论仍需外部审查主体复跑（C06）。
