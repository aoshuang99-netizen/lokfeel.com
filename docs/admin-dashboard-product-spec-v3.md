# LokFeel 管理后台 — V3.0 全面调研与架构升级报告

> **文档版本**: v3.0 | **日期**: 2026-05-02 | **作者**: Scout
> **状态**: 待评审
> **变更说明**: 基于 PM OS 产品框架 + 行业对标（LINEAR/Stripe/Vercel）+ 数据架构审计，对管理后台数据存储与交互功能做全面合理性审查

---

## 速览

| 维度 | v2.0 | v3.0 |
|------|------|------|
| 页面/路由 | ~45 | ~52 |
| API 端点 | ~180 | ~200 |
| 数据模型 | 39 | 41 (重构7) |
| 权限粒度 | 61项 | 72项 (+11新增) |
| 严重问题 | 未审计 | 3个P0 / 8个P1 / 12个P2 |
| 交互规范 | 基础 | 完整（3态/4态/6规则） |

---

## 一、数据存储层深度审查

> 基于对 `schema.prisma`（39个模型、32个枚举）的逐行审计

### 1.1 🔴 P0 — 阻塞性缺陷（必须修复才能开工）

#### P0-1: User 模型缺少 AdminUserRole 反向关系

**现状**:
```prisma
model AdminUserRole {
  userId String
  user   User @relation(fields: [userId], references: [id], onDelete: Cascade)
  // ...
}

model User {
  // ❌ 缺少 adminRoles AdminUserRole[]
}
```

**影响**: 无法用 `include: { adminRoles: true }` 查询用户的管理角色，RBAC 系统核心链路断裂。

**修复**:
```prisma
model User {
  // ... 现有字段 ...
  adminRoles AdminUserRole[] // ← 新增
}
```

---

#### P0-2: AdminRoleAudit 零关系绑定

**现状**:
```prisma
model AdminRoleAudit {
  actorId      String    // 裸字符串，无 @relation
  targetUserId String?   // 裸字符串，无 @relation
}
```

**影响**: 审计日志无法与 User 表 JOIN，查询操作人信息需要手动 SQL。审计日志的可追溯性名存实亡。

**修复**:
```prisma
model AdminRoleAudit {
  actorId      String
  actor        User      @relation(fields: [actorId], references: [id])
  targetUserId String?
  targetUser   User?     @relation(fields: [targetUserId], references: [id])
}
```

---

#### P0-3: AdminRole 是枚举非模型（无法动态创建角色）

**现状**: `AdminRole` 是 Prisma enum，无法在运行时创建新角色。

**影响**: 用户无法通过 UI 创建自定义角色（如"华南区运营"），RBAC 系统降级为静态权限分配。

**推荐方案**: 保持 `AdminRole` 枚举用于系统预留角色，新增 `CustomRole` 模型支持动态角色：

```prisma
model CustomRole {
  id          String     @id @default(cuid())
  name        String     @unique
  description String?
  isSystem    Boolean    @default(false)  // 系统角色不可删除
  permissions String[]                      // 权限编码数组
  createdAt   DateTime   @default(now())
  updatedAt   DateTime   @updatedAt
  
  userRoles   AdminUserRole[]
}

// AdminUserRole 新增字段
model AdminUserRole {
  // ... 现有字段 ...
  customRoleId String?
  customRole   CustomRole? @relation(fields: [customRoleId], references: [id])
}
```

---

### 1.2 🟠 P1 — 高优先级缺陷

#### P1-1: SincerityWallet 关联到 Profile 而非 User

```prisma
model SincerityWallet {
  userId String  @unique
  user   Profile @relation(fields: [userId], references: [id], onDelete: Cascade)
  //        ↑ 实际指向 Profile.id，但字段名叫 userId，极易混淆
}
```

**问题**: 全系统唯一一个"以 Profile 为所有者"的模型，其余（Subscription/Payment/Notification/UserPresence/PowerBoardRule）均关联 User。

**建议**: 不改动现有逻辑，但必须在文档中标注，并在 V3.0 的 Admin API 中对此做适配处理。

---

#### P1-2: Bot 系统模型全部使用裸字符串外键（5个模型）

| 模型 | 裸 FK 字段 |
|------|-----------|
| BotInteractionLog | `botUserId`, `targetUserId`, `matchId` |
| BotLearningRecord | `botId`, `userId` |
| BotPreference | `botId` (有 @unique) |
| BotAvatar | `botId` (有 @unique) |
| SincerityTransaction | `matchId`, `fromUserId`, `toUserId` |

