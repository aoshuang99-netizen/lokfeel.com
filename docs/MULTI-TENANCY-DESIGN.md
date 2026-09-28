# 多租户改造技术设计（P0-2）

> 状态：**设计定稿待评审 / 预研未开始** · 2026-09-27
> 关键路径：**这是整个开源化改造中最长的路径（10–14 周），且唯一会触碰线上数据。**
> 排期上应最早启动、最晚收尾，并单独预留 30% 缓冲。

---

## 1. 为什么必须做

当前是**单租户单实例**应用：

- `prisma/schema.prisma` 的 42 张表中，**没有任何** `tenant` / `organization` / `workspace` 概念（全量搜索零命中）
- 一个部署 = 一个社群
- 服务端代码中所有查询都假定"库里只有这一家的数据"

这使得以下形态**无法实现**：

| 目标形态 | 为何当前不可行 |
|---|---|
| 云托管多客户（SaaS） | 一个实例无法服务多个社群 |
| 白标分发 | 无法为不同运营方隔离数据 |
| 分租户计费 | 没有租户维度可挂计费 |
| 单实例多社群（社区运营者常需） | 数据会互相可见 |
| 企业客户的"多部门/多品牌"需求 | 同上 |

**结论：没有多租户，就没有"SaaS 开源平台"，只有"开源单机软件"。**

---

## 2. 隔离模型选型

| 方案 | 隔离强度 | 改造成本 | 运维成本 | 适配度 |
|---|---|---|---|---|
| **A. 共享 schema + `tenantId` 列** | 中（依赖应用层强制） | 低 ⭐ | 低 ⭐ | ✅ **推荐** |
| B. Schema-per-tenant | 高 | 高 | 中（N 个 schema 迁移） | 租户数少时可考虑 |
| C. Database-per-tenant | 最高 | 极高 | 高 | 强合规场景（政企/医疗） |

### 推荐：A + RLS 纵深防御

理由：

1. **租户数量预期是"长尾大量小租户"**（社群运营者多为 1,000–10,000 人规模），B/C 的运维成本会随租户数线性膨胀
2. 迁移成本最低 —— 现有 42 张表只需加列 + 加索引，不需要重建数据库对象
3. 用 **PostgreSQL RLS（行级安全）** 作为第二道防线，弥补"应用层漏加 where 条件"的风险
4. 未来如出现强隔离需求的客户（政企/医疗，对应之前分析中的 C 类客群），可**为该租户单独部署一套实例**（单租户模式 = 当前架构），而不是在同一实例里做数据库级隔离

> **关键设计原则**：架构必须同时支持"一个实例承载多租户"与"一个实例只服务一个租户"。后者是当前形态，也是面向强合规客户的交付方式。这两种模式应共存，而不是二选一。

---

## 3. 身份模型：User 全局，Profile 租户内

这是本次改造中**最重要的一个设计决策**。

### 3.1 两种候选

| 模型 | 说明 | 优点 | 缺点 |
|---|---|---|---|
| 用户租户内建（User 带 tenantId） | 同一个人加入两个社群 = 两个账号 | 隔离最简单，实现最快 | 用户要注册两次；无法跨社群识别；无法做跨社群增长 |
| **User 全局 + Membership（推荐）** | 一个身份，多社群成员关系 | 一次注册多社群；跨社群识别；网络效应 | 隔离复杂度上升 |

### 3.2 推荐模型（对齐本领域特性）

对本产品（关系匹配）而言，**Profile 必须租户内独立**——同一个人在不同的社群里可能希望展示不同的自我（不同的关系结构、不同的照片、不同的昵称）。这恰好是"User 全局 + Profile 租户内"的天然理由：

```
User (全局身份，只放登录凭据)
  ├─ Account / Session / VerificationToken   (全局，绑定 User)
  │
  └─ UserTenantMembership (用户 × 租户的成员关系)
       ├─ role (MEMBER / MODERATOR / OWNER)
       ├─ status (ACTIVE / PENDING / BANNED)
       └─ Profile            ← 租户内档案（昵称、照片、关系结构标签）
            ├─ 匹配记录        ← 租户内
            ├─ 会话/消息        ← 租户内
            ├─ 诚意值钱包      ← 租户内
            └─ 通知/举报/拉黑  ← 租户内
```

