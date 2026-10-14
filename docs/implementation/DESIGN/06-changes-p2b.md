# Living Connection OS — P2 · Slice 2（Consent Gate / Outcome Observatory / Agent 区）交付记录

> 阶段定义见 `02-plan.md` §P2。本文只记录**已交付的事实与证据**，不含计划。承 `05-changes-p2.md`。
>
> ⚠️ P2 共**四项**：① Field 升级为 2.5D 关系网络 ← `05-changes-p2.md`；
> ② Consent Gate 接逐字段披露投影；③ Outcome Observatory 时间轴；④ Agent 区 —— ②③④ 即**本文**。
> 至此 P2 四项**全部落地**（未发版），并已补 **HTTP 层端到端取证**（§9，`130/0`）。

## 1. 交付物

| 文件 | 状态 | 作用 |
|---|---|---|
| `src/lib/living/consent/types.ts` | 新 | 六组取值域镜像 + 6 条**编译期漂移守卫** + 出口类型 |
| `src/lib/living/consent/projection.ts` | 新 | 披露投影**装配器**（纯函数、零 IO）+ 提案板 + 动作请求 |
| `src/lib/living/consent/index.ts` | 新 | 出口（注释写明 R10 引用纪律） |
| `src/lib/living/observatory/types.ts` | 新 | 三组取值域镜像 + 3 条守卫 + 漏斗/成本**展示口径** |
| `src/lib/living/observatory/timeline.ts` | 新 | 时间轴 + 指标**装配器**（纯函数、零 IO） |
| `src/lib/living/observatory/index.ts` | 新 | 出口 |
| `src/lib/living/agents/types.ts` | 新 | 五组取值域镜像 + 5 条守卫 + 状态/风险/降级/Provider 文案 |
| `src/lib/living/agents/board.ts` | 新 | 运行面板 + 用量**装配器**（纯函数、零 IO）+ 裁决请求 |
| `src/lib/living/agents/index.ts` | 新 | 出口 |
| `src/components/living/living-states.tsx` | 新 | 共享四态部件（加载/读失败/空/说明）+ 操作结果条 |
| `src/components/living/use-living-post.ts` | 新 | 写操作统一出口（成功判据只有一条；错误文案**原文优先**） |
| `src/components/living/consent/consent-gate.tsx` | 新 | 逐字段披露表 + 提案板 + `ConsentInspector` |
| `src/components/living/observatory/outcome-observatory.tsx` | 新 | 指标面板 + 时间轴 + `ObservatoryInspector` |
| `src/components/living/agents/agent-board.tsx` | 新 | 运行面板 + 用量面板 + `AgentsInspector` |
| `src/app/workspace/living-workspace.tsx` | 改 | 三区接线（各一个 `enabled` 受控 hook）+ `inspector` 四分支；NAV 全 ready |
| `src/components/living/node-card.tsx` | 改 | 新增 `case 'agent'` 渲染（含 `provider` 诚实块） |
| `src/lib/workspace-spec/schema.ts` | 改 | 契约 **1.1 → 1.2**；`agent` 转入白名单；3 组镜像 + 3 条守卫；`AgentNodeSchema` |
| `src/lib/workspace-spec/assemble.ts` | 改 | 新增 `assembleAgentNode()`（缺 `provider` 诚实块 ⇒ **不产节点**） |
| `src/lib/workspace-spec/index.ts` | 改 | 导出 `AGENT_*` / `AgentNodeSchema` / `assembleAgentNode` |
| `scripts/check-ui-invariants.mjs` | 改 | **R6 由句法改语义**；**新增 R10**（客户端可达只能 `import type`） |
| `scripts/qa/verify-ui-invariants-mutation.mjs` | 改 | R6 变异体改写 + **R10 变异体**；负向对照含两类"像违规其实合法"的写法 |
| `tests/living/{consent,observatory,agents}/*.test.ts` | 新 | **6 套**（镜像回归 + 装配器全谱系） |
| `tests/workspace-spec/schema.test.ts` | 改 | 版本断言 1.2；`agent` 从"保留类型"用例改为"必须自带 runs + provider"用例 |
| `tests/workspace-spec/assemble.test.ts` | 改 | 补 `AGENT_STATES` / `AGENT_RISKS` / `AGENT_SKILLS` **三条硬编码回归**（镜像的"第二根柱子"，见 §8 #9） |
| `scripts/qa/verify-workspace-spec-drift.mjs` | 改 | ① 归因区间改取**首尾**守卫（148–153，原先被具名守卫钉死在 148–150）；② 补第 4 条 **agent 变异**；③ 加固：启动期锚点自检 + SIGINT/SIGTERM 还原后再退出（见 §8 #5 / #10） |
| `.gitignore` | 改 | 补 `tsconfig.drift-probe.json` + `__mutant-*`（自证脚本被中断时的残留，此前会被 `git add -A` 误提交） |
| `scripts/qa/verify-p2-workspace-e2e.mts` | 新 | **P2 端到端取证**（隔离库 + 真实 HTTP + 真实装配器，9 节）—— 披露逐字段投影 / 时间轴·指标 / 审批写路径（含两条 409 负向）/ 用量归因 / 契约 1.2 agent 节点装配（见 §9） |
| `scripts/qa/fake-openai-provider.mjs` | 新 | 本地**假模型端点**（OpenAI 兼容；按 `max_tokens` 路由技能，未知值 **400**）—— 让"批准成功"这条写路径**可复跑**（见 §9.1） |
| `src/lib/agent/runtime.ts` | 改 | 三处**用户可见** `reason` 文案去掉 markdown 强调标记（R9 只扫前端源码，扫不到**服务端下发**的文案，见 §8 #11） |
| `package.json` | 改 | 注册 `verify:p2:e2e` |

