# 56 · V20.4 Agent Real E2E（Batch 4 真实业务闭环）

> 目标链路：`Intent → WorkspaceSpec → Workspace → Mission → Agent → Consent → Action → Verified Outcome`
> 判定口径：S1 沙箱 / S2 真实 Provider / S3 生产业务验证 **必须分别举证**，不能用 S1 的成绩单冒充 S2。

---

## 0. 本轮在链路中的实际位置

```
Intent ──▶ WorkspaceSpec ──▶ Workspace ──▶ Mission ──▶ Agent ──▶ Consent ──▶ Action ──▶ Verified Outcome
  ×            ×               ○(UI已验)      ●(S1)      ●(S2)      ○(界面已验)   ×           ×
```

- ○ = 界面/契约层已验证（`54` 的 13 屏 + G-03）
- ● = 本文件举证
- × = **本轮未验证**

**必须明确**：S2 只证明「Agent 运行真实调到了云端模型并产出过契约的输出」，**没有**证明「审批 → 授权执行 → Outcome 回写 → 独立验证」这条尾巴。后者仍缺证据。

---

## 1. S1 · 沙箱集成

### 1.1 内核不变量（`npm run check:agent-invariants`）

扫描 9 个文件（`approval.ts` / `cost.ts` / `execution.ts` / `guard.ts` / `index.ts` / `provider.ts` / `runtime.ts` / `skills.ts` / `types.ts`）：

```
✅ Agent 不变量全部通过
   A1 内核不碰授权 · A2 内核无 IO · A3 模型输出不当代码
   A4 无定时器伪成功 · A5 内核无网络调用
```

这五条正是「内核纯净」的判据：模型输出不被当代码执行（A3）、没有定时器伪造成功（A4）、内核自身不直接发网络请求（A5）。

### 1.2 HTTP + DB + 审计（真实 Turso，非 mock）

| 步骤 | 命令 | 结果 |
|---|---|---|
| 创建 Mission | `POST /api/v1/missions`（带 `Idempotency-Key`） | **201**，返回真实 `id` + `organizationId=org_default` + `shareToken` |
| 读回 | `GET /api/v1/missions?pageSize=50` | **200**，`items=2`，全部 `org_default` |
| 归属强制 | 请求体塞 `organizationId: 757eee19-…`（别人的组织） | **被忽略**，落库仍为 `org_default` |
| 清理 | `DELETE FROM Mission WHERE id IN (…)` | 2/2 已删，无残留 |

幂等键是**必需**的（缺失 → 400，不静默退化为非幂等）。这是沙箱层的正确取舍。

### 1.3 生产无法启用 Stub

`provider=none` 时的行为（本地实测）：

```json
{"status":"FAILED","degradeCode":"NO_DEGRADE_PATH",
 "reason":"未配置 WORKBUDDY_LLM_ENDPOINT —— 无法定位云端算力端点；
           未配置 OPENAI_API_KEY —— 不会用任何\"假模型\"冒充真实调用"}
```

**这是正确的**：没有凭据时明确失败，而不是回落到规则式假回复。生产环境 `provider=workbuddy`，不存在 stub 路径。

### S1 判定：**PASS**

---

## 2. S2 · 真实 Provider（生产环境实测）

工具：`scripts/qa/verify-llm-live.mjs`（脚本自带 9 条断言，走完整链路：登录 → 读诚实块 → 发起真实 run → 核对 token 归因）。

### 2.1 生产 `https://app.lokfeel.com` —— 9 PASS / 0 FAIL

```
[1/4] 登录 https://app.lokfeel.com（qa.male@lokfeel.com）
PASS  登录成功  — status=200 cookies=yes

[2/4] 读诚实块 GET /api/v1/agents/usage
PASS  用量接口 200  — status=200
PASS  诚实块存在  — {"provider":"workbuddy","realCallsEnabled":true,
                    "reason":"已接入 WorkBuddy 云端算力：模型=deepseek-v4.1-flash（免密钥，凭据不下发）。"}
PASS  provider=workbuddy（云端算力）  — provider=workbuddy
PASS  realCallsEnabled=true  — true

[3/4] 发起一次真实运行 POST /api/v1/agents/runs
PASS  运行已创建（200/201）  — status=201
PASS  状态为 PROPOSED（模型产出过契约，不是降级）  — status=PROPOSED degradeCode=- reason=-

[4/4] 核对 token 归因
PASS  输入 token > 0  — 461
PASS  输出 token > 0  — 270

✅ 生产已真实调用云端模型（非规则式兜底）
```

**这 9 条为什么足以证明「真调用」**：

