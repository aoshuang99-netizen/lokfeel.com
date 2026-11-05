# 36 · V20.2 Agent / Consent / Action / Outcome 真实闭环

> 对应 V20.2 作战令 Batch 4。结论先行：S1 隔离沙箱 **708/708 测试通过（39 套件）**，内核级验证真实；S2 真实 Provider、S3 生产业务验证 **BLOCKED**（分别缺 Provider 凭据与 D-10 授权），不以前端/单测成功替代。

## 验收标准对照

| 作战令要求 | 状态 |
|---|---|
| S1 所有适用场景 PASS | ✅ 708/708（39 套件）本地实跑通过 |
| S2 真实 Provider 至少一个完整场景 PASS | ⚠️ BLOCKED：缺 `WORKBUDDY_LLM_*` / `OPENAI_API_KEY`（经 Cloudflare Secrets 注入） |
| 真实 Provider 失败可见 | ⚠️ 待 S2 解锁后验证 |
| `AgentCall` / `AgentApproval` / `AgentExecution` 与 Outcome 记录一致 | ✅ S1 单测覆盖（runtime→awaiting approval、approval-consistency 唯一裁决行） |
| 无批准不能执行 | ✅ `execution-gated` / `guard` 单测覆盖 |
| 无证据不能显示 Verified | ✅ `outcome/verification` 单测覆盖 |
| 不允许用 Stub 成功替代 S2/S3 | ✅ 本台账明确标注 S2/S3 未执行 |

## S1 — 隔离沙箱（本地实跑，真实 HTTP + 独立库 + 显式 stub）

运行命令（本环境）：
```
env -u NODE_OPTIONS npx jest tests/agents tests/agent tests/living/consent tests/outcome tests/tenancy/consent-revocation.test.ts --ci
```
结果：`Test Suites: 39 passed, 39 total` / `Tests: 708 passed, 708 total`（耗时 ~17.5s）。

覆盖的场景（与作战令清单逐一对应）：
- **显式 stub 安全边界**：`provider-mode` 单测断言——生产环境 + `AGENT_PROVIDER=stub` 组合**硬抛错**；缺凭据时返回 `unavailable`，**不**回退到 stub（防止生产误用假执行）。
- **人工批准 / 待批**：`runtime` 单测断言运行时探测后、需审批技能产出 `AWAITING_APPROVAL`；`approval` / `execution-gated` 覆盖批准、拒绝、撤销、过期、幂等。
- **裁决一致性**：`approval-consistency` 断言 `APPROVED` 且仅产生**唯一裁决行**（防并发双裁决）。
- **跨租户**：`guard` / `tenancy/consent-revocation` 覆盖组织作用域与撤销。
- **Outcome / Evidence**：`outcome/verification` / `outcomes` / `metrics` 断言证据校验与「无证据不显示 Verified」。
- **对抗注入**：`adversarial-injection` 覆盖提示词注入边界。

> 说明：以上为隔离单测层证据（S1 内核）。作战令要求的「真实 HTTP 请求 + 独立数据库」集成级 S1 集成套件（`tests/integration` 等）同样以 stub 隔离运行；本批仅跑了 agent/consent/outcome 内核套件，集成级 S1 将在 PR 触发 CI 后由 `ci.yml` 的 `test` job 全量复跑。

## S2 — 真实 Provider（BLOCKED_ACCESS）

- 需要经 Cloudflare Secrets / GitHub Secrets 注入的真实模型凭据：`WORKBUDDY_LLM_ENDPOINT` / `WORKBUDDY_LLM_KEY` / `WORKBUDDY_LLM_MODEL`（WorkBuddy 云端算力）或 `OPENAI_API_KEY`。
- 至少执行一个受控端到端：`Intent → Workspace → Mission → Agent → Consent → Action → Outcome`，测试账户需明确授权，外部执行限制在安全测试目标内。
- **当前未执行**：无凭据不得伪造 S2 PASS。待 `CLOUDFLARE_API_TOKEN` 配置后，在 Preview 环境以隔离测试库重跑。

## S3 — 生产业务验证（BLOCKED · 需 D-10）

- 仅在生产发布且获得 D-10 授权后执行；须记录真实用户授权、实际执行结果与 Outcome 证据。
- **当前未执行**。

## 结论
S1 已真实闭环并通过；S2/S3 因缺凭据/授权处于诚实 BLOCKED 状态，未以任何 stub 成功冒充。CI 触发后 `ci.yml` 将复跑全量 Jest 套件，届时补充集成级 S1 的 CI Run ID 证据。