## 2. 三条纪律在本切片是**同一条**：不重算服务端派生值

三个区各自独立地踩到了同一个问题 —— **前端自己算一遍服务端的判据**。
三处都刻意不写，因为每一处的错法都是**静默**的（不报错，只是展示错的结论）：

| 区 | 服务端派生值 | 前端若重算会怎样 |
|---|---|---|
| Consent | 档位可见性（包含式 `rank(granted) >= rank(viewer)`） | 写反 ⇒ 用户看到"只授权给组织者的字段，候选也能看到" —— **静默越权展示** |
| Observatory | 「已验证」（`isVerified()` 是唯一实现） | 散落比较 `level === 'EXTERNALLY_VERIFIED'` ⇒ 日后加第四级时**静默漏算** |
| Agents | 「能不能批准」（`decideAgentRun` 才是判据） | 自己判 ⇒ 按钮被错误禁用（静默失效）或可用但必然 409（误导） |

Consent 侧还多做一步：前端**自证**服务端注释承诺的单调性不变量 `cand ⊆ cp ⊆ org`，
违反则产一条说明。理由是倒挂**不会**触发任何错误 —— 它只会让某个受众少看到（看不出来）
或反过来多看到（越权）。读服务端数据、同时断言它自洽，是这里唯一能做到的两件事。

## 3. 结构性不可授权 ≠ 用户没开（Consent 特有）

联系方式类字段在服务端 `disclosable: false`：它**既不在**任何受众分组，**也不在** `withheld`，
而是单列在 `protectedFields`。三者在界面上分开渲染，因为把前两者混为一谈会让用户以为
"只要我勾上就能披露邮箱" —— 而实际上那条路**结构上不存在**（任何写入请求一律 400）。

`ConsentGateTotals` 因此是五个数而不是两个：三个受众可见数 + `withheld` + `protectedFields`。

## 4. `consentPending` 不是漏斗的一级

服务端 `funnel` 里有 `consentPending`，但**不进入漏斗主线**：它是 `proposals` 的
**子集状态**（"还有多少条在等表态"）。插进主线会让漏斗看起来像"从提案掉到待表态"。

判据来自服务端自己：`rates` 恰好是 4 个键（`acceptedPerProposal` / `introducedPerAccepted` /
`outcomePerIntroduced` / `verifiedPerOutcome`），对应 5 级主线的 4 次相邻跳转。
`OBSERVATORY_FUNNEL_STAGES.length - 1 === OBSERVATORY_RATE_KEYS.length` 被单测钉住 ——
一旦有人把 `consentPending` 插进主线，这条等式立刻不成立。

