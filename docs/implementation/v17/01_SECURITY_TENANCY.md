# 01 租户权限与数据隔离（WB17-01）

**执行时间**：2026-10-21 15:30–16:20（GMT+8）
**基线**：`5b1a75f` / 分支 `work/v17-hardening`
**对应门禁**：SEC-01 ~ SEC-08

---

## 1. 结论摘要

| 问题 | 交接书假设 | 实测 | 处理 |
|---|---|---|---|
| `withTenant` 数组用 `some()` ⇒ 混入弱能力静默降级 | 「高概率 / 严重」 | **语义确实是 ANY，但全仓 57 处调用 0 处传数组** ⇒ 潜在缺陷，未在生产路径触发 | 已拆成显式 `withTenantAll` / `withTenantAny`，`withTenant` 传数组直接抛 `TypeError` |
| 「11 张表缺 organizationId」 | 需逐张分类 | **Connection OS 的 21 张表全部已有 `organizationId`**；41 张无此字段的表里，绝大多数是 legacy B2C / 平台全局 / 用户私有 | 已逐类归档（§3），不以"加字段"为解法 |
| 跨租户读写 | 未验证 | 静态扫描 182 条租户模型查询：**0 条未登记的越权风险**，5 条已人工判定并写明理由 | 新增 CI 门禁 `tenancy-scoping-gate` |
| 同意可否撤回 | 列为 SEC-07 | **不可撤回**：`isRevoked` 只被读、从不被写，`AuditAction` 里却预留了 `consent_revoked` | 已实现 `DELETE /api/im/consent` + 7 条测试 |
| 真实双组织负向测试 | 要求 | 无第二个真实组织 | **BLOCKED**（外部条件），代码级替代证据见 §6 |

一句话：**没找到已在生产生效的跨租户漏洞**，但找到了一个真实的"只读字段"缺陷（同意不可撤回）和一个真实的语义地雷（数组=ANY）。两者都已修。

---

## 2. `withTenant` 的语义缺陷（SEC-06）

### 2.1 缺陷是什么

修复前：

```ts
export function withTenant(capability: TenantCapability | TenantCapability[]) {
  const required = Array.isArray(capability) ? capability : [capability]
  ...
  const allowed = required.some((c) => can(tenant.role, c))   // ← 任一满足
```

`some()` 本身不是 bug —— 问题在于**签名对"一个集合"和"一组备选"不加区分**。调用方写
`withTenant(['mission.read', 'mission.update'])` 时，几乎必然想表达"两个都要"，
实际却只要 `mission.read` 就放行。它不报错、不告警、审计里也只记 `required` 数组，
事后复盘根本看不出"这次放行只满足了其中一个"。

### 2.2 实测影响面

```bash
# 精确扫描（node 解析，非 grep —— 本仓 grep 对部分文件无输出）
single-string calls: 57
array calls: 0
```

**57 处调用全部是单能力，零数组。** 所以这个缺陷当前是**潜在**的，不是"已在线上越权"。
这一点必须写清楚：交接书把它评为"高概率/严重"，证据上应降级为
"高风险设计缺陷，未触发"。

### 2.3 修复

| 入口 | 语义 | 失败时 |
|---|---|---|
| `withTenant(cap)` | 单能力 | 传数组 / 空串 → **构造期**抛 `TypeError` |
| `withTenantAll([...])` | 合取，缺一即拒 | 403 + 审计 `mode: 'all'` |
| `withTenantAny([...])` | 析取，仅入口等价时用 | 403 + 审计 `mode: 'any'` |
| 空数组 | 直接抛错 | `every([])` 恒真，绝不能放行 |

同时在审计 `safeMetadata` 里写入 `mode`，让"这次为什么放行"可复核。

### 2.4 测试（`tests/tenancy/capability-semantics.test.ts`，9 例）

