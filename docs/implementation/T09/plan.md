# T09 · Agent Runtime —— 实施计划

> 依据：`tasks/T09_AGENT_RUNTIME.md`（立项总包）与 `docs/implementation/BACKLOG.md` §3 T09 卡片。
> 验收：**AC-08（BLOCKER）** Agent 安全 —— Prompt 注入**不能**改变权限 / 泄露资料 / 绕过审批；
>       **AC-20（P1）** Agent 成本 —— 每次调用**可归因**，限额触发时**停止高成本任务**。

## 0. 拍板的技术栈（2026-10-13）

**TS 内编排**（不引 Python / LangGraph）。判据是**平台约束，不是偏好** —— 与 T06 选 DB outbox 同源：

1. Netlify 免费计划的函数是**临时的**，没有常驻进程 → 跑不了常驻的 LangGraph 服务；
2. 现有仓是**纯 TypeScript**，引入第二语言要独立部署、独立凭据、独立可观测性，而收益（图编排/检查点）
   在 T09 的范围（三类技能、单轮/少轮）里**用不到**；
3. 编排点隔离在 `AgentRuntime` 接口后 —— 日后真要换引擎，**业务层不动**（与 T06 的
   `src/lib/workflow/runtime.ts` 驱动器接口同一手法）。

## 1. 复用既有资产（不重复造）

| 资产 | 复用方式 |
|---|---|
| `src/lib/workspace-spec`（P1 交付） | **结构化产出的唯一契约**：`strictObject`（未知字段直接拒绝）+ 节点白名单。Agent 的结构化输出**复用**它，不另立一套 schema |
| `src/lib/connection/disclosure.ts` 的 `discloseSubject()` | **披露的唯一出口**（T03 立的铁律）。进入 prompt 的资料**必须**经它投影，否则 AC-03 破 |
| `src/lib/tenancy` 的 `withTenant(capability)` | 权限**唯一**判定点。Agent **不得**参与权限判定 |
| T08 `UsageRecord` | 成本归集的落点（Slice 2 接线），使 AC-20 与 AC-16 同一套口径 |

## 2. 🔴 铁律 → **结构性**保证（不是"约定"）

T09 卡片与 AC-08 的四条要求，逐条对应到**代码里不存在的代码路径**（这才是防注入的正解 ——
靠"给模型说别越权"是防不住的）：

| 要求 | 结构性保证 |
|---|---|
| LLM 不做最终权限判断 | `runtime.runSkill()` **只返回结果，不执行副作用**。执行副作用只存在于 `executeApproved()`，它**要求**一条 approval 记录 + 在服务端**重新**判能力 |
| Agent 不得自主发送高风险消息 | `RiskLevel.HIGH` 的技能/动作在 **`AgentOutcome.requiresApproval === true`**，且状态机**不存在** `PROPOSED → EXECUTED` 的边（见 `approval.ts` 的迁移表） |
| Prompt 注入不得改变权限 | 模型输出**只是文本**，唯一的消费路径是 `zod` 校验后的结构化数据；**没有任何代码**把模型文本当权限/白名单/配置读取 |
| Prompt 注入不得泄露资料 | 入 prompt 的资料先经 `discloseSubject()`（不在授权集合里的字段**键都不存在**）；输出若要含资料，必须是**投影后的对象**，不是模型自述 |
| 注入不得绕过审批 | 审批是**状态机**，不是提示词；模型无法"说服"状态机 |

> **诚实声明**：`guard.ts` 的注入模式检测是**旁证/告警**，**不是**防线本身 ——
> 模式表一定能被绕过，所以它**不作为放行判据**。真正的防线是上面那些"路径不存在"。

## 3. 切片

### Slice 1 · 纯内核（**无 DB、无网络**，全部纯函数 → 可单测）