| 断言 | 它排除的伪证 |
|---|---|
| `provider=workbuddy`（非 `none`/`stub`） | 排除了「规则式兜底」与「本地假模型」 |
| `realCallsEnabled=true` | 排除「接口存在但实际不发请求」 |
| run `status=PROPOSED`（非 `DEGRADED`） | 排除「模型没调到、走了降级」 |
| input token **461** / output token **270** | 排除「账本少算/记 0」。token 是模型侧产出的真实计数，不是应用自己编的常量 |

### 2.2 本地（对照）—— 诚实降级，4 PASS / 5 FAIL

同一脚本打 `http://127.0.0.1:3099`：

```
PASS  登录成功
PASS  用量接口 200
PASS  诚实块存在  — provider=none, realCallsEnabled=false（附完整原因）
FAIL  provider=workbuddy  — provider=none
FAIL  realCallsEnabled=true  — false
PASS  运行已创建  — status=201
FAIL  状态为 PROPOSED  — status=FAILED degradeCode=NO_DEGRADE_PATH
FAIL  输入 token > 0  — 0
FAIL  输出 token > 0  — 0
```

**这组 FAIL 是本轮最有价值的对照**：同一份代码、同一个账号、同一条 API，只因为本地 `.env.local` 里没有 `WORKBUDDY_LLM_*`，就如实报 `none` + `NO_DEGRADE_PATH` + token 0。

如果本地也报 PASS，那才说明系统在**伪造**真实调用。

### 2.3 证据边界（不夸大）

| 已证 | 未证 |
|---|---|
| 模型被真实调用（真 token 计数） | 审批（`AgentApproval.decision`）流转 |
| 输出通过 zod 契约（`PROPOSED` 而非 `DEGRADED`） | 授权后的**执行**（Action） |
| 生产环境非 stub | Outcome 回写与 `verificationLevel` 独立验证 |
| — | 失败路径与幂等的完整矩阵 |

### S2 判定：**PASS（限于「真实 Provider 调用」这一段）**

---

## 3. S3 · 生产业务验证

**PASS（2026-11-07，生产 `ab8b342` 实测 25/25，0 FAIL / 0 SKIP）。**

> 2026-11-06 判定为 BLOCKED 的两个前提（无获批生产版本、D-10 未批）已在发布后消除；
> 当时「一旦执行会产生真实外部动作」的顾虑经代码核实**不成立**：
> `executor.ts` 头注释与 `EXECUTION_PLANS` 双重声明 `recipient: 'REQUESTER'`，
> 执行的效果是**站内回执给发起人**，不对外送达、不调第三方 API。

### 3.1 工具与两条链路

`scripts/qa/v204-s3-production-flow.mjs`（25 项断言，可复现）：

- **A 低风险执行链** `INTENT_EXTRACTION`（`requiresApproval=false`）
  → 真实 Provider 产出 `PROPOSED` → 执行 → 重放 → 落点 `EXECUTED`
- **B 高风险审批门** `INTRO_DRAFT`（`requiresApproval=true`, `risk=HIGH`）
  → 待批 → OPERATOR 批准被拒 → ADMIN 批准 → 执行被投递门拒绝

### 3.2 结果（逐项实测值）

| 组 | 断言 | 结果 |
|---|---|---|
| A1–A4 | 运行创建 201；`provider=workbuddy`；`status=PROPOSED`；`requiresApproval=false` | **PASS** |
| A5–A7 | 首执 201；重放 200 且 `replayed=true`；**不二次投递** | **PASS** |
| A8 | 落点 `EXECUTED` | **PASS** |
| A9–A10 | `AgentExecution` 恰 1 条（重放未造第二条）；`deliveryStatus=SENT` | **PASS** |
| A11–A12 | 发起人收到站内回执（Notification=1）；审计 `agent.run.executed`=1 | **PASS** |
| B2–B4 | 高风险运行创建 201；`requiresApproval=true`；状态 `AWAITING_APPROVAL` | **PASS** |
| B5 | **OPERATOR 批准 → 403**（`agent.approve` 的 ADMIN 门槛，AC-08 制度层证据） | **PASS** |
| B6–B7 | ADMIN 批准 200；状态 → `APPROVED` | **PASS** |
| B8–B9 | 无目标身份 → 执行 **409**（投递门 `NO_TARGET` 类）；状态仍 `APPROVED` | **PASS** |
| B10 | **零执行记录落库**（拒绝即无副作用） | **PASS** |
| B11 | 临时提权已回滚（`ADMIN → OPERATOR`） | **PASS** |

### 3.3 S3 暴露并修复的真缺陷（本次最大收获）

第一次跑 S3 时，B 段直接失败：生产 `INTRO_DRAFT` 运行 `status=FAILED`、
`degradeCode=OUTPUT_SCHEMA_INVALID`，
`reason=模型输出未通过契约校验：counterpartLabel expected string, received undefined`。