**影响**: 查询时无法用 Prisma `include` 做关联查询，Bot 系统的管理面板性能受损。

**建议**: 全部添加 `@relation` 声明，为管理后台的 Bot 管理页面提供完整的数据查询能力。

---

#### P1-3: 双重角色体系冲突

| 体系 | 字段/模型 | 角色值 |
|------|----------|--------|
| 用户级 | `User.role` (UserRole枚举) | USER, ADMIN, SUPER_ADMIN |
| 管理级 | `AdminUserRole` (AdminRole枚举) | SUPER_ADMIN, ADMIN, MODERATOR, ... |

**问题**: `ADMIN` 和 `SUPER_ADMIN` 在两个体系中重复存在，新管理员入职时两个地方需要同步设置。

**建议**: V3.0 统一为单一权限源——用户级 `User.role` 仅保留 `USER`，管理权限完全由 `AdminUserRole` 表管理。

---

#### P1-4: 两套审计日志系统重叠

```prisma
// 通用管理日志
model AdminLog { authorId, action, target, targetId, details, createdAt }

// RBAC 专用审计
model AdminRoleAudit { actorId, actorRole, targetUserId, targetRole, action, details, reason, createdAt }
```

**问题**: 字段语义重叠，结构不一致，查询时需要跨两张表。

**建议**: 合并为统一的 `AdminAudit` 模型：

```prisma
model AdminAudit {
  id           String    @id @default(cuid())
  actorId      String
  actor        User      @relation(fields: [actorId], references: [id])
  category     String    // "user" | "match" | "payment" | "rbac" | "system"
  action       String    // "create" | "update" | "delete" | "grant_role" | ...
  targetType   String    // "User" | "Match" | "Payment" | "AdminRole"
  targetId     String?
  changes      Json?     // { before: {...}, after: {...} }
  reason       String?
  ip           String?
  createdAt    DateTime  @default(now())
  
  @@index([actorId])
  @@index([category, createdAt])
  @@index([targetType, targetId])
}
```

---

#### P1-5: 零软删除机制

**现状**: 全库39个模型无 `deletedAt` 字段，所有删除操作均为物理删除。

**风险**: 恶意操作或误操作后数据不可恢复，与 RBAC 的"高危操作二次确认"设计初衷矛盾。

**建议**: 核心业务模型添加软删除：

```prisma
model User {
  // ...
  deletedAt DateTime?        // null = 未删除
  @@index([deletedAt])
}
```

使用 Prisma 扩展自动过滤软删除记录：`prisma-extension-soft-delete`。

**需要软删除的模型**: User, Profile, Match, ChatRoom, Conversation, Subscription, Payment, UserReport, CreativeTemplate, VIPMembership

---

#### P1-6: 缺少索引优化

**缺失的关键索引**：
- `Match.createdAt`（匹配列表排序）
- `IMMessage.conversationId + createdAt`（消息列表分页）
- `UserReport.status + createdAt`（举报处理队列）
- `Payment.createdAt + status`（支付流水查询）
- `VIPMessage.vipUserId + createdAt`（VIP 消息列表）
- `Subscription.userId + status`（用户订阅查询）

---

### 1.3 🟡 P2 — 中优先级改进

| # | 问题 | 建议 |
|---|------|------|
| P2-1 | `User.botType` 是裸 String，与 `BotType` 枚举不关联 | 改为 `BotType?`，或统一注释 |
| P2-2 | `Match.senderAction/receiverAction` 语义模糊 | 注释说明与 `MatchReaction` 的关系 |
| P2-3 | `SystemConfig.key` 作为 `@id` | 短 key 可接受，但建议添加唯一约束 |
| P2-4 | 无数据版本号/乐观锁 | 高风险操作添加 `version Int @default(1)` + `@@updatedAt` |
| P2-5 | `Profile` 中 JSON 数组存为 String | 改为 Prisma `Json` 类型 |
| P2-6 | 无双时区字段 | 所有 `DateTime` 默认 UTC，前端显示时转换 |
| P2-7 | 无 `User.createdAt` 索引 | 用户新增统计需要全表扫描 |
| P2-8 | CreativeTemplate.`config` 存为 JSON | 合理，但 v3.0 模板编辑器需对此做版本管理 |
| P2-9 | AlertRule/Alert 未实现 | v3.0 应作为 Phase 5 完成 |
| P2-10 | TrafficEvent 字段未在主表中 | 建议直接扩展到 `AnalyticsEvent` 模型 |
| P2-11 | VIPMessage.slaDeadline 无自动检测 | 添加 cron job 定时检测 SLA 超限 |
| P2-12 | 无数据归档策略 | 超过90天的消息/匹配记录应迁移到归档表 |