| 断言 | 为什么它有价值 |
|---|---|
| MEMBER 有 `org.read`、无 `mission.update` → `withTenantAll` **403** | 直接复现"混入弱能力" |
| 同一组能力换成 `withTenantAny` → 200 | **变异对照**：证明上面的 403 来自合取语义，不是别的原因 |
| `withTenant(['org.read','member.invite'])` → `TypeError` | 类型层挡住之后，运行时再挡一次（JS 调用方） |
| 空数组 → `TypeError` | 防 `every([])` 恒真的"静默全开" |
| 角色能力单调 `MEMBER ⊆ OPERATOR ⊆ ADMIN ⊆ OWNER` | 权限模型断层是结构缺陷，必须自动发现 |
| 能力名不越界 | 防止改名后旧能力名静默失效 |
| `OPERATOR` 能 `agent.run` 不能 `agent.approve` | AC-08 的**制度层**保证（同一个人不能既跑又批） |
| 前置非空：能力表 > 20、每个角色非空 | 防空集导致的恒真断言 |

---

## 3. 数据模型的租户归属（41 张无 `organizationId` 的表，逐类归档）

实测：**62 个模型**，其中 **21 个带 `organizationId`**，41 个不带。
交接书说的"11 张缺 `organizationId`"与实测不符 —— 需要更正为下列分类。

### 3.1 已有 `organizationId`（21）—— 无需任何迁移

`Mission` `SocialIntent` `MissionParticipation` `ConnectionProposal` `ProposalDecision`
`Outcome` `OutcomeVerification` `IntroductionWorkflow`
`AgentRun` `AgentCall` `AgentApproval` `AgentExecution` `AgentDeliveryTarget`
`WorkflowJob` `NotificationDelivery` `BridgeMemberOptIn`
`BillingEvent` `UsageRecord` `IdempotencyRecord` `Membership` `TenantAuditEvent`

**结论：Connection OS 主线的每一张业务表都已带租户键。** "补 `organizationId`"不是当前瓶颈。

### 3.2 无 `organizationId`（41），按性质分四类

| 类别 | 模型 | 为什么不需要 `organizationId` | 隔离靠什么 |
|---|---|---|---|
| **A. 双主体**（2 个租户同时是当事方） | `CommunityBridge` | 一条协议天然属于两个组织，单一 org 列无法表达 | `initiatorOrgId` / `recipientOrgId` + 查询 `OR` 两侧；已加强制谓词（§5） |
| **B. 平台全局**（不属于任何租户） | `User` `Account` `Session` `VerificationToken` `Organization` `SystemConfig` `AdminPermission` `CustomRole` `AdminRolePermission` `AdminUserRole` `AdminAudit` `AnalyticsEvent` `AnalyticsEventDef` `AnalyticsDailyAgg` | 全局目录/配置/审计 | 平台角色 + `withPermission`（与 `withTenant` 分工明确） |
| **C. 用户私有**（legacy B2C / IM，属主是个人而非组织） | `Profile` `Match` `MatchReaction` `Conversation` `ConversationParticipant` `IMMessage` `MessageReceipt` `MessageReaction` `UserPresence` `Block` `UserReport` `SincerityWallet` `SincerityTransaction` `Notification` `AuditLog` `PowerBoardRule` `Subscription` `Payment` `ConsentRequest` `ConsentGrant` | 这些表的隔离维度是 `userId`，不是 `organizationId` | 查询必须带 `userId`（会话用户） |
| **D. 机器人（演示/运营）** | `BotProfile` `BotInteractionLog` `BotLearningBatch` `BotLearningRecord` `BotPreference` `BotAvatar` | 属于 legacy 演示线，无真实租户 | 仅内部调度访问 |

**判定**：A 类需要"当事方谓词"（已做）；B 类不应加；C 类加 `organizationId` 会造出
"用户有两个租户维度"的二义性，属错误建模；D 类不动。