| 文件 | 内容 |
|---|---|
| `src/lib/agent/types.ts` | 领域枚举与类型：`RiskLevel` / `AgentRunStatus` / `SkillKey` / `DegradeReason` |
| `src/lib/agent/skills.ts` | **技能注册表**：意图抽取 / 介绍草稿 / 协调建议。每技能声明 `inputSchema`、`outputSchema`（zod）、`risk`、`costProfile`、`requiresApproval` |
| `src/lib/agent/guard.ts` | 不可信数据**通道化**（分隔符 + 转义，防闭合标签逃逸）+ 注入信号检测（**仅告警**） |
| `src/lib/agent/cost.ts` | **成本账本**（纯）：按技能/按调用计 token 与金额 + **限额判定**（限额不足时**拒绝启动**高成本任务，而不是降级偷偷跑） |
| `src/lib/agent/approval.ts` | **批准状态机**（纯）：迁移**真相表** + `canTransition()`；`EXECUTED` 不可由 `PROPOSED` 直达；配**次序不变量**断言 |
| `src/lib/agent/provider.ts` | `ModelProvider` 接口 + `StubProvider`（确定性，供测试/无凭据）+ **缺凭据时显式不可用**（不静默降级成 stub 冒充真实调用） |
| `src/lib/agent/runtime.ts` | 编排：校验输入 → 限额判定 → 守卫 → 调用 → **zod 校验输出** → 失败**降级到 P1 的规则式编译器**并标注原因 → 记成本 → 返回（**不执行副作用**） |
| `src/lib/agent/index.ts` | 出口 |

### Slice 2 · 持久化 + API + 审计 —— ✅ 已交付（见 `slice-2.md`）

- **C6 迁移**（**纯新增**）：`AgentRun` / `AgentCall`（逐次调用的成本归因）/ `AgentApproval`。
- HTTP 面：`POST /api/v1/agents/runs`（幂等键，能力 `agent.run`）、`POST /api/v1/agents/runs/[id]/approve|reject`、
  `GET /api/v1/agents/runs`、`GET /api/v1/agents/runs/[id]`（详情带逐次调用，**交付时新增**）、`GET /api/v1/agents/usage`。
- 审计事件：`agent.run.created` / `approved` / `rejected` / `degraded` / `blocked_quota`。
- 🔴 新能力名要加进 `TenantCapability`（`agent.run` / `agent.approve`），并同步 `ROLE_CAPABILITIES`。
- ⚠️ 交付时补充：`agent.run`（OPERATOR+）与 `agent.approve`（ADMIN+）**必须分离** —— 否则同一人可自我盖章，AC-08 在**制度层**被绕过。

### Slice 3 · 真实 Provider + 对账 + 对抗/预算测试 —— ✅ 已交付（见 `slice-3.md`）

- 真实 `OpenAIProvider`（仅当 `OPENAI_API_KEY` 存在；否则该 provider **不可用**并明确报错）。
  🔴 **交付时的边界调整**：HTTP 实现落在**服务层** `src/lib/agents/provider-openai.ts`，
  内核只保留**纯环境解码** `resolveProviderConfig(env)`；并给 `check-agent-invariants`
  **新增 A5**（内核不得出现网络调用）—— 否则"内核无 IO"会从性质退化成口号（A2 只挡数据库）。
- **成本对账脚本**（AC-20）：`scripts/qa/agent-reconcile.mjs`（+ `emit-agent-usage.mts` /
  `seed-t09-agent.mts`）用原始表 SQL 独立复算**逐次调用**归因，与 API 响应**双向比字段集**；
  含**变异自证**（改单价/改 token 必须让结果变）与诚实条款（`realCallsEnabled=false`
  ⇒ 本期不得有 `OPENAI` 调用行；期望值须显式给出，见 `slice-3.md` §3.1）。
- **对抗测试夹具**（AC-08）：`tests/agents/adversarial-injection.test.ts` —— 闭合标签逃逸
  （6 种写法含零宽）+ 注入语料（8 条），断言**注入后权限判定不变、披露集合不变、审批状态不变**；
  每条"防住了"的断言都配**负向对照**。
