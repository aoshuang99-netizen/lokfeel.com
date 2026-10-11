# T05 · changes — 变更记录

> 基线 commit **`cca7b80`**（`chore(qa): T04 生产上线复验脚本 + 回填发布基线`，`main`）。
> 任务：**`T05_CONSENT_TRUST` — 双边同意、审批、撤销与审计**。
> 验收：**AC-04 / AC-05 / AC-06**（三条都是 BLOCKER）。
> 前序交接：T04 在候选页**刻意不放**"建立连接"按钮（双边同意属 T05），
> 并留下两条约束 ——
> ① `CANDIDATE` 档位是"同意之前"的可见度，**T05 落地后才会真正生效**；
> ② `COUNTERPARTY` 档位在 T04 时点**没有任何读路径**（用户选了却永不生效），
> 由 T05 接通。

---

## 1. 提交

| 项 | 值 |
|---|---|
| 交付提交 | `75897d3` — `feat(t05): 双边同意与撤销 —— 提案状态机、介绍执行点与移动端连接页`（含 `[skip netlify]`） |
| 本文档回填 | 紧随其后的文档提交 |
| 分支 | `main` |
| 上线 | Netlify 免费计划，**站点级变量**；`allowed_branches=['main']`，推 `main` 才发版 |

> ⚠️ 提交信息里**不得**出现 `[skip netlify]` 以外的跳过指令，且 `[skip netlify]` 会被
> **扫描整条提交信息（含正文）** —— 发布提交的正文里若写出它，会自伤静默跳过构建。

---

## 2. 交付物清单

### 2.1 Schema（**C2 批次：纯新增 2 表 + 10 索引**）

| 文件 | 规模 | 说明 |
|---|---|---|
| `prisma/schema/connection.prisma` | **+121** | 新增 `enum ConnectionProposalStatus`、`enum ProposalDecisionKind`、`model ConnectionProposal`、`model ProposalDecision` |
| `prisma/schema/core.prisma` | +9 | `User` 上三条**具名**反向关系（见下） |
| `prisma/schema/tenancy.prisma` | +7 | `Organization` 上两条反向关系 |
| `prisma/migrations/20261011170000_t05_connection_consent/migration.sql` | **72 行（新）** | 纯新增；**无** ALTER、**无** DROP、**无** 数据订正 |
| `scripts/connection/migrate.mjs` | +177 | 注册 C2 批次（幂等：先按 `PRAGMA table_info` 差集只补缺口） |
| `src/generated/**` | 6 文件再生 | `npx prisma generate` 产物 |

**为什么额外需要三条具名关系**：`ConnectionProposal` 有**两个**都指向 `User` 的外键
（`proposerId` / `candidateId`）。不显式命名的话 Prisma 无法判断哪一侧是哪一侧 ——
它**不会报错**，只会生成混淆的两个字段，写入时错位。因此：
`@relation("ProposalProposer")` / `@relation("ProposalCandidate")` /
`@relation("UserProposalDecisions")`。`Organization` 侧不需要命名：两条外键里只有
`organizationId` 指向它。

**`@@unique([missionId, proposerId, candidateId])`** 是"重复发起"的最后一道兜底：
即便调用方换了 `Idempotency-Key`，也不会为同一对搭档堆出多条并行同意流程 ——
那会把"双方同意"退化成"同意其中一条"，而另外几条仍在待决（界面自相矛盾）。

### 2.2 运行时可复用内核 `src/lib/connection/`

| 文件 | 规模 | 作用 | 关键约束 |
|---|---|---|---|
| `proposals.ts` | **+1050（新）** | **纯函数内核**（`resolveStatusAfterDecision` / `evaluateIntroducibility` / `deriveProposalState` / `availableActions` / `isClosed` / `isExpired` / `partyRoleOf`）+ **服务层**（`createProposal` / `decideProposal` / `revokeProposal` / `introduceConnection` / `listMyProposals` / `introductions`）+ DTO | 内核**无 IO**，可被单测直接 import；所有查询带 `organizationId` |
| `proposal-input.ts` | **+80（新）** | `parseProposalCreate` / `parseConsentDecision` / `parseRevokeNote` | `decision` 契约是**小写** `accept\|reject`，与 DB 的大写枚举之间的转换**只在这一层**发生 |
| `field-catalog.ts` | +25 | 新增 `COUNTERPARTY_PROFILE_AUDIENCE`；`auditCatalog()` 增加**秩关系**校验 | 该常量是 `COUNTERPARTY` 档**唯一的生效入口**；秩校验防"同意之后反而看不到"的反漏斗 |
| `index.ts` | +49 | barrel：T05 全部符号 + `resolveShareTokenTenant` / `ShareTokenTenant` | — |

