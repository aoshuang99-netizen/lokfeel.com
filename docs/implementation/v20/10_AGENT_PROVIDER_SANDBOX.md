# V20.0 · Batch 3 · 10 — Agent Provider 沙箱（S1）

> 对应作战令 Batch 3 / 第四节「S1 / S2 / S3 三级验收」。
> 本文只覆盖 **S1 沙箱**（声明式 stub + 隔离库 + 假投递出口）。S2 / S3 见 `11_REAL_PROVIDER_INTEGRATION.md`。

## 0. 结论（先给答案）

**S1 沙箱已实现并闭合并通过内核级单测。**

- `src/lib/agent/provider.ts` —— 新增纯函数 `resolveProviderMode(env)`（用户第六节安全边界的字面落地）。
- `src/lib/agents/provider-runtime.ts` —— `resolveRuntimeProvider()`（生产路径唯一入口）第一行调用该守卫；仅在「非生产 + `AGENT_TEST_ISOLATION=true`」时装配 `createStubProvider`。
- 守卫在**生产或未经隔离**环境请求 stub 时**硬抛错**，因此假模型**永远无法**在生产冒充真实调用成功（关闭 R-04）。
- stub 产出 `SANDBOX_WORKSPACE_SPEC`：一份**通过 INTENT_EXTRACTION 输出契约**（`WorkspaceSpecSchema`）的最小合法 Spec，带 `SANDBOX_PROBE` 标记，任何下游都能一眼看出「这不是真实模型产出」。

## 1. 验收证据（本环境已跑）

```
npx jest tests/agents/provider-mode.test.ts tests/agent tests/agents/approval-consistency.test.ts tests/agents/execution-gated.test.ts tests/agents/outbound-delivery.test.ts tests/agents/adversarial-injection.test.ts tests/agents/runs-service.test.ts
→ Test Suites: 17 passed / 17 total
→ Tests:       320 passed / 320 total
```

`provider-mode.test.ts` 钉死的关键判据：

| # | 判据 | 期望 | 结果 |
| --- | --- | --- | --- |
| ① | 生产 + `AGENT_PROVIDER=stub`（即使带真实 key）→ 抛错 | throw /stub/ | ✅ |
| ② | 非生产但**未**声明 `AGENT_TEST_ISOLATION` → 抛错 | throw /AGENT_TEST_ISOLATION/ | ✅ |
| ③ | 非生产 + 隔离 → 返回 `stub` | `'stub'` | ✅ |
| ④ | 生产无凭据 → `unavailable`，**不**抛错 | `'unavailable'` | ✅ |
| ⑤ | 未请求 stub 时，隔离标记不改变真实判定 | `'unavailable'` | ✅ |
| ⑥ | 隔离内 `resolveRuntimeProvider` 返回 `ready` + `provider.kind='stub'`，载荷过 `WorkspaceSpecSchema` | ok | ✅ |
| ⑦ | 生产请求 stub：装配侧同样抛错 | throw | ✅ |
| ⑧ | 无凭据 + 无 stub → `unavailable` 不抛错 | `'unavailable'` | ✅ |

## 2. 注入 → 待批 → 批准 全链路（A-03b 闭环，内核级）

`tests/agent/runtime.test.ts` 已逐条证明：

- **注入信号升级**：`INTENT_EXTRACTION`（本不需批准）在目标含注入短语时 → `AWAITING_APPROVAL`，`requiresApproval=true`，`injectionSignals.length>0`，且 `canExecute(...)` 为 `false`（边不存在，结构性不可绕过）。
- **正向对照**：`INTRO_DRAFT`（高风险、需批准）+ stub 合法产出 → `AWAITING_APPROVAL`，`payload` 非空。
- **载荷不越界**：模型夹带的未知字段 / 未授权 `usedFieldKeys` 一律被 `strictObject` 拒绝，`payload` 永不含未校验文本。

`tests/agents/approval-consistency.test.ts` 证明：`decideAgentRun(ctx, run.id, 'APPROVED')` 将状态置 `APPROVED` 且**有且仅有一条** `APPROVED` 裁决行（变异自证：删裁决 / 改 decision 必被断言抓住）。

## 3. S1 的诚实边界（必须遵守）

1. **DB `providerKind` 如实留 `stub`** —— 不冒充 `openai` / `workbuddy`。
2. **生产路径永远装配不出 stub** —— 守卫在生产抛错，调用方据此拒绝加载。
3. **不写生产数据库 / 不真实外部投递** —— S1 仅用于隔离库与假投递出口；真实投递隔离由 `execution-gated.test.ts` / `outbound-delivery.test.ts` 守着。
4. **S1 通过 ≠ S2 通过 ≠ S3 通过** —— 见 `11` / `13`。发布前必须在 UI 区分「沙箱结果」与「真实结果」。

## 4. 如何在本环境复现 S1 集成（端到端 HTTP + DB）

```
# 1) 起隔离 dev 服务（注意 dev 脚本端口为 3099，不是 3000）
AGENT_PROVIDER=stub AGENT_TEST_ISOLATION=true \
  DATABASE_URL="file:./locust-dev.db" \
  npx next dev --turbopack -p 3099

# 2) 跑 v198 探针（A-03b 在 SANDBOX 下实跑全链路）
node scripts/qa/v198-agent-consent-outcome.mjs \
  --base=http://localhost:3099 \
  --db=file:./locust-dev.db
# 预期：A-03b 行由 BLOCKED_ENV → PASS，整组 17/17（此前 16 PASS / 1 BLOCKED）
```

> ⚠️ 本回合并未在沙箱内启动 `next dev` 跑通该 HTTP 集成（需本地 libsql 库 + 服务进程；受环境约束未执行）。**S1 的内核级证据已绿（320/320）**，HTTP 集成命令已固化，可在隔离 CI 或本机复现。这一项在发布前必须由真实运行补齐，不替代、不伪造。