## 5. Agent 区的诚实块**进契约**，而不是留给 UI 自由发挥

「跑了 3 次花 0 分」不是「模型免费」，而是「走的是规则式兜底（没有调用模型）」。
这两个读数在界面上必须能区分，所以它不是一句 UI 提示，而是**契约的一部分**：

- `AgentNodeSchema.data.provider = { realCallsEnabled, reason }` —— 让"能不能这么说"只有一个答案；
- `assembleAgentNode(items, provider)` 在 `provider === null` 时**拒绝产出节点**
  （宁可不画，也不画一个说不出话的节点）；
- 用量面板在 `!realCallsEnabled` 时用**警告色**并明写"下方「花费 0 分」不代表模型免费"；
- `execution.reason`（本切片恒 `available:false`）**原样展示** —— 它是"点了批准到底会发生什么"
  的唯一答案，概括成"不可用"就等于没有答案。

另有一条**不展示**纪律：列表形状（`AgentRunSummaryDto`）只有 `injectionFlagged` 布尔，
不含 `injectionSignals` 明细 ⇒ **不展示信号条数**（那是无从得知的数字，编 0 或 1 都是伪造）。
单测用 `expect('injectionCount' in row).toBe(false)` 把这条钉死。

## 6. 契约 1.1 → 1.2 与 R6 的改造方向

`NODE_TYPES` 是 `discriminatedUnion` 的**判别依据**，所以新增 `agent` 节点会让**旧前端整块拒绝**
（而不是忽略那一个节点）⇒ 版本号必须升，`1.1 → 1.2`。

`RESERVED_NODE_TYPES` 改回**空数组**（而不是删掉机制）：空数组使 `ReservedNodeType = never`、
`compile.ts` 的过滤恒不命中；保留机制的理由是它是现成的预留位出口 —— 删掉会让下一个需要
预留位的人**重新发明**一个大概率没人遵守的规则。

门禁 **R6 从"句法"改成"语义"**：判据从句法（"有没有写 `type: 'agent'`"）改为语义
（"有没有 `runs` 字段 = 真实端点数据来源"）。规则**变松**（禁止 → 有条件允许）是 T09 升级
带来的，不是标准降低 —— 所以判据必须落在数据来源上。正则 `/\bruns\b\s*[:,}]/` 同时接受
**简写**（`data: { runs, provider }`）与**显式赋值**（`runs: value`）两种写法（只认 `runs:`
会让最自然的简写写法被误判为"无源"）。

门禁 **新增 R10**：客户端可达的 Living 代码（`components/living` / `lib/living` / `app/workspace`）
**只能 `import type`** 服务端模块。值导入会把 Prisma / 租户守卫 / 网络拖进客户端 bundle ——
P1 的 `@/lib/connection` 桶文件一行 `import { X }` 就够。唯一放行 `@/lib/connection/field-catalog`
（零 import 的纯字段目录）。实现上必须**抓整条 import 语句**（跨多行）：逐行匹配会漏检
多行写法，而漏检的后果正是这条规则要防的那件事。

## 7. 金额换算：**不重写**，只保留一处本地表述

`living/agents/board.ts` 原本镜像了一份"整数微分 → 字符串"的实现，理由是"避免把服务端模块
拖进客户端"。写完单测（与内核逐值比对）后这个决定被**推翻**：

1. 镜像那份在 `999_999` 微分上会算出 `0.10000 分`（5 位小数）—— 内核给 `1.0000 分`。
   进位没处理，且只在末段微分区出现，肉眼极难发现；
2. 更重要的是**理由本身不成立**：`@/lib/agent`（**单数**）是零 IO 内核，
   复数 `@/lib/agents` 才是有 IO 的服务层。R10 只拦后者。

⇒ 改为直接复用内核 `formatMicroCents`，只保留一条**本地表述**：四舍五入到 4 位小数后为
`0.0000` 时显示 `0 分`（`|micro| < 50` 恰好等价于内核输出 `0.0000`）。
零成本是「规则式兜底」路径下最常见的读数，4 个零只会变成噪音；界面文案也依赖这个读法。
这条分歧由单测**显式钉住**，其余值逐值等于内核。

