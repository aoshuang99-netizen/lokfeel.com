# T09 · Agent Runtime —— Slice 6 交付记录（对外送达 + 生产侧连通性入口 + 对账端到端）

> 计划见同目录 `plan.md`；Slice 1–5 见 `slice-1.md` … `slice-5.md`。
> 本文件只记录**已交付事实 + 证据 + 诚实修订**。
> **不发版**：提交带 `[skip netlify]`，仅在本地、隔离库与真实浏览器上验证。

范围（用户点选的三项，一次做完）：

- ① **对外送达**：`src/lib/agent/execution.ts`（重写）、`src/lib/agents/delivery-target.ts`（新）、
  `src/lib/agents/dto.ts`（改）、`src/lib/agents/runs.ts`（改）、`src/lib/agents/executor.ts`（改）、
  `src/app/api/v1/agents/runs/route.ts`（改）、`prisma/schema/agent.prisma` + `tenancy.prisma`（改，C8）、
  `scripts/connection/migrate.mjs`（改，C8 批次）、`src/generated/*`（`prisma generate` 产物）、
  `tests/agent/execution.test.ts`（改）、`tests/agents/outbound-delivery.test.ts`（新）、
  `tests/agents/execution-gated.test.ts`（改）、`tests/agents/_fake-db.ts`（改）、
  `scripts/qa/agent-reconcile.mjs`（改，字段集 +1）
- ② **生产侧连通性复验入口**：`src/lib/agents/connectivity.ts`（新）、
  `src/app/api/v1/agents/diagnostics/connectivity/route.ts`（新）、
  `tests/agents/connectivity.test.ts`（新）、
  `scripts/qa/verify-agent-connectivity-server.mjs`（新）、`package.json`（改，+npm script）
- ③ **`agent-reconcile.mjs` 端到端实跑**（隔离库全链路，见 §5）

---

## 1. 本切片解决的问题

Slice 5 收尾时列出的三处「仍未闭合」，每一处都是"看起来做完了、其实差最后一根线"：

| 缺口 | 未闭合时的实际状态 | 危害 |
|---|---|---|
| ① 对外送达 | `ExecutionPlan.recipient` 是**字面量** `'REQUESTER'`，介绍草稿只发给发起人自己 | 「把 A 介绍给 B」这个功能**不存在** —— 只产生一封写给自己看的回执 |
| ② 生产侧连通性 | 只有**本机**探针，且 2026-10-15 实跑已证明"本机 ≠ 生产"（本机走代理才通、生产是直连） | 发版前**没有人能回答**"生产到底能不能到模型端点"，只能靠猜 |
| ③ 对账端到端 | `agent-reconcile.mjs` 从未对着**真实库**跑过（只跑过单测级的假库） | SQL 对账这一路的 SQL 可能整体写错而无人发现（"永远通过"与"正确"长相一样） |

---

## 2. 🔴 两道门的分工（本片的核心设计）

`planExecution()` 与 `planOutboundDelivery()` **都是纯函数、都在 `execution.ts`、都不查库**，
但回答的是**两个不同的问题**：

| 门 | 问题 | 判据 |
|---|---|---|
| ① `planExecution()` | **动作**能不能发生 | 技能注册了执行器 / 状态机允许 / 库里**真的**有 `APPROVED` 裁决 |
| ② `planOutboundDelivery()` | **送到目标**这一步能不能发生 | 目标身份存在 / 创建时授权非空 / 执行时授权**仍覆盖**创建时快照 |

🔴 **为什么合成一个函数是错的**：那会把「网络/披露/权限」三类完全不同的失败压成同一个现象，
出问题时说不清该修哪一侧 —— 与 Slice 5 探针把"路由没走对"报成"端点不可达"是同一类错误。

**拒绝码刻意分开列**（`EXECUTION_REFUSAL_CODES` / `OUTBOUND_REFUSAL_CODES`）：
前者是"这条运行能不能跑"，后者是"跑完之后能不能送到"。UI 需要区分
**"还要等批准"与"授权已撤回，需重新发起"** —— 那是两种不同的处置动作。
但 DTO 只有一个 `execution.code` 字段 ⇒ 对外形状合并为 `EXECUTION_GATE_CODES`（取值域 = 并集）。

第二道门只会让第一道门的放行**更严**（`recipient === 'REQUESTER'` 时恒放行 —— 给它加闸门
只会制造一个永远为真的条件，那是装饰而不是判据）。

---

## 3. ① 对外送达：身份在**创建时**固定，依据在**执行时**复验

### 3.1 两个必须由服务端回答、且必须在**不同时刻**回答的问题