**已有代码的适配量**：现有 `Profile` 表关联 `User`。改造为关联 `UserTenantMembership` 需要迁移——这是本次改造中最大的一块数据迁移工作。

### 3.3 平台管理员 vs 租户管理员

现有 RBAC 体系（61 个权限码 / 7 个角色 / `AdminUserRole`）是**租户级**的。

需要**新增**一个平台级角色，用于跨租户运维：

| 角色 | 范围 | 能力 |
|---|---|---|
| Platform Admin | 全平台 | 创建/停用租户、查看全局指标、处理跨租户纠纷 |
| Tenant Owner | 单租户 | 租户内全部权限 |
| Tenant Moderator | 单租户 | 内容审核、用户处置 |
| Member | 单租户 | 普通使用 |

**注意**：Platform Admin 必须有**独立于租户数据的审计留痕**，且其操作应被认为"高风险"（类似 GDPR 下的数据处理者）。

---

## 4. 表改造清单（42 张表分类）

### 4.1 第一类：全局表（不加 `tenantId`）

| 表 | 理由 |
|---|---|
| `User` | 全局身份 |
| `Account`、`Session`、`VerificationToken` | 认证体系，绑定全局 User |
| `AdminPermission` | 权限字典，全平台共用 |
| `AnalyticsEventDef` | 事件定义字典，全平台共用 |
| `SystemConfig` | **需拆分**：部分配置全局（如平台名称），部分租户级（如配额） |

### 4.2 第二类：新增表

| 表 | 用途 |
|---|---|
| `Tenant` | 租户主体（社群） |
| `TenantDomain` | 自定义域名映射（白标） |
| `UserTenantMembership` | 用户 × 租户成员关系 |
| `TenantFeatureFlag` | 租户级功能开关（与 Edition 门控对接） |
| `TenantSubscription` | **租户级**计费（现有 `Subscription` 是用户级，两者需并存） |

### 4.3 第三类：租户内数据表（加 `tenantId`）

| 分组 | 表 |
|---|---|
| 档案 | `Profile` |
| 匹配 | `Match`、`MatchReaction` |
| 聊天（旧栈） | `ChatRoom`、`ChatRoomMember`、`Message` |
| 聊天（IM 栈） | `Conversation`、`ConversationParticipant`、`IMMessage`、`MessageReceipt`、`MessageReaction`、`UserPresence` |
| 授权 | `ConsentRequest`、`ConsentGrant` |
| 计费 | `Subscription`、`Payment` |
| 权限/审计 | `CustomRole`、`AdminRolePermission`、`AdminAudit`、`AuditLog`、`AdminUserRole` |
| 安全/增长 | `Block`、`UserReport`、`Notification`、`SincerityWallet`、`SincerityTransaction`、`PowerBoardRule` |
| 分析 | `AnalyticsEvent`、`AnalyticsDailyAgg` |

### 4.4 第四类：**建议直接删除**（不属于开源核心）

| 分组 | 表 | 理由 |
|---|---|---|
| 机器人体系 | `BotProfile`、`BotInteractionLog`、`BotLearningBatch`、`BotLearningRecord`、`BotPreference`、`BotAvatar` | 见 P0-5：与开源品牌冲突，应剥离为可选插件 |

**这 6 张表在改造中直接移出核心 schema，可减少 14% 的改造量。**

---

## 5. 隔离强制机制（核心安全问题）

### 5.1 三层防御

```
第 1 层：类型系统   —— 查询构造器强制传入 tenantId
第 2 层：Prisma 扩展 —— 自动注入 where / 自动写入 create
第 3 层：数据库 RLS  —— 最后一道，应用层漏了也拦得住
```

### 5.2 第 1 层：租户上下文必须显式传递

**禁止**在业务代码里从"当前用户"隐式推导租户。租户必须作为显式参数贯穿调用链：

```ts
// ❌ 错误：隐式推导，容易在后台任务/定时任务中出错
const tenantId = (await getCurrentUser()).tenantId;

// ✅ 正确：显式传入
export async function getMatches(ctx: TenantContext, filter: MatchFilter) {
  // ctx.tenantId 是必须的
}
```

理由：定时任务、webhook、管理脚本中没有"当前用户"，隐式推导会导致这些路径**静默地跨租户操作**。这是多租户系统最常见的严重事故来源。

### 5.3 第 2 层：Prisma 扩展自动注入（fail-closed）