## 8. 本轮抓到的真问题（12 个）

| # | 问题 | 怎么发现的 | 处置 |
|---|---|---|---|
| 1 | 🐛 **时间轴把"无法解析的时间"排到了最前**：`timeOf` 返回 `+Infinity`，但时间轴是**降序**排的 —— 与注释声明的"排到末尾"相反 | 单测断言"不可解析的时间排在末尾"失败（实际输出 `['bad','good']`） | 改返回 `Number.NEGATIVE_INFINITY`；注释写明"必须是**负**无穷" |
| 2 | 🐛 **金额镜像的进位缺陷**（`999_999` → `0.10000 分`） | 写单测时决定"与内核逐值比对"，一比就暴露 | 推翻镜像，改为复用内核（§7） |
| 3 | 🐛 `data.gate` 在 `.map()` 回调内 `possibly null`（`TS18047` ×3）：TS 的控制流收窄**在闭包内失效**（属性访问可能已被改写） | `tsc` | 提到 `const gate = data.gate`，收窄对闭包持续有效 |
| 4 | ⚠️ **方法论**：变异自证与 `tsc` **并行**跑 ⇒ tsc 扫到自证脚本临时创建的 `__mutant-*` 文件又被删除 → `TS6053`（"假失败"） | 后台任务日志 | **自证类脚本不得与其他扫描型任务并行**（它往 `src/` 写文件）；独占重跑得 `0 error` |
| 5 | 🔴 **最值钱的一条：被中断的自证脚本会留下"就地半改"的源文件** —— 它看起来就是"我写的代码"，只有 `git diff` 能看出来 | 见下 | 见下 |
| 6 | 🐛 R9 命中 `board.ts` 的 note 模板串里的 `**过滤后**`（会渲染成星号） | `check:ui-invariants` | 去掉 `**`。这是**第 3 次**同类缺陷（前两次在 `05-changes-p2.md` §5），R9 第三次生效 |
| 7 | ESLint `react/no-unescaped-entities` ×2（JSX 文本里的直引号） | `eslint` | 改用中文书名号「…」 |
| 8 | **我自己把用例写废了一条**：测"对手方可见项超出组织者"时，用的键其实**在**组织者集合里 ⇒ 该用例退化成"无倒挂"，测不出东西 | 单测断言"产 note"失败 | 换成确实不在组织者集合里的键；这条失败说明"用例也会假绿"的反面 —— 它在**变红时**救了自己 |
| 9 | **新镜像只挂了编译期守卫、没挂硬编码回归**：`AGENT_STATES` / `AGENT_RISKS` / `AGENT_SKILLS` 只有 `AssertTrue<Exact<…>>`，而本仓自己的纪律是**两根柱子缺一不可**（守卫只防单侧漂移） | 自查（写 §2 时对照 `assemble.test.ts` 既有三段硬编码） | 在 `tests/workspace-spec/assemble.test.ts` 补三条硬编码期望 |
| 10 | 🔴 **门禁自证的"归因边界"引用了一个会被追加的列表里的具名元素**：`verify:workspace-drift` 的 `guardLineRange` 用 `_DriftGuardConsent` → `_DriftGuardOutcomeLevel` 算区间 ⇒ 区间被钉死在 **148–150**；本切片新增的 3 条 Agent 守卫在 **151–153**，**落在区间之外**。同时变异集里**没有 agent 变异** ⇒ 新守卫"到底接没接对服务端类型"从未被证 | 审**证据本身**：日志报的行号是 `148–150`，而源码里守卫有 **6 条** —— 数字对不上 | ① `guardLineRange` 改取**首尾**守卫（现为 148–153）；② 补第 4 条变异（`AGENT_SKILLS` 的 `COORDINATION_ADVICE` → 从未存在的 `OUTCOME_NARRATIVE`）。加固后 **16/16**，新变异命中 `line=153`（正是 `_DriftGuardAgentSkill`）⇒ 两条都证明：区间缺陷是真的，新守卫也确实有牙 |
| 11 | 🔴 **服务端下发的文案自带 markdown 强调标记**：`runtime.ts` 的 `reason` 里有 `已**升级**为需人工批准`、`含**未授权项**`、`已降级为**规则式**抽取`，而 `agent-board.tsx` 直接渲染 `{run.reason}` ⇒ 界面显示**字面星号** | e2e 输出里打出 `⚠️ 原因文案说明"已**升级**为…"` —— 断言通过了，但**打印出来的东西**不对 | **R9 只扫前端源码，扫不到服务端下发的文案** ⇒ ① 三处改「」（**单次原子写入 + 每锚点唯一命中校验**，避开本仓"同文件多改静默丢一处"的坑）；② e2e §8 加**类级守卫**（扫整张列表的 `reason` + `execution.reason` **不含 `**`**）。这是**第 3 次**同类缺陷（前两次见 §8 #6 与 `05-changes-p2.md` §5），但**首次出现在服务端** |
| 12 | 🔴 **我自己写出了一条空集假绿**：`✅ 值级：preview 三个受众都**不含** email 键   org=0 cp=0 cand=0` —— 三个投影**全空** ⇒ "不含 email"和"单调"都是**空集套空集**，**等于什么都没测**，却显示全 ✅ | 审**证据本身**：`org=0 cp=0 cand=0` 三个零摆在一起时，任何"不含 / 子集 / 相等"断言都**必然成立** | ① 脚本先用真实端点 `PUT /api/profile` 写入 `displayName/company/bio`（投影取值来自 **`Profile` 行**，不是 `User.name` —— 夹具不写 Profile 就会全空）；② 加**前置断言**（三个投影都非空）；③ 值级断言从"不含 X"升级为**集合精确相等**。重跑后 `org=3 cp=2 cand=1`，才是真断言 |

