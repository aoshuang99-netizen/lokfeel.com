# T09 · Agent Runtime —— Slice 5 交付记录（组织级额度 + 第 7 屏 Agents + 真实端点连通性）

> 计划见同目录 `plan.md`；Slice 1–4 见 `slice-1.md` … `slice-4.md`。
> 本文件只记录**已交付事实 + 证据 + 诚实修订**。
> **不发版**：提交带 `[skip netlify]`，仅在本地、隔离库与真实浏览器上验证。

范围：

- 组织级真实额度配置：`src/lib/billing/plans.ts`（改）、`src/lib/agents/quota.ts`（新）、
  `src/lib/agents/runs.ts`（改）、`src/lib/agents/index.ts`（改）、
  `tests/agents/_fake-db.ts`（改）、`tests/agents/org-quota.test.ts`（新）
- 第 7 屏 Agents：`src/app/console/agents/page.tsx`（新）、`src/app/console/console-shell.tsx`（改）、
  `src/lib/agents/dto.ts`（改）、`src/lib/agents/executor.ts`（改）、
  `tests/agents/approval-consistency.test.ts`（改，追加逐格交叉验证）、
  `scripts/qa/verify-ac18-console-e2e.mjs`（改，六屏 → 七屏）、
  `scripts/qa/agent-reconcile.mjs`（改，字段集 +2）
- 真实端点连通性：`scripts/qa/verify-agent-connectivity.mts`（新）、`package.json`（改，+npm script）

---

## 1. 本切片解决的问题

Slice 4 结束时，三处**接线仍然缺着**，且每一处都是"看起来能用、其实没接"的形态：

| 缺口 | 未接线时的实际状态 | 危害 |
|---|---|---|
| ① 组织级真实额度 | 内核里写死 `DEFAULT_QUOTA`（500 分 / 20 次），**与方案无关** | 花 **25 万** 的 `SCALE` 租户与免费租户拿到**同一个**额度 —— 界面显示的是**幻觉** |
| ② 第 7 屏 Agents | 导航项 `ready:false` 不可点 + 直访 **404** | AC-18「七屏」少一屏；Agent 全部能力**在界面上不可达** |
| ③ 真实端点连通性 | 只有"沙箱探不了外网"这条**结论**，没有**判据** | 发版前无人能回答"生产到底能不能到模型端点" |

三者的共性：**都是"外部世界"与"已交付内部实现"之间缺一根线**。本切片把它们接上，
并**每一条都配上可复跑的取证**（不是"我看了一眼，能用"）。

---

## 2. 交付物

| 文件 | 职责 | 关键设计 |
|---|---|---|
| `src/lib/billing/plans.ts`（改） | 额度的**唯一数值来源** | `PlanLimits` 新增 `agentMicroCentsPerMonth` / `agentHighCostCallsPerMonth`，**类型是 `number` 而非 `number \| null`** —— 花费上限**刻意不提供"无限"**：AC-20 要的是"停下来"，而 `JSON.stringify(Infinity) === 'null'` 会把"无限"在序列化时静默变成"没有额度" |
| `src/lib/agents/quota.ts`（新） | 接线层：**额度从哪来** | `agentQuotaOf(plan)` 纯函数（`PLAN_LIMITS` → `AgentQuota`）+ `resolveOrganizationAgentQuota(ctx)`（经 `getSubscriptionState` 派生）。文件头写明两条边界：① 数字**仍是占位假设**（本片接的是"额度从哪来"，不是"额度该是多少"）；② **本文件不做任何判定**，放行只由内核 `checkQuota()` 说 |
| `src/lib/agents/runs.ts`（改） | 服务层接入 | `createAgentRun` 的 `quota` 改为 `input.quota ?? (await resolveOrganizationAgentQuota(ctx)).quota`；`agentUsage` 增 `plan: EffectivePlan \| null`；🔴 **`decideAgentRun` 补上缺失的纵深防御**（见 §4） |
| `src/app/console/agents/page.tsx`（新，AC-18 第 7 屏） | 渲染层 | 额度面板（进度条 + 次数/花费/剩余 + 真实调用状态 + `assumptions.quota` 全文）+ 四个状态过滤 tab + 运行卡片。🔴 **动作按钮全部读服务端下发字段**（`run.canApprove` / `run.canReject` / `run.execution.available`）；三者皆 false 时**不渲染禁用按钮**，只渲染 `run.execution.reason` —— 前端**不重写状态机** |
| `src/lib/agents/dto.ts`（改） | DTO 投影 | 新增 `AgentRunViewer { canDecide?: boolean }`；`decidable = viewer.canDecide === true && !row.approval`；`canApprove = decidable && canTransition(status,'APPROVED')`。判据与 `decideAgentRun` 的 `assertTransition` **共用同一张真相表** |
| `scripts/qa/verify-agent-connectivity.mts`（新） | 连通性取证 | 三层**分离**报告：路由 / 网络 / 凭据。**不计费**（只打 `GET {baseUrl}/models`）。`baseUrl` 默认值**从内核 `OPENAI_DEFAULTS` 导入**，不抄第二份 |

