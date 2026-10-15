# T10 · Community Bridge —— Slice 2 交付记录（C9 落库 + 服务层 + 能力 + 审计）

> 计划见同目录 `plan.md` §3（数据模型）/ §5（能力）/ §6（切片）；内核见 `slice-1.md`。
> 范围：`prisma/schema/bridge.prisma`、`prisma/schema/tenancy.prisma`（+1 反向关系）、
> `scripts/connection/migrate.mjs`（+C9）、`src/lib/bridges/*`、`src/lib/tenancy/capabilities.ts`、
> `tests/bridge/schema-drift.test.ts`。
> **不发版**：提交带 `[skip netlify]`，仅在本地与隔离库验证。

## 1. 交付物

| 文件 | 职责 | 关键设计 |
|---|---|---|
| `prisma/schema/bridge.prisma`（新） | `CommunityBridge`（16 列）+ `BridgeMemberOptIn`（10 列）+ 两个枚举 | 纯新增、方言无关（无 `@db.*`）、JSON 列一律 `String`（libSQL 下 `Json` 落 TEXT，坏字符会打挂整行读取）；`status` **落列**（"我参与的活跃协议"必须能下推 SQL） |
| `prisma/schema/tenancy.prisma`（改） | `Organization.bridgeMemberOptIns` 反向关系 | 🔴 **只加这一条**：`initiatorOrgId` / `recipientOrgId` 是**软引用**，因此 `CommunityBridge` 在 `Organization` 上**没有**反向字段（schema-drift 里有一条 `not.toMatch(/communityBridges/)` 钉住这件事） |
| `scripts/connection/migrate.mjs`（改） | 新增 **C9** 批次（2 表 + 7 索引 + 2 外键） | DDL 由 `prisma migrate diff` 生成后**逐字**拷入；`verify` 新增 **4j 段**，其中含一条**反向对照**断言：`CommunityBridge` **有** `status` 列（与 T09 断言 `AgentDeliveryTarget` **没有** status 方向相反、同时成立） |
| `src/lib/bridges/dto.ts`（新） | DTO 投影（**唯一**对外形状）+ 行形状 | 跨群可见字段**只有一条出口**；🔴 逐字段**归因**（`narrowed` + `who`）**只在本人视角**，跨群视角只给聚合计数 |
| `src/lib/bridges/bridges.ts`（新） | 协议聚合：发起（幂等）/ 列表 / 双边审批 / 撤销 | `status` 的**唯一**写入点；UPDATE 带 `status = 期望起始态` 的 **CAS 谓词**；能力判定只查表（`can()`），不含推理 |
| `src/lib/bridges/optins.ts`（新） | 成员逐个 opt-in / opt-out | 🔴 **fail loud**：成员勾了群主没开的字段 ⇒ **整单拒绝**（400 + `bridge.optin_rejected` 审计），而不是静默收窄 |
| `src/lib/bridges/discovery.ts`（新） | 跨群投影（**唯一**的跨群读取路径）+ 本人视角投影 | 跨群查询谓词只有 `bridgeId + organizationId + status`；出口**必**经 `discloseSubject()` **且**再按交集二次裁剪；协议不可用**不抛错**，回空列表 + 原因码 |
| `src/lib/bridges/index.ts`（新） | 服务层出口 | 与 `@/lib/bridge`（内核）的目录边界即 B1/B2 的**执法点** |
| `src/lib/tenancy/capabilities.ts`（改） | 新增 `bridge.read` / `bridge.optin`（SELF_SERVICE）、`bridge.manage`（ADMIN_EXTRA） | 🔴 **成员自助**与**群主管理**分离：`bridge.manage` 决定"本群成员数据能否出街"，`bridge.optin` 决定"我自己是否加入" —— 群主的管理权**不**包含替成员表态 |
| `tests/bridge/schema-drift.test.ts`（新，**17 例**） | schema 漂移守卫 | 读**真实 .prisma 文本**比对；含两条**方向相反**的断言（`EXPIRED` 在视图里、不在枚举里）与两条 `@@unique` |
| `tests/bridges/bridges-api.test.ts`（新，**35 例**） | HTTP 层 + 跨群投影取证 | 见 `slice-3.md` §3 |

### 目录边界（本切片最重要的一条约定）

```
src/lib/bridge/   （单数）= 无 IO 的纯内核 —— 受 check-bridge-invariants 的 B1/B2/B3/B4/B5 约束
src/lib/bridges/  （复数）= 允许碰 DB 的服务层 —— 它 import 内核，反之不成立
```

