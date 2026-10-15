# T11 · Slice 5 — AC-22 端到端合约取证 + 收尾

> **状态**：✅ **AC-22 通过 — 57 通过 / 0 失败**（`npm run verify:ac22:open-sdk`，退出码 0）。

---

## 1. 取证对象与"为什么必须真运行时"

| 已有证据 | 它证了什么 | 它**证不了**什么 |
|---|---|---|
| `tests/mcp/mcp-route.test.ts`（25 例） | 函数契约：信封、状态码、授权分支 | 它把 `@/lib/tenancy` **整个 mock 掉了** —— "无会话 ⇒ 401"在单测里是**我们告诉它**的，不是它自己做到的 |
| `tests/a2a/*.test.ts`（22 例） | 同上（A2A 侧） | 同上 |
| `scripts/check-openapi-contract.mjs` | **文本级**同源：契约里的能力名 == 代码里 `withTenant(...)` 的能力名 | 运行时到底返回了什么；`resolveTenant` 是否真的挂了 |
| `scripts/qa/open-source-audit.mjs` | 许可证 + 凭据卫生 | 运行时的越权行为 |

本切片补的正是被 mock 掉的那一环：

```
resolveTenant()  →  requireAuth()（真 cookie 会话）  →  Membership 回查  →  can(role, cap)
```

只有真 dev server + 真隔离库 + 真登录会话能让它真正执行。

---

## 2. 交付物

| 文件 | 说明 |
|---|---|
| `scripts/qa/ac22-fixture.mjs` | 夹具常量（单一来源） |
| `scripts/qa/seed-ac22-e2e.mjs` | 隔离库播种（`--reset` DROP 全表 + `--regenerate` 现场生成 DDL） |
| `scripts/qa/verify-ac22-open-sdk.mjs` | 端到端取证，9 段 / **57 条断言** |
| `package.json` | +`verify:ac22:open-sdk` |

**夹具设计**（一个群 + 一个非成员群）：

```
org_ac22_a（我们所在的群）
  ├─ aOwner    OWNER    ── 全能力（对照用）
  ├─ aOperator OPERATOR ── 有 mission.read（关键：与 MEMBER 只差这一档）
  ├─ aMember   MEMBER   ── 只有 SELF_SERVICE（**越权主角**）
  └─ Mission mission_ac22_a（**真实数据锚点**）
org_ac22_b（**零成员**）── organizationId 越权靶标
```

### 🔴 为什么夹具要**三档角色**而不是两个

「MEMBER 被拒」单独拿出来是**弱证据**：它可以用"数据不存在""路径写错了"
"功能压根没实现"等无数种方式变真。所以每一组越权都配一条**只差一个变量**的对照：

| 对照 | 唯一变量 | 期望 |
|---|---|---|
| `GET /api/v1/missions` | OPERATOR → MEMBER | 200 → **403** |
| `POST /api/v1/bridges` | OWNER → MEMBER | 400（缺幂等键）→ **403** |
| `GET /api/v1/bridges?organizationId=…` | 自己的群 → 别人的群 | 200 → **403** |
| `tools/call list_missions` | OPERATOR → MEMBER | `isError:false` → **`isError:true`** |

两条一起看，「被拒」才**唯一地**归因到能力判定。夹具刻意选了 `mission.read`
（`OPERATOR_EXTRA`）这条天然分档的能力做探针 —— 不靠任何取巧
（例如"造一个谁都做不到的操作"来凑一条 403）。

---

## 3. 九段取证（57 条断言）

| 段 | 内容 | 条数 |
|---|---|---|
| ⓪ | 引导：隔离库 → dev server → 三档角色**真实登录** | 5 |
| ① | **发现面（匿名）**：MCP `initialize` / `notifications/initialized`(202 无体) / `ping` / `tools/list`；`GET /api/mcp` 405+`Allow`；agent card | 10 |
| ② | **契约一致性（运行时）**：两份清单**双向集合相等** + 能力逐字一致 + 卡片无凭据 + 夹具探针与运行时对齐 | 6 |
| ③ | **协作（授权，断言真实数据）**：REST / MCP / A2A 三面 × `mission.read`(OPERATOR) 与 `bridge.read`(MEMBER) | 6 |
| ④ | **越权·无会话**：REST GET / REST POST / MCP / A2A 全 401（POST 必须 401 而非 400） | 4 |
| ⑤ | **越权·能力不足**：同端点只换角色（403 / `isError` / `failed`）+ **越权响应不含夹具数据** | 8 |
| ⑥ | **越权·跨租户**：`organizationId` 指向非成员群 ⇒ REST / MCP / A2A 全拒 | 3 |
| ⑦ | **协议健壮性**：-32700 / -32600 / -32601 / -32602 / 404 / 400 各归其位 | 6 |
| ⑧ | **失败路径不泄漏内部细节**（无 SQLite / prisma / 绝对路径 / env 回显 / 堆栈） | 5 |
| ⑨ | **交付铁律「外部示例可运行」**：实跑 `examples/sdk/` 四个脚本 | 4 |

### 几条值得单独说的断言