### 8.1 第 5 条的完整经过（因为它一度让我得出**错误结论**）

**症状**：同一棵树、同一 config，两个命令给出相反的判定 ——

```bash
npx tsc --noEmit                      # exit 0   ← 看起来是"假绿"
npx tsc --noEmit --incremental false  # exit 2  # schema.ts(148,47) TS2344
```

当时的第一反应是"`incremental: true` 的陈旧 `tsconfig.tsbuildinfo` 会让 tsc 假绿" ——
这是个**方法论级**的指控（全项目都把 `tsc --noEmit` 当主门禁）。于是做了受控对照：

| 条件 | 结果 |
|---|---|
| A) 漂移源码 + **陈旧 buildinfo** + 默认（增量）tsc | `exit=2`（命中 1 处 TS2344） |
| B) 漂移源码 + **无 buildinfo** + 默认（增量）tsc | `exit=2`（命中 1 处 TS2344） |
| C) 修好的源码 + 无 buildinfo | `exit=0` |

⇒ **A/B 都正确报错，增量假绿的假设被证伪。**

**真相**：那两个命令看到的**不是同一份 `schema.ts`**。此前有一次 `verify:workspace-drift`
被 SIGTERM 打断（8G 机上前台跑 tsc 被 OOM 杀），而它的**第二个变异恰好就是"从镜像里删掉
`CANCELLED`"** —— node 在 SIGTERM 下**不执行 `finally`**，于是那处删改被留在了磁盘上。

**反证（同时说明前面的工作是对的）**：全量 jest 在 12:11–12:13 跑完并**通过**了
`tests/workspace-spec/assemble.test.ts` 里硬编码含 `'CANCELLED'` 的断言 ⇒ 那一刻文件是
**正确**的；杀进程发生在 12:14。也就是说，`CANCELLED` **从未**在重写 `schema.ts` 时丢失。

**处置**（治理，而不只是修数据）：

1. 恢复文件（我的编辑内容是对的，**诊断是错的** —— 这点必须写下来）；
2. `scripts/qa/verify-workspace-spec-drift.mjs` 加**启动期锚点自检**：三个变异锚点必须各命中
   1 次，否则**指名道姓**报"源码可能被上一次中断的自证半改了，先 `git diff`" ——
   而不是让症状退化成"基线 `tsc exit != 0`"（那句话看起来像"守卫恒失败"，与真相无关）；
