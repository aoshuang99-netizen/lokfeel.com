# T11 · Slice 3 — A2A 最小可用（agent card + `POST /api/v1/a2a/tasks`）

> **状态**：✅ 已落地；`tests/a2a/*` **22/22 全绿**；`tsc --noEmit` exit 0。

---

## 0. 范围决定（用户拍板：**最小可用**）

完整 A2A 有：任务生命周期（`submitted → working → completed`）、SSE 流式、
push notification、`tasks/get` 持久化查询、`tasks/cancel`。
本次**只保留 A2A 的"形状"**，其余刻意不做：

| 能力 | 本次 | 理由 |
|---|---|---|
| `task` + `status.state` + `artifacts` | ✅ | 这是 A2A 的**形状**，第三方 Agent 的解析逻辑靠它 |
| `skillId` + `input` 请求模型 | ✅ | 与 MCP `tools/call {name, arguments}` 同构 |
| SSE 流式 | ❌ | 本项目工具都是**短请求**，一个来回就结束；流式没有收益 |
| push notification / 长任务 | ❌ | 同上 |
| `tasks/get` 持久化 | ❌ | **无状态**设计，见 §2；这条最有争议，故单列 |
| `tasks/cancel` | ❌ | 无状态就没有可取消的东西 |

**agent card 里如实声明** `capabilities.streaming = false`、`pushNotifications = false`、
`stateTransitionHistory = false`。**声明为 false 不是待办清单，是契约的一部分** ——
客户端据此决定自己要不要走轮询。少声明一个能力，比声明了却做不到要好得多。

---

## 1. 交付物

| 文件 | 说明 |
|---|---|
| `src/app/api/v1/a2a/tasks/route.ts` | 单端点（`POST`） |
| `public/.well-known/agent-card.json` | 静态 agent card（**无凭据**） |
| `tests/a2a/a2a-tasks.test.ts` | 12 例 |
| `tests/a2a/agent-card.test.ts` | 10 例 |

### agent card 为什么是**静态文件**

`public/.well-known/agent-card.json` 由 Next 直接托管，**不经过任何鉴权与数据库**。
这样做的两个后果都是想要的：

1. 它**不可能**意外包含租户数据 —— 静态文件没有数据源；
2. 它**不可能**因为数据库抖动而不可用 —— 发现面必须是稳定的。

（反向的代价：能力清单变了要改两处 —— JSON 文件与 `tools.ts`。这正是
`tests/a2a/agent-card.test.ts` 做「**双向集合相等** + 能力逐字一致」断言的原因；
`verify-ac22-open-sdk.mjs` 在真实运行时再验一次。**两处是刻意接受的重复，
重复必须由断言来锁死。**）

---

## 2. 核心决定：**任务不落库**

若把 `task` 落库，就会产生**第二套运行记录**，与 T09 的 `AgentRun` 语义重叠：

- 谁是真相来源？`AgentRun` 还是 `a2a task`？
- 重试以谁为准？A2A 的 `tasks/get` 还是 T09 的运行记录？
- 两套状态机要不要对齐？（`submitted/working/completed` vs `PENDING/AWAITING_APPROVAL/EXECUTED`）

回答这些问题需要一个**完整的生命周期设计**，那是「完整 A2A」的范围，不是「最小可用」的。
本切片刻意选择**无状态**：`task.id` 只在本次响应里有效，客户端要再查就重发。

**这条决定被写成断言**（否则它只是一句注释，随时会被人"顺手加个表"）：

```ts
// tests/a2a/a2a-tasks.test.ts
// examples/sdk/demo-a2a.ts
// scripts/qa/verify-ac22-open-sdk.mjs
同一调用连发两次 ⇒ task.id 必须**不同**
```

三处断言（单测 / 示例 / 端到端）——因为"无状态"是本切片对外的**语义承诺**，
不是内部实现细节。

---

## 3. 授权：与 MCP **完全同源**

