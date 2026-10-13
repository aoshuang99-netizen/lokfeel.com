# T09 · Agent Runtime —— Slice 1 交付记录（纯内核）

> 计划见同目录 `plan.md`。本文件只记录**已交付事实 + 证据 + 诚实修订**。
> 范围：`src/lib/agent/*`（7 个文件）+ `tests/agent/*`（4 套）+ `scripts/check-agent-invariants.mjs`。
> **本切片不碰 DB、不碰网络、不加路由** —— 全部纯函数/纯类型，回滚 = 删目录。

## 1. 交付物

| 文件 | 职责 | 关键设计 |
|---|---|---|
| `src/lib/agent/types.ts` | 领域枚举 | `AGENT_RUN_STATUSES` 含 `PROPOSED/AWAITING_APPROVAL/APPROVED/REJECTED/EXECUTED/DEGRADED/BLOCKED_QUOTA/FAILED`；`riskAtLeast()` |
| `src/lib/agent/guard.ts` | 不可信数据通道化 + 注入**告警** | `wrapUntrusted()` 转义分隔符（防闭合标签逃逸）；`detectInjection()` **只告警** |
| `src/lib/agent/cost.ts` | 成本账本 + 限额判定 | 整数微分（1 分 = 1_000_000 微分）；单价表**可注入**；`checkQuota()` **调用前**判定 |
| `src/lib/agent/approval.ts` | 批准状态机 | 迁移**真相表**；`AWAITING_APPROVAL → EXECUTED` **边不存在**；`assertExecutable()` |
| `src/lib/agent/skills.ts` | 技能注册表 | `INTENT_EXTRACTION` 输出契约**复用** P1 `WorkspaceSpecSchema`；`untrustedFields` 显式清单 |
| `src/lib/agent/provider.ts` | 模型提供方 | `ProviderResolution` 显式区分 `ready` / `unavailable`；**缺凭据不静默 stub** |
| `src/lib/agent/runtime.ts` | 编排（**无副作用**） | 输入校验 → 限额 → 守卫 → 调用 → zod 校验 → 越界检查 → 记账 → 返回**提案** |
| `src/lib/agent/index.ts` | 出口 | — |

## 2. 门禁证据（2026-10-13）

| 命令 | 结果 |
|---|---|
| `npx jest tests/agent` | **4 套 / 60 用例全通过** |
| `npx jest`（全量） | **68 套 / 1319 用例全通过**（247s） |
| `npx tsc --noEmit` | **exit 0**（0 error；2m50s） |
| ESLint（**目录级**） | **0 error / 0 warning** —— 范围：`src/lib/agent` · `tests/agent` · `src/lib/workspace-spec` · `src/components/living` · `src/app/workspace` · 两个门禁脚本 |
| `npm run check:agent-invariants` | **通过**（扫描 8 文件，A1–A4） |
| `npm run verify:agent-invariants` | **通过**（A1/A2/A3/A4 变异各被捕获 exit=1，负向对照无误报，临时文件已清理） |
| `npm run check:ui-invariants` | 通过（R1–R7，含 `src/lib/workspace-spec/*`） |
| `npm run verify:ui-invariants` | 通过（R1–R7 变异 7/7 生效） |
| `npm run check:script-decls` | 通过（64 脚本 / 0 未声明引用） |

`check-agent-invariants` 的四条不变量：
- **A1** 内核不 import `@/lib/tenancy`（权限判定不在内核）；
- **A2** 内核不 import 数据库（无 IO）；
- **A3** 模型输出不被当代码执行（无 `eval`/`new Function`/动态 import 模型文本）；
- **A4** 无定时器伪成功（不靠 `setTimeout` 假装完成）。

## 3. 🔴 修复记录（首轮 4 个失败用例）—— 分类是**诚实**的

首轮 `jest tests/agent` = `2 failed 套件 / 4 failed 用例`。四处的性质**不同**，逐条说明：

### 3.1 实现缺陷（真修）— `runtime.ts` 的降级归因

- **现象**：`provider 报错 → 降级，且失败调用也被记账` 断言 `outcome.cost.ok === false` 收到 `true`；且账本 `calls` 本应为 1。
- **根因**：`degrade()` 在 `INTENT_EXTRACTION` 可走规则式兜底时，**无条件**新建一条 `providerKind:'rules'`、`ok:true`、0 成本的记录，并把它当作 `outcome.cost` 返回、又 `appendCall` 一次。当本次**已经发生过一次失败的真实调用**时，后果是：
  1. `outcome.cost` 指向兜底记录 ⇒ 失败调用的归因被**顶掉**（`cost.ok` 变 `true`）；
  2. 同一次运行在账本里留下**两条**记录 ⇒ 归因重复计数（对账失真，违反 T08「指标必须可复算」）。
- **修法**（`runtime.ts` · `degrade()` 的 `INTENT_EXTRACTION` 分支）：
  - `cost` 非空（真实调用发生过，哪怕失败）⇒ **沿用那一条**，不再补记；
  - `cost` 为空（根本没调用，如 provider 不可用）⇒ 补记一条 0 成本规则式记录，使**降级率可见**。