> 只有一种情况需要重新考虑命名：若将来要求"组织内共享 IM 会话"，`Conversation` 才需要
> 引入 `organizationId`。届时是一次 schema 迁移 + 数据回填，不在本次范围。

---

## 4. 静态审计：182 条查询，0 条未登记风险

新增 `scripts/qa/tenant-scoping-audit.mjs`（`npm run audit:tenancy`）：

- 解析 `prisma/schema/*.prisma` → 找出 21 个 org 模型 + 1 个双主体模型；
- 扫描多租户面 117 个文件（`src/lib/{connection,outcome,bridges,agents,workflow,billing,tenancy,interop}` + `src/app/api/v1`）；
- 对每条 `db.<model>.<op>()` 做平衡括号截取，判定：`scoped` / `via-variable` / `follow-up` / `public-share` / `unknown`；
- `unknown` 必须进 baseline 并写明理由，否则 `--strict` 判红。

```
扫描文件 117 个｜租户模型查询 182 条｜org 模型 21 个｜双主体模型 1 个
需人工判定 5 条｜未登记 0 条｜baseline 失效 0 条
✅ 无未登记的跨租户风险查询
```

### 4.1 自证（`--self-test`，6 条）

| 用例 | 期望 |
|---|---|
| 直写 `organizationId` | 0 报 |
| `where` 变量内含谓词（含 `{ where }` 简写） | 0 报 |
| **变异**：去掉 `organizationId` | 1 报 |
| 双主体模型用 `OR` 当事方 | 0 报 |
| **变异**：双主体模型只按 id | 1 报 |
| 反向对照：schema 无租户字段时扫描数 = 0 | 证明"报 0 条"必须配合 `scanned > 0` 才有效（防空集假绿） |

> 第一次跑自测时 `via-variable` 用例失败（只支持 `where: ident`，不支持 `{ where }` 简写）——
> 已修。这条弯路本身说明自测有效：如果只跑"实仓 0 发现"，我永远不知道自己漏了一类写法。

### 4.2 baseline 的 5 条（全部人工看过代码）

| 位置 | 理由 |
|---|---|
| `bridges/optins.ts:170` opt-in 更新 | 复合唯一键 `bridgeId_userId`；`bridgeId` 来自 `findBridgeRow(org)` 已校验当事方 |
| `workflow/runtime.ts:989` worker 锁回收 | 调度器全局视角，只改锁字段且 `lockedBy=自身` |
| `workflow/workflow.ts:50` 按 `proposalId` 查重 | `proposalId` 全局唯一；创建时已写入 `organizationId` |
| `billing/service.ts:223/230` 用量写入 | `rows` 每行都显式带 `organizationId`（同函数 209 行），扫描器看不到变量内容 |

---

## 5. 本轮实际修复的 4 处代码

| # | 文件 | 改动 | 性质 |
|---|---|---|---|
| 1 | `src/lib/tenancy/guard.ts` | ALL/ANY 显式化 + 单能力禁数组 + 空集抛错 + 审计记 `mode` | **设计缺陷**（SEC-06） |
| 2 | `src/app/api/im/consent/route.ts` | 新增 `DELETE` 撤销同意（仅授出方本人、幂等、清会话缓存、写 `consent_revoked` 审计） | **真实功能缺口**（SEC-07） |
| 3 | `src/lib/connection/missions.ts` | 删除 `withdrawFromMission(userId, missionId)` —— 无租户谓词的写入口，全仓零调用 | **后门 API 清理** |
| 4 | `src/lib/bridges/bridges.ts`、`src/lib/agents/runs.ts` | 3 处写操作补租户谓词（`compensate` 硬删除、CAS 迁移、Agent 裁决） | 纵深防御 |

第 2 项值得单独说：`isRevoked` 字段、`revokedAt` 字段、索引、`AuditAction` 里的
`consent_revoked` 全都在，读取路径也都按 `isRevoked: false` 过滤 —— **唯独没有写入者**。
这不是"没实现"，是"看起来实现了"。它比完全没做更危险：审计时看到字段在、枚举在，
容易误判为"支持撤销"。