---

### 1.4 数据库关系完整性矩阵

| 统计项 | 数量 |
|--------|------|
| 总模型数 | 39 |
| 总 Prisma 关系 | 79 |
| 裸字符串外键（无 relation） | 12 |
| 缺失反向关系 | 1（User ← AdminUserRole） |
| 双重系统（需要合并） | 3（Chat、Audit、Role） |

---

## 二、交互功能层深度审查

> 基于 v2.0 规划 45+ 页面 + 180+ API 端点，使用 PM OS 框架逐模块打分

### 2.1 页面逐个合规审查

#### 仪表盘 `/admin` — ⚠️ 需改进

| 检查项 | 状态 | 问题 |
|--------|------|------|
| 骨架屏加载 | ❌ | 未设计——线性图突然出现 |
| 组件级错误边界 | ❌ | 一个 KPI 接口挂了，整个页面白屏 |
| 自动刷新控制 | ⚠️ | 60s 固定刷新，无暂停/手动刷新按钮 |
| 空状态 | ❌ | 首次部署无数据时的展示未设计 |
| 数据对比 | ⚠️ | 仅显示绝对值，缺少"较昨日↑12%"对比 |

**改进方案**:
1. KPI 卡片添加对比（vs 上周/昨日）
2. 错误边界按卡片隔离——每个 KPI/图表独立请求
3. 添加 `Pause Auto-Refresh` 按钮
4. 首次空状态：引导完成 Onboarding checklist

---

#### 用户管理 `/admin/users` — ⚠️ 需改进

| 检查项 | 状态 | 问题 |
|--------|------|------|
| 虚拟滚动 | ❌ | 3500+ 用户时全部渲染 |
| 批量操作反馈 | ❌ | 批量封禁 200 人无进度条 |
| 搜索防抖 | ⚠️ | 输入即搜索，无防抖 |
| CSV 导出上限 | ❌ | 无行数限制，可能 OOM |
| 用户详情7标签页 | ⚠️ | 同时加载所有数据，应懒加载 |

**改进方案**:
1. TanStack Table Virtual——超过 50 行启用虚拟滚动
2. 批量操作：显示进度 "正在处理: 45/200"
3. 搜索防抖 300ms
4. CSV 导出上限 10,000 行，超过提示使用时间范围过滤
5. 用户详情标签页：默认加载"基本信息"，其余按需请求

---

#### 匹配管理 `/admin/matches` — ✅ 基本合规

| 检查项 | 状态 | 问题 |
|--------|------|------|
| 排序/过滤 | ✅ | 已设计 |
| 引擎配置 | ⚠️ | 修改后无变更日志 |
| 手动匹配 | ⚠️ | 需添加操作确认 + 后果说明 |

**改进**: 引擎参数修改自动写审计日志；手动匹配弹窗显示"将发送通知给双方用户"

---

#### 举报处理 `/admin/reports` — ⚠️ 需改进

| 检查项 | 状态 | 问题 |
|--------|------|------|
| 状态流转 | ✅ | PENDING → UNDER_REVIEW → RESOLVED_* |
| 队列分配 | ❌ | 无认领/分配机制 |
| 处理时间 SLA | ❌ | 未设计超时提醒 |
| 批量处理 | ⚠️ | 设计了但无确认步骤 |

**改进方案**:
1. 审核员可"认领"举报（避免多人同时处理）
2. PENDING 超 2h 未处理 → 橙色标记；超 24h → 红色标记
3. 批量处理增加二次确认

---

#### AI 推广图 `/admin/creative` — ⚠️ 未开工，设计审查

| 检查项 | 状态 | 问题 |
|--------|------|------|
| 模板编辑器 | ⚠️ | "拖拽组件"复杂度被低估 |
| 批量生成队列 | ⚠️ | 无失败重试策略、无速率限制 |
| A/B 测试 | ⚠️ | 统计显著性计算未设计 |
| 素材管理 | ❌ | 无 CDN 上传进度、无批量操作 |

**建议**: v3.0 将模板编辑器拆分为独立任务（预估 2-3 周而非 4 天）；批量生成添加 BullMQ 队列管理。

---

#### AI 客服 `/admin/ai-support` — ⚠️ 未开工，设计审查