```
POST /api/v1/a2a/tasks
  ① 校验 skillId 存在            → 缺 ⇒ 400 INVALID_ARGUMENT
  ② toolByName(skillId)          → 未知 ⇒ 404 SKILL_NOT_FOUND（附可用技能清单）
  ③ resolveTenant({organizationId}) → 无会话 ⇒ 401 / 非成员 ⇒ 403
  ④ can(ctx.role, tool.capability)  → 能力不足 ⇒ 200 + task.status.state = "failed"
  ⑤ tool.run(ctx, input)          → ApiError ⇒ 200 + failed；其它 ⇒ 200 + failed（内部错误）
```

`toolByName` 与 `can` 都来自 Slice 2 的共享层 —— **A2A 没有自己的权限判断代码**。
这就是「工具目录单一来源」在授权上的直接收益：不可能出现"MCP 拒了、A2A 放了"。

### 任务信封

```json
{
  "task": {
    "id": "a2a-<uuid>",
    "skillId": "list_bridges",
    "status": { "state": "completed", "timestamp": "2026-10-15T…" },
    "artifacts": [{ "artifactId": "result", "parts": [{ "type": "data", "data": { … } }] }]
  }
}
```

- `state ∈ {completed, failed}` —— 最小可用只有这两种终态（没有 `working`，因为没有长任务）；
- **`failed` 时 `artifacts` 为空数组**，"失败不产出数据"是显式的，不靠客户端去判空。

---

## 4. 单测：22 例

`a2a-tasks.test.ts`（12 例）

| 组 | 覆盖 |
|---|---|
| 请求形状 | 缺 `skillId` ⇒ 400；未知技能 ⇒ 404 `SKILL_NOT_FOUND`；非法 JSON ⇒ 400 |
| 授权 | 无会话 ⇒ **401**；能力不足 ⇒ **200 + failed** 且**不调用服务层**；`organizationId` 透传给 `resolveTenant` |
| 执行 | 成功 ⇒ `completed` + `artifacts[0].parts[0].type === 'data'`；`ApiError` ⇒ 200 + failed；非 `ApiError` ⇒ 200 + failed 且**不泄漏**；**两次调用 `task.id` 不同**（无状态）；`failed` 时 `artifacts` 为空 |

`agent-card.test.ts`（10 例）

| 组 | 覆盖 |
|---|---|
| 文件本身 | 合法 JSON；`protocolVersion` / `name` / `url` / `securitySchemes` 齐备；`capabilities` 三项均 `false`；`skills` 非空且每项有 `id` 与 `x-required-capability` |
| 与工具目录一致 | **双向集合相等**（`skills[].id` ↔ `INTEROP_TOOLS[].name`）；能力逐字一致；**无幽灵能力**（每个 `x-required-capability` 都在 `capabilities.ts` 里） |
| 开源合规 | **无凭据形态**（无 token/secret/apiKey 的值）；**无内部实现细节**（无表名 / env / 文件路径） |

> agent-card 测试**读真实文件**（`fs.readFileSync('public/.well-known/agent-card.json')`）
> 而不是 import 一个常量 —— 因为要防的正是"文件被改坏了"。

---

## 5. 门禁证据

```
npx jest tests/a2a          → 22 passed / 22 total
npx tsc --noEmit            → exit 0
```

---

## 6. 未覆盖 / 诚实声明

1. **不是合规 A2A 实现**：只实现了 `POST tasks` 一个端点。完整 A2A 的
   `tasks/get` / `tasks/cancel` / `message/send` 等均未实现。
   本切片的价值是**形状与授权**，不是协议完备性 —— README 与 agent card 都如实说明。
2. **`protocolVersion: "0.3.0"`**：写的是 A2A 规范的版本号。本实现只覆盖其**子集**，
   而 A2A 没有"我实现了子集"的正式表达方式（`capabilities` 只覆盖 streaming /
   pushNotifications / stateTransitionHistory 三项）。因此声明版本号时，
   **必须同时看 capabilities** —— 这一点写进了 `examples/sdk/README.md`。
3. **`task.status.timestamp` 是服务端时间**，与客户端时钟无关；
   无状态设计下它不用于任何排序或幂等判断。