```ts
/**
 * 租户隔离的 Prisma 扩展。
 *
 * 设计要点：
 *  1. 白名单机制 —— 只有显式登记的"全局表"才允许跳过 tenantId 注入
 *  2. fail-closed —— 未登记的模型若缺少 tenantId 条件，直接抛异常而非放行
 *  3. 同时覆盖读（where）与写（data）
 */
const GLOBAL_MODELS = new Set([
  'User', 'Account', 'Session', 'VerificationToken',
  'AdminPermission', 'AnalyticsEventDef', 'Tenant', 'TenantDomain',
]);

export function tenantIsolation(tenantId: string) {
  return Prisma.defineExtension((client) =>
    client.$extends({
      query: {
        $allModels: {
          async $allOperations({ model, operation, args, query }) {
            if (!model || GLOBAL_MODELS.has(model)) return query(args);

            const isWrite = operation.startsWith('create') || operation.startsWith('update') || operation.startsWith('upsert');
            const isRead = operation.startsWith('find') || operation.startsWith('count') || operation.startsWith('aggregate') || operation.startsWith('groupBy');

            if (isRead) {
              args.where = { ...(args.where ?? {}), tenantId };
            }
            if (isWrite) {
              args.data = Array.isArray(args.data)
                ? args.data.map((d: Record<string, unknown>) => ({ ...d, tenantId }))
                : { ...(args.data ?? {}), tenantId };
            }

            // fail-closed：写操作若未成功注入 tenantId，说明模型未登记但被当作租户表使用
            if ((isRead || isWrite) && args.where && 'tenantId' in args.where && args.where.tenantId !== tenantId) {
              throw new Error(`[tenant-isolation] 试图访问其他租户数据: ${model}`);
            }

            return query(args);
          },
        },
      },
    }),
  );
}
```

⚠️ **注意**：`deleteMany` / `updateMany` 也必须走同一路径。当前实现中已覆盖（`$allOperations` 拦截所有操作），但**必须有测试证明**。

### 5.4 第 3 层：PostgreSQL RLS（纵深防御）

```sql
-- 每个租户表启用 RLS
ALTER TABLE "Match" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "Match"
  USING ("tenantId" = current_setting('app.current_tenant', true));

-- 强制即使表所有者也要遵守（防止应用用超级用户连接绕过）
ALTER TABLE "Match" FORCE ROW LEVEL SECURITY;
```

应用在每次事务开始时设置：

```sql
SET LOCAL app.current_tenant = '<tenantId>';
```

⚠️ **风险**：若连接池复用了连接而忘记重置 `app.current_tenant`，会**串租户**。因此必须使用 `SET LOCAL`（事务级，自动重置），**绝不能用 `SET`**（会话级，会跨请求泄漏）。

### 5.5 强制测试（不接受"应该没问题"）

以下测试是**发布阻断项**：

```ts
describe('租户隔离', () => {
  it('读取操作不能跨租户返回数据', async () => { /* 建 A/B 两租户数据，断言 A 只看到 A */ });
  it('create 自动写入正确的 tenantId', async () => { /* 断言落库的 tenantId */ });
  it('update/delete 不能影响其他租户的数据', async () => { /* 跨租户 id 应无效果 */ });
  it('未登记的模型不会静默跳过隔离', async () => { /* 断言抛异常 */ });
  it('RLS 在应用层漏加条件时仍能拦住', async () => { /* 绕过扩展直接查询 */ });
  it('连接池复用不串租户', async () => { /* 并发交错请求，断言隔离 */ });
  it('定时任务/webhook 路径显式携带租户', async () => { /* 覆盖无用户上下文的路径 */ });
});
```

---

## 6. 数据迁移策略

### 6.1 迁移模式：影子表 + 分批回填

**不使用**单次大事务迁移（42 张表、线上数据，锁表风险不可接受）。

```
阶段 A：加列（可空）
  ALTER TABLE "Match" ADD COLUMN "tenantId" TEXT;   -- 允许 NULL
  → 应用继续正常工作

阶段 B：回填
  以 1000 行/批 回填为"默认租户"（当前唯一租户）
  → 每批提交，可中断、可续跑
  → 监控主从延迟

阶段 C：加约束
  ALTER TABLE "Match" ALTER COLUMN "tenantId" SET NOT NULL;
  加复合索引 (tenantId, <常用查询列>)
  加外键 tenantId → Tenant.id

阶段 D：启用隔离
  部署带 tenantIsolation 扩展的版本
  观察期：所有查询都带 tenantId 条件，监控慢查询与报错率
```