| 检查项 | 状态 | 问题 |
|--------|------|------|
| 知识库编辑器 | ⚠️ | Markdown 编辑器 vs 富文本待定 |
| 路由规则 | ⚠️ | 条件组合复杂度（AND/OR 嵌套） |
| 情感分析 | ❌ | 依赖外部 AI API 但无降级方案 |
| 搜索重建 | ❌ | "重建索引"操作无进度提示 |

**建议**: 知识库使用 TipTap 富文本编辑器（已成熟）；路由规则限制嵌套深度为 2 层；情感分析 API 不可用时自动降级为关键词匹配。

---

#### VIP 收件箱 `/admin/vip-inbox` — ⚠️ 未开工，设计审查

| 检查项 | 状态 | 问题 |
|--------|------|------|
| 消息分配 | ⚠️ | 无"自动分配"逻辑 |
| SLA 检测 | ❌ | 只存了字段，无自动检测机制 |
| 满意度回访 | ❌ | 只设计了评分字段，无自动发送逻辑 |
| 上下文面板 | ⚠️ | "用户完整上下文"数据量可能过大 |

**建议**: 添加 cron job 每 5 分钟检测 SLA 超限；满意度调查在消息关闭后 24h 自动发送；上下文面板按需加载（先加载摘要，点击展开详情）。

---

#### 数据分析 `/admin/analytics` — ✅ 基本合规

| 检查项 | 状态 | 问题 |
|--------|------|------|
| 漏斗/留存/收入 | ✅ | 设计完整 |
| 数据时效性 | ⚠️ | 实时 vs T+1 未标注 |
| 导出格式 | ⚠️ | 仅 CSV，缺少 PDF 报告 |

**改进**: 每个指标标注数据时效性（实时/1小时/T+1）；导出支持 PDF 报告格式。

---

### 2.2 全局交互规范缺失项

| 规范 | 现状 | v3.0 要求 |
|------|------|-----------|
| **加载态** | 未设计 | 骨架屏（shadcn/ui Skeleton），自适应组件尺寸 |
| **空状态** | 未设计 | 专用插画 + 标题 + 描述 + CTA 按钮 |
| **错误态** | 未设计 | 组件级错误边界，Toast 通知 + 重试按钮 |
| **成功反馈** | 部分 | 所有写操作必须 Toast 反馈（shadcn/ui Sonner） |
| **乐观更新** | 无 | 列表页的快速操作（封禁/标记）使用乐观更新 |
| **确认对话框** | 部分 | 高危操作（P0级）使用破坏性确认弹窗 |
| **表单验证** | 未设计 | zod + react-hook-form，实时验证 |
| **键盘快捷键** | 无 | `/` 聚焦搜索，`Esc` 关闭弹窗，`Ctrl+Enter` 提交 |

### 2.3 交互功能评分矩阵（PM OS Spec Quality）

每个模块按 PM OS 质量标准打分 /20：

| 模块 | 问题验证 | 成功指标 | 范围明确 | 边界情况 | 错误态 | 移动端 | 无障碍 | 性能 | 分析埋点 | 依赖 | 总分 |
|------|----------|----------|----------|----------|--------|--------|--------|------|----------|------|------|
| 仪表盘 | 2 | 2 | 2 | 1 | 0 | 1 | 0 | 1 | 2 | 1 | **12** ⚠️ |
| 用户管理 | 3 | 2 | 2 | 1 | 1 | 1 | 0 | 0 | 1 | 1 | **12** ⚠️ |
| 匹配管理 | 2 | 2 | 2 | 1 | 1 | 1 | 0 | 1 | 1 | 1 | **12** ⚠️ |
| 举报处理 | 2 | 2 | 2 | 2 | 1 | 1 | 0 | 1 | 1 | 1 | **13** |
| 支付管理 | 2 | 2 | 2 | 2 | 2 | 1 | 0 | 1 | 1 | 1 | **14** |
| AI推广图 | 1 | 1 | 2 | 1 | 0 | 1 | 0 | 1 | 1 | 1 | **9** 🔴 |
| AI客服 | 1 | 1 | 2 | 1 | 0 | 1 | 0 | 1 | 1 | 1 | **9** 🔴 |
| VIP收件箱 | 1 | 1 | 2 | 1 | 0 | 1 | 0 | 1 | 1 | 1 | **9** 🔴 |
| 数据分析 | 2 | 2 | 2 | 1 | 1 | 1 | 0 | 1 | 2 | 1 | **13** |
| 系统设置 | 2 | 2 | 2 | 1 | 1 | 1 | 0 | 1 | 1 | 1 | **12** ⚠️ |
| RBAC | 2 | 2 | 2 | 2 | 1 | 1 | 0 | 1 | 2 | 1 | **14** |