---

## 3. 三个缺口各自的解法

### 3.1 ④ 组织级真实额度：做法是"接线"，不是"新造一张表"

派生链**单向、无环**：

```
BillingEvent（事件集，T08 Slice 3 已落地）
   └→ getSubscriptionState(ctx)        ← 既有纯内核，事件溯源
        └→ EffectivePlan（FREE/STARTER/GROWTH/SCALE）
             └→ planLimitsOf(plan)     ← src/lib/billing/plans.ts 的 PLAN_LIMITS
                  └→ agentQuotaOf(plan) → AgentQuota → 内核 checkQuota()
```

🔴 **刻意不新造第二张额度表**。任何"另一个地方也存一份额度"都会立刻产生
"两个事实来源谁说了算"的问题，而这类分歧**只在生产上以账单形式暴露**。

**行为保持（本片最重要的一条约束）**：`FREE` 档的两个数值被设成内核旧 `DEFAULT_QUOTA`
的**逐字副本**（`500 * 1e6` / `20`）。于是：

- `tests/agents/budget.test.ts`、`runs-service.test.ts`、`tests/living/agents/board.test.ts`
  **一个字都不用改**就全绿 —— 这本身就是"没改坏"的证据（回归面为零）；
- 新行为（换档 / 降级 / 承重）由**新增**的 `tests/agents/org-quota.test.ts`（13 例）覆盖。

`org-quota.test.ts` 四组：

1. **纯函数**：FREE 逐字等于 `DEFAULT_QUOTA` · 逐档递增 · 全档有限正整数 · 两列同源；
2. **服务层派生**：从未订阅 → `FREE`；订阅 `GROWTH` → 换档；**降级后额度立刻变小**；
3. **承重断言**：**同一份账本，仅因方案不同而由"拒绝"变为"放行"** —— 这是唯一能证明
   "额度真的来自方案"而不是"来自别的什么常量"的用例；
4. **注入路径不查订阅**：注入 `quota` 时零额外 IO 且 `plan === null`（A/B 对照：
   `not.toHaveBeenCalled()` vs 不注入时 `toHaveBeenCalled()`，防止"压根没走过派生"的假通过）。

🔴 **注入路径回填 `plan = null` 而不是假装 `FREE`**：若回填 `FREE`，界面会出现
"测试注入的额度被标成 FREE 档额度"这种**假陈述**。

🔴 `agentUsage` 的注入分支用**显式判断**而非非空断言：

```ts
// ✅ 显式分支：把"忘了传"变成编译期可查的东西
if (options.quota !== undefined) { … plan = null } else { … 派生 }
// ❌ 非空断言 organization!.quota —— 断言会把"改错"变成运行期崩溃，而不是编译期报错
```

### 3.2 ② 第 7 屏 Agents：**不重写状态机**是这一屏的设计核心

第 7 屏唯一容易做错的地方是"按钮该不该亮"。错误做法有两种，且**都是静默的**：

- 前端自己比 `status === 'APPROVED'` → 与服务端状态机**分叉**，某天服务端改了转移表，
  界面会稳定地显示一个**点不动的按钮**（AC-18 的 R2「无空按钮」正是要挡这个）；