**为什么"纯函数内核 + 服务层"分离**（本刀最重要的一条工程决策）：
`AC-04` 的全部内容就是一条状态转移规则（"双方 accept 才是 mutual"）。
把它写成服务层里的一段 `if`，它就只能通过**起数据库**来验证。
抽成 `resolveStatusAfterDecision(谁, 决定, 双方表态)` 之后，这条规则有了 12 个
纯单测，跑一次 0.3 秒，而且**任何调用方都绕不过它** —— 这正是"最容易写错的那一处"
应有的形状。

**为什么不复用 `ConsentRequest` / `ConsentGrant`**（卡片写"可复用"，这是逐条核对后的判定）：
那两个模型是 **IM 媒体访问权限** —— `consentType: MEDIA`、`requestedLevel/grantedLevel`
是 `L0_TEXT | …` 这类媒体档位、外键 `conversationId` 挂在**会话**上，
语义是"允许对方看我的摄像头 / 麦克风"。本任务要表达的是"组织者牵线，与另一个人建立连接"：
没有会话、没有媒体档位、参与者是「提案双方」而非「会话双方」。硬塞进去需要把
`conversationId` 改成可空，并给 `consentType` 加一个与 `MEDIA` 并列的取值 ——
结果是**两个语义域共用一张表**，媒体权限的查询会捞到连接提案（反之亦然），
且没有任何编译期信号。契约本身把二者分表（`consent_grants` vs `connection_proposals`），
本仓遵循契约。**可复用的是模式而非表**：拒绝即关闭、撤销清空待发、执行前再校验。

### 2.3 API（新增 4 路由 + 1 只读聚合 · 共 326 行）

| 路由 | 能力 | 说明 |
|---|---|---|
| `POST /api/v1/connections/proposals` | `proposal.create`（**OPERATOR+**） | **要求 `Idempotency-Key`**（缺失 → 400，不退化为"非幂等"）。重放时回 `Idempotent-Replayed: true` |
| `GET /api/v1/connections/proposals` | `proposal.read`（自助） | 谓词写死在服务层（`OR: [proposerId, candidateId]`）；`?states=` 过滤在**装配之后**（`EXPIRED` 是派生值，不在 SQL 里） |
| `POST /api/v1/connections/{connectionId}/consent` | `proposal.decide`（自助） | body `{decision: 'accept'\|'reject'}`。**单方 accept 也是 200**（状态仍 `CONSENT_PENDING`）—— 它不是"部分成功"，而是此刻最正常的返回 |
| `POST /api/v1/connections/{connectionId}/revoke` | `proposal.decide`（自助） | 空 body / 无 body 均合法；立刻终态并写 `closedAt` |
| `POST /api/v1/connections/{connectionId}/introduce` | `proposal.create`（OPERATOR+） | **AC-06 的执行点**（本仓显式新增；契约把它隐含在"介绍工作流"里）。**刻意不带幂等键** —— 重复调用回 409 是**正确结果**，见 §3.6 |
| `GET /api/v1/connections/introductions` | `proposal.read`（自助） | 已建立连接的清单（`COUNTERPARTY` 档投影） |

`_shared/params.ts`：`proposalIdOf(params)` —— 路径参数名是 `connectionId`，
但它在语义上**就是提案 id**（合同的命名，见 §4）。

**为什么 `proposal.create` 是运营能力而不是自助**：这是"牵线由社群主理人发起、
被介绍的人自己表态"这一产品语义在权限层的落点。普通成员**不能**替别人发起连接；
但**读**和**表态**是自助的 —— 同意权不能被代理人行使。

### 2.4 前端（2 页 + 2 客户端组件）

| 文件 | 规模 | 说明 |
|---|---|---|
| `src/app/m/[token]/proposals/page.tsx` | **+351（新）** | RSC。三分区：**待处理 / 已建立连接 / 已结束**。`stateInfo()` 明确区分"双方已同意等待介绍"≠"已建立连接" |
| `src/app/m/[token]/proposals/proposal-actions.tsx` | **+144（新）** | 客户端。接受 / 拒绝 / 撤回，**动作清单由服务端下发**；401 跳登录 |
| `src/app/m/[token]/matches/propose-button.tsx` | **+153（新）** | 客户端。**仅运营可见**的"发起连接"表单（`rationale` 8–500 字，自带 `Idempotency-Key`） |
| `src/app/m/[token]/matches/page.tsx` | +80/−? | 加"我的连接"入口；运营可见时渲染 `ProposeButton`；文案改为 T05 口径 |
| `src/app/m/[token]/page.tsx` | +27/−? | 已加入成员区域加"我的连接 →"链接 |