- **影响面**：`PROVIDER_UNAVAILABLE`（无调用）行为**不变**；只有"有调用的失败"这一类被修正。

### 3.2 测试设置错误 ×2 — `tests/agent/cost.test.ts`

- **现象**：两例期望 `HIGH_COST_CALL_LIMIT` / 期望低成本技能放行，实际拿到 `INSUFFICIENT_BUDGET` / 拒绝。
- **根因**：该 `describe` 复用了 `quota = { maxMicroCents: 100_000, maxHighCostCalls: 2 }`。而 `skill.costProfile` 预估为 **75_000 微分**、账本已用 30_000 微分 ⇒ `105_000 > 100_000`，**预算判据先命中**。测到的是预算，**不是**高成本次数判据。
- **修法**：新增 `ampleBudget = { maxMicroCents: 10_000_000, maxHighCostCalls: 2 }`，**只在这两例**使用，让"高成本次数"成为唯一约束。原 `quota` 及其余用例**不动**（`INSUFFICIENT_BUDGET` 那例仍用它，保持既有覆盖）。

### 3.3 测试断言错误 ×1 — `tests/agent/runtime.test.ts`

- **现象**：`模型多带未知字段 → payload 为 null` 收到非 null。
- **根因（先核实再下结论）**：`INTENT_EXTRACTION.outputSchema` 即 `WorkspaceSpecSchema`，是 `z.strictObject` ⇒ 模型夹带的 `permissions` / `capabilities` **确实被拒绝**（否则该用例会在上一条 `status !== 'PROPOSED'` 就先失败）。失败发生在**下一句**：`INTENT_EXTRACTION` **有规则式兜底**，契约拒绝模型输出后走 `degrade()`，`payload` 是**本地 `compileWorkspaceSpec()` 编译**的那份 ⇒ 合理地非 null。原断言与同一文件 `JSON 合法但违反契约 → DEGRADED` 的设计**自相矛盾**。
- **修法（把断言换成真正要保护的性质，而不是放宽它）**：
  - 主体：断言 `status !== 'PROPOSED'` + `degradeCode === 'OUTPUT_SCHEMA_INVALID'`，并对 `JSON.stringify(payload)` 做**深层**文本断言 —— 不含 `ADMIN`、不含 `mission.delete`（避免"只查顶层键、嵌套漏检"）；
  - 对照：**新增**一条用例，对**无降级路径**的技能（`INTRO_DRAFT`）断言契约拒绝后 `payload === null`、`status === 'FAILED'` —— 原用例想表达的"宁可不产出"由它承担。
- **诚实声明**：这里**没有**为了变绿而放宽安全断言；相反，验证强度是**提高**的（深层文本断言 + 新增负向对照）。

## 4. 全量回归（2026-10-13）

- `npx jest`（全量，含 `tests/agent` 60 例）：**68 套 / 1319 用例全通过**（247.7s）。
- `npx tsc --noEmit`：**exit 0**（2m50s）。
- ESLint（**目录级**，见 §2 范围）：**0 error / 0 warning**。
- ⚠️ **诚实说明**：裸跑 `npm run lint`（= 无路径的 `eslint`）会 `exit 1`，报错全部落在
  **仓库根的历史遗留 JS**（`check-tables.ts` / `fix-enums.js` / `migrate-phase-b.js` /
  `run-test.js` / `scripts/*.js`）与**既有 `src/app/(admin)/**` 页面**上 —— 均**不在本次改动面内**
  （`git status` 可核）。本项目既有口径即为「ESLint 0/0（**含目录级**）」（见 `BACKLOG.md` §8），
  故此处按同一口径记录：**本次改动面目录级 0/0**。

## 5. 未覆盖（留给 Slice 2 / 3，不假装已完成）

1. **持久化**：`AgentRun` / `AgentCall` / 审批记录的 C6 迁移（纯新增表）与 HTTP 面（`/api/v1/agents/runs*`）——**未做**，当前 `runSkill()` 只活在内存里。
2. **真实 Provider**：`provider.ts` 目前对"存在 `OPENAI_API_KEY`"也返回 `unavailable`（HTTP 实现属 Slice 3）。**不存在**任何生产路径会用到 stub。
3. **成本对账 SQL** 与**对抗测试夹具**（改权限/套资料/绕审批/闭合标签逃逸四类样本）——未做。
4. **披露接线**：本切片**不向模型传任何主体档案数据**（只传 `subjectLabel` 这类标签）；真实披露必须经 `discloseSubject()` 投影后再进 prompt（AC-03），属 Slice 2。
5. **审计事件**：`agent.run.created/approved/rejected/degraded/blocked_quota` —— 未做。

> 依据 plan.md §3 的切片划分：Slice 1 到此**闭合**；Slice 2（持久化 + API + 审计）与 Slice 3（真实 Provider + 对账 + 对抗/预算）为后续工作。