🔴 **依赖方向是单向的**：`bridges/` → `bridge/`。若有人从内核 import 服务层，B2 会立刻红
（内核不得 import 数据库，而服务层**必然** import 数据库）—— 这条"顺带"的失败模式让依赖方向
不需要靠 code review 维持。

## 2. 数据模型的两个刻意选择

| 选择 | 理由 | 反向对照（同样存在、方向相反） |
|---|---|---|
| `CommunityBridge` **有** `status` 列 | 「本组织参与的**活跃**协议」是必须**下推 SQL** 的查询（`WHERE status='ACTIVE'`）。不落列就只能"取最近 N 条 → 应用层过滤"，列表页的**总数**会失真 | T09 有一条断言钉住 `AgentDeliveryTarget` **没有** status —— 两者方向相反，同时成立：一个要回答"当前状态是什么"，一个只记录"创建时的事实快照" |
| `EXPIRED` **不落库** | 过期是 `expiresAt` 与当下时刻的**函数**。落列 ⇒ 第二个事实来源 + 需要一个 sweeper | 对外视图 `BRIDGE_STATUS_VIEWS` **有** `EXPIRED`（UI 要显示"已过期"）；两条断言一个 `toContain`、一个 `not.toContain` |
| `bridgeId` / `organizationId` 建**真 FK**（级联删） | 协议删除必须级联清 opt-in —— **孤儿 opt-in 行会被投影当成"有效授权"** | `userId` / `createdBy` / `revokedBy` / 两侧组织 id 一律**软引用**（无 FK）：用户注销后"谁曾加入过"仍须可查；组织注销后协议仍须可查，且重建后**不得**继承旧协议 |
| `@@unique([initiatorOrgId, recipientOrgId])` | 没有这条约束，"同一对组织开两份协议"会**静默产生双倍授权面** | `@@unique([bridgeId, userId])`：一人一份，重复 opt-in 是幂等**更新**而非新增行 |
| `WITHDRAWN` **保留行** | 「谁曾加入过、何时退出」是审计问题，删行就答不了 | 与 T06 保留失败投递记录同一取向；投影靠 `status` 判 `MEMBER_OPTED_OUT`，不依赖行的存在与否 |

### C9 的 `verify` 覆盖（`scripts/connection/migrate.mjs`）

| 类别 | 内容 |
|---|---|
| 表 | `CommunityBridge` / `BridgeMemberOptIn` 存在 |
| 列 | 逐列存在性 + 类型（含 `status` 的枚举类型名） |
| 索引 | 7 条（`(initiatorOrgId,status)` / `(recipientOrgId,status)` / `(status,expiresAt)` / `(organizationId,status)` / `(userId,status)` + 两条唯一约束） |
| 外键 | 2 条（`bridgeId`→`CommunityBridge`、`organizationId`→`Organization`，均含 `onDelete=Cascade`） |
| **反向对照** | `CommunityBridge` **有** `status` 列（防"为了统一把派生状态也落列"） |

> **未 apply 到生产**：C9 已并入迁移脚本并被 `plan` 正确识别（`⬜ CommunityBridge` / `⬜ BridgeMemberOptIn`），
> 但按用户决策「等 B 做完统一发版」，本切片**只**在隔离库验证过。发版前需再跑一次
> `npm run connection:migrate` 的 `apply`（C0–C8 已 apply，C9 尚未）。

## 3. 能力矩阵的改动与自证

| 能力 | 归属 | 为什么 |
|---|---|---|
| `bridge.read` | `SELF_SERVICE` | 成员要能看见"本组织有哪些协议、我是否已加入、我的数据会被投给谁" |
| `bridge.optin` | `SELF_SERVICE` | 🔴 AC-19 的「**逐个 opt-in**」就是它：加入与否**只能由成员自己**决定 |
| `bridge.manage` | `ADMIN_EXTRA` | 发起/批准/撤销 = 决定"整个群成员的数据能否出街"。与 `agent.approve` 同一取向取严 |

**两条新断言**（`tests/tenancy/capabilities.test.ts`）：
1. MEMBER 能读、能自己加入，但**不能** manage；OPERATOR 同样不能 manage；ADMIN/OWNER 能。
2. 🔴 `bridge.optin` 与 `bridge.manage` 是**两条独立的路** —— 存在"能 opt-in 但不能 manage"的角色
   （`['OPERATOR','MEMBER']`）。若有人把 `bridge.manage` 当成"顺便也能替成员 opt-in"，
   就等于**群主可以代成员同意**披露其数据，AC-19 的"明确 opt-in"当场失效。

