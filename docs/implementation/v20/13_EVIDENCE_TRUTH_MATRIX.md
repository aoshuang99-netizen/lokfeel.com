# V20.0 · Batch 3 · 13 — Evidence 真相矩阵

> 作战令要求：「界面上每一个『执行成功』『已批准』『已验证』，都必须有服务端状态和证据映射。」
> 本文逐条把**前端可见断言**钉到**唯一服务端事实来源**，确保「无证据 = 不渲染成功」。

## 0. 真相来源总览

| 前端可见状态 | 服务端唯一事实 | 表 / 字段 | 能否客户端篡改 |
| --- | --- | --- | --- |
| AgentRun 状态（待批/已批/已执行/失败…） | `AgentRun.status` 列 + `AgentApproval` 事件表 | `AgentRun.status` / `AgentApproval.decision` | ❌ 否（状态机纯函数 + 裁决只增） |
| 「需要我批准」按钮可见性 | `canApprove` / `canReject` DTO | 由 `approval-consistency.test.ts` 逐格证明 ≡ `decideAgentRun` 实际行为 | ❌ 否 |
| providerKind（沙箱/真实/降级） | `AgentRun.providerKind` 列 | `stub`/`rules`/`workbuddy`/`openai` | ❌ 否（写入时由内核决定） |
| Outcome「已验证」 | `Outcome.verificationLevel` + `verified` 派生 | `OutcomeVerification.level` | ❌ 否（派生，非输入） |
| Evidence 是否齐全 | `OutcomeVerification` 行集合 | 缺失 ⇒ 数组为空，前端如实显示「无证据」 | ❌ 否 |
| 跨租户是否泄漏 | 租户作用域查询 | `organizationId` 强制过滤 | ❌ 否 |
| 调用是否真实发生 | `AgentCall` 行（含 `ok`/`usage`） | 失败也记账，`failedCalls` 可见 | ❌ 否 |

## 1. 关键不变量（已有测试守着）

1. **状态机边不存在**（`approval.ts` 真相表）：`AWAITING_APPROVAL → EXECUTED` 边不存在 ⇒ 注入 / 模型文本无法绕过一次真实 `approve`。（`adversarial-injection.test.ts`）
2. **降级不降低门槛**：`DEGRADED` 仍须走批准；`PROPOSED → APPROVED` 边不存在。（`runtime.test.ts` / `approval.test.ts`）
3. **裁决与状态一致**：终态（APPROVED/REJECTED）有且仅有一条裁决行，且 `decision ≡ status`。（`approval-consistency.test.ts`，含变异自证）
4. **未校验文本永不渲染**：`runtime.ts` 仅将 `payload`（zod 校验后）交渲染层；`rawText` 仅审计。（`runtime.test.ts` ④）
5. **执行双门**：`planExecution`（状态机 + 真实裁决行）+ `planOutboundDelivery`（披露授权/撤销/收窄）。（`execution-gated.test.ts` / `outbound-delivery.test.ts`）
6. **幂等**：执行 `dedupeKey = agent-exec:<runId>` ⇒ 重放仅一次投递。（`runs-service.test.ts`）

## 2. UI 必须如实呈现的「负向」形态

| 情形 | UI 形态 | 错误形态（禁止） |
| --- | --- | --- |
| 无 Provider 凭据 | 「模型不可用 / 已降级为规则式」+ `realCallsEnabled=false` | 显示「调用成功」「AI 已生成」 |
| Outcome 仅自报 | `SELF_REPORTED` 标签 + 「待验证」 | 显示「已验证 ✓」 |
| 撤销/过期授权 | 创建侧禁用手柄 + 提示「授权已失效」 | 仍允许发起对外送达 |
| 跨租户访问 | `404` | 200 + 空列表（泄露存在性） |
| 执行失败 | 可恢复的 `409` 错误态 + 重试入口 | 500 / 静默假成功 |

## 3. 发布前红线

- **任何「已验证 / 已批准 / 执行成功」的 UI 文案，必须能在上述表中找到服务端字段映射；找不到的一律视为缺陷（P0）。**
- S1 沙箱结果必须在 UI 与 API 响应中明确标 `providerKind=stub`，**不得**与真实结果混排。
- S2/S3 未通过前，涉及真实 Provider 的能力在产品中须诚实标注「不可用 / 沙箱」，不得用 `AI_READY=true` 之类总开关冒充。