三条与全站一致的红线在页面上都成立：
**内部标识不进 DOM**（`organizationId` / `missionId` / 对侧 `userId` 一概不渲染）、
**动作由服务端下发**（前端不自己推断"我现在能点什么"）、
**拒绝理由不回流**（对侧只显示"是否已表态"，不显示 `note`）。

### 2.5 测试与夹具（详见 `tests.md`）

| 文件 | 规模 | 内容 |
|---|---|---|
| `tests/connection/proposals.test.ts` | **+691（新）** | 纯内核 + 服务层，**49 例** |
| `tests/connection/proposals-api.test.ts` | **+713（新）** | HTTP 层端到端，**34 例** |
| `tests/e2e/consent-trust.spec.ts` | **+453（新）** | 移动端 E2E，**7 例** |
| `scripts/qa/seed-t05-e2e.mjs` | **+440（新）** | 夹具：**独立 Mission** `mission_e2e_t05`（6 提案 / 6 表态 / 3 新用户） |
| `tests/e2e/candidate-match.spec.ts` | 改 1 处断言 | T04 里 `matches-connect-coming` → T05 后的 `matches-connect-note` + `matches-view-proposals` |

---

## 3. 设计决策（值得单独记下来的）

### 3.1 AC-04：`CONSENT_PENDING` **跨越第一次 accept**

最常见的实现错误是把 accept 直接写成"状态 = ACCEPTED"，于是**谁先点谁触发** ——
第一个同意的人就把提案推到了"可介绍"。本文件的判据始终是
`MUTUALLY_ACCEPTED`（**双方**均已 accept），而不是"有人同意了"。
单方 accept 的返回仍是 `200` + `state: 'CONSENT_PENDING'` —— 把它做成 `202`
或别的码会诱导前端把"等待对方"当成异常。

### 3.2 AC-05：终态不可逆，且**同意过后只剩「撤回」**

`REJECT` / `REVOKE` 立刻进终态并写 `closedAt`；终态之后**任何**表态一律 `409`，
**不是**幂等成功。理由：若"'拒绝'之后再'接受'"被静默接受，用户会以为自己改变了主意，
而对方早已收到拒绝 —— 这种"两端认知不一致"比一个显式报错危险得多。

**本刀修掉的第二处（装配层）**：`availableActions()` 是**角色无关**的纯函数
（它不知道"我"是谁），所以"我已同意"这层过滤必须在装配处做。原先只滤掉了 `ACCEPT`，
于是"我已经同意过"的提案上会**同时**出现「拒绝」和「撤回」两个按钮 ——
它们产生**不同**的 `ProposalDecision`（REJECT vs REVOKE）却造成**相同**的终态，
审计里"曾经同意过"这件事就被覆盖成了"拒绝"。
现在同意过后**只剩「撤回」**：同意之后改主意的准确语义是**撤回同意**，
不是"拒绝一个我没拒绝过的邀约"。

### 3.3 AC-06：执行时校验 = **重新查 + CAS 写**

介绍是本任务唯一的**执行点**。它在**执行的那一刻**重新确认两件事：

1. 提案自身仍 `MUTUALLY_ACCEPTED`、未过期、未撤销、未介绍过 —— `evaluateIntroducibility()`（纯函数）；
2. **双方**的 `SocialIntent` 此刻仍 `ACTIVE` 且未过期 —— `loadLiveParties()`（IO）。

写入用**条件更新**实现 compare-and-swap：

```ts
db.connectionProposal.updateMany({
  where: { id, organizationId, introducedAt: null, status: 'MUTUALLY_ACCEPTED' },
  data: { introducedAt: now },
})
// count !== 1 → 409 "state changed while introducing"
```

**这才是真正的"执行时校验"** —— "先查再写"在并发下仍然会双写。
`updateMany` 把"再校验"和"写入"合并成一条原子语句，两个并发请求只有一个能成功。

### 3.4 披露档位随**阶段**升级（接通 T04 的 `COUNTERPARTY`）

| 阶段 | 档位 | 为什么 |
|---|---|---|
| 同意前 | `CANDIDATE` | 双方本就是**同任务的伙伴**，与 T04 候选页同一档位 —— 不因为"多了一条提案"而放宽 |
| 介绍**落地后** | `COUNTERPARTY` | 用户在意图表单里为此档单独授权过 |

升级判据是 `introducedAt !== null`，**不是**"双方点了同意"：
同意只表示"愿意被介绍"，介绍尚未发生前双方仍是候选关系。
若把判据写成"同意即升级"，用户只授权给「匹配后的对手方」的字段（如年龄）
会在**还没被介绍**时就泄露出去 —— E2E 与 API 测试各有一条负测钉住这一点
（`age: COUNTERPARTY` 的哨兵值 47 在未介绍的卡片上**一次都不该出现**）。