- 前端拿角色算权限 → DTO 迟早长出**第二张权限表**，与 `capabilities.ts` 分叉。

所以本片把判据**整体推到服务端**：

```
canApprove = can(role,'agent.approve') × canTransition(status,'APPROVED') × !approval
canReject  = can(role,'agent.approve') × canTransition(status,'REJECTED') × !approval
```

- `canTransition` 与 `decideAgentRun` 内部用的 `assertTransition` 是**同一张真相表**；
- `AgentRunViewer` **故意只收一个布尔** `canDecide`，**不收** `TenantContext`/角色 ——
  它一旦收到角色，DTO 就获得了"再算一遍权限"的能力，分叉只是时间问题；
- 三者皆 false 时**不渲染禁用按钮**（渲染 `run.execution.reason`），从根上不给"空按钮"留位置。

**导航接线**：`console-shell.tsx` 的 `/console/agents` 由 `ready:false` + `reason` 改为

```ts
{ href: '/console/agents', label: '智能体', icon: Bot, ready: true, capability: 'agent.run' }
```

🔴 **读能力 gate 取 `agent.run`**（OPERATOR+），**不是** `agent.approve`（ADMIN+）——
"能不能进这一屏"与"能不能批"是两件事；若按后者 gate，运营就看不到自己发起的运行。

### 3.3 ③ 真实端点连通性：三层分离，且**"路由没走对"不能报成"端点坏了"**

`scripts/qa/verify-agent-connectivity.mts` 输出三段独立结论：

| 段 | 回答的问题 | 判据 |
|---|---|---|
| 路由 | 这台机器**经哪条路**能出去 | 逐条尝试：直连 / `QA_PROBE_PROXY` / `HTTPS_PROXY` / 项目已知本地代理 / 系统代理 |
| 网络 | 到达了一个 HTTP 响应吗 | DNS + TLS + HTTP 往返（收到任一状态码即成立） |
| 身份 | 通到的是**对的**端点吗 | 无凭据时必须是 **401 + OpenAI 形状的 error**（防门户页/中间人的 200 HTML） |
| 凭据 | key 被端点认吗 | 注入 `Authorization` 后同一 URL 得 200。**无 key ⇒ `BLOCKED`** |

🔴 **本片最有价值的一条，是首版脚本犯的错**：

首版只试 `--no-proxy-server` 一条路，跑出「api.openai.com **不可达**」。
但同一台机器上：

```
$ curl -x http://127.0.0.1:10808 -o /dev/null -w '%{http_code}' https://api.openai.com/v1/models
401          # 0.71s
$ curl --noproxy '*' ... https://api.openai.com/v1/models
000          # 12s 超时
```

**端点好得很，坏的是探针自己没走对路。** 把"路由没选对"报成"端点不可达"是
典型的**假红** —— 它会让人去改一个根本没坏的东西（改防火墙、找 OpenAI 要说法）。
所以第二版把**路由发现**提升为第一段，并把每条路的结果逐条列出：**那张表本身就是结论**。

同时**顺序也有讲究**：**直连放第一位**。生产（Netlify 函数）是直连，本机代理是
**本机特例**；若把本机代理放前面，本机验绿会让人误以为"生产也就通了" —— 那是假绿的
另一面。两种错法对称，都必须挡住。

**不计费**：只打 `GET {baseUrl}/models`（列模型），**不打** `POST /chat/completions`。
理由写在文件头：连通性取证不该花用户的钱，也不该在账本里留下一条"看起来像真实运行"
的痕迹（会污染 AC-20 的归因）。

**2026-10-15 本机实跑结果**（`npm run verify:agent:connectivity`，exit 0）：

