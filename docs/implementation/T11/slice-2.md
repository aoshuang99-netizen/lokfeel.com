# T11 · Slice 2 — MCP 适配层（Streamable HTTP）

> **状态**：✅ 已落地；`tests/mcp/mcp-route.test.ts` **25/25 全绿**；`tsc --noEmit` exit 0。

---

## 0. 决定：为什么是 **HTTP**，而不是 stdio

MCP 有两种传输：stdio 与 Streamable HTTP。本项目选 HTTP，理由不是偏好：

1. **Netlify 免费计划没有常驻进程** —— stdio 型 MCP server 无处安放。
   这不是"暂时不方便"，而是部署形态决定的硬约束。
2. **复用同一套租户守卫**。HTTP 端点随应用一起部署，于是 `resolveTenant()` /
   `can(role, capability)` 是**同一份代码**。这一点直接决定了 AC-22 的
   「越权必须失败」能在**真实链路**上取证，而不是只在单测里假设。

---

## 1. 交付物

| 文件 | 说明 |
|---|---|
| `src/lib/interop/tools.ts` | **共享工具目录**（MCP 与 A2A 的单一来源） |
| `src/app/api/mcp/route.ts` | MCP Streamable HTTP 单端点 |
| `tests/mcp/mcp-route.test.ts` | 25 例 |

---

## 2. 核心设计一：工具目录**不在**协议路由里

最初我把工具定义直接写在 `route.ts` 里。写 A2A（Slice 3）时立刻撞上问题：
agent card 需要同一份清单。摆在面前的只有两条路 —— 复制一份，或者抽出来。

复制一份的代价是**静默漂移**：MCP 加了工具、A2A 没加，两边都不报错，
直到某个外部 Agent 说"你的 agent card 里没有这个 skill"。这类缺陷没有任何
运行时测试能自动抓到（除非专门写一条，而那正是我们要避免重复的东西）。

所以抽成 `src/lib/interop/tools.ts`：

```
src/lib/interop/tools.ts
  INTEROP_TOOLS      ── 5 个工具：list_missions / list_bridges / bridge_discovery
  │                              / list_outcomes / report_outcome
  toolByName(name)   ── 按名字取（找不到返回 undefined，调用方负责回"未知工具"）
  INTEROP_TOOL_NAMES ── 名字集（用于错误响应里回列可用项）
  publicToolList()   ── 对外清单（MCP tools/list 与 A2A agent card 都从它派生）
```

**本文件的四条纪律**（写在文件头）：

1. 每个工具**只**调既有服务层函数，不复制任何业务判断；
2. `capability` 必须取自 `capabilities.ts`（同一张表）—— 写一个不存在的能力名比不写更糟；
3. `inputSchema` 是对外契约，不得出现内部实现细节（表名 / env 名 / 文件路径）；
4. 工具执行**不做**二次授权判断 —— 授权由调用方在解析出租户上下文后判定；
   服务层自己还有一次复判（纵深防御，不是这里的职责）。

---

## 3. 核心设计二：**逐工具**授权，而不是包住整个路由

这一条是本文件最关键的实现判断，值得把**错误解法**写下来：

```ts
// ❌ 错误解法：一个能力套住整条路由
export const POST = withTenant('mission.read')(async (req) => { /* switch method */ })
```

为什么错：MCP 是**单端点**，但不同工具需要**不同能力**
（`mission.read` / `bridge.read` / `outcome.report`）。用 `withTenant('mission.read')`
包住整条路由，等于把**最严**的能力强加给**最松**的工具 ——
`list_bridges` 会因为调用者没有 `mission.read` 而失败，而它本来只需要 `bridge.read`。
更糟的是这种失败**看起来是"正确的拒绝"**（403 嘛），很难被发现。

正确做法：

```
路由层：只做 JSON-RPC 形状校验（jsonrpc / method 存在性）
tools/call：
  ① resolveTenant()              → 无会话 ⇒ HTTP 401
  ② can(ctx.role, tool.capability) → 能力不足 ⇒ result.isError = true（HTTP 仍 200）
  ③ tool.run(ctx, args)           → 只调服务层（服务层再复判一次）
```

`organizationId` 的取值顺序：`params.arguments.organizationId` 优先，其次查询串。
**它自始至终只是选择器** —— `resolveTenant` 会回查 memberships，
指向自己不属于的群 ⇒ 403（在 `verify-ac22-open-sdk.mjs` 里有专门断言）。

---

## 4. 暴露面的取舍：**发现公开，协作需授权**

| 方法 | 是否需要会话 | 理由 |
|---|---|---|
| `initialize` | ❌ | 外部 Agent 必须先知道协议版本与服务器身份 |
| `tools/list` | ❌ | 敏感的是**数据**，不是**能力清单**。不知道能请求什么，授权无从谈起 |
| `ping` | ❌ | 无副作用 |
| `notifications/initialized` | ❌ | 通知；返回 `202` 且**无响应体** |
| `tools/call` | ✅ **必须** | 唯一接触数据的方法 |
| `GET` | — | `405 + Allow: POST`（不做 SSE） |