降级**即刻生效**：任一方撤销 / 过期意图后，`liveDisclosureOf()` 当次即为空表，
投影立刻归零，不需要任何定时任务配合（T03 R6 的同一条不变量）。

### 3.5 `EXPIRED` 是**派生值**，不落库

与 T03 的 `IntentStatus` 同一取向。落库就必须有人按时把它翻过去 ——
一旦那个定时任务停摆，"过期"会静默失效，而过期的提案仍可被介绍。派生没有这个失败模式。
代价是 `?states=EXPIRED` 的过滤只能发生在装配之后（已在路由注释里写明，
防止日后有人"优化"进 SQL —— 那会让 `EXPIRED` 静默变成"过滤不掉"，而不是报错）。

### 3.6 `introduce` **刻意不带幂等键**

`POST /connections/proposals` 要求 `Idempotency-Key`，而 `introduce` 不要。
这不是疏漏：介绍是**一次性事实**，"再介绍一次"本身就是错误请求，
正确的答复是 `409 already_introduced`，而不是"回放上次结果"。
若给它幂等键，反而会把"第二次点击"伪装成成功 —— 用户会以为产生了第二次介绍。

### 3.7 拒绝理由不回流

`ProposalDecision.note` 只落库供审计，**不返回给对侧**（DTO 里对侧只有
`counterpartDecision: 'ACCEPT' | 'REJECT' | null`，没有 `note`）。
否则"拒绝理由"就成了一次计划外的信息披露。

### 3.8 401 跳登录用 `router.push()`，不用 `window.location.href`

两个客户端组件（`proposal-actions.tsx` / `propose-button.tsx`）原先用
`window.location.href = '/login?callbackUrl=…'` 做整页跳转。ESLint 报两处：

- `react-hooks/immutability` —— **error**："This value cannot be modified"
  （对组件外定义的值赋值）；
- `@next/next/no-location-assign-relative-destination` —— **warning**。

改用 `router.push()`（Next 官方推荐的客户端导航）后两项一并消除，
门禁因此回到 **0 error / 0 warning**。行为差异（软导航 vs 整页跳转）
对本场景（会话已过期、目标只是登录页）无影响。

---

## 4. ⚠️ 契约路径陷阱（E2E 才暴露出来的真实 bug）

契约里 `{connectionId}` 这个路径参数，在 T05 的三个端点上**就是提案 id**：

```
POST /api/v1/connections/{connectionId}/consent     ← 只有 3 段
POST /api/v1/connections/{connectionId}/revoke
POST /api/v1/connections/{connectionId}/introduce
```

**没有** `proposals` 中间段。本刀在实现期犯过 3 次同一个错（把 URL 写成
`/connections/proposals/{id}/consent` 这种 4 段路径），**每一次都能通过单元测试** ——
因为单测是直接 `import` handler 并手工传 `params`，根本不经过路由匹配。
只有真正跑 E2E 的浏览器点击（与 `ctx.request`）才会得到 `404`。

> 教训：**路径形状属于路由层，只有端到端能证**。凡是"手工传 params"的测试，
> 都覆盖不到它。

---

## 5. 与 T04 交接的闭合

| T04 留下的约束 | T05 的落点 |
|---|---|
| 候选页**刻意不放**"建立连接"按钮 | `/m/<token>/matches` 现在放的是**仅运营可见**的「发起连接」；普通成员看到的是"去我的连接看提案" |
| `CANDIDATE` 档位"同意之前只看到该看到的" | 提案卡片上，未介绍前的对方投影一律 `CANDIDATE`（E2E 断言键集/值级扫描） |
| `COUNTERPARTY` 档位**没有任何读路径** | `introduceConnection()` → `assembleProposal()` 在 `introducedAt !== null` 时改用该档；这是它唯一的入口 |

---

## 6. 未做 / 交接给后续任务

| 项 | 状态 | 归属 |
|---|---|---|
| 介绍的**重试 / 超时 / 死信 / 人工接管** | ❌ 只做了同步执行点与并发安全 | **T06** Workflow Execution |
| 介绍后的**协调与成果记录** | ❌ 未做 | T06 / T08 |
| 邮件 / 站内通知（"你有一条新提案"） | ❌ 未做；目前靠用户主动打开"我的连接" | T06 |
| 跨社群提案（`CommunityBridge`） | ❌ 未做 | T10 |
| 组织者侧的**批量发起**界面 | ⚠️ 只做了候选页的单条发起 | T07 SaaS Console |
| 提案的**分页** | ⚠️ `limit` 默认 50，无游标 | T12 |
| 隔离是**应用级**而非 DB 级（libSQL 无 RLS） | ⚠️ 现状 | M6（PG + RLS） |