3. 同脚本加 **SIGINT / SIGTERM 还原后再退出**；
4. `.gitignore` 补 `tsconfig.drift-probe.json` + `__mutant-*`（此前不在忽略列表 ⇒ `git add -A`
   会把它们当正常文件提交）。

**为什么这个风险不对称**：`verify:ui-invariants` 只**新建** `__mutant-*` 文件，残留能被门禁
**R0** 扫出来（它会主动报错并拒绝通过）；而 `verify:workspace-drift` 是**唯一**会**就地改写
已存在源文件**的自证脚本，残留既不被 R0 覆盖，也不像临时文件那样显眼，
**只差一步就会被当成"我写的代码"提交**。

另顺手修掉上一轮遗留的一处笔误：`WorkspaceSpecSchema.IntentNodeSchema` 里
`isoemporalGuard(),`（正确为 `isoTemporal`）。

## 9. P2 端到端取证（HTTP 层，`npm run verify:p2:e2e`）

**为什么必须有它**：本切片此前只有单测绿 —— 单测测的是**装配器**（纯函数），而 P2 验收原文是
「**全链路真实 API、审批与状态更新**」。两者覆盖的东西**没有交集**：装配器正确 ≠ 端点契约正确 ≠
审批写路径**真的把状态改了**。故新建 9 节取证（隔离库 + 真实 HTTP + 真实装配器）：

1. **材料准备**：`PUT /api/profile` 写 `displayName/company/bio`。
   🔴 这一步**是必需的，不是装饰** —— 披露投影的取值来自 **`Profile` 行**（不是 `User.name`），
   不写 Profile 会让三个受众的 `preview` 全是 `{}`，下面所有"值级"断言都退化成**空集套空集**（见 §8 #12）；
2. **Consent 读 · 逐字段投影**：断言三受众**集合精确相等**（`org={displayName,bio,company}` /
   `cp={bio,company}` / `cand={bio}`），且**先断言三者都非空**。`COUNTERPARTY` 档的 `company`
   对候选**不可见** ⇒ 验的是**值级**，不是"字段清单里有这个名字"；
3. **Consent 写 · fail loud**：受保护字段（`disclosable:false`）写入一律 **400**；
4. **链路数据**：提案 / 成果落库（后续各节的数据来源）；
5. **Observatory**：时间轴排序 + 指标口径（`consentPending` 不入主线、`rates` 恰为 4）；
6. **状态更新**：**刷新后仍成立**（不是"响应里对了一次"）；
7. **Agents 读**：`usage` 与列表形状（**无 `injectionCount`**）；
8. **Agents 写**：`AWAITING_APPROVAL → APPROVED → 200` + **两条语义不同的 409**（已有裁决不可改判 / 状态不允许）
   + `MEMBER` 批准 **403**（触发权与批准权是两个能力，AC-08）；另加**类级守卫**：整张列表的
   `reason` 与 `execution.reason` **不含 `**`**（见 §8 #11）；
9. **契约 1.2**：`assembleAgentNode(runs, honesty)` → 节点过 `WorkspaceSpecSchema`；
   `assembleAgentNode(runs, null)` 必须**不产节点**，且原因**点名** provider 诚实块。

### 9.1 让"批准成功"可复跑：假模型端点

无 `OPENAI_API_KEY` 时 `INTRO_DRAFT` **没有降级路径** ⇒ 运行落 `FAILED` ⇒ 批准**必然** 409
（那条负向用例会"通过"，但正向用例**永远走不到**）。故用**本地假端点**（`fake-openai-provider.mjs`，
把 `OPENAI_BASE_URL` 指向 `127.0.0.1:3199`）让服务端走**完整真实调用链**
（`fetch → usage 归因 → zod → 越界检查 → 状态机`），只把"模型说什么"变成确定性：

- **按 `max_tokens` 路由技能**（`INTRO_DRAFT 1200` / `COORDINATION_ADVICE 900` / `INTENT_EXTRACTION 800`
  三值互不相同 ⇒ **稳定判别键**），**不靠猜 prompt 文本**；
- **未知 `max_tokens` ⇒ 400**（而不是"给个默认应答"）⇒ `costProfile` 一漂移就**自曝**，不会静默假绿；
- `finish_reason` 必须是 `stop`（`length` 会被判"半截产出"而拒绝）；必须带
  `usage.{prompt_tokens,completion_tokens}`（缺失 ⇒ `PROVIDER_ERROR`，AC-20 要求**每次调用可归因**）。