---

## 6. SEC-01 ~ SEC-08 逐项判定

| 编号 | 判据 | 实测证据 | 判定 |
|---|---|---|---|
| SEC-01 | A 读 B 的 Mission → 403/404，无泄露 | `transitionMission` / `getMission` 均为 `findFirst({ id, organizationId })`，未命中即 `NotFoundError`（404，不泄露存在性）；`resolveTenant` 回查 memberships | **PASS**（代码级）· 真实双组织 **BLOCKED** |
| SEC-02 | A 改 B 的 Mission → 拒绝且 DB 不变 | 同上：读不到即抛 404，写操作不会执行；`update` 前必有一次 scoped `findFirst` | **PASS**（代码级）· 真实双组织 **BLOCKED** |
| SEC-03 | 跨租户列表/搜索不返回他人数据 | `listMissions` / `listMyIntents` / `listCandidates` 的 `where` 首字段即 `organizationId`；静态扫描 182 条 0 未登记 | **PASS** |
| SEC-04 | 跨租户 Agent 操作 → 服务端拒绝 | `findRunRow(org, id)` + 服务层复判 `can(role,'agent.approve')`（纵深防御）；本轮又给 `agentRun.update` 补了 org 谓词 | **PASS**（代码级） |
| SEC-05 | 跨租户 MCP / A2A 调用 → 无授权不可访问 | `src/lib/interop` 与 `/api/v1` 均在扫描范围内，0 未登记；工具层复用同一 `TenantContext` | **PASS**（代码级） |
| SEC-06 | 弱能力混入不得降低所需权限 | 语义已拆分；9 条单测含"混入即 403"与"换成 ANY 则 200"的变异对照 | **PASS** |
| SEC-07 | Consent 撤销后受限操作全部拒绝 | 读取路径本就过滤 `isRevoked`；本轮补上唯一缺失的写入者 `DELETE /api/im/consent` + 7 条测试 | **PASS**（修复后，生产部署待 CI） |
| SEC-08 | 审计含主体/组织/动作/结果，不泄露密钥 | `writeTenantAudit` + `redactMetadata()` 拦截 password/secret/token/email/phone/card 等 20 类键；`capability_denied` 记录 role + required + mode | **PASS** |

### 为什么 SEC-01/02/04/05 只能算"代码级 PASS"

V17 的判据是**行为**（A 访问 B 必须被拒），而不是"代码里写了谓词"。要在真实环境证明，
必须有两个都有数据的组织 —— 当前生产只有一个，建第二个需要你授权（涉及真实数据）。
因此这四项标 **PASS（代码级）+ BLOCKED（行为级）**，不合并成一个"通过"。

---

## 7. 残留风险

| 风险 | 现状 | 缓解 |
|---|---|---|
| 无第二个真实组织 | BLOCKED | 已用"静态扫描 + 单测 + 变异"三重替代证据；一旦授权即可跑负向剧本 |
| `follow-up` 判定依赖 40 行窗口 | 启发式，可能漏判 | `--strict` 有 baseline 失效告警；新增写操作会在 diff 里显形 |
| legacy B2C 面未纳入扫描 | 本次范围是多租户面（Connection OS） | V17 不把 B2C 当主线；若要收口需单独排期 |
| `consent` 撤销未覆盖"组织内共享"场景 | 该场景尚未建模 | 与 §3 的 `Conversation` 迁移一并考虑 |

---

## 8. 状态

**PASS**（SEC-01~08 均为 PASS 或 PASS+BLOCKED，无 FAIL）

- 有证据：扫描输出、自测输出、9+7 条测试、4 处代码 diff。
- 有纠正：交接书的"11 张表"与"高概率越权"都按实测下调/改写了，未照抄。
- 有前提：真实双组织负向测试仍 BLOCKED，未用"代码看起来对"替代行为证明。