---

## 5. 错误语义（刻意与"业务失败"分开）

这是 MCP 适配里最容易做错的一处：**把业务拒绝报成协议错误**。

| 情形 | HTTP | 信封 |
|---|---|---|
| 请求体不是合法 JSON | **400** | JSON-RPC `-32700` |
| 缺 `jsonrpc` / `method` | **400** | JSON-RPC `-32600` |
| 未实现的方法（如 `resources/list`） | **404** | JSON-RPC `-32601` |
| **未知工具** | **200** | JSON-RPC `-32602` + `data.available`（回列可用工具） |
| 无会话 | **401** | JSON-RPC `-32001` |
| 有会话、**能力不足** | **200** | `result: { content: [...], isError: true }` |
| 工具执行时业务失败（`ApiError`） | **200** | 同上，`isError: true` |

**为什么"能力不足"是 200 而不是 403**：这是 JSON-RPC 的语义 —— 请求被正确处理了，
只是**业务结果**是"拒绝"。若报成协议错误，客户端会认为自己在**调用方式**上出了问题，
从而重试或改参数，而不是去补权限。**把"你没有被授权"伪装成"你调用错了"，
会让人把时间花在错误的方向上。**

**为什么"未知工具"也是 200**：同上，且它附带 `data.available` ——
错误信息里直接给出可选项，比让客户端去猜有用得多。

---

## 6. 单测：25 例，四组

> 🔴 **加载陷阱**（踩过）：`@/lib/bridges` 这个 barrel 会把 `@/lib/db` → next-auth（纯 ESM）
> 一起拖进来，CJS require 直接失败。测试里必须 **mock 掉四个 barrel**
> （`@/lib/tenancy` / `@/lib/connection` / `@/lib/bridges` / `@/lib/outcome`）
> 或走深路径。本次选择 mock barrel —— 因为路由正是通过 barrel 引用的。

| 组 | 例数 | 覆盖 |
|---|---|---|
| 协议形状 | 7 | 非法 JSON `-32700` / 缺信封 `-32600` / 未知方法 `-32601` / `GET` 405+Allow / 202 无体 / ping / 未知工具 `-32602` + `available` |
| `initialize` | 2 | 版本与服务器身份；**不回显凭据形态** |
| `tools/list` | 4 | 公开可达；**无幽灵能力**（每个 `requiredCapability` 都在能力表里）；不泄漏实现细节（无表名 / env / 路径）；清单与 `INTEROP_TOOLS` 同源 |
| `tools/call` 授权 | 12 | 无会话 **401**；能力不足 ⇒ `isError:true` 且**不调用服务层**（`run` 未被 invoke）；`ApiError` ⇒ `isError:true`；**非 `ApiError` 不泄漏内部细节**（断言响应里不出现 `secret_col` / `SQLITE`）；参数透传；`organizationId` 优先级 |

其中两条是**负向断言的负向断言**，值得单独说：

- 「能力不足时**不调用**服务层」—— 否则就是"先查了再过滤"，而"先查再过滤"意味着
  数据**已经离开了数据库边界**，日志/缓存/连接池都可能留下痕迹。
- 「非 `ApiError` 不泄漏内部细节」—— 夹具里刻意 mock 一个抛
  `Error('secret_col does not exist in SQLITE …')` 的服务层，然后断言响应体里
  **没有** `secret_col` 与 `SQLITE`。否则"通用错误处理"就退化成了堆栈转发。

---

## 7. 门禁证据

```
npx jest tests/mcp          → 25 passed / 25 total（重构为共享目录后复跑仍 25/25）
npx tsc --noEmit            → exit 0
npm run check:script-decls  → 通过
```

---

## 8. 未覆盖 / 诚实声明

1. **不做 `resources` / `prompts`**：只实现 `tools`。未用到的能力声明出来只会误导客户端。
2. **不做 SSE 流式**：本项目工具都是短请求，流式没有收益；`GET` 明确回 405 并给出 `Allow`。
3. **不做会话协商**（MCP 的 `Mcp-Session-Id`）：本适配层的每次 `tools/call` 都由
   NextAuth 会话独立鉴权，服务端不需要维护 MCP 侧会话状态。这是一条**取舍**，
   不是遗漏 —— 若将来要支持服务端推送，才需要引入会话。
4. **单测把 `@/lib/tenancy` mock 掉了** —— 也就是说"无会话 ⇒ 401"在单测里是我们
   **告诉**它的，不是它自己做到的。这一环只有真实运行时能证 ——
   由 `verify-ac22-open-sdk.mjs` 补（见 `slice-5.md`）。
