# T09 · Agent Runtime —— Slice 3 交付记录（真实 Provider + 成本对账 + 对抗/预算夹具）

> 计划见同目录 `plan.md`；Slice 1（纯内核）见 `slice-1.md`；Slice 2（持久化 + HTTP + 审批）见 `slice-2.md`。
> 本文件只记录**已交付事实 + 证据 + 诚实修订**。
> 范围：`src/lib/agent/provider.ts`（改）、`src/lib/agents/provider-openai.ts`（新）、
> `src/lib/agents/runs.ts`（改）、`scripts/check-agent-invariants.mjs`（改，+A5）、
> `scripts/qa/{seed-t09-agent.mts, emit-agent-usage.mts, agent-reconcile.mjs}`（新）、
> `tests/agents/{provider-openai, adversarial-injection, budget}.test.ts`（新）。
> **不发版**：提交带 `[skip netlify]`，仅在本地与隔离库验证。

## 1. 交付物

| 文件 | 职责 | 关键设计 |
|---|---|---|
| `src/lib/agent/provider.ts`（改） | 内核：Provider **接口** + **纯环境解码** | 🔴 **移除** `resolveProvider()`（它是个"永远不可用"的占位），改为纯函数 `resolveProviderConfig(env)`：认哪个键、默认模型、超时上限 —— **判据只有一处**。真实 HTTP 实现**移出内核**（见下）。另加 `OPENAI_DEFAULTS`（默认模型/端点/超时/超时上限）与 `OpenAIConfig` |
| `src/lib/agents/provider-openai.ts`（新） | 服务层：真实 `OpenAIProvider` | `createOpenAIProvider()`（可注入 `fetchImpl` ⇒ 请求体逐字可断言）+ `resolveRuntimeProvider()`（生产路径唯一入口）。**失败映射分开**：401/403→`PROVIDER_UNAVAILABLE`、408/504→`PROVIDER_TIMEOUT`、其余→`PROVIDER_ERROR`。🔴 **缺 usage 即拒绝**（记 0 是账本少算，不是免费）；**`finish_reason=length` 即拒绝**（半截 JSON 不是"短一点的产出"）；**不传 `response_format`**（兼容端点）；非 http(s) 端点直接拒绝（否则"调用模型"变成一次本地读取）。另出 `providerHonesty(env)` 诚实块 |
| `src/lib/agents/runs.ts`（改） | 服务层：调用点 | 改走 `resolveRuntimeProvider(process.env)`；`AgentUsageDto` 新增 `provider` 诚实块；`createAgentRun` / `agentUsage` 新增 **`quota` / `price` 注入点**（见 §5「为什么必须注入」） |
| `scripts/check-agent-invariants.mjs`（改） | 门禁：**新增 A5** | 🔴 内核**不得出现网络调用**（`fetch` / `XMLHttpRequest` / `node:http(s)` / `undici` / `axios` / `node-fetch` / `got` / `ky`）。这是"内核纯净"从**口号**变回**可执行性质**的关键一步：A2 只挡数据库，挡不住网络 |
| `scripts/qa/seed-t09-agent.mts`（新） | 夹具（AC-20） | 🔴 **行不手写，走真实服务路径**（`createAgentRun` / `decideAgentRun`）—— 手写 INSERT 只能证明"我写的两行自洽"。9 条运行覆盖 7 种状态（含 `BLOCKED_QUOTA` 的**零调用**与一条 `ok=false` 的失败调用），另有 1 条**跨期噪声**证明期次过滤承重 |
| `scripts/qa/emit-agent-usage.mts`（新） | 取证器（AC-20） | 输出 `{ usage, runs[] }` **两段**：汇总只能证明"总数对得上"，逐次明细才证明"每一条调用的 token→金额 推导对得上"。service / http 双模式；**只读**，不写库 |
| `scripts/qa/agent-reconcile.mjs`（新） | 对账（AC-20） | 用**原始表 SQL** 独立复算：逐次归因（token × **响应下发的单价**）、冗余列 `costMicroCents` vs `SUM(AgentCall)`、状态↔裁决一致、汇总/分组/状态分布、**双向字段集**、诚实条款；**变异自证 15/15** |
| `tests/agents/provider-openai.test.ts`（新，32 例） | 真实 Provider | 请求体逐字、7 种 HTTP 状态映射、缺 usage/截断/空 content 拒绝、网络异常与超时可区分、**凭据只出现在鉴权头**、`openai`→DB 枚举 `OPENAI` 端到端 |
| `tests/agents/adversarial-injection.test.ts`（新，26 例） | 对抗夹具（AC-08） | 闭合标签逃逸 ×6 种写法（含零宽断字）+ 注入语料 ×8 + 权限/披露/审批三组"行为不变"断言，**每组的负向对照都写出来** |
| `tests/agents/budget.test.ts`（新，21 例） | 预算夹具（AC-20） | 判据与**边界**（额度 `>` 才拒 / 次数 `>=` 即停，两条**刻意不同**）、零调用自证、账本来源 A/B 对照、期次过滤承重、单价承重 |