```
[1] 出口路由发现
  ℹ️  [INFO] 直连（--no-proxy-server）                     → 未收到响应：超时
  ℹ️  [INFO] 环境变量 HTTPS_PROXY（http://127.0.0.1:50311） → 未收到响应：超时
  ✅ [PASS] 本项目已知本地代理（http://127.0.0.1:10808）     → 收到 HTTP 401 —— 这条路能出去
[2] 网络可达性  ✅ HTTP 401（经 127.0.0.1:10808）
[3] 端点身份    ✅ application/json · HTTP 401 · error.message = Missing bearer authentication in header
[4] 凭据可用性  ⛔ BLOCKED（未配置 OPENAI_API_KEY）
汇总：PASS 6 · FAIL 0 · BLOCKED 1 → 🟡 已判定项通过，但存在未判定项
```

🔴 **结论措辞就是纪律**：`BLOCKED ≠ PASS`。缺 key 时凭据侧**永远** `BLOCKED`，
不会因为"网络通了"就顺手报绿 —— 那是把前提当结论。
故本片**不得宣称"真实端点已验"**；只能说**网络侧与端点身份已实证、凭据侧未判定**。

---

## 4. 🔴 逐格交叉验证抓出的真实缺陷（本片最重要发现）

`tests/agents/approval-consistency.test.ts` 追加的交叉验证不是"复述实现"，而是
**遍历 `status × role × 有无裁决` 每一格**，断言：

```
dto.canApprove === "decideAgentRun 真的会成功"
```

它就抓出了一个**按钮看不出、只有服务层才暴露**的缺陷：

> `decideAgentRun` **没有**能力复判。`updateOrganization` / `executeAgentRun` 都有
> `can(ctx.role, …)`，唯独 `decideAgentRun` 只靠路由上的 `withTenant('agent.approve')`。

后果是：**OPERATOR 可以直接调用服务函数批准一条运行**，绕过「OPERATOR 能跑不能批」
这条 —— 而它是 **AC-08 的"双人复核"在制度层**的保证（Slice 2 明确记录过：
"同一人不能自我盖章是**制度层**保证而不仅是状态机保证"）。
路由的 `withTenant` 只挡 HTTP 入口；服务函数可被脚本 / cron 直接调用。

修法（`runs.ts`）：

```ts
if (!can(ctx.role, 'agent.approve')) {
  throw new ForbiddenError('当前角色不能裁决 Agent 运行（需要 agent.approve）', {
    capability: 'agent.approve', role: ctx.role,
  })
}
```

修毕后 **8 状态 × 2 角色 × 2 裁决态**逐格交叉验证通过。

**为什么先前没抓到**：既有断言测的是"状态机对不对"，而这处缺陷在**状态机之外**
（状态允许、权限不允许）。⇒ **通用教训：判据的"来源"与判据的"执行点"是两件事，
必须分别派断言。**

---

## 5. 门禁与证据

| 门禁 | 结果 |
|---|---|
| `tsc --noEmit` | **0 error**（3m0s；含新增 `.mts` —— 它在 `tsconfig.include` 的 `**/*.mts` 内，所以**必须**重跑） |
| jest（相关面：`tests/agent` + `tests/agents` + `tests/billing` + `tests/living`） | **24 套 / 518 例**，既有零失败 |
| jest（全量） | **87 套 / 1756 例 全过**（Slice 4 基线 86 套 / 1738 例 ⇒ **+1 套 +18 例** = `org-quota.test.ts` 13 例 + `approval-consistency.test.ts` 追加 5 例，**数字精确对上**） |
| 变异自证（额度派生） | **3/3 全部被捕获**（详见 §6） |
| ESLint（`src/lib/agents` · `src/lib/billing` · `tests/agents`） | **0/0** |
| ESLint（`src/lib/agents` · `src/lib/billing` · `src/app/console` · `tests/agents` · 新脚本） | **0/0** |
| `check:ui-invariants` | 通过（**首次纳入** `src/app/console/agents/page.tsx`） |
| `check:script-decls` | **70/0**（新增 `.mts` 不在该门禁扫描面内，由 `tsc` 覆盖） |
| `verify:ac18:console` | **84 通过 / 0 失败**（六屏 → 七屏口径） |
| `verify:agent:connectivity` | **PASS 6 · FAIL 0 · BLOCKED 1**，exit 0 |

`verify:ac18:console` 的关键改动（**断言是"替换"不是"删除"**）：

