# V20.0 · Batch 3 · 11 — 真实 Provider 集成（S2）与生产证据（S3）

> 对应作战令「S2 真实集成 / S3 生产证据」。本文件记录**当前阻塞态**与**解锁条件**——不伪造、不自动降级成 stub 成功。

## 0. 三级验收对照（用户第四节）

| 层级 | 执行模式 | 可宣称的结果 | 当前状态 |
| --- | --- | --- | --- |
| S1 沙箱 | 显式 stub + 隔离库 + 假投递 | 状态机与授权链已测试 | ✅ 已闭合并通过内核单测（见 `10`） |
| S2 真实集成 | 实际 Provider + 受控测试账户 | 模型调用与执行链已验证 | ⛔ **BLOCKED** — 无 Provider 凭据 |
| S3 生产证据 | 真实用户授权 + 合法动作 + 真实 Outcome | 特定生产业务场景完成并验证 | ⛔ **BLOCKED** — 需真实用户授权 |

## 1. S2 解锁条件（代码已就绪，只差凭据）

`resolveRuntimeProvider()` 的判定顺序（生产路径唯一入口）：

1. `resolveProviderMode(env)` —— 若显式 `stub` 且非生产+隔离 → `stub`；否则继续。
2. `resolveWorkBuddyConfig(env)` —— 需要 `WORKBUDDY_LLM_ENDPOINT` + `WORKBUDDY_LLM_KEY`（应用级 `wbpk_*`）。
3. `resolveProviderConfig(env)` —— 需要 `OPENAI_API_KEY`。
4. 两者皆缺 → `unavailable`（编排层走**明示规则式降级**，绝不回退 stub）。

**即：只要注入任一真实凭据，S2 即自动激活，无需改代码。** 但本环境无 `wbpk_*` / `sk-*` / `OPENAI_API_KEY`，故 S2 维持 `unavailable`。

### S2 必须达成的验收（上线前在隔离测试账户实跑）
- [ ] `AGENT_PROVIDER` 不设置、注入 `WORKBUDDY_LLM_*` → `providerHonesty().realCallsEnabled === true`，`provider === 'workbuddy'`。
- [ ] 真实模型输出通过 `skill.outputSchema` zod 校验；非法输出走 `DEGRADED` / `FAILED`，不进 `payload`。
- [ ] 高风险技能（INTRO_DRAFT）真实产出 → `AWAITING_APPROVAL` → 人工 `APPROVED` → `EXECUTED` + 投递 + 审计。
- [ ] 真实调用**失败**时落 `AgentCall`（`ok=false`）并走降级，失败调用计入账本（`failedCalls`）。
- [ ] 调用真实外部端点**仅限服务端**；前端不持有任何 Provider key；凭据不进前端产物。

## 2. S3 解锁条件（需真实用户 + 合法场景）

S3 不靠自动化测试覆盖，而是**生产观测证据**（见 `v20/00` 计划 P0-2）：

- [ ] 真实用户提交目标 → Agent 在授权范围内完成实际动作（非沙箱、非规则式兜底）。
- [ ] 产出 `Outcome.verificationLevel` 由服务端派生（`EXTERNALLY_VERIFIED` / `COUNTERPARTY_CONFIRMED` / `SELF_REPORTED`），且前端「已验证」严格绑定该字段，**不**渲染 `rawText` 或自报成功。
- [ ] 审计日志可回溯到具体运行、裁决、执行、投递四面证据。

## 3. 诚实红线（全层级适用）

- **无凭据时明确 `unavailable` / `BLOCKED`，禁止自动降级成 stub 成功。**（`resolveProviderMode` 已硬保证：stub 仅显式隔离环境；否则抛错或 unavailable。）
- **`providerKind` 如实记录**：`rules`（降级）/ `stub`（沙箱）/ `workbuddy` / `openai`（真实）。UI 必须区分展示。
- **前端不信任未经验证的模型输出**：`runtime.ts` 只把 `payload`（已 zod 校验）交渲染层，`rawText` 仅审计。
- **不跨租户访问 Evidence**：`outbound-delivery.test.ts` 与 `tenant-isolation.test.ts` 守着。

## 4. 决策依赖（人工）

- D-09 凭据风险清单（历史形似凭据轮换）—— 见 P2 任务，不阻塞 S2 代码路径。
- 真实 Provider 选择（WorkBuddy 云端算力 vs OpenAI 自带 key）—— 产品决策，代码两条路均已支持。