## 2. 门禁证据（2026-10-13）

| 命令 | 结果 |
|---|---|
| `npx jest tests/agents` | **8 套 / 135 用例全通过**（较 Slice 2 的 5 套 56 例 **+3 套 +79 例**） |
| `npx jest`（全量） | **76 套 / 1456 用例全通过**（Slice 2 时 73 套 / 1377） |
| `npx tsc --noEmit` | **exit 0**（0 error；2m27s） |
| ESLint（**目录级**：`src/lib/agent` · `src/lib/agents` · `tests/agents`） | **0 error / 0 warning** |
| `npm run check:agent-invariants` | **通过**（扫 8 文件；新增 **A5**） |
| `npm run verify:agent-invariants` | **通过**（**A1–A5** 变异各被捕获 `exit=1`；负向对照未误报；收尾复验 `exit=0`） |
| `npm run check:ui-invariants` | 通过（R1–R7） |
| `npm run check:script-decls` | 通过（**66** 脚本 / 0 未声明引用；较 Slice 2 的 64 **+2**） |
| 隔离库端到端对账（`file:/tmp/t09-agent.db`） | `seed-t02-e2e --reset --regenerate`（58 表）→ `agent:seed` → `agent:emit` → `agent:reconcile`：**对账 187 通过 / 0 不一致 · 变异自证 15/15 · exit 0** |

### 夹具的实测期望值（对账逐项核对过）

```
r1 COORDINATION_ADVICE  PROPOSED          调用 1  4,500 微分
r2 INTRO_DRAFT          AWAITING_APPROVAL 调用 1  109,500
r3 INTENT_EXTRACTION    DEGRADED（规则式） 调用 1  0
r4 COORDINATION_ADVICE  FAILED（越界产出） 调用 1  9,435
r5 INTRO_DRAFT          BLOCKED_QUOTA     调用 0   ← AC-20 的"调用前判定"被真跑出来
r6 INTRO_DRAFT          APPROVED          调用 1  81,000
r7 INTRO_DRAFT          REJECTED          调用 1  57,000
r9 COORDINATION_ADVICE  FAILED（提供方报错）调用 1  ok=false（失败也入账）
r8（上个月，跨期噪声）    PROPOSED          调用 1  3,465（不计入本期）
本期 calls=7 · ok=6 · **failed=1** · highCost=3 · microCents=261,435
```

## 3. 本轮**抓到**的问题（写在最前面，因为它比"全绿"更有信息量）

### 3.1 🔴 对账脚本的"诚实块"断言是**恒真**的（由变异自证抓出）

首版 `agent-reconcile.mjs` 对 `usage.provider.realCallsEnabled` 只有一条断言：
「`false` ⇒ 本期不得有 `OPENAI` 调用行」。它看起来是对的 —— 而且**干净跑时是绿的**。
但变异自证把 `realCallsEnabled` 由 `false` 改成 `true` 后，**断言毫无反应**：
前提不成立了，条件式断言自动为真。**15 个变异里唯一漏网的就是这条。**

