# LokFeel Connection OS · 互操作示例（TypeScript / Node）

这四个脚本是**可运行的文档**：说明第三方 Agent / 集成方如何接上本服务，以及
**授权模型在三个协议面上分别长什么样**。它们随源码一起被 `npx tsc --noEmit` 检查，
所以不会像 markdown 那样腐烂。

> **本目录不含任何凭据。** 凭据由环境变量注入，或由示例自己走一次真实登录换取。

---

## 快速开始

```bash
# ① 发现面（**无需凭据**）—— 先跑这个，验证能连上
LOKFEEL_BASE_URL=https://app.lokfeel.com npx tsx examples/sdk/demo-discovery.ts

# ② 授权 / 越权三组（需要凭据）
#    方式 A：直接给会话 Cookie（浏览器 → DevTools → Network → 任一 /api 请求 → Cookie）
LOKFEEL_BASE_URL=https://app.lokfeel.com \
LOKFEEL_COOKIE="next-auth.session-token=…" \
  npx tsx examples/sdk/demo-mcp.ts

#    方式 B：给账号，让示例自己登录
LOKFEEL_BASE_URL=http://localhost:3099 \
LOKFEEL_LOGIN_EMAIL=you@example.com \
LOKFEEL_LOGIN_PASSWORD=… \
  npx tsx examples/sdk/demo-mcp.ts
```

`LOKFEEL_BASE_URL` 省略时默认 `http://localhost:3099`（`npm run dev` 的端口）。
另外三个脚本同理：`demo-a2a.ts`（A2A 面）、`demo-rest.ts`（REST 面）。

每个脚本都会打印**断言汇总**并以退出码反映结论：有 `FAIL` → `exit 1`，因此可以直接放进 CI。

### 🔴 为什么没有 `LOKFEEL_TOKEN` / Bearer

本服务的身份判定是 `requireAuth()` → NextAuth `auth()`，也就是**会话 cookie**；
代码里**不存在**读 `Authorization: Bearer …` 的分支。所以示例不发明一个令牌机制
——那样写出来的示例"看起来专业、实际只会拿到 401"。示例与浏览器行为一致：
走一次 `/api/auth/login` 拿 `Set-Cookie`，之后复用。

若将来需要长期有效的机器令牌（无头集成），那是一条**新的认证能力**
（签发 / 轮换 / 吊销 / 作用域），必须单独评审，不该混在"示例"这一层悄悄加。

---

## 文件

| 文件 | 作用 | 需要凭据 |
| --- | --- | --- |
| `lokfeel-client.ts` | 零依赖客户端：MCP / A2A / REST 三个面 + `login()` 换 cookie + 结果解读小工具 | — |
| `config.ts` | 凭据解析（`LOKFEEL_COOKIE` 优先，其次 `LOKFEEL_LOGIN_*`）；缺凭据时**立即退出并打印用法** | — |
| `expect.ts` | 极小断言器，支持 `ok` / `FAIL` / `SKIP` 三态并输出退出码 | — |
| `demo-discovery.ts` | 发现面：MCP 握手、`tools/list`、agent card、**两份清单双向一致**、匿名调用必须 401 | 否 |
| `demo-mcp.ts` | MCP：`initialize` → 202 通知 → 授权调用 → 三种越权 | 是 |
| `demo-a2a.ts` | A2A：agent card → 任务信封 → **无状态（两次 id 不同）** → 三种越权 | 是 |
| `demo-rest.ts` | REST：`bridge.read` 通过 vs `bridge.manage` 403，并断言**守卫先于请求体校验** | 是 |

---

## 授权模型（三个面同一张表）

权限的唯一事实来源是 `src/lib/tenancy/capabilities.ts` 的 `ROLE_CAPABILITIES`。
工具/技能需要什么能力，写在 `src/lib/interop/tools.ts` 里（MCP 与 A2A 的**单一来源**）。

失败语义**刻意不统一**，因为这是协议决定的：

| 情形 | REST | MCP | A2A |
| --- | --- | --- | --- |
| 无会话 | HTTP **401** | HTTP **401** | HTTP **401** |
| 有会话、能力不足 | HTTP **403** | HTTP 200 + `result.isError = true` | HTTP 200 + `task.status.state = "failed"` |
| 未知资源 | HTTP 404 | JSON-RPC **-32602** + `data.available` | HTTP **404** `SKILL_NOT_FOUND` |
| 未实现的方法 / 路径 | HTTP 404 | JSON-RPC **-32601** / 404 | — |
| 请求体非法 | HTTP 400 | JSON-RPC **-32700** / 400 | HTTP **400** `INVALID_ARGUMENT` |

> ⚠️ 所以客户端**不能只看 `res.ok`**：`tools/call` 的"业务被拒"是 HTTP 200。
> `lokfeel-client.ts` 的 `mcpRaw()` 把结果归一成三态（`result` / `error` / `accepted`），
> 就是为了让调用方无法把"被拒"误读成"成功"。

---

## 关于 `SKIP`

越权演示需要调用者的角色**恰好不具备**目标能力（例如 `mission.read` 属 OPERATOR+、
`bridge.manage` 属 ADMIN+）。若你用的是一个高权限账号，这几条会打印 `SKIP` 并说明原因 ——
**不会**静默算通过。要完整看越权链路，请用 `MEMBER` 角色的账号复跑。

同理，脚本**不会**为了让断言变绿而降低标准：一条恒真的断言等于没有断言。

---

## 相关文档

- 契约（34 路径 / 42 操作，每条带 `x-required-capability`）：`contracts/connection.openapi.yaml`
- 契约 ↔ 实现同源核对：`npm run check:openapi-contract`
- 端到端合约取证（真实 dev server + 真隔离库 + 三档角色；**并实跑本目录全部脚本**）：
  `npm run verify:ac22:open-sdk`
- 交付记录：`docs/implementation/T11/`