**低于 14 分 = 不可开工**：AI推广图、AI客服、VIP收件箱（均 9 分）需重构设计。

---

## 三、行业对标分析

> 对标对象: **LINEAR**（项目管理）、**Stripe Dashboard**（支付后台）、**Vercel**（部署平台）

### 3.1 数据架构对标

| 维度 | LINEAR | Stripe | Vercel | LokFeel v2.0 | v3.0 目标 |
|------|--------|--------|--------|-------------|-----------|
| 数据模型 | ~50 | ~100+ | ~60 | 39 | 41 (重构) |
| 软删除 | ✅ | ✅ | ✅ | ❌ | ✅ P1 |
| 审计日志 | Sync Engine | 统一事件流 | 统一审计表 | 2套独立 | ✅ 合并 |
| 乐观锁 | ✅ 同步引擎 | ❌ (2PC) | ❌ | ❌ | ✅ P2 |
| 索引策略 | 每表 3-5 个组合索引 | 大量 | 中等 | 极少 | ✅ 补全 |
| 多租户 | workspace_id | account_id | team_id | 单租户 (OK) | 单租户 |

### 3.2 交互设计对标

| 模式 | LINEAR | Stripe | Vercel | LokFeel 现状 | v3.0 采用 |
|------|--------|--------|--------|-------------|-----------|
| 侧边栏 | 220px, 可折叠 | 240px | 260px | 250px | ✅ 256px |
| KPI 卡 | 3-4 卡，含趋势 | 4 卡，含增量 | 4 卡，实时 | 6 卡，无对比 | ✅ +对比 |
| 表格高度 | 40px/行 | 48px/行 | 36px/行 | 未定 | 44px/行 |
| 加载态 | 骨架屏 | 骨架屏 | 进度条 | 无 | ✅ 骨架屏 |
| 空状态 | 插画+CTA | 文字说明 | 引导流程 | 无 | ✅ 插画+CTA |
| 快捷搜索 | Cmd+K | Cmd+K | / 搜索 | 无 | ✅ Cmd+K |
| 键盘导航 | 全键盘 | 部分 | 部分 | 无 | ✅ /, Esc, Ctrl+Enter |
| 深色模式 | ✅ | ✅ | ✅ | 未设计 | P3 |
| 响应式 | 桌面端 | 桌面+平板 | 桌面+平板 | 桌面端 | 桌面端 OK |
| 实时更新 | WebSocket | 轮询 | WebSocket | 60s轮询 | ✅ SSE |

### 3.3 对标结论

**LokFeel v2.0 与行业标杆差距**:

| 差距项 | 严重程度 | 优先级 |
|--------|----------|--------|
| 无加载/空/错误三态设计 | 高 | P0 |
| 无软删除机制 | 高 | P0 |
| 审计系统分散 | 中 | P1 |
| 无键盘快捷键 | 中 | P1 |
| 无数据对比（KPI） | 中 | P1 |
| 无深色模式 | 低 | P3 |
| 无响应式（移动端） | 低 | P3 |

---

## 四、API 设计审查

### 4.1 端点命名规范性

**违规项**:
```
# ❌ 不一致
DELETE /api/admin/users/[id]          → 删除用户
DELETE /api/admin/users/bots/import   → （不存在这个，但...）
POST   /api/admin/users/[id]/ban      → 封禁用户

# ✅ v3.0 统一
DELETE /api/admin/users/:id           → 删除用户
POST   /api/admin/users/:id/ban       → 封禁用户
POST   /api/admin/users/:id/unban     → 解封
```

**批量操作路径不一致**:
```
# v2.0 混乱
POST /api/admin/users/batch-action          # 用户批量
POST /api/admin/users/bots/batch             # Bot批量
POST /api/admin/reports/batch               # 举报批量

# v3.0 统一: POST /api/admin/{resource}/batch { action, ids, params }
```

### 4.2 响应格式标准化

```typescript
// v3.0 统一 API 响应格式
interface ApiResponse<T> {
  success: boolean
  data: T | null
  error?: {
    code: string          // 错误码，如 "PERMISSION_DENIED"
    message: string       // 人类可读错误信息
    details?: unknown     // 验证错误详情
  }
  meta?: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
}
```

