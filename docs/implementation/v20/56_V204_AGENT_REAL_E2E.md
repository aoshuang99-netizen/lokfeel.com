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

**BLOCKED。**

原因不是技术不可行，而是 S3 的定义前提未满足：S3 要求「**在获批发布的生产版本上**用授权测试账号执行低风险受控流程」。当前：

1. 生产运行的是旧版本（`79459d6`，T-4 三屏视觉升级），**不是本 RC**（`e5fa762`）；
2. 本轮 RC 判定为 NO-GO（`58`），未取得 D-10 发布授权；
3. 因此不存在「RC 版本的生产环境」。

**不做的具体事项**：没有在生产上跑 Consent→Action→Outcome 的完整业务流。这条不动，因为一旦执行会产生真实外部动作（发信、调外部 API），没有授权不能做。

### S3 判定：**BLOCKED**

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
| S3 生产业务验证 | **BLOCKED** | 无获批的 RC 生产版本；D-10 未批 |
| A-03b HTTP 集成 | **PASS（部分）** | Mission 全链路 HTTP+DB 已验；Agent 审批/执行/Outcome 未验 |
| 无未授权外部动作 | **PASS** | 除一次真实 LLM run（低风险、被授权范围内的测试调用）外无外部动作 |
| Verified Outcome 有独立依据 | **NOT_TESTED** | 本轮未产生 Verified Outcome |

**Batch 4 判定：S1 PASS / S2 PASS（局部）/ S3 BLOCKED。**

「核心 AI 执行闭环已能运行」这句话**目前只能说到「模型调用」这一段**。审批→执行→验证的尾巴仍是空的，因此对外不能宣称完整 Connection OS 正式版。