它**不是**对 T09「无凭据即不可用」的放宽：生产**没有任何代码**读 `OPENAI_BASE_URL`，T09 的诚实纪律不变。

### 9.2 一个必须写下来的坑：`.mts` 看不见 `export *` 桶导出

脚本导入 `src/` 下的 `.ts` 时，`.ts` 按 **CJS** 加载，具名导出由 `cjs-module-lexer` **静态**识别 ——
它**看不穿 `export * from './x'`**（esbuild 编成 `__reExport(...)` 助手）⇒ `.mts` 里报
`SyntaxError: does not provide an export named …`。而 `await import()` **却能成功**
（运行时命名空间里有那个键），所以症状**只在静态具名导入时**出现。修法 = **深路径导入**
（`@/lib/living/agents/board`）；理由已写进脚本文件头，防止后人"顺手改回桶导出"。

另有一处同类陷阱：JSDoc 里写 glob 时，`*` + `/` 两个字符连在一起会**提前闭合块注释**
⇒ esbuild `ERROR: Unexpected "*"`。注释里别写 glob 的字面形式。

## 10. 验证结果（可复跑）

| 项 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `npx tsc --noEmit` | **0 error**（exit 0，2m44s；🔴 首轮 `exit 2` 是**假失败** —— 与变异自证并行，见 §8 #4） |
| 单测（本切片） | `npx jest tests/living` | **8 套 198 例全通过**（新增 6 套：consent 2 / observatory 2 / agents 2） |
| 单测（全量） | `npx jest` | **85 套 1699 例全通过**（79 套 1549 → 85 套 1699；+6 套 / +150 例，**既有零失败**） |
| Lint | `npx eslint --max-warnings=0 <改动目录>` | **0/0**（exit 0） |
| UI 不变量 | `npm run check:ui-invariants` | **32 文件通过（R1–R10）**（P2 Slice 1 时为 18 文件 / R1–R9） |
| UI 门禁自证 | `npm run verify:ui-invariants` | **10/10**（R1–R10 变异各被捕获 `exit=1`；负向对照无漏报；收尾复验 `exit=0`） |
| **枚举漂移自证** | `npm run verify:workspace-drift` | **16/16**（基线 `exit 0` → **四条**真实变异各被 `tsc` 捕获（`exit=2`）、`TS2344` 精确落在守卫行 **148–153** → 还原**逐字一致**、探针已清理）。P2 Slice 1 时为 13/13（3 条变异、区间 148–150） |
| **P2 端到端取证** | `npm run verify:p2:e2e` | **130 通过 / 0 失败**（exit 0）—— 9 节：披露逐字段投影 → 时间轴/指标 → 状态更新（刷新后仍成立）→ 审批 + 两条语义不同的 409 + 权限负向 → 契约 1.2 装配。**隔离库 + 真实 HTTP + 真实装配器**；"批准成功"经**本地假模型端点**（见 §9） |
| 脚本声明 | `npm run check:script-decls` | **68 脚本 / 0 未声明引用**（67 → 68，+1 = 新增的 `fake-openai-provider.mjs`；新脚本 `verify-p2-workspace-e2e.mts` 由 `tsc` 覆盖 —— 该门禁**只扫 `.mjs`**） |

## 11. 仍未闭合（本切片未做）

1. **浏览器端交互取证**：三区真实数据渲染、审批写操作、360px 无横向溢出、两套主题跟随、
   键盘可达 —— **本切片仍无浏览器取证**（沙箱探不了外部端口，见 `2026-10-14` 记忆）。
   ✅ **HTTP 层**端到端取证**已补**（§9，`130/0`）：端点契约、审批写路径与状态更新、契约 1.2 装配
   均已**可复跑**；**未覆盖的只剩渲染层**。
2. **P2 四项已完成但仍未发版**：`[skip netlify]` 状态维持，发版时机由运营决定。
3. 支付生产不可用（缺 Creem 凭据）—— 既有未闭合项，用户明确排除。