```
创建时：目标是谁？      → resolveDeliveryTarget()  → 落库 AgentDeliveryTarget（被那次批准覆盖）
执行时：凭什么还能发？  → loadOutboundGate()       → 用**当时**的披露表复验（T05「撤销即刻生效」）
```

若在执行时才由调用方传入收件人，就等于允许「**批准的是 A、发出去的是 B**」—— 审批退化成橡皮图章。
所以目标身份在**另一个时刻**（创建）落库，执行时只**复验**。

### 3.2 创建侧的四道校验（全部在服务端，`targetUserId` / `intentId` 属不可信输入）

| # | 校验 | 挡住的错 |
|---|---|---|
| ① | 技能的执行计划必须 `recipient === 'TARGET'` | 否则"给任意技能挂一个收件人"就成了**通用后门** |
| ② | 目标不能是发起人自己 | 自己给自己发"介绍"是配置错误，不是业务动作 |
| ③ | 目标必须与该意图**同任务**且 `status: 'INTERESTED'` | 跨任务越界送达 / 已退出的人还能收到 |
| ④ | 意图**当前**对该受众披露了至少一个字段 | 没有可送达的介绍内容 |

⚠️ ③ 的 `where` 条件写在一起（不是"先查 id 再断言 userId"）—— 后者漏一次断言就是一次越权引用。

### 3.3 送达的**通知体里没有档案字段**（刻意的，不是遗漏）

T06 立下的纪律不变：通知是"有事在等你"，披露的唯一出口是页面上的 `discloseSubject()` 投影。
因此第二道门守的**不是**"通知体里有没有敏感词"，而是**送达这件事本身的前提**：
创建时存在对该受众非空的披露授权，且**执行时这份授权仍然覆盖创建时快照的那批字段**。
授权被撤销/收窄后仍以发起人名义去敲门 = 用一次已失效的授权替人代言。

### 3.4 落库为什么是**独立一张表**（`AgentDeliveryTarget`）而不是 `AgentRun` 上加一列

本仓迁移机制**只支持 `CREATE TABLE/INDEX IF NOT EXISTS`**（无 `ALTER`），加列会破"纯新增"纪律。
独立成表顺带拿到 `@@unique([runId])` 的**库级**保证（一条运行最多一个送达目标）。

落库与运行**同一个嵌套 `create`**（原子）：否则会出现"运行有了、目标没落"的中间态，
而那种运行**永远执行不了**。

### 3.5 服务端注入授权集合，**不采信**请求体

创建路径把 `resolved.authorizedFieldKeys`（T05 当刻读数）覆盖进 `input.allowedFieldKeys` ——
否则"模型能用哪些字段"就变成请求体的一个字段。用 `canInject` 守卫只在输入契约**有**该位置时注入
（其余技能的输入是 `strictObject`，多一个键会被 400）。
`tests/agents/outbound-delivery.test.ts` 用一个**哨兵字符串**证明注入生效：
把调用方传的 `['SENTINEL_CALLER_SUPPLIED_MUST_BE_IGNORED']` 换成 `['bio']`，
并从**模型真正收到的请求**里断言"含 bio、不含哨兵"。

### 3.6 `delivery` 进**请求指纹**（`requestHash`）

同一把幂等键配"送给 A"与"送给 B"是**两件事** —— 唯一约束只能保证"不重复"，
保证不了"同一把键没被复用于另一个意图"。

### 3.7 DTO 的 `viewer.outbound` 缺省 = **拒绝**

`executionOf()` 从 `viewer.outbound` 取数；未传会被读成"没有目标" ⇒ 不可执行。
**默认拒绝是刻意的**：忘传的后果是"按钮不可点"，而不是"点了一个会 403 的东西"。
`viewerOf()` 里用 `...(outbound ? { outbound } : {})` 显式区分 `undefined`（这条运行没有对外送达这一步）
与"空闸门"（要送但没目标）—— 两者是**不同**的事。

---

## 4. ② 生产侧连通性复验入口

### 4.1 为什么必须在**应用里**再做一个探针

`verify-agent-connectivity.mts` 证的是**跑它的那台机器**能不能出去。2026-10-15 实跑已证明
两者可以完全相反：本机直连超时、走本机代理才 401；而生产（Netlify 函数）是**直连**出口。
⇒ "本机验绿"**推不出**"生产能到"。

于是把同一套分层报告做进应用：部署后由管理员打一次
`GET /api/v1/agents/diagnostics/connectivity`（能力 `agent.execute`，OPERATOR+），
拿到的就是**生产出口**的真实结论。

### 4.2 边界（写在路由文件头）

只读 / 不计费（只打 `GET {baseUrl}/models`，不是 `POST /chat/completions`）/ 不落库 /
**不泄漏 key**（报告里**只有 key 长度**）/ 要能力 / `no-store`。