- **预算测试**（AC-20）：`tests/agents/budget.test.ts` —— 限额耗尽 → `BLOCKED_QUOTA`，
  且**没有**产生模型调用记录（provider 零调用自证 + 账本零新增 A/B 对照）。
  🔴 为此给 `createAgentRun` / `agentUsage` 加了 `quota` / `price` **注入点**
  （默认额度 500 分 ≈ 11 万次调用，不注入就无法端到端跑出限额）。
  ⚠️ 判定用的是技能的 `costProfile` **预估**，不是"上次实际花了多少"（差一个数量级，见 §3.2）。

### Slice 4 · 执行器落地（`EXECUTED` **只有一条路径**）—— ✅ 已交付（见 `slice-4.md`）

> 若**先**改状态再投递：投递失败就会留下"状态 EXECUTED、但什么都没发出"的**假成功** ——
> 而重试会因为状态是终态而被拒（`EXECUTED` **没有出边**），那条产出**永远发不出去**。

- **C7 迁移**（**纯新增**单表）：`AgentExecution`（`@@unique([runId])` + 2 索引 + 2 强 FK）。
  🔴 执行记录独立成表，是因为批次机制**只支持 `CREATE TABLE/INDEX IF NOT EXISTS`**（无 `ALTER` 形态），
  且"执行是事件、**只增不改**"。断言 **205 → 219（+14）**。
- **内核**：`src/lib/agent/execution.ts` —— 执行计划**真相表** + `planExecution()`。
  与 `approval.ts` 是**串联的两道门**（状态机问"这个状态允许迁移吗"；执行计划问"这个技能注册了执行器吗、效果是什么"），
  外加一道纵深防御：`requiresApproval` 的技能，库里必须**真的**有一条 `APPROVED` 裁决行
  （状态是**列**，可被人工改坏；裁决表是只增不改的事件）。
- **服务层**：`src/lib/agents/executor.ts` —— `EXECUTED` 的**唯一**写入点；
  经 **T06 统一投递出口** `deliverNotification()` 产生副作用（拿到披露守卫 + 身份声明断言 + 投递幂等 + 留痕）；
  **先投递、后落库**（顺序论证见 `slice-4.md` §3）。
- **阶段断言"升级"而非删除**：Slice 2 的"`EXECUTED` 必须为 0"→ **双向一致**
  （`EXECUTED ⇔ 有 AgentExecution 行`）；"唯一写入点"由**静态断言**守着
  （服务层 + 路由层源码里 `EXECUTED` 字面量**只允许**出现在 `executor.ts`；写入口计数固定）。
- **诚实边界**：本切片只做**内部回执**（收件人恒为**发起人**）。
  对外送达需 target 身份 + T05 的 `discloseSubject()` 出口，属**下一片**。
- **能力**：`agent.execute` = **OPERATOR+** —— 批准才是 ADMIN+ 的**决策**，执行是**机械动作**；
  若执行也要 ADMIN，「运营发起 → 管理员批准 → 运营执行」这条正常动线走不通。
- **连带修正**（同一提交内，避免留下假绿）：两份 QA 脚本 + 6 份既有测试按新口径改写；
  `EXECUTION_PLANS` 的描述去 markdown 标记（UI 原样渲染）；`agent.delivery` **不**渲染任务标题。

### Slice 5 · 组织级额度 + 第 7 屏 Agents + 真实端点连通性 —— ✅ 已交付（见 `slice-5.md`）

- **三个缺口各自的解法**：④ 组织级真实额度 = **接线**（不是新造一张表）；
  ② 第 7 屏 Agents 的**不重写状态机**是这一屏的设计核心（前端只做投影，裁决权仍在服务端）；
  ③ 真实端点连通性 = **三层分离**，且**「路由没走对」不能报成「端点坏了」**。
- 🔴 **逐格交叉验证抓出的真实缺陷**（本片最重要发现）；**变异自证首轮漏掉一个（M2）**
  → 已在 `slice-5.md` §6 记录并补齐。
- 诚实边界见 `slice-5.md` §7，回填见 §8。

### Slice 6 · 对外送达 + 生产侧连通性入口 + 对账端到端 —— ✅ 已交付（见 `slice-6.md`）