⇒ 修法：对账**必须知道期望值**，而不是只做条件式检查。新增
`--expect-real-calls=0|1`（service 模式默认从**本进程 env** 推断；http 模式必须显式给出，
因为本进程 env 与目标环境无关 —— **不许猜**）。改完后该变异被抓到（1 项不一致）。

**通用教训（值得记进「常踩的坑」）：**
> **「A ⇒ B」形式的断言，必须有人测 `not A`**。否则它只挡了一半，而漏掉的那一半
> （把前提改掉）恰恰是**攻击者最省力的一步**。这也正是"变异自证"的价值：
> 它不检查代码对不对，它检查**断言有没有牙齿**。

### 3.2 🔴 服务层预算是按**技能的 costProfile 预估**判定的，不是按"上次实际花了多少"

写预算测试时第一版把额度设成"一次调用的实际成本（4,500）+ 1,000"，
结果**该通过的那一例也被拒了**。真因：`checkQuota` 用的是技能声明的
`costProfile`（`COORDINATION_ADVICE` = 2,000/900 token ⇒ **84,000** 微分），
而夹具里的 stub 只回报 100/50 token。两者**差一个数量级**。

这不是 bug，但**极易被误读**（"额度明明够，为什么不给跑"）。
⇒ 处置：把这条差异**显式钉成断言**（`ADVICE_ESTIMATE === 84_000`、`> ADVICE_COST`），
并在测试注释里写明"别把预估与实际混为一谈"。额度注入点也因此必须以**预估值**为杠杆。

### 3.3 🔴 只删主体数据、忘了删**幂等索引** → 重放时目标不存在

`seed-t09-agent.mts` 首版只删 `AgentRun`（靠 `dedupeKey` 前缀），
第二次运行直接抛 `Idempotent replay target no longer exists` ——
`withIdempotency` 命中旧键后去 `load` 目标，而目标已被删掉。
⇒ 修法：清理必须**连 `IdempotencyRecord` 一起删**（同租户 + `scope='agent.run'` + 同前缀）。
**通用教训：先删数据再重建时，别忘了它旁边的索引/记录 —— 只删主体是"半个清理"。**

### 3.4 两处**断言写错**（不是代码错）

1. 对抗测试里断言"包裹后的整段文本不出现 `</untrusted_data>`" —— 而包裹器**本来就**以它结尾。
   正确的判据是"像闭合分隔符的东西**只有包裹器那一个**"（改为宽容计数 `closeLikeCount`）。
2. 闭合标签的**负向对照**首版用精确字面量计数，于是大写/空格/零宽三种变体会让对照**假通过**。
   改为"归一化（去零宽）+ 大小写/空白宽容"的正则计数，三种变体才真的构成对照。

⇒ 两条属同一类：**断言写得太"字面"，就会在变体上失真**。

## 4. 结构性保证（AC-08 / AC-20 逐条落点）

| 要求 | 落点（**可执行**的判据，不是约定） |
|---|---|
| 注入不得**闭合标签逃逸** | `guard.escapeUntrusted()`：**转义**而非模式匹配 ⇒ 对没见过的写法也成立；6 种变体（含零宽）逐一断言"分隔符恰好一对" + 未转义原文的**负向对照** |
| 注入不得**改变权限** | ① 模型输出只能是 `zod.strictObject` 通过的对象 ⇒ 夹带 `capabilities`/`role` 等字段**直接拒绝**；② 授权集合是**服务端入参**、进**可信**指令，不进不可信区（有断言）；③ 检测器只**升级**审批，从不降门槛、从**不阻断**（阻断是结构的活） |
| 注入不得**泄露资料** | `usedFieldKeys ⊆ allowedFieldKeys`、`candidateIds ⊆ allowedCandidateIds`，越界**拒绝（不截断）**；攻击目标（"顺便把邮箱也写进去"）不能扩大授权集合 |
| 注入不得**绕过审批** | `AWAITING_APPROVAL → EXECUTED` **边不存在**；服务层无任何写入 `EXECUTED` 的点（`execution.available` 恒 `false`）；改判 409；`PROPOSED → APPROVED` 也禁止 |
| 成本**每次可归因** | 逐条 SQL 复算（token × **响应下发的单价**），**开价假设改一下必须让结果变**（变异自证：改单价 → 7 项不一致） |
| 限额**触发即停高成本任务** | 判定在**调用之前**（`BLOCKED_QUOTA` 时 provider **零调用**，夹具里真跑出来）；颗粒度正确（只停高成本，低风险仍可跑）；账本来自**本期已发生调用**（A/B 对照 + 期次过滤承重） |
| 内核**无网络** | 门禁 **A5**（`fetch` 等一律命中，含 `typeof fetch` 这类类型引用 —— 保守取严） |