- `ZONES` 六屏 → 七屏（插入 `{ path: '/console/agents', h1: '智能体' }`）；
- (f) 段**方向反转**：由"必须存在一个不可点项"改为"导航里**没有**施工中/无权限项"。
  旧断言在接线后**恒假** —— 留着它，它就从判据退化成**阻碍接线**；
  R4（`ready:false` 必须写 reason）由 `check:ui-invariants` 静态覆盖，故反转**不丢覆盖**；
- 第 7 屏整段改为"已实现"举证：`head` 非 404 + `h1 === '智能体'` + 导航项是 `<a>` +
  **现场 POST 造一条 `COORDINATION_ADVICE` 运行**（低风险 ⇒ `execution.available=true`）+
  断言渲染出「执行」按钮。

实跑输出（节选）：

```
── ② 第 7 屏 Agents：已实现 —— 可达、入口可点、动作按钮有真实来源
  ✅ 已实现的 /console/agents 可达（不是 404）  status=200
  ✅ 直访 /console/agents 打开的是 Agent 屏（不是 404 兜底页）  h1=「智能体」
  ✅ 导航里的「智能体」是可点链接（不再是"施工中"的 span）
  ✅ 能造出一条 Agent 运行（POST /api/v1/agents/runs → 201）
  ✅ 刚造出的运行被真正渲染出来（服务端数据 → 屏）
  ✅ 该运行渲染出「执行」按钮（execution.available 由服务端下发，不是前端自算）
════════ AC-18 结果：84 通过 / 0 失败 ════════
```

`scripts/qa/agent-reconcile.mjs` 的 DTO 字段集断言补 `'canApprove'` / `'canReject'` ——
新增 DTO 字段若不同步到对账脚本的字段集，对账会**静默少校验**两个字段。

---

## 6. 变异自证：首轮漏掉一个（M2）

`org-quota` 的变异自证首轮结果：**M2 高成本次数不再来自方案（写死 20）没有被捕获**。

原因是当时的断言只验了 `maxMicroCents` 一路；两列"同源"这件事**没有任何断言在承重**。
补两条后 **3/3 全部捕获**：

- **结构性**：逐档 `quota.maxHighCostCalls === limits.agentHighCostCallsPerMonth`；
- **行为性**：`seedHighCostCalls(20)` 后 FREE **拒**，订阅 GROWTH 后**放行**。

还原后与变异前**逐字相同**。

⇒ 这正是变异自证的价值所在：它检查的不是"代码对不对"，而是**断言有没有牙齿**。
"两列同源"这种"看起来显然"的性质，恰恰是最容易只写在注释里、没有断言的地方。

---

## 7. 诚实边界

1. **额度数值仍是占位假设**。本片接的是"**额度从哪来**"（方案 → 额度），
   **不是**"额度该是多少"。`FREE` 档沿用旧常量，其余三档是**拍的数**。
   它们需要真实定价才谈得上正确；`assumptions.quota` 在**界面上原文下发**，不藏。
2. **凭据侧 `BLOCKED`**。无 `OPENAI_API_KEY` ⇒ 无法判定凭据可用性。
   ⚠️ 且**生产侧连通性必须在生产环境（或等价出口）重跑**本脚本才能认领 ——
   本机验绿只说明"本机经 127.0.0.1:10808 能到"，**不等于** Netlify 函数能到。
3. **真实扣款仍 `BLOCKED`**（T08 R1 既有，未变动）。
4. **对外送达仍未做**。`ExecutionPlan.recipient` 仍是字面量 `'REQUESTER'`，
   收件人恒为发起人。它需要 target 身份 + T05 的 `discloseSubject()` 出口，
   属下一片（用户本片**未点选**该项）。
5. **`agent-reconcile.mjs` 的端到端实跑**需真实库，本片未执行（脚本已同步字段集）。

---

## 8. 回填

- 提交：见 `BACKLOG.md` 末行（`[skip netlify]`）；
- `verify:no-release` 实证最新部署仍为 `f6630ea6b`（2026-10-13）⇒ 保持"**可发版未发版**"。