- 核心是**两道门的分工**：状态机问「这个状态允许迁移吗」；送达问「这个身份、这个依据，**此刻**还成立吗」。
- ① 对外送达：身份在**创建时**固定（`AgentDeliveryTarget`，C8 纯新增单表），依据在**执行时**复验；
  🔴 **送达通知体里没有档案字段**（刻意的，不是遗漏）。
- ② 生产侧连通性**入口**（**发版后必须在生产出口实跑一次**）；本片修掉一处**文件头与实现自相矛盾**，
  以及身份层认不出「没带凭据」措辞的真实缺陷。
- ③ 端到端实跑：隔离 libSQL 全链路（60 张表，C8 由当前 schema 完整 DDL 自动建出）。
- 两条既有断言按**新语义重写**（不是删掉）；§6 为变异 / 反向对照；回填见 §8。

## 4. 门禁（沿用既有 + 新增）

```
tsc --noEmit                 # 0 error
npx jest                     # 全量
eslint <dir> --max-warnings=0
npm run check:script-decls
npm run check:ui-invariants  # 若 Slice 2/3 触及 living 目录
```

**新增（建议）**：`check:agent-invariants` —— 静态断言 `src/lib/agent` 内
**不存在**从模型输出到权限/白名单/配置的读取路径（例如不得出现
`providerText` 参与 `capability` / `audience` / `role` 的判定），把"路径不存在"变成**可复跑的检查**。
已实现为 **A1–A5**：A1 不碰 tenancy · A2 不碰 DB · A3 不当代码执行 · A4 无定时器 ·
**A5 无网络调用**（Slice 3 新增 —— 真实 Provider 接上后，这条是"内核纯净"的执法点）。

## 5. 风险与取舍

| # | 风险 | 处置 |
|---|---|---|
| A1 | 用 stub 冒充真实模型调用，把"能跑通"当成"已接通" | `provider.ts` 显式区分；缺凭据 → **BLOCKED/不可用**，绝不静默 stub（同 T08 Creem 沙箱的口径） |
| A2 | 注入防御被当成"模式表能不能绕过"来评审 | 文档与代码注释都写明：模式表**只是告警**，防线是结构性"路径不存在" |
| A3 | 模型输出直接进 UI（回到"模型写 HTML"的老路） | 产出必须过 `workspace-spec` 的 `strictObject` + 白名单渲染（P1 已建） |
| A4 | 成本归因与 T08 用量口径漂移 | 复用 `UsageRecord`，并写 SQL 对账（Slice 3）；口径写进 `risks.md` |
| A5 | 限额判定放在"调用之后" → 已经花了钱才发现超限 | 限额判定必须在**发起调用之前**（Slice 1 的 `checkQuota` 就是为此） |

## 6. 回滚

- Slice 1 是**纯新增文件**，回滚 = 删除目录（无副作用）。
- Slice 2 的 C6 迁移必须是**纯新增表**，回滚 = 停用路由 + 保留表（不删表，与 T08 同口径）。
- Slice 3 = **纯新增文件**（`provider-openai.ts` + 3 个 QA 脚本 + 3 个测试套件）+
  `provider.ts` 里把一个永远 `unavailable` 的占位换成纯函数 + `runs.ts` 两个**可选**注入点。
  回滚 = 删新增文件 / 恢复占位函数；**无 schema 变更**，不涉及迁移与数据。
- Slice 4 = **纯新增**（`execution.ts` / `executor.ts` / `execute` 路由 / 2 个测试套件）+
  `dto.ts` 的 `executionOf()` 改为**转发**内核判据 + `notification-content.ts` 新增一个模板 +
  **C7 迁移（单表）**。回滚 = 删新增文件 + 把 `executionOf()` 改回返回"不可执行 + 原因" +
  `rollback --batch=C7`（**只删 `AgentExecution`**，不删 `AgentRun` —— 与 T08 同口径）。
  🔴 本切片**没有**改动任何既有表的列 ⇒ C0–C6 完全不受影响。
