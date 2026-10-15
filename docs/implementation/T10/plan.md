# T10 · Community Bridge —— 实施计划

> 依据：`tasks/T10_COMMUNITY_BRIDGE.md`（立项总包）与 `docs/implementation/BACKLOG.md` §3 T10 卡片。
> 验收：**AC-19（P1）** —— 跨社群**仅**共享明确 opt-in 的数据，**双边群主配置生效**。
> 铁律：**无跨群默认共享**；**不得直接查询对方私有行**。

## 0. 问题定义（先把"跨群"与"同群"划开）

T03–T06 建立的整套披露模型有一个隐含前提：**双方在同一个租户（Organization）内**。
`discloseSubject(profile, map, 'CANDIDATE')` 的受众档位、`CONNECTION_EXTERNAL_AUDIENCES`
的三个取值，全部预设"组织者/对手方/同任务伙伴"共享一个租户上下文。

跨社群把前提抽掉了：**两个群主各管一个租户，互不隶属**。于是出现三个新问题：

1. **谁有权开启共享** —— 不是成员，是**双方群主**（协议层）。一方的意愿不能强加给另一方。
2. **成员凭什么被共享** —— 默认**不共享**。协议只是"允许共享的**上限**"，成员必须**逐个** opt-in。
3. **共享出去的是什么** —— 只能是三方**交集**（群主配置 ∩ 成员选择 ∩ 成员自己的披露档位），
   且**永远不能**是"对方租户的私有行"。

> 🔴 这三条决定了 T10 的形态：它**不是**"多一个受众档位"，而是**独立的一层授权**。
> 把跨群塞进 `CONSENT_AUDIENCES` 会立刻违反铁律（那等于给同租户四个受众多开一个口子，
> 而"跨群"恰恰**不**是同一信任域）。

## 1. 核心判据：三方取交集（AC-19 的可执行定义）

跨群可见字段 = **① ∩ ② ∩ ③**，任一环缺失则该字段**不可见**：

| 环 | 来源 | 收窄方向 |
|---|---|---|
| ① 群主配置 | `CommunityBridge` 的 `initiatorFieldKeys` ∩ `recipientFieldKeys` | 双方都允许才生效（**双边配置生效**） |
| ② 成员 opt-in | `BridgeMemberOptIn.disclosedFieldKeys` | 必须 ⊆ ①（成员不能放得比群主宽） |
| ③ 成员披露档位 | 该成员 T03 意图的 `DisclosureMap`（经 `discloseSubject()`） | 必须 ⊆ ② |

**单调性铁律**（贯穿三层）：下层只能**收窄**，不能放宽。
任一层出现"下层比上层宽" ⇒ 服务层**拒绝该字段**并记审计（fail loud），而不是静默取上层的值 ——
因为"我 opt-in 了 X，但系统按别人配的 Y 给了我"是**最危险**的一类静默失败。

**默认拒绝**：`bridge.status !== 'ACTIVE'` ∨ 已过期 ∨ 成员无 `ACTIVE` 的 opt-in ⇒ **空投影**。
代码里**不存在**"没配任何东西也能读到对方成员"的路径。

## 2. 🔴 铁律 → 结构性保证（对齐 T09 的写法）

| 铁律 / 要求 | 结构性保证 |
|---|---|
| **无跨群默认共享** | 跨群读取的**唯一**入口是 `projectBridgeView()`。它按上述三环判定，缺任一环即返回空 —— 没有任何"旁路读取"存在 |
| **不得直接查询对方私有行** | ① 内核 `src/lib/bridge/`（单数）**无 IO**（门禁 B2），因此不可能出现 `prisma.socialIntent.findMany({where:{organizationId: partner}})` 这类直查；② 服务层 `src/lib/bridges/` 的跨群查询**只以 `bridgeId` + 交集字段集**为谓词，且出口**必**经 `discloseSubject()` 投影 |
| **双边群主配置生效** | `status` 由 `initiatorApprovedAt` ∧ `recipientApprovedAt` **派生**（缺一即 `PENDING`），且**只**由 `transitionBridge()` 独占修改；撤销走独立端点 |
| **成员逐个 opt-in** | 共享无"群级默认值"。`BridgeMemberOptIn` 是**逐人**行，缺行 = 未加入 |
| **撤销即刻生效** | 成员 opt-out ⇒ opt-in 行置 `WITHDRAWN`；群主 revoke ⇒ bridge 置 `REVOKED`。投影每次**实时**取 DB，不缓存"上次可见的集合" |