### 6.2 复合索引策略

现有单列索引在多租户下**效率会下降**（因为查询总是带 tenantId）。需要把高频索引改为 `(tenantId, ...)` 前缀：

| 原索引 | 新索引 |
|---|---|
| `Match(userId)` | `Match(tenantId, userId)` |
| `IMMessage(conversationId, createdAt)` | `IMMessage(tenantId, conversationId, createdAt)` |
| `Notification(userId, read)` | `Notification(tenantId, userId, read)` |

⚠️ **这一步不要漏**：多租户上线后最常见的性能问题是"查询变慢了 10 倍"，原因几乎总是索引没改。

### 6.3 回滚方案

| 阶段 | 回滚动作 | 数据影响 |
|---|---|---|
| A | 删列 | 无 |
| B | 停止回填 | 无（列可空） |
| C | 删除约束与索引 | 无 |
| D | 回滚应用版本 | **需谨慎**：新版本期间写入的数据已带 tenantId，旧版本会忽略该列 → 安全 |

**关键**：整个迁移过程保持向后兼容 —— 每个阶段都可独立回滚，且回滚不丢数据。

---

## 7. 分阶段实施与工期

| 阶段 | 内容 | 工期 | 交付物 |
|---|---|---|---|
| 0 | **技术预研**：选 3–5 张核心表打通全链路 | **2–3 周** | 可运行的 POC + 真实工程量结论 |
| 1 | 设计定稿 + 评审 | 1 周 | 本文档定稿、ER 图、迁移脚本骨架 |
| 2 | Bot 表剥离（P0-5）+ 新增 Tenant/Membership 模型 | 2 周 | schema 变更 + 迁移 |
| 3 | 隔离层实现（Prisma 扩展 + RLS + 测试） | 2–3 周 | 隔离测试全绿 |
| 4 | 42 表加列 + 回填 + 约束 | 3–4 周 | 迁移完成 |
| 5 | 业务层改造（所有查询携带 TenantContext） | 3–4 周 | 端到端可用 |
| 6 | 索引优化 + 压测 + 观察期 | 2 周 | 性能达标 |
| **合计** | | **15–19 周** | 含预研 |

> 若预研发现工程量显著超出（例如超过 20 周），则应评估**替代路径**：不改造现有代码，而是**提取核心能力重建一个精简的多租户版本**（把现有代码当作功能参考与前端资产）。这是需要正式决策的分叉点。

---

## 8. 风险登记

| 风险 | 等级 | 缓解 |
|---|---|---|
| 跨租户数据泄漏 | 🔴 极高 | 三层防御 + 发布阻断级隔离测试 + 灰度观察期 |
| 迁移期线上数据损坏 | 🔴 高 | 影子表分批迁移 + 每阶段可独立回滚 + 迁移前全量备份 |
| 连接池串租户 | 🔴 高 | 只用 `SET LOCAL`；专项并发测试 |
| 索引未更新导致性能崩塌 | 🟡 中 | 阶段 6 专项压测；上线前 explain 抽查 |
| 隐式租户推导导致后台任务越权 | 🟡 中 | 显式 TenantContext；定时任务/webhook 路径专项测试 |
| 现有 RBAC 与租户模型的权限冲突 | 🟡 中 | 明确 Platform Admin 与 Tenant Admin 边界，权限判定加租户维度 |
| 用户级订阅与租户级订阅并存导致权益判定混乱 | 🟡 中 | 明确"谁付费、谁享受权益"，写清优先级规则 |

---

## 9. 待决策事项

| # | 决策点 | 建议 | 状态 |
|---|---|---|---|
| 1 | 隔离模型选 A/B/C | A + RLS | ⬜ 待评审 |
| 2 | User 全局 or 租户内 | 全局 + Membership | ⬜ 待评审 |
| 3 | Profile 归属（User or Membership） | Membership（租户内独立） | ⬜ 待评审 |
| 4 | 是否同时支持单租户部署模式 | 是（面向强合规客户） | ⬜ 待评审 |
| 5 | Bot 表是否直接删除 | 是 | ⬜ 待评审 |
| 6 | 用户级订阅 vs 租户级订阅 | 并存，需明确权益优先级 | ⬜ 待评审 |

---

*最后更新：2026-09-27*