### 4.3 🔴 本片修掉的一处**自相矛盾**（文件头与实现不一致）

`connectivity.ts` 的文件头写着「无 key 就裸请一次（401 + OpenAI 错误体证明网络与身份，凭据记 `BLOCKED`）」，
**但实现里这段是死代码**：`resolveProviderConfig(env)` 无 key 时直接 `ok:false` 提前返回，
三层全 `FAIL` 且**不发任何请求**。

后果：未配 key 的部署只拿到一句"配置不合法"（且被判成 `FAIL` 而不是"未判定"），
**无从知道出网到底通不通** —— 而"出口被墙"与"没配 key"是**两种病**，处置动作完全不同。

修法：目标 `baseUrl` 的确定分两路（有 key 走内核解析器；无 key 退化成"只用 `OPENAI_BASE_URL`
或内核默认值"，**但仍过 http(s) 校验**，防止手滑的 `file://` 变成一次本地读取），
然后**无论有没有 key 都探一次**：不带凭据的 401 就能把网络与身份两层定下来，凭据层如实记 `BLOCKED`。

### 4.4 🔴 单测抓出的第二处真实缺陷：身份层认不出"没带凭据"的措辞

身份层原本只认 `/missing bearer|incorrect api key|invalid api key/i`。
而**完全没带凭据**时 OpenAI 回的是：

```
You didn't provide an API key. You need to provide your API key in an Authorization header using Bearer auth...
```

—— **不匹配**。于是"无 key"这一**最常见**的部署状态会被判成"身份可疑（疑似门户页/中间人）"。
已收敛为一条 `OPENAI_AUTH_ERROR_RE`，并把已知两种措辞都写进注释；
单测同时加了**反向对照**（一个不是 OpenAI 措辞的 401 必须判可疑），确保这条正则不会宽到失去意义。

### 4.5 可复跑脚本

```bash
# 本机（跑脚本的机器）：
npm run verify:agent:connectivity

# 生产出口（**发版后必须做一次**）：
QA_BASE_URL=https://app.lokfeel.com npm run verify:agent:connectivity:server
```

`verify:agent:connectivity:server` 的判据（§5 有实跑口径）：

1. 匿名 → **401 + JSON**（路由已注册 + 能力闸门生效，不是"谁都能读的诊断面"）；
2. 真实登录路径（自定义端点 `/api/auth/login`）→ 带 cookie → **200**；
3. 报告**五段齐备**（`endpoint`/`network`/`identity`/`credentials`/`probe`）；
4. 🔴 **服务端自己算的 `summary` 与客户端按同一规则重算的一致**（报告不得自相矛盾）；
5. 🔴 **不泄漏密钥**（无 `sk-*` 形态串、无 `Bearer ` 明文）；
6. 🔴 **单调性**：凭据层 `PASS` ⇒ 网络层 `PASS`；无 key 时凭据层**不得**报 `PASS`；
7. 泄漏负测：任何响应不含部署专用域名 `--xxx.netlify.app`。

⚠️ 能力不足（403）记 **SKIP** 不记 `FAIL` —— 缺前提 ≠ 破坏（与两版连通性脚本同一口径）。

---

## 5. 门禁与证据

| 门禁 | 结果 |
|---|---|
| `tsc --noEmit` | **0 error** |
| jest（`tests/agent` + `tests/agents`） | **16 套 / 300 例 全过**（新增 `outbound-delivery.test.ts` 19 例 + `connectivity.test.ts` 16 例） |
| ESLint（`src/lib/agents` · `src/lib/agent` · `src/app/api/v1/agents` · `src/app/console/agents` · `tests/agents` · `tests/agent` · 新脚本） | **0/0** |
| `check:ui-invariants` | 通过（R1–R10） |
| `check:script-decls` | 扫描 **71** 个脚本，**0** 个未声明引用 |
| `check:agent-invariants` | 通过（A1–A5） |
| `verify:agent-invariants`（自证） | **A2/A3/A4/A5 变异全部被捕获**；清理后 exit=0 |
| `verify:ac18:console` | **84 通过 / 0 失败**（七屏口径保持） |
| `agent-reconcile`（**端到端实跑**，见下） | **对账 217 通过 / 0 不一致；变异自证 15/15** |

### 5.1 ③ 端到端实跑（隔离 libSQL 全链路）