> **诚实声明**：与 T09 的 `guard.ts` 同理 —— 门禁 B1/B2/B5 是**文本级**的，
> 它保证的是"内核里**写不出**直查对方行的代码"，**不是**"运行时绝不会越权"。
> 运行时的保证来自那套**三方交集判定**本身，以及 §6 的 E2E 反向对照。

## 3. 数据模型（C9，**纯新增**，两表）

> 迁移机制只支持 `CREATE TABLE/INDEX IF NOT EXISTS`（无 ALTER），故 T10 的落点必须是**新表**。

### `CommunityBridge` —— 组织间的合作协议（双边）

- `id`
- `initiatorOrgId` / `recipientOrgId`（**软引用**，与 T08/T09 同一取向：组织注销后协议仍须可查）
- `status`（`DRAFT | PENDING | ACTIVE | REVOKED | EXPIRED`）—— 落列理由同 `AgentRun.status`：
  "我参与的活跃协议"是**必须下推 SQL** 的查询（`WHERE status='ACTIVE'`）
- `initiatorFieldKeys` / `recipientFieldKeys`（JSON 数组，各自允许披露的字段）
- `shareableMissionKinds`（JSON 数组，可共享的**任务类型**）
- `purpose`（用途声明 —— purpose limitation）
- `initiatorApprovedAt` / `recipientApprovedAt`
- `expiresAt` / `revokedAt` / `revokedBy`
- `createdBy` / `createdAt` / `updatedAt`
- `@@unique([initiatorOrgId, recipientOrgId])` —— 一对组织同时只有**一份**协议（防重复开启）

### `BridgeMemberOptIn` —— 成员逐个选择加入

- `id` / `bridgeId`（**强 FK** → `CommunityBridge`）/ `organizationId`（**强 FK**）
- `userId`（**软引用**）
- `status`（`ACTIVE | WITHDRAWN`）
- `disclosedFieldKeys`（JSON 数组；必须 ⊆ 本组织在 bridge 里配置的字段）
- `optedInAt` / `withdrawnAt`
- `@@unique([bridgeId, userId])` —— 一人一份，重复 opt-in 是幂等更新而非新增行

**为什么 `bridgeId` 建真 FK 而 `userId` 不建**：`bridgeId` 指向**同一租户内**的协议行，
删除协议必须级联清 opt-in（否则孤儿行会被投影当成"有效授权"）；而 `userId` 与 T09 一致 ——
用户注销后"谁 opt-in 过什么"仍须可查。

## 4. 目录边界（**继承 T09 的双目录纪律**）

| 目录 | 性质 | 内容 |
|---|---|---|
| `src/lib/bridge/`（单数） | **纯内核**，无 IO、无网络、不碰授权 | `types.ts`（状态/拒绝码）、`policy.ts`（三方交集判定，纯函数） |
| `src/lib/bridges/`（复数） | **服务层**，允许 IO | `bridges.ts`（协议 + 双边审批）、`optins.ts`（成员 opt-in）、`discovery.ts`（跨群投影）、`dto.ts`、`index.ts` |

🔴 **目录边界就是执法点**（与 T09 的 `agent`/`agents` 同一理由）：内核无 IO 使"交集判定"
可以在无数据库、无凭据的情况下被完整单测覆盖。把两件事混进一个目录，门禁 B1/B2 会**静默**失效。

## 5. 能力与 HTTP 面

**新能力**（同步进 `TENANT_CAPABILITIES` + `ROLE_CAPABILITIES`）：

| 能力 | 归属 | 理由 |
|---|---|---|
| `bridge.read` | `SELF_SERVICE` | 成员要能看见"本组织有哪些协议、我是否已加入" |
| `bridge.manage` | `ADMIN_EXTRA` | 开启/批准/撤销跨群共享 = 决定"本群成员数据能否出街"，与 `agent.approve` 同一取向（要第二双眼睛），归 ADMIN+ |
| `bridge.optin` | `SELF_SERVICE` | 成员**自主**决定自己是否加入 —— 这正是 AC-19 要求的"逐个 opt-in" |

**HTTP 面**（`src/app/api/v1/bridges/`）：