> **诚实记录**：断言 2 首版写成 `toEqual(['MEMBER','OPERATOR'])`，被真实结果
> `['OPERATOR','MEMBER']` 抓红 —— 顺序跟随 `TENANT_ROLES`（OWNER→ADMIN→OPERATOR→MEMBER）。
> 这不是笔误级别的噪音：它说明**新写的断言确实在跑**，而不是被某个 `expect(...).toContain`
> 之类的宽松写法盖过去了。

## 4. 🔴 三处"刻意不做"，都是防泄漏而不是省事

1. **跨群视角不给逐字段归因**。归因回答「该找谁改」：`MEMBER_POLICY` / `INTENT_DISCLOSURE`
   意味着"去问**对方组织的那名成员**调整他的 opt-in 或意图披露"。把它下发给我们，
   等于把**对方组织的内部配置**（"张三没有勾 email"）透给外部 —— 那是**元数据泄漏**，
   不是"共享字段"。因此跨群视图只给**聚合计数**（`gatedOut`：原因码 + 人数），
   逐字段归因只出现在**本人**视角（`GET /api/v1/bridges/{bridgeId}` 的 `myProjection`）。
2. **被门控的成员身份不下发**。已 opt-in 但未产生可见字段的人，只进 `gatedOut` 计数，
   **不给 userId**。与 T02 `CandidateList.gatedOut` 同一手法。
3. **审计只记计数与状态**。`bridge.created` 记 `initiatorFieldCount` / `recipientFieldCount` /
   `missionKindCount`，`member.opted_in` 记 `disclosedCount`；**不记**任何字段键的值。
   唯一例外是 `purpose` —— purpose limitation 要求"这份共享是为什么开的"事后可答，
   且该文本由**发起方自撰**、不含对方数据。

## 5. 🔴 未覆盖 / 诚实声明

1. **`recipientFieldKeys` 在创建时是"提议"**。发起方创建时同时给出两侧字段集，其中
   `recipientFieldKeys` 是**对另一侧的提议**；**被邀方批准 = 接受该提议**（`recipientApprovedAt` 落值），
   ①环 自此才成立。因此"发起方替对方配了字段"**不会**导致任何共享（`PENDING` 时投影恒为空）。
   被邀方若不同意，本切片的唯一动作是**撤销** —— **没有"改字段"的端点**（见 §6）。
2. **`PENDING` 时允许 opt-in**（成员提前表态无害：协议不 `ACTIVE` 时投影恒为空）；
   `REVOKED` / `EXPIRED` 时 409。
3. **一名用户取"最新创建的一条意图"**作为披露依据（不是并集）。理由：取并集 = 更宽
   （把一个任务里的披露授权带到另一个任务上）；取单条 = **相对并集更保守**，且规则唯一、可解释。
4. **跨群介绍的执行**：本切片只让双方"可见"。真正发起跨群介绍复用 T05 的 proposal 流程，
   属 **Slice 4**；若 T05 的模型假设同租户而无法复用，将降级为**仅可见 + 手动联系**（plan.md §8.1）。
5. **`shareableMissionKinds` 是自由文本**（任务类型尚未收敛成枚举）：只在服务层做长度与非空校验，
   并显式拒绝 `'*'`。

## 6. 回滚

- **代码**：删除 `src/lib/bridges/**`、`src/app/api/v1/bridges/**`、`tests/bridges/**`、
  `tests/bridge/schema-drift.test.ts`，还原 `capabilities.ts` 的三行能力与
  `tenancy.prisma` 的反向关系、删除 `prisma/schema/bridge.prisma` 与 `migrate.mjs` 的 C9 段。
  目录消失后 `/api/v1/bridges/*` 自然 404。
- **数据库（首选）**：**停用路由 + 保留空表** —— C9 是纯新增，留两张空表对既有功能零影响。
- **数据库（重手段，需显式确认）**：
  `node scripts/connection/migrate.mjs rollback --batch=C9 --yes --url=<...>`
  —— 逆序删 `BridgeMemberOptIn → CommunityBridge`（外键顺序正确）。
- **能力矩阵**：`bridge.*` 若整块回退，须同步删掉 `tests/tenancy/capabilities.test.ts` 的 T10 两组断言
  （否则"已定义但谁也拿不到"断言会红）。
