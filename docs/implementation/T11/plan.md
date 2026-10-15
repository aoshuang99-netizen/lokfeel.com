# T11 · Open SDK — 标准互操作与开源准备（开工方案 + 验收口径）

> **状态**：🚧 **Slice 1–4 已落地，Slice 5 进行中（均未发版）**。本文件是设计 + 切片计划 + 验收口径。
> **基线**：`47e1dac`（`main`，T10 Slice 4 收尾提交；**未发版**，最新生产部署仍是 `f6630ea6b`）。
> **前序交接**（`BACKLOG.md` §3 T10 卡片）：T10 新增的 8 个端点与 T09 的 `/api/v1/agents/*`
> **尚未写入契约**，T11 做「OpenAPI 固化」时需一并补齐 —— 见 Slice 1。

---

## 0. 任务定义

| 项 | 内容 |
|---|---|
| 目标（BACKLOG） | A2A / MCP 适配 + OpenAPI 固化 + SDK 示例 + 许可证审计 |
| 目标（`tasks/T11_OPEN_SDK.md`） | A2A/MCP 适配、LDCP schema、SDK 示例、README、许可证审计、贡献指南 |
| 依赖 | T04 / T05 的 API 面稳定后（已满足） |
| 验收 | **AC-22** |
| 交付 | 适配层 + 示例 + 贡献指南 |
| 铁律 | 外部示例**可运行**；**越权必须失败**；开源仓**无凭据** |

### AC-22 的可执行定义

`docs/ACCEPTANCE_MATRIX.md` 原文：

> **AC-22** ｜ P2 ｜ A2A/MCP ｜ **第三方 Agent 在授权范围内完成发现/协作，越权失败** ｜ 证据形式：**合约测试**

拆成三条必须同时成立的判据（缺一条就不是 AC-22）：

| # | 判据 | 为什么必须单独证 |
|---|---|---|
| ① | **发现**：能力清单在**无会话**时可读（MCP `tools/list`、A2A agent card） | 若清单也要授权，第三方 Agent 无法知道"能请求什么"，授权就无从谈起；这一条定义了「公开什么」（能力）与「保护什么」（数据）的分界 |
| ② | **协作**：在**授权范围内**完成调用，且返回**真实数据** | 「200 + 空列表」不是协作成功的证据 —— 它同样能由"功能未实现"产生 |
| ③ | **越权失败**：无会话 / 能力不足 / 跨租户，三种成因各自以**正确的语义**失败 | 见下节「为什么必须成对取证」 |

### ⚠️ LDCP：交付包中**无任何定义**，故本任务**不实现**

`tasks/T11_OPEN_SDK.md` 的「目标与范围」列了 `LDCP schema`，但该缩写在交付包中
**只出现一次**（`docs/PRODUCT_PRD.md:10` 的「A2A/MCP/LDCP 扩展」），没有协议文档、
没有 schema、没有字段定义。**没有规格就没有实现** —— 凭空造一个协议再声称"实现了 LDCP"
属于虚报。本任务对 LDCP 的处置：**不实现，在验收报告里记为 `N/A（交付包未定义规格）`**。
若后续提供规格，它是独立任务，不属于 T11 的完成定义。

---

## 1. 为什么必须**成对**取证（本任务最重要的判据设计）

「越权被拒」单独拿出来是**弱证据**：它可以用无数种与授权无关的原因变真 ——
数据不存在、路径拼错、功能压根没写、夹具没播进去。因此本任务的每一组越权
都配一条**对照**，两者只差一个变量：

| 对照 | 变量 | 期望 |
|---|---|---|
| `GET /api/v1/missions` | 会话：OPERATOR → MEMBER | 200 → **403** |
| `POST /api/v1/bridges` | 会话：OWNER → MEMBER | 400（缺幂等键）→ **403** |
| `GET /api/v1/bridges?organizationId=…` | 参数：自己的群 → 别人的群 | 200 → **403** |
| `tools/call list_missions` | 会话：OPERATOR → MEMBER | `isError:false` → **`isError:true`** |

两条一起看，「被拒」才**唯一地**归因到能力判定。为此夹具造了**三档角色**
（MEMBER / OPERATOR / OWNER）而不是两个 —— 并且刻意选了 `mission.read`
（`OPERATOR_EXTRA`）这条天然分档的能力做探针，不靠任何取巧。

---

## 2. 授权模型：一张表，三个协议信封

权限的**唯一事实来源**是 `src/lib/tenancy/capabilities.ts` 的 `ROLE_CAPABILITIES`
（T01 建立）。三个面都从它派生：

```
                    ┌──────────────────────────────────────┐
                    │  capabilities.ts · ROLE_CAPABILITIES │  ← 唯一的权限事实
                    └───────────────┬──────────────────────┘
                                    │ can(role, capability)
        ┌───────────────────────────┼───────────────────────────┐
        ▼                           ▼                           ▼
  REST /api/v1/**            MCP POST /api/mcp           A2A POST /api/v1/a2a/tasks
  withTenant(cap)            逐工具 can()                 逐技能 can()
  ↳ 401 / 403                ↳ 401 / 200+isError          ↳ 401 / 200+state=failed
```