### 4.3 RBAC 权限注解

v3.0 要求所有 API 端点增加权限注解：

```typescript
// 示例：v3.0 API 权限声明
export const POST = withPermission('user.ban')(async (req) => {
  // ...
})

// 或装饰器模式
@requirePermission('user.delete', { dangerous: true, confirmation: true })
export async function DELETE_user(req: Request) { ... }
```

---

## 五、PM OS 战略评估

### 5.1 Strategy Brief (LokFeel 管理后台)

```yaml
product_strategy:
  vision: "单人在 30 分钟内运营 10,000 用户的社交平台"
  mission: "通过 AI 自动化 + 精细权限 + 实时数据中心，消除运营瓶颈"
  target_customer: "Frank（创始人/唯一运营者）未来扩展至 5-10 人运营团队"
  problem: "3500 用户导入后，手工运营无法支撑匹配引擎调优 + 举报处理 + 用户增长 + AI 内容生成"
  differentiation:
    - "AI 推广图批量化（竞品无此能力）"
    - "VIP 分级服务体系（竞品无此能力）"
    - "Bot 行为学习 + 种子用户冷启动（社交平台独有）"
  business_model: "降低成本（替代人工运营）× 提升匹配质量 → 用户留存 → 订阅收入"
  success_metric: "管理后台上线后，DAU 运营时间 < 30分钟/天 | 用户投诉 24h 内零积压"
  moat_type: "data (Bot 行为数据 + 匹配引擎参数)"
  anti_goals:
    - "不做自定义 BI 报表（v3.0）"
    - "不做第三方集成（Slack/钉钉通知 v3.0）"
    - "不做移动端管理后台"
    - "不做多语言（保持英文）"
  key_assumptions:
    - assumption: "3500 用户会产生足够的管理需求来证明后台成本"
      validation_method: "上线后 2 周内统计日均操作次数"
      status: "unvalidated"
    - assumption: "AI 推广图可替代人工运营发布"
      validation_method: "A/B 测试：AI 图 vs 人工图 CTR 对比"
      status: "unvalidated"
  competitive_landscape:
    direct: ["Hinge Admin (内部)", "Tinder Admin (内部)"]
    indirect: ["自建脚本", "Excel 手工管理"]
    do_nothing: "用户投诉积压，匹配引擎参数无人调优，Bot 行为偏离，最终用户流失"
```

### 5.2 RICE+ 功能优先级

| 功能 | Reach | Impact | Confidence | Strategic | Effort | RICE+ Score |
|------|-------|--------|------------|-----------|--------|-------------|
| P0 Schema 修复 | 10 | 3.0 | 1.0 | 1.0 | 2 | **15.0** |
| 全局三态设计（加载/空/错误） | 10 | 2.5 | 1.0 | 1.0 | 3 | **8.3** |
| 审计日志统一 | 7 | 2.0 | 0.8 | 0.8 | 4 | **2.2** |
| API 响应标准化 | 8 | 2.0 | 1.0 | 0.8 | 3 | **4.3** |
| 软删除机制 | 9 | 2.5 | 1.0 | 1.0 | 4 | **5.6** |
| 仪表盘增强（KPI 对比） | 6 | 2.0 | 0.8 | 0.6 | 2 | **2.9** |
| 虚拟滚动 | 5 | 2.0 | 1.0 | 0.6 | 2 | **3.0** |
| RBAC 中间件 | 8 | 2.5 | 1.0 | 1.0 | 3 | **6.7** |
| AI 推广图模板编辑器 | 3 | 3.0 | 0.5 | 0.8 | 8 | **0.45** |
| VIP 收件箱 | 2 | 3.0 | 0.5 | 0.8 | 6 | **0.4** |
| AI 客服知识库 | 4 | 2.5 | 0.5 | 0.7 | 5 | **0.7** |

> **结论**: P0 修复 + 三态设计 + 软删除 + RBAC 中间件 = v3.0 最高优先级

---

## 六、v3.0 实施路线图

### Phase 1: 数据层修复（Week 1-2）🔴 阻塞

```
Sprint 1.1 (3天)
├── P0-1: User 添加 adminRoles 反向关系
├── P0-2: AdminRoleAudit 添加 Prisma relations
├── P0-3: 新增 CustomRole 模型 + AdminUserRole 扩展
└── P1-5: 核心模型添加 deletedAt 软删除字段

Sprint 1.2 (3天)
├── P1-2: Bot 系统模型添加 @relation
├── P1-4: 合并 AdminLog + AdminRoleAudit → AdminAudit
├── P1-6: 补充关键索引
├── P2-1~P2-4: 小修复
└── 数据库迁移 + 回滚测试

Sprint 1.3 (3天)
├── Prisma seed 脚本：61 权限 + 7 角色 + 1 超管
├── API 响应格式标准化 middleware
├── RBAC 权限检查 middleware
└── 审计日志统一写入
```