```bash
E2E_DB_FILE=/tmp/t09-agent6.db node scripts/qa/seed-t02-e2e.mjs --reset --regenerate
# → ✅ schema 已建立（60 张表）  ← C8 的 AgentDeliveryTarget 由当前 schema 的完整 DDL 自动建出
AGENT_ORG_ID=org_e2e DATABASE_URL=file:/tmp/t09-agent6.db npx tsx scripts/qa/seed-t09-agent.mts
AGENT_ORG_ID=org_e2e DATABASE_URL=file:/tmp/t09-agent6.db npx tsx scripts/qa/emit-agent-usage.mts > /tmp/t09-agent6-api.json
AGENT_ORG_ID=org_e2e DATABASE_URL=file:/tmp/t09-agent6.db node scripts/qa/agent-reconcile.mjs --api=/tmp/t09-agent6-api.json
```

实跑输出（节选）：

```
✅ [2] 🔴 逐次调用归因全部对得上（复算 8 条，0 处不一致）  checked=8
✅ [3] totals.microCents = SUM(microCents 本期)  API=261435 SQL=261435
✅ [5] AgentRun DTO 必含字段齐备  keys=...,deliveryTarget,...
✅ [6] 🔴 AgentExecution 表存在（C7 迁移已应用 —— 缺表即代表部署不完整）  rows=0
[7] 变异自证（把载荷故意改坏，断言必须被抓到） → 15/15
✅ 对账通过：对账 217 通过 / 0 不一致；变异自证 15/15
```

🔴 这一步的价值正是"**SQL 侧独立于业务代码**"：对账脚本不 import 任何业务模块，
只把响应自己下发的单价与表里的原始 token 重算一遍。单测级的假库**证不了**这一路。

### 5.2 两条既有断言按**新语义重写**（不是删掉）

`INTRO_DRAFT` 从"内部回执"变成"送达对手方"⇒ 两处旧断言**必然变红**，本片同批更新：

| 位置 | 旧断言 | 新断言 |
|---|---|---|
| `tests/agent/execution.test.ts` | `expect(plan.recipient).toBe('REQUESTER')`（逐技能硬编码） | 穷举取值域 `EXECUTION_RECIPIENTS`（硬编码会让"多了一个合法成员"与"有人写错了字面量"变成同一个红） |
| 同上 | `expect(plan!.description).toContain('回执')` | 收件人是 `'TARGET'`，且描述同时说清"送给谁"与"**不含任何档案字段**" |
| `tests/agents/execution-gated.test.ts` | 介绍草稿的站内信 `userId === 'u_1'`（发起人） | `userId === 'u_target'`（**创建时固定的对手方**） |

同时 `execution-gated.test.ts` 的 `createIntro()` 补上 `delivery` —— 这是**新语义的正确后果**：
Slice 6 起介绍草稿**必须**有送达目标，否则那条运行永远执行不了（内核判 `NO_TARGET`）。

---

## 6. 变异 / 反向对照（自证断言有牙）

`tests/agents/outbound-delivery.test.ts` 的最后一组专门做这件事：

| 变异 | 期望 | 结果 |
|---|---|---|
| 把创建时的授权快照抹掉（`authorizedFieldKeys = null`） | 执行被拒 | ✅ 抓到（证明 `DISCLOSURE_EMPTY` 不是恒真） |
| 把目标行删掉 | 报 `NO_TARGET`（**而不是发给自己**） | ✅ 抓到 |
| 把披露**加宽**（对手方看到更多） | 仍应**放行**（这道门只拦"变窄"，不拦"变宽"） | ✅ 通过 |

`agent-reconcile.mjs` 的变异自证 **15/15** 全捕获（含"改单价""改 token""冗余列漂移"
"`available` 取反""注入禁用键"）。

---

## 7. 诚实边界

1. **送达的只是"通知"，不是档案内容**。站内信不含任何档案字段（T06 纪律不变）。
   本次介绍的具体内容仍在连接页经披露投影展示。
2. **`AgentDeliveryTarget` 只有软引用**（`targetUserId` / `intentId` 无 FK）——
   这是刻意的（跨域引用不该有硬 FK），代价是"目标用户被删"只能靠闸门侧保守拒绝兜住。
3. **`agent-reconcile` 的实跑仍是隔离库**（`file:/tmp/t09-agent6.db`），不是生产库。
   生产库的那次对账需要真实运行数据，属发版后动作。
4. **生产侧连通性交付的是"入口 + 可复跑脚本"，尚未在生产跑过** ——
   本片结束时仍**不得**宣称"生产出口已验"。发版后必须跑一次
   `npm run verify:agent:connectivity:server` 才算闭合。
5. **`EMAIL` 渠道仍未做**（`EXECUTION_CHANNELS` 只有 `IN_APP`）。
6. **Creem 支付生产不可用**（T08 既有，用户明确排除，本片未动）。

---

## 8. 回填

- 提交：`<见 BACKLOG 的 T09 行>`（`[skip netlify]`）；
- `verify:no-release` 实证最新部署未变 ⇒ 保持"**可发版未发版**"。