- `POST /api/v1/bridges` —— 发起协议（`bridge.manage`，幂等键）
- `GET  /api/v1/bridges` —— 列表（本组织发起 + 受邀）
- `POST /api/v1/bridges/[bridgeId]/approve` —— 被邀方批准（`bridge.manage`）
- `POST /api/v1/bridges/[bridgeId]/revoke` —— 撤销（`bridge.manage`）
- `POST /api/v1/bridges/[bridgeId]/opt-in` —— 成员加入（`bridge.optin`，带字段选择）
- `POST /api/v1/bridges/[bridgeId]/opt-out` —— 成员退出（`bridge.optin`）
- `GET  /api/v1/bridges/[bridgeId]/discovery` —— 跨群可见成员投影（`bridge.read`）

## 6. 切片

### Slice 1 · 纯内核（无 IO、无网络 → 全部可单测）

- `src/lib/bridge/types.ts`：`BRIDGE_STATUSES` / `BRIDGE_REFUSAL_CODES` / `BridgeStatus`
- `src/lib/bridge/policy.ts`：
  - `bridgeUsableReason(bridge, now)` —— 返回可用 / 拒绝码（未 ACTIVE / 过期 / 已撤销）
  - `intersectBridgeFields(initiatorKeys, recipientKeys, optInKeys, intentKeys)` —— **三方交集**，
    并**同时**返回被哪一环收窄（供 UI 说明与审计）
  - `planBridgeVisibility(...)` —— 合成判定；**拒绝码分开列**（与 T09 的 `EXECUTION_GATE_CODES` 同一手法）

### Slice 2 · 持久化 C9 + 服务层 + 能力 + 审计

- 迁移 C9（`CommunityBridge` / `BridgeMemberOptIn`）
- `src/lib/bridges/`：协议 CRUD、双边审批、opt-in/out、跨群投影
- 审计事件：`bridge.created` / `approved` / `revoked` / `member.opted_in` / `member.opted_out`
- 🔴 审计面最小化：只记**计数与状态**，**不记**对方字段值

### Slice 3 · HTTP 面 + DTO

- 七个端点 + 请求/响应 DTO + 幂等键 + 能力守卫

### Slice 4 · 前端 + AC-19 E2E 取证

- 工作区新增 **Bridge** 区（在既有七屏之外，或并入 Consent 区的一个子面板）
- `verify-ac19-bridge-e2e.mjs`：真实 Chrome + 隔离库 + 两个租户夹具
  - **正向**：双群主批准 + 双方成员 opt-in ⇒ 交集字段**可见**
  - **反向（同权）**：未 opt-in 的成员**不可见**；单边批准（PENDING）**不可见**；成员 opt-in 收窄后字段**不可见**；群主 revoke 后**立即不可见**
  - **越权**：以 A 群成员身份尝试读 B 群私有行 ⇒ 失败

## 7. 门禁

新增 `scripts/check-bridge-invariants.mjs`（**照 `check-agent-invariants.mjs` 的结构**，扫描 `src/lib/bridge/**`）：

| 规则 | 内容 | 为什么 |
|---|---|---|
| B1 | 不得 import `@/lib/tenancy` | 授权不属于内核（同 A1） |
| B2 | 不得 import `@/lib/db` / `@/lib/prisma` / `@prisma/*` | 内核无 IO（同 A2）——**这条同时是"不得直接查询对方私有行"的第一道结构性保证** |
| B5 | 不得出现网络调用 | 同 A5 |

配 `--self-test`（在扫描目录内注入单条违反 → 断言 exit 1 且命中对应 `[Bn]`；再写合法文件做负向对照）。

## 8. 未决 / 边界（诚实清单）

1. **跨群介绍的执行**：本切片让双方"可见"；**真正发起跨群介绍**复用 T05 的 proposal 流程
   （跨群只是让 candidate 出现在对方的候选集里）。若 T05 的 proposal 模型假设同租户而无法直接复用，
   本条降级为**仅可见 + 手动联系**，并在文档中显式标注。
2. **`shareableMissionKinds` 的取值域**：初版取自由字符串（任务类型尚未收敛成枚举），
   但落库前做长度与非空校验 —— 不让它退化成"什么都允许"的 `'*'`。
3. **前端归属**：Bridge 是新增一屏，还是 Consent 区的子面板 —— 取**后者**（少一次导航层级变更，
   且 AC-18 的七屏口径保持不变）。
4. **跨境合规**：跨群共享涉及两方主体的数据出境/境内流转，本切片只做**技术**上的最小披露；
   合规文本不在代码范围，须由产品侧补充（标注为 T12 的风险项）。