- **根因**：该技能的 `systemPrompt` 只写了「只使用 allowedFieldKeys」，**没给输出字段形状**。
  `INTENT_EXTRACTION` 早用 `INTENT_OUTPUT_SKELETON` 规避了同类问题，`INTRO_DRAFT` 漏了。
  该技能**没有降级路径** ⇒ 每次运行都失败 ⇒ `requiresApproval=true` 的审批门
  **在生产永远走不到**（`AWAITING_APPROVAL` 从未出现过）。
- **修复**：`skills.ts` 补 `INTRO_OUTPUT_SKELETON` 并写进提示词；`ab8b342` 已上线（deploy `6aeeac10`）。
- **附带修复**：`runtime.ts` 的 `degrade()` 原先把 `providerKind` 无条件写成 `'rules'`，
  真实调用过模型但输出不合契约时也这么写 —— 等于在账本/审计里声称「根本没调模型」，
  令「高成本调用次数」与「降级率」两组指标同时失真。改为 `cost?.providerKind ?? 'rules'`。
- **回归守卫**：`tests/agent/skill-prompt-contract.test.ts` 断言必填输出字段必须以
  **JSON 键形式**出现在提示词骨架里。负控实测：改掉骨架键名 → 用例 FAIL
  （最初写成 `toContain(field)` 时负控**仍 PASS**，已修正为 `"field":` 正则）。

### 3.4 一条环境事实（不是缺陷，但必须记）

生产组织 `default` **没有任何 ADMIN 成员**（实测只有 `qa.male` / `qa.female` 两个 OPERATOR），
ADMIN 只存在于 `preview` 组织。因此 B 段用 `--elevate`：把 `qa.female` 临时提到 ADMIN，
`finally` 里强制回滚并断言回滚成功（B11）。**不加该开关时 B 段记 SKIP，不当通过。**

> 这条同时说明：真实客户组织的 owner 必须是 ADMIN，否则审批与结果核验在生产上无人可做。
> 当前 `default` 是种子组织，尚未配 owner —— 记为发布后债务（D-12）。

### S3 判定：**PASS（25/25）**

---

## 4. 全量回归（S1 的旁证）

| 项 | 结果 |
|---|---|
| `npx tsc --noEmit` | 0 error |
| 全量 Jest（CI 原命令 `npm test`） | **128 套件 / 2493 测试全 PASS** |
| `npm run check:ui-invariants` | R1–R11 全通过 |
| `npm run lint:gate` | 零新增债务 |
| `npm run audit:tenancy` | 117 文件 / 182 条查询 / **0 未登记** |
| `npm run verify:contrast` | 全部组合 WCAG AA |

> 口径说明：上一轮记录的 `869/869` 是「修正 jest 忽略规则前」的数字（把 `.next/standalone` 副本也算进去了）。本轮加入 `<rootDir>/.next/`、`<rootDir>/.open-next/` 排除后，真实套件数是 **128 / 2493**。两个数字都不隐藏，但**以 128/2493 为准**。

---

## 5. 本批次结论

| 层级 | 判定 | 依据 |
|---|---|---|
| S1 沙箱集成 | **PASS** | A1–A5 不变量 + HTTP 201 + DB 读回 + 租户归属强制 + 幂等键必需 |
| S2 真实 Provider | **PASS**（限定段落） | 生产 9/9，真实 token 461/270，`provider=workbuddy` |
| S3 生产业务验证 | **PASS（25/25）** | 生产 `ab8b342`：执行链 12 项 + 审批门 10 项 + 提权回滚 1 项（见 §3） |
| A-03b HTTP 集成 | **PASS（部分）** | Mission 全链路 HTTP+DB 已验；**Agent 审批/执行已验**；Outcome 核验仍未验（`outcome.report` 需 `proposalId`，属另一条链路） |
| 无未授权外部动作 | **PASS** | 执行效果为**站内回执**（`recipient=REQUESTER`）；无对外送达、无第三方 API |
| Verified Outcome 有独立依据 | **NOT_TESTED** | 本轮未产生 Verified Outcome（仍缺） |

**Batch 4 判定（发布后更新）：S1 PASS / S2 PASS / S3 PASS。审批→执行的尾巴已闭合。**

⚠️ 但「完整闭环」仍差最后一环：**Outcome 的独立核验**（`outcome.report` → `outcome.verify`）
挂在计费/提案链路上，需要一条真实的 `proposalId`，本轮未构造，不冒充已验证。
因此对外可以说「审批→执行已闭环」，**不能**说「验证→结算已闭环」。