## 5. 为什么必须给 `createAgentRun` 加 `quota` / `price` 注入点

不加的话，"限额触发 → 拒绝且零调用"这件事**无法端到端测**：
默认额度是 500 分 ≈ **11 万次调用**，要触发得先灌 11 万条账。
于是"限额生效"就只剩"读代码相信它"这一条路 —— 而本仓的纪律是**判据要能跑**。

注入点带来两件事：
1. 夹具能在**真实服务路径**上跑出 `BLOCKED_QUOTA`（r5，零调用，实测）；
2. `agentUsage` 也接受同一份 `quota`，**下发的额度与执行时用的是同一份对象**
   （否则会出现"报 500 分、按另一个数判"这种没人会发现的不一致）。

⚠️ **缺的是"配置从哪来"（组织级真实额度），不是"配置能不能生效"。** 生产路径两侧
仍同为 `DEFAULT_QUOTA` / `DEFAULT_PRICE_TABLE` 这两个**占位假设**，且假设随响应下发。

## 6. 🔴 未覆盖 / 诚实声明

1. **真实端点连通性未取证**：沙箱探不了外部网络（本仓既有结论）。所有用例注入 `fetchImpl`，
   因此**没有**任何一个用例证明"`api.openai.com` 真的能打通"。这条要等真机/带凭据环境，
   登记为**发版前必验**（与 Creem 支付同一栏）。
2. **真实模型产物质量未取证**：技能能否拿到合规 JSON，取决于真实模型；本切片验证的是
   **契约与降级**，不是"模型好不好用"。
3. **组织级真实额度配置仍未接线**（注入点已在，来源未定）。
4. **执行器仍不可达**：`EXECUTED` 无写入点（`execution.available` 恒 `false`）——
   执行要先接 T05 披露出口 / T06 投递出口。
5. **AC-03 的另两条下游仍未接线**（向量索引、Agent 上下文）：Agent 上下文目前**只进标签、
   不进档案数据**（`runSkill` 的注释里已写明），所以"披露唯一出口"这条铁律**尚未被真正使用**，
   接线时必须经 `discloseSubject()`。
6. **对账脚本的 `[2]` 段与 `cost.ts` 同形**：它验证的是"表里的 token 列与金额列自洽、
   且与响应一致"，**不是**"重新发明一套定价"。定价合理性由**响应下发的假设**承担
   （并由变异自证证明"改假设必须让结果变"）。
7. **`A5` 是文本级检查**：它不区分"调用 `fetch`"与"类型引用 `typeof fetch`"（保守取严）。
   若将来内核确有必要提到它，应当**重新讨论边界**，而不是放宽规则。

## 7. 回滚

- `provider-openai.ts` / 三个 QA 脚本 / 三个测试套件都是**纯新增文件** ⇒ 删除即回滚。
- `provider.ts` 的改动是"移除一个永远 `unavailable` 的占位函数 + 新增纯函数"：
  回滚 = 恢复 `resolveProvider()` 并让 `runs.ts` 改回调用它。
- `runs.ts` 的 `quota`/`price` 注入点是**可选参数**，不传即原行为 ⇒ 回滚风险为零。
- **无 schema 变更**（`prisma/` 零改动）⇒ 不涉及迁移与数据。