### Phase 2: 交互基础层（Week 3-4）🟡 高优

```
Sprint 2.1 (3天)
├── shadcn/ui 全局配置（主题变量 + 组件库）
├── 骨架屏组件（Skeleton）
├── 空状态组件（EmptyState）
├── 错误边界组件（ErrorBoundary）
└── Toast 通知系统（Sonner）

Sprint 2.2 (3天)
├── 仪表盘增强（KPI 对比 + 自动刷新控制）
├── 用户列表虚拟滚动（TanStack Table Virtual）
├── 搜索防抖 300ms
├── 批量操作进度条
└── Cmd+K 全局搜索

Sprint 2.3 (3天)
├── 确认对话框组件（破坏性/警告/信息）
├── 表单验证基础组件（zod + react-hook-form）
├── 权限拒绝页面（403）
├── 审计日志查看器（统一 AdminAudit）
└── 角色管理页面（列表 + 创建 + 编辑权限）
```

### Phase 3: 新模块开发（Week 5-8）

```
Sprint 3.1: AI 推广图（重新估算）
├── Modern: 模板编辑器 → TipTap 富文本 + 图层
├── 批量生成 → BullMQ 队列 + 进度轮询
├── A/B 测试 → 统计显著性计算
└── 素材管理 → CDN 上传 + 批量操作

Sprint 3.2: AI 客服
├── 知识库 → TipTap 编辑器
├── 路由规则 → 条件构建器
├── 情感分析 → API + 关键词降级
└── 搜索重建 → 进度提示

Sprint 3.3: VIP 收件箱
├── 消息队列 + SLA 定时检测
├── 自动分配逻辑
├── 满意度回访自动化
└── 代理绩效仪表盘

Sprint 3.4: 数据埋点 + 测试
├── 全模块 GA/自定义事件埋点
├── E2E 测试（Playwright）
├── 性能测试（Lighthouse 95+）
└── 安全审计
```

### Phase 4: 优化与上线（Week 9-10）

```
├── P2 问题批量修复
├── Alert 系统实现（AlertRule + Alert）
├── CSV/PDF 导出优化
├── 深色模式（P3）
├── 管理手册
└── 灰度上线 + 监控
```

---

## 七、v3.0 数据模型全景

```
┌─────────────────────────────────────────────────────────────┐
│                     LokFeel Admin v3.0                       │
│                    数据模型全景图                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │  用户系统    │  │   匹配引擎    │  │    聊天系统        │  │
│  │             │  │              │  │                   │  │
│  │ User ──── Profile     │  │ Match ──── ChatRoom    │  │ Conversation    │  │
│  │  ├─ BotProfile       │  │  ├─ MatchReaction      │  │  ├─ IMMessage    │  │
│  │  ├─ Subscription     │  │  └─ PowerBoardRule     │  │  ├─ Participant  │  │
│  │  ├─ Payment          │  │                        │  │  ├─ Receipt      │  │
│  │  ├─ Notification     │  │                        │  │  ├─ Reaction     │  │
│  │  ├─ UserPresence     │  │                        │  │  ├─ Presence     │  │
│  │  ├─ SincerityWallet  │  │                        │  │  ├─ ConsentReq   │  │
│  │  └─ AdminUserRole ───┼──┼────────────────────────┼──┼─ ConsentGrant   │  │
│  └─────────────────────┘  └──────────────────────────┘  └─────────────────┘  │
│                                                             │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │  权限系统    │  │   AI 创意     │  │     AI 客服        │  │
│  │             │  │              │  │                   │  │
│  │ AdminPermission     │  │ CreativeTemplate    │  │ SupportTemplate   │  │
│  │  ├─ AdminRolePerm   │  │  ├─ CreativeJob     │  │ KnowledgeArticle  │  │
│  │  ├─ AdminUserRole   │  │  ├─ CreativeAsset   │  │ SupportTicket     │  │
│  │  ├─ CustomRole 🆕   │  │  └─ CreativeABTest  │  │ SupportTicketNote │  │
│  │  └─ AdminAudit  🆕  │  └────────────────────┘  └───────────────────┘  │
│  └─────────────────────┘                                               │
│                                                             │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │  VIP 系统    │  │   数据分析     │  │   系统 & 告警      │  │
│  │             │  │              │  │                   │  │
│  │ VIPMembership       │  │ AnalyticsEvent     │  │ SystemConfig      │  │
│  │  ├─ VIPMessage      │  │  ├─ TrafficEvent   │  │ AlertRule         │  │
│  │  └─ VIPServiceRecord│  │  └─ UserTrackingEvt│  │  └─ Alert         │  │
│  └─────────────────────┘  └──────────────────┘  └───────────────────┘  │
│                                                             │
│  🆕 = v3.0 新增  |  修改 = v3.0 重构  |  保留 = 功能不变     │
└─────────────────────────────────────────────────────────────┘
```