**① 「协作」断言的是真实数据，不是"空列表也算成功"**：
三种面都断言返回体里**含夹具 Mission 的 id**（`total=1 命中=true`）。
否则"200 + 空列表"同样能由"功能未实现"产生 —— 那是最危险的一类假绿。

**② 「越权响应不含夹具数据」**：
MEMBER 调 `list_missions` 被拒后，响应文本里**不得出现** `mission_ac22_a`
（MCP 与 A2A 各断言一次）。这道防线拦的是"先查出来再过滤" ——
那种实现会让数据**离开数据库边界**（进过内存、可能进过日志/缓存）。

**③ 「越权·无会话」的 POST 必须 401 而不是 400**：
若顺序反了，请求体会先被校验 —— 意味着**未认证的输入被用来驱动逻辑**，
而且错误信息会把"这个端点需要哪些字段"泄漏给未认证方。

**④ 「OWNER POST ⇒ 400 而非 403」这条对照**：
它同时证明两件事：
(a) 403 归属**能力判定**（不是路由恒拒）；
(b) 取证脚本**没有偷偷建数据** —— 因为刻意**不传** `Idempotency-Key`，
即使过了能力门槛也只会拿到 400，不会真的建出一份协议。

**⑤ ⑨ 段实跑四个示例**：
「外部示例可运行」是 T11 铁律的第一条，而"能跑"最容易**静默**失效
（信封形状变了、状态码改了、登录端点换了 ⇒ 示例里的断言写错，只会在读者去跑时才发现）。
所以这里用 **MEMBER** 账号实跑 —— 三组"越权"分支会**真的触发**，
等于把示例自身的越权断言也一并取证了。

---

## 4. 🔴 本轮踩到并修掉的两个真实缺陷

### 4.1 就绪判据把 **404 当成"就绪"**（假绿判据）

第一版 `waitForHttp()` 只要求「`fetch` 没抛」就返回 `ok`。第二次运行时，
dev server 因上一轮被 SIGTERM 组杀而留下**不完整的 Turbopack 路由清单**，
症状是**全站 404**（连 `/api/auth/login` 这种老路由都 404）。
旧判据判定「就绪」→ 失败被推迟到登录那一步，报出来的症状是
**"登录 404"**，指向完全错误的方向（看起来像认证坏了）。

**修法**：判据改为**必须 200**；失败时清 `.next` 重试一次
（把"环境残留"与"代码缺陷"分开：第二次仍 404 就是真问题，必须让人看见）。

**同类缺陷一并修**：`verify-ac19-bridge-e2e.mjs` 用了同一份 `waitForHttp` 与同一句
`ck('dev server 就绪（/api/health 可达）', devReady.ok, …)` —— 同一类假绿。
已把它也改成要求 `status === 200`。

> **通用规则（值得留在检查清单里）**：
> 探针的判据必须是**目标状态本身**，而不是"请求完成了"。
> `fetch` 成功只说明有人应答；404 也是应答。
> 与"返 200 ≠ 写成功"同源 —— 判据要落在**语义**上，不能落在**机制**上。

### 4.2 凭据审计漏掉**未跟踪的新文件**

`open-source-audit.mjs` 用 `git ls-files` 列文件 —— 也就是**只扫 index**。
新写的文件在 `git add` 之前**不在其中**。而"新写的文件"恰恰是最可能带进凭据的东西
（旧文件早被历次扫描覆盖过）。这会让审计给出**看起来通过、实际有盲区**的结论。

**修法**：改为 `git ls-files -z --cached --others --exclude-standard`
（`--others` 纳入未跟踪文件，`--exclude-standard` 仍排除 `.gitignore` 覆盖的产物）。
扫描文件数 **1463 → 1489**，即本次新增的未跟踪文件确实进入了扫描范围。

---

## 5. 门禁证据

```
npm run verify:ac22:open-sdk        → 57 通过 / 0 失败，exit 0
npm run check:openapi-contract      → 5 项断言全绿
npm run audit:open-source           → 5 项全绿（1489 文件扫描；2 处夹具假值降级为提示）
npm run check:script-decls          → 80 脚本 / 0 未声明引用
npx jest tests/mcp tests/a2a        → 47 passed（25 + 22）
npx jest                            → 见提交前门禁记录
npx tsc --noEmit                    → exit 0
npx eslint <本轮改动路径>            → exit 0
```

---

## 6. 未覆盖 / 诚实声明

1. **不是合规 A2A / MCP 实现**：见 `slice-2.md` §8 与 `slice-3.md` §6。
2. **示例的"协作"全部是只读操作**：写工具（`report_outcome`）需要真实 `proposalId`，
   在隔离库里只能得到 400。因此**不虚报**写入链路端到端打通。
3. **不覆盖渲染层**：本脚本的判据是 HTTP 合约，**没有**浏览器。渲染归 AC-18 七屏取证。
4. **`organizationId` 跨租户只验了"非成员群"这一种**：没有覆盖
   「曾经是成员、后来被移除」「租户被 SUSPENDED」等分支 ——
   那些属 T01 的隔离负测范围（`tests/tenancy`），不在本任务内重复。
5. **配额/限流未覆盖**：MCP / A2A 端点目前**没有**独立的速率限制。
   这是一条**已知缺口**，不在 T11 的验收口径内，但应当在 T12 的负载项里被看见。