三个面**失败语义刻意不统一** —— 这是协议决定的，不是随手写的：

| 情形 | REST | MCP | A2A |
|---|---|---|---|
| 无会话 | HTTP **401** | HTTP **401** | HTTP **401** |
| 有会话、能力不足 | HTTP **403** | HTTP 200 + `result.isError=true` | HTTP 200 + `task.status.state="failed"` |
| 未知资源 | HTTP 404 | JSON-RPC **-32602** + `data.available` | HTTP **404** `SKILL_NOT_FOUND` |
| 未实现的方法 | HTTP 404 | JSON-RPC **-32601** / 404 | — |
| 请求体非法 | HTTP 400 | JSON-RPC **-32700** / 400 | HTTP **400** `INVALID_ARGUMENT` |

> ⚠️ 对 SDK 消费者的直接后果：**不能只看 `res.ok`**。MCP 的 `tools/call`
> 「业务被拒」是 HTTP 200。示例里的 `mcpRaw()` 把它归一成三态
> （`result` / `error` / `accepted`），就是为了让调用方无法把「被拒」误读成「成功」。

---

## 3. 两个关键架构决定（及其理由）

### 3.1 工具目录**不在**协议路由里 —— `src/lib/interop/tools.ts`

MCP 与 A2A 是两套**信封**，但「能做什么、需要什么能力」是**同一件事**。
把工具清单放进任一协议的路由文件，另一个协议就必须复制一份 —— 而两份清单的漂移是
**静默**的（一边加了工具，另一边没加，两边都不报错），直到某个外部 Agent 说
「你的 agent card 里没有这个 skill」。因此：

- `src/lib/interop/tools.ts` = **单一来源**（`INTEROP_TOOLS` / `toolByName` /
  `INTEROP_TOOL_NAMES` / `publicToolList`）；
- 协议层只管信封（JSON-RPC 2.0 / A2A task envelope），**不复制任何业务判断**；
- 每个工具只调**既有服务层**函数（`listMissions` / `listBridges` / …），零业务复制；
- 由 `scripts/qa/verify-ac22-open-sdk.mjs` 在**运行时**做「两份清单双向集合相等」断言。

### 3.2 MCP 是**单端点**，但**不能**用 `withTenant(cap)` 包住整个路由

不同工具需要不同能力（`mission.read` vs `bridge.read` vs `outcome.report`）。
若整条路由套一个 `withTenant('mission.read')`，就会把**最严**的能力强加给**最松**的工具
——`list_bridges` 会因为调用者没有 `mission.read` 而失败，而它本来只需要 `bridge.read`。
所以 MCP 路由的授权是**逐工具**的：

```
路由层：只做 JSON-RPC 形状校验
tools/call：resolveTenant() → can(ctx.role, tool.capability) → tool.run(ctx, args)
```

服务层自己还有一次能力复判（纵深防御），但那是它自己的职责，不是协议层的。

### 3.3 A2A 选择**无状态**

不落库 `task`。理由：落库就产生「第二套运行记录」，与 T09 的 `AgentRun` 语义重叠
（谁是真相来源？重试以谁为准？）—— 那需要一个完整状态机，属「完整生命周期」范畴。
最小可用刻意选择无状态：`task.id` 只在本次响应内有效，客户端要再查就重发。
**这条决定被写成断言**：同一调用连发两次，`task.id` 必须不同
（`demo-a2a.ts` 与 `verify-ac22-open-sdk.mjs` 各验一次）。

---

## 4. 切片计划

| 切片 | 内容 | 落点 | 状态 |
|---|---|---|---|
| **1** | **OpenAPI 契约固化**（8 → **34 路径 / 42 操作**，每条带 `x-required-capability`）+ `check:openapi-contract` 契约↔实现同源核对 + `audit:open-source` 许可证分级与凭据扫描 | 前序交接（T09/T10 端点补齐） | ✅ |
| **2** | **MCP 适配层**（Streamable HTTP，`POST /api/mcp`）+ 共享工具目录 + 25 例单测 | **AC-22 ① ③** | ✅ |
| **3** | **A2A 最小可用**（`GET /.well-known/agent-card.json` + `POST /api/v1/a2a/tasks`）+ 22 例单测 | **AC-22 ① ③** | ✅ |
| **4** | **TypeScript SDK 示例**（`examples/sdk/`，4 个可运行脚本，授权/越权成对演示，零凭据） | **AC-22 ②**、铁律「示例可运行 + 无凭据」 | ✅ |
| **5** | **AC-22 端到端合约取证**（`verify:ac22:open-sdk`，真实 dev server + 真隔离库 + 三档角色真实会话）+ 文档 + 回填 + 提交 | **AC-22 全文** | 🚧 |