---

## 八、风险矩阵

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| Schema 迁移失败导致数据丢失 | 低 | 极高 | 全量备份 + staging 环境验证 + 回滚脚本 |
| Neon 512MB 超限 | 中 | 高 | 定时清理日志 + 归档策略 + 监控告警 |
| AI API 成本失控 | 中 | 高 | 日预算限制 + 降级模式 + 用量仪表盘 |
| 单人开发进度严重延迟 | 高 | 高 | Phase 1-2 先行上线，Phase 3 分模块交付 |
| 权限配置错误导致数据泄露 | 中 | 极高 | 双重确认 + 审计日志 + 定期权限审计 |
| VIP SLA 频繁超限 | 中 | 中 | 自动升级 + 人力备援方案 |

---

## 九、决策记录

### 决策 1: 不做的功能（v3.0 anti-goals）

1. ❌ 自定义 BI 报表——用预设报表 + CSV 导出替代
2. ❌ Slack/钉钉/飞书集成通知——v4.0 再评估
3. ❌ 移动端管理后台——纯桌面端
4. ❌ 国际化（多语言）——保持英文
5. ❌ 实时 WebSocket 推送——用 SSE 替代（更简单）

### 决策 2: 技术选型确认

| 组件 | v2.0 | v3.0 |
|------|------|------|
| UI 框架 | shadcn/ui | shadcn/ui ✅ |
| 图表库 | Recharts + Tremor | Recharts ✅（Tremor 移除，太重） |
| 表格 | 原生 table | TanStack Table ✅ |
| 富文本 | 未定 | TipTap ✅ |
| 表单 | 未定 | react-hook-form + zod ✅ |
| 任务队列 | 无 | BullMQ + Redis ✅ |
| 实时通信 | 60s 轮询 | SSE（Server-Sent Events）✅ |
| 软删除 | 无 | prisma-extension-soft-delete ✅ |

### 决策 3: 交互设计铁律（6条）

1. **每个组件必须有 4 态**: 加载态（骨架屏）、空态（插画+CTA）、错误态（组件级边界）、正常态
2. **所有写操作必须有反馈**: Toast 通知（成功/失败）
3. **高危操作必须有二次确认**: 破坏性弹窗 + 原因输入
4. **列表超 50 项必须虚拟滚动**: TanStack Table Virtual
5. **搜索输入必须有防抖**: 300ms
6. **删除必须是软删除**: `deletedAt` 字段

---

## 十、总结

### 核心发现

LokFeel 管理后台 v2.0 规格在**功能广度**上设计充分（45+页面、180+端点），但在**数据存储合理性**和**交互规范**上存在显著缺口：

| 类别 | 问题数 | 阻断 |
|------|--------|------|
| Schema 关系缺陷 | 3 个 P0 | ✅ 阻断 |
| 架构设计缺陷 | 6 个 P1 | 不阻断但必须修 |
| 优化改进 | 12 个 P2 | 渐进式 |
| 交互规范缺失 | 8 项全局规范 | ✅ 阻断 |
| API 规范缺失 | 3 类 | P1 |

### 最紧急 3 件事

1. **Schema 修复**（Week 1-2）——3个P0必须在任何新功能前修复
2. **全局交互规范**（Week 2-3）——骨架屏/空状态/错误态/Toast，无此规范不可开工新模块
3. **RBAC 中间件**（Week 3-4）——权限系统是所有页面的基础

### 一句话总结

> v3.0 不是新功能版本，是**质量基础设施版本**。先把地基打牢（数据层+交互层+RABC），然后才能安全地盖高层（AI推广图+客服+VIP）。

---

*Scout - LokFeel AI 协调员 | 2026-05-02*