排序理由：**先契约定形状，再实现信封，最后取证**。反过来的话，
「契约」会退化成对已写代码的事后描述，同源核对就失去意义。

---

## 5. 交付物清单（对照 `tasks/T11_OPEN_SDK.md`）

| 任务书要求 | 交付 | 说明 |
|---|---|---|
| A2A / MCP 适配 | `src/app/api/mcp/route.ts`、`src/app/api/v1/a2a/tasks/route.ts`、`src/lib/interop/tools.ts`、`public/.well-known/agent-card.json` | Slice 2/3 |
| OpenAPI 固化 | `contracts/connection.openapi.yaml`（34 路径 / 42 操作）+ `scripts/check-openapi-contract.mjs` | Slice 1 |
| SDK 示例 | `examples/sdk/`（客户端 + 3 组演示 + README，`tsc` 覆盖） | Slice 4 |
| README | `examples/sdk/README.md`；仓库级 `README.md` 已在（T00 开源准备） | Slice 4 |
| 许可证审计 | `scripts/qa/open-source-audit.mjs`（生产依赖强 copyleft/未知 ⇒ 失败）+ **修复 1 处真实凭据泄漏** | Slice 1 |
| 贡献指南 | `CONTRIBUTING.md` **已存在**（T00 交付），本任务不重写；`docs/OPEN-CORE-POSITIONING.md` 同理 | 复用 |
| LDCP schema | **无规格 ⇒ N/A**，见 §0 | 不实现 |

### 🔴 Slice 1 抓到一处**真实凭据泄漏**（已修）

`scripts/fix-bot-photos-http.mjs` 硬编码了一个**真实可用的 Turso 读写 token**
（JWT，payload 含 `"a":"rw"`），且该文件**已在 git 里**。修法：改为
`process.env.TURSO_TOKEN`（缺失即 `exit 1` 并提示用法），注释写明「必须视为已泄漏并轮换」。
审计脚本随之改进：**测试目录里的凭据形态降级为提示**（夹具必然含假凭据），
否则第一次运行就会因夹具而红、然后被人加白名单绕过 —— 那才是真正的失守。

---

## 6. 未覆盖 / 诚实声明

1. **无 `resources` / `prompts`**（MCP）与**无 `tasks/get`、无 push notification、无流式**（A2A）：
   本项目工具都是**短请求**，未用到的能力声明出来只会误导客户端。agent card 里
   `capabilities.streaming = false`、`pushNotifications = false` 是**如实声明**，不是待办。
2. **`POST /api/mcp` 不做 SSE**：`GET /api/mcp` 返回 `405 + Allow: POST`，把「该用什么方法」说清楚。
3. **示例的「协作」全部是只读工具**：写工具（`report_outcome`）需要真实 `proposalId`，
   在没有完整 T05 链路的隔离库里只能得到 400。因此 AC-22 的「协作」以
   只读 + REST 读端点取证，**不虚报写入链路已端到端打通**。
4. **AC-22 不覆盖渲染层**：判据是 HTTP 合约，不是 UI。渲染归 AC-18 的七屏取证。
5. **公开仓库仍是私有仓**：`audit:open-source` 证的是「许可证与凭据卫生」，
   不等于「已开源发布」。真正公开需独立评审（`docs/OPEN-CORE-POSITIONING.md`）。

---

## 7. 变更日志

| 日期 | 内容 |
|---|---|
| 2026-10-15 | **开工**：读出 AC-22 原文与 T11 三条铁律；确认 `LDCP` 无规格 ⇒ 不实现；定下两个关键决定（工具目录单一来源、MCP 逐工具授权）。规划 5 个切片。 |
| 2026-10-15 | **Slice 1 落地**：契约从 8 路径扩到 34 路径 / 42 操作（42/42 带 `x-required-capability`）+ `check:openapi-contract`（5 项断言全绿）+ `audit:open-source`（**抓到真实 Turso token 泄漏**并修复 → 5 项全绿）。 |
| 2026-10-15 | **Slice 2 落地**：抽出 `src/lib/interop/tools.ts` 共享目录；MCP Streamable HTTP 路由；**25 例单测全绿**（含「无幽灵能力」「能力不足时**不调**服务层」「非 ApiError 不泄漏内部细节」）。 |
| 2026-10-15 | **Slice 3 落地**：A2A 路由 + agent card；**22 例单测全绿**（含「无状态：两次 id 不同」「卡片与工具目录双向一致」）。`tsc --noEmit` exit 0。 |
| 2026-10-15 | **Slice 4 落地**：`examples/sdk/` 四个可运行脚本（`demo-discovery` 免凭据；`demo-mcp`/`demo-a2a`/`demo-rest` 需令牌）+ README。全部纳入 `tsc` 覆盖（`examples/**` 不在 exclude）⇒ 不会腐烂。 |
