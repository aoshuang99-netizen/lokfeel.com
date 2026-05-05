# LokFeel 管理后台 V3.0 — 产品需求文档 (PRD)

> **文档版本**: v1.0 | **日期**: 2026-05-02 | **作者**: Scout
> **状态**: 待评审
> **依赖**: [V3.0 调研报告](./admin-dashboard-product-spec-v3.md) | [v2.0 规格](./admin-dashboard-product-spec-v2.md) | [RBAC v2.1 规格](./admin-dashboard-rbac-spec.md)

---

## 1. Problem Statement

LokFeel 管理后台 v2.0 在功能广度上设计充分（45+页面、180+ API端点），但经过对数据存储层和交互功能层的全面审计，发现 **3个P0级阻断性缺陷** 和 **8项全局交互规范缺失**，导致系统无法安全开工。

**核心问题**：

1. **数据层结构断裂** — User 模型缺少 `AdminUserRole` 反向关系，RBAC 权限系统的核心查询链路不通；`AdminRoleAudit` 审计日志零关系绑定，无法追溯操作人信息。
2. **零交互规范** — 全系统无统一的加载态（骨架屏）、空状态、错误态设计。一个 KPI 接口故障可导致整个仪表盘页面白屏。
3. **行业对标差距** — 对标 LINEAR/Stripe Dashboard 标准，缺失软删除机制（数据误删不可恢复）、无键盘快捷键、无数据对比展示。

**影响评估**：

| 影响维度 | 严重程度 | 说明 |
|----------|----------|------|
| 数据安全 | 🔴 极高 | 误删数据不可恢复，审计日志不可追溯 |
| 系统稳定性 | 🔴 高 | 组件级错误导致页面级崩溃 |
| 开发效率 | 🟡 中 | 无统一规范导致每个页面重复造轮子 |
| 用户体验 | 🟡 中 | 网络慢时无加载反馈，首次使用无引导 |

**不解决的后果**: 按 v2.0 状态直接开工，每开发一个新页面就需要重复处理加载/空/错误三态，RBAC 权限验证链路存在断裂风险，数据误操作后无法恢复。预计开发效率降低 40%，生产事故概率提高 3倍。

---

## 2. Goals

### 2.1 用户目标

| # | 目标 | 衡量标准 |
|---|------|----------|
| G1 | 管理员可在 3 秒内完成角色权限分配 | 角色分配页面加载时间 < 500ms，操作延迟 < 200ms |
| G2 | 任何页面在数据加载中/无数据/异常时均有明确反馈 | 全系统三态覆盖率达到 100% |
| G3 | 误删除数据可在 30 天内恢复 | 软删除 + 回收站功能 |
| G4 | 所有管理操作有可追溯的审计日志 | 审计日志查询响应 < 1s（近 7 天数据） |

### 2.2 业务目标

| # | 目标 | 衡量标准 |
|---|------|----------|
| B1 | 减少管理后台开发重复劳动 | 新页面仅需引用基础组件即可获得三态能力 |
| B2 | 为 3500 用户导入后的运营做好准备 | 用户列表支持 5000+ 行流畅滚动（< 60fps） |
| B3 | 消除 P0 级数据安全风险 | 所有删除操作默认软删除 |
| B4 | 运营人力需求降低 50% | DAU 运营时间 < 30 分钟/天（目标） |

---

## 3. Non-Goals（明确不做）

| # | 非目标 | 原因 |
|---|--------|------|
| N1 | **不开发新功能模块**（AI推广图、AI客服、VIP收件箱） | v3.0 是质量基础设施版本，新模块延后到 v3.1 |
| N2 | **不做移动端适配** | 管理后台是纯桌面端产品，目标设备 ≥1366px 宽度 |
| N3 | **不做国际化/多语言** | 当前仅英文用户，ROI 不足以支撑投入 |
| N4 | **不做自定义 BI 报表** | 预设报表 + CSV 导出已满足当前需求 |
| N5 | **不做 Slack/钉钉/飞书通知集成** | 邮箱通知 + 站内通知已足够，v4.0 再评估 |
| N6 | **不做自定义角色编辑器（拖拽权限组）** | v3.0 仅支持预设角色 + API 创建角色，UI 编辑在 v3.1 |
| N7 | **不迁移双重聊天系统** | ChatRoom → Conversation 是历史遗留，暂不合并 |

---

## 4. User Stories

### 4.1 角色: Frank（超级管理员）

**US-1: Schema 修复验证**
> As a 超级管理员, when I assign MODERATOR role to a new staff member through the admin panel, I want the system to immediately reflect this role in the User's adminRoles relation, so that the permission middleware can correctly authorize their subsequent API calls.

**Acceptance Criteria**:
- [ ] `GET /api/admin/users/:id` 响应中包含 `adminRoles` 数组（通过 Prisma include）
- [ ] 角色分配后，用户的 RBAC 权限在 1 分钟内生效（无需重启服务）
- [ ] `AdminRoleAudit` 记录可关联到具体 User（通过 Prisma relation）
- [ ] GIVEN 用户被分配 MODERATOR 角色 WHEN 用户访问 `/admin/users` THEN 能看到用户列表（user.view 权限通过）
- [ ] GIVEN 用户被分配 MODERATOR 角色 WHEN 用户尝试 `DELETE /api/admin/users/:id` THEN 返回 403（user.delete 权限未授予）

---

**US-2: 审计日志可追溯**
> As a 超级管理员, I want to view a unified audit log showing who did what and when across all admin modules, so that I can trace any suspicious activity back to the specific admin who performed it.

**Acceptance Criteria**:
- [ ] 审计日志页面 `/admin/settings/audit` 显示统一格式的记录
- [ ] 每条记录包含：操作人头像+姓名、操作类型、目标对象、变更内容（JSON diff）、IP、时间
- [ ] 支持按操作人、操作类型、时间范围筛选
- [ ] 支持按时间倒序排列（默认）
- [ ] 列表支持分页（默认 50 条/页）
- [ ] GIVEN 管理员 A 封禁了用户 B WHEN 查看审计日志 THEN 能看到 "A banned User B, reason: spam" 的记录
- [ ] GIVEN 大量审计日志（10万+）WHEN 查询近 7 天数据 THEN 响应时间 < 1s

---

**US-3: 软删除与数据恢复**
> As a 超级管理员, when I accidentally delete a user, I want to be able to restore them within 30 days, so that irreversible data loss is prevented.

**Acceptance Criteria**:
- [ ] 删除用户操作将 `deletedAt` 设为当前时间，不物理删除
- [ ] 被软删除的用户在前端列表中默认不显示（通过 Prisma middleware 过滤）
- [ ] 提供"回收站"入口 `/admin/users/trash`，显示已删除用户列表
- [ ] 在回收站中，管理员可点击"恢复"将 `deletedAt` 置为 null
- [ ] 恢复后的用户数据完整性 100%（Profile、Match、Payment 等关联数据）
- [ ] 超过 30 天的软删除记录自动物理清除（cron job）
- [ ] GIVEN 用户被软删除 WHEN 30 天到期 THEN 自动物理删除（含关联数据）
- [ ] 以下模型支持软删除：User, Match, ChatRoom, Subscription, Payment, UserReport

---

**US-4: 全局加载/空/错误三态**
> As a 超级管理员, when I navigate to any page in the admin panel, I want consistent visual feedback during loading, when data is empty, and when errors occur, so that I always understand the system state without guesswork.

**Acceptance Criteria**:

**加载态 (Loading)**:
- [ ] 所有数据列表/表格页面显示与内容形状匹配的骨架屏（Skeleton）
- [ ] 骨架屏在数据请求开始时立即显示，数据到达后平滑过渡到正常态
- [ ] KPI 卡片独立加载——一个卡片的加载不影响其他卡片

**空态 (Empty)**:
- [ ] 首次进入无数据页面时，显示专用插画 + 标题 + 描述 + CTA 按钮
- [ ] 例如：用户列表为空时显示"No users yet. Import your first batch of users." + "Import Users" 按钮
- [ ] 筛选后无结果时显示"No results match your filters. Try adjusting your search criteria." + "Clear Filters" 按钮

**错误态 (Error)**:
- [ ] 每个数据组件使用 ErrorBoundary 包裹——组件错误不影响页面其他区域
- [ ] 错误组件显示红色/琥珀色横幅 + 错误描述 + "Retry" 按钮
- [ ] 全局 500 错误由 `error.tsx` (Next.js) 兜底
- [ ] 404 错误显示"Page not found" + "Go to Dashboard" 按钮

---

### 4.2 角色: Admin（管理员）

**US-5: 用户列表虚拟滚动**
> As an admin managing 5000+ users, I want the user list to scroll smoothly without lag, so that I can quickly browse and find users regardless of total count.

**Acceptance Criteria**:
- [ ] 用户列表使用 TanStack Table Virtual 实现虚拟滚动
- [ ] 超过 50 行时自动启用虚拟滚动
- [ ] 滚动帧率 ≥ 55fps（在 5000 行数据集上）
- [ ] 固定表头，仅滚动数据行区域
- [ ] 搜索/筛选/排序在 300ms 内完成（防抖后的查询时间）
- [ ] GIVEN 5000 个用户 WHEN 快速滚动列表 THEN 无卡顿、无白屏

---

**US-6: 批量操作进度反馈**
> As an admin, when I perform batch operations on 200+ users, I want to see a real-time progress indicator, so that I know when the operation will complete.

**Acceptance Criteria**:
- [ ] 批量操作触发后，显示进度弹窗："Processing: 45/200 (22%), 3 failed"
- [ ] 进度每 500ms 更新一次
- [ ] 已完成的操作显示绿色 ✓，失败的操作显示红色 ✗ + 失败原因
- [ ] 操作完成后显示汇总："Completed: 197/200, Failed: 3/200. View details."
- [ ] 支持在操作进行中取消（取消后，已完成的操作不回滚）
- [ ] GIVEN 封禁 200 个用户 WHEN 点击"Ban 200 users" THEN 显示进度条 + 完成汇总

---

**US-7: 高危操作二次确认**
> As an admin, when I attempt a dangerous operation like banning or deleting users, I want the system to require explicit confirmation, so that I avoid accidental irreversible actions.

**Acceptance Criteria**:
- [ ] 删除/封禁/退款等 P0 高危操作触发破坏性确认弹窗
- [ ] 弹窗包含：红色警告图标、操作标题、影响说明、后果说明
- [ ] 对于"删除用户"类型操作，要求输入用户名确认（"Type USERNAME to confirm"）
- [ ] 对于"封禁"类型操作，要求选择原因（下拉框）+ 可选备注
- [ ] 确认按钮使用红色 + `destructive` variant
- [ ] 取消按钮为默认焦点（防止回车误操作）
- [ ] GIVEN 点击"Delete User John" WHEN 弹窗显示 THEN 必须输入"John"才能点击确认按钮

---

### 4.3 角色: 所有管理员

**US-8: Cmd+K 全局搜索**
> As an admin, I want to press Cmd+K to open a global search panel that lets me quickly navigate to any user, page, or setting, so that I can work efficiently without clicking through menus.

**Acceptance Criteria**:
- [ ] Cmd+K / Ctrl+K 打开全局搜索面板（居中浮层）
- [ ] 搜索面板支持搜索：用户（按姓名/邮箱/ID）、页面（按标题）、快捷操作
- [ ] 输入即搜索（防抖 200ms），结果显示前 8 条匹配
- [ ] 键盘导航：↑↓ 选择，Enter 跳转，Esc 关闭
- [ ] 搜索结果按类型分组显示（Users / Pages / Actions）
- [ ] URL 导航：选择用户 → 跳转到 `/admin/users/:id`；选择页面 → 跳转到对应路由
- [ ] Esc 关闭面板，焦点回到触发前的元素

---

**US-9: Toast 操作反馈**
> As an admin, I want to see a brief notification after any write operation (create/update/delete), so that I know immediately whether my action succeeded or failed.

**Acceptance Criteria**:
- [ ] 所有写操作（POST/PATCH/DELETE）完成后显示 Toast 通知
- [ ] 成功：绿色，"User banned successfully"，2 秒自动消失
- [ ] 失败：红色，"Failed to ban user: Network error"，5 秒自动消失 + 手动关闭按钮
- [ ] 使用 shadcn/ui Sonner 组件
- [ ] Toast 显示位置：右下角
- [ ] 同时最多显示 3 个 Toast（超出排队）
- [ ] GIVEN 封禁用户操作成功 WHEN 点击"Ban" THEN 显示绿色 toast "User banned successfully"

---

**US-10: 表单验证反馈**
> As an admin, when I fill out a form (e.g., editing user profile), I want real-time validation feedback, so that I can fix errors before submitting.

**Acceptance Criteria**:
- [ ] 所有表单使用 react-hook-form + zod schema 验证
- [ ] 输入时实时验证（onChange），显示错误提示在字段下方
- [ ] 提交时再次全面验证，无效字段自动聚焦
- [ ] 错误提示格式：红色文字 + 具体错误原因
- [ ] 必填字段以 `*` 标记
- [ ] 日期/数字字段格式化输入（输入时自动格式化）
- [ ] GIVEN 用户名称为空 WHEN 尝试提交表单 THEN 显示"Name is required"并聚焦到名称字段

---

## 5. Requirements（需求分级）

### 5.1 P0 — Must-Have（不完成不可发布 v3.0）

#### REQ-01: Schema 关系修复

| 属性 | 内容 |
|------|------|
| **描述** | 修复 3 个 P0 Schema 缺陷，确保 RBAC 和审计系统数据链路完整 |
| **依赖** | 无 |
| **估时** | 5 天（含迁移脚本 + staging 验证） |

**Sub-Requirements**:

**REQ-01.1: User + AdminUserRole 反向关系**
```prisma
model User {
  // ... existing fields ...
  adminRoles AdminUserRole[] // ← 新增
}
```

**REQ-01.2: AdminRoleAudit + User 关系绑定**
```prisma
model AdminRoleAudit {
  actorId      String
  actor        User     @relation(fields: [actorId], references: [id])
  targetUserId String?
  targetUser   User?    @relation(fields: [targetUserId], references: [id])
}
```

**REQ-01.3: CustomRole 模型（支持动态角色创建）**
```prisma
model CustomRole {
  id          String     @id @default(cuid())
  name        String     @unique
  description String?
  isSystem    Boolean    @default(false)
  permissions String[]   // ["user.view", "user.ban", ...]
  createdAt   DateTime   @default(now())
  updatedAt   DateTime   @updatedAt
  userRoles   AdminUserRole[]
}

// AdminUserRole 新增字段
model AdminUserRole {
  // ... existing fields ...
  customRoleId String?
  customRole   CustomRole? @relation(fields: [customRoleId], references: [id])
}
```

---

#### REQ-02: 统一审计日志

| 属性 | 内容 |
|------|------|
| **描述** | 合并 AdminLog 和 AdminRoleAudit 为统一的 AdminAudit 模型 |
| **依赖** | REQ-01 |
| **估时** | 3 天 |

**Sub-Requirements**:

**REQ-02.1: AdminAudit 模型**
```prisma
model AdminAudit {
  id           String    @id @default(cuid())
  actorId      String
  actor        User      @relation(fields: [actorId], references: [id])
  category     AuditCategory  // "user" | "match" | "payment" | "rbac" | "system"
  action       String    // "create" | "update" | "delete" | "grant_role" | "revoke_role"
  targetType   String    // "User" | "Match" | "Payment" | "AdminRole"
  targetId     String?
  changes      Json?     // { before: {...}, after: {...} }
  reason       String?
  ip           String?
  createdAt    DateTime  @default(now())
}
```

**REQ-02.2: AuditCategory 枚举**
```prisma
enum AuditCategory {
  USER, MATCH, CHAT, PAYMENT, CONTENT, BOT,
  AI_CREATIVE, AI_SUPPORT, VIP, ANALYTICS, SYSTEM, RBAC
}
```

**REQ-02.3: 审计日志写入中间件**
- 所有管理 API 的写操作（POST/PATCH/DELETE）自动写入 AdminAudit
- 操作人信息从 session 中提取（NextAuth `getServerSession`）
- IP 地址从 `x-forwarded-for` header 提取
- 记录写入为异步操作（不阻塞 API 响应）

**REQ-02.4: 审计日志查看器页面**
- 页面: `/admin/settings/audit`
- 筛选器：操作人、类别、日期范围
- 列表：头像+姓名、操作图标+文字、目标、变更摘要、时间
- 展开详情：完整 before/after JSON diff
- 分页：默认 50 条/页

---

#### REQ-03: 软删除机制

| 属性 | 内容 |
|------|------|
| **描述** | 为核心模型添加软删除，数据误删后 30 天内可恢复 |
| **依赖** | 无 |
| **估时** | 4 天 |

**Sub-Requirements**:

**REQ-03.1: Schema 变更**
需要软删除的模型：
```prisma
// User, Match, ChatRoom, Conversation, Subscription,
// Payment, UserReport, CreativeTemplate, VIPMembership
model User {
  // ...
  deletedAt  DateTime?
  @@index([deletedAt])
}
```

**REQ-03.2: Prisma 软删除中间件**
```typescript
// src/lib/prisma-soft-delete.ts
// 使用 prisma-extension-soft-delete 或自定义 Prisma Client Extension
// 自动过滤 deletedAt IS NOT NULL 的记录
// 所有查询默认排除已删除记录
```

**REQ-03.3: 回收站页面**
- 路由: `/admin/users/trash`, `/admin/matches/trash`, 等
- 显示已删除记录列表（类型、名称、删除时间、删除人）
- "Restore" 按钮：将 deletedAt 置为 null
- "Permanently Delete" 按钮：物理删除（需二次确认）

**REQ-03.4: 自动清理 Cron Job**
```typescript
// 每日凌晨 2:00 执行
// DELETE FROM User WHERE deletedAt < NOW() - INTERVAL '30 days'
// 同样处理 Match, ChatRoom 等模型
```

---

#### REQ-04: 全局交互基础组件

| 属性 | 内容 |
|------|------|
| **描述** | 建立全局统一的加载/空/错误三态组件库 |
| **依赖** | 无 |
| **估时** | 6 天 |

**Sub-Requirements**:

**REQ-04.1: Skeleton 骨架屏组件**
```typescript
// src/components/ui/skeleton.tsx (复用 shadcn/ui)
// src/components/admin/loading-skeleton.tsx (业务封装)

// 使用模式:
// <DataTableSkeleton columns={5} rows={10} />   // 表格骨架
// <CardSkeleton />                               // KPI 卡片骨架
// <ChartSkeleton height={300} />                 // 图表骨架
```

**REQ-04.2: EmptyState 空状态组件**
```typescript
// src/components/admin/empty-state.tsx
interface EmptyStateProps {
  icon: LucideIcon        // 插画图标
  title: string           // 标题
  description: string     // 描述
  action?: {              // CTA 按钮
    label: string
    onClick: () => void
  }
  filtered?: boolean      // true = 筛选结果为空 / false = 真正无数据
}

// 使用模式:
// <EmptyState icon={Users} title="No users yet" 
//   description="Import your first batch of users to get started."
//   action={{ label: "Import Users", onClick: handleImport }} />
```

**REQ-04.3: ErrorBoundary 错误边界**
```typescript
// src/components/admin/error-boundary.tsx
// 每个独立数据区域包裹 ErrorBoundary
// 错误时显示: 红色横幅 + 错误消息 + "Retry" 按钮
// 不传播到父级组件

// 使用模式:
// <ErrorBoundary fallback={<DataLoadError onRetry={refetch} />}>
//   <UserTable data={users} />
// </ErrorBoundary>
```

**REQ-04.4: Toast 通知系统**
```typescript
// 使用 shadcn/ui Sonner (toast 库)
// 成功: toast.success("User banned successfully")
// 失败: toast.error("Failed to ban user: Network error")
// 加载: toast.loading("Banning user...")
```

**REQ-04.5: ConfirmDialog 确认弹窗**
```typescript
// src/components/admin/confirm-dialog.tsx
// 三种模式:
// - destructive: 红色按钮 + 警告图标 + 需输入确认文字
// - warning: 琥珀色按钮 + 警告图标
// - info: 蓝色按钮 + 信息图标
```

---

#### REQ-05: API 基座标准化

| 属性 | 内容 |
|------|------|
| **描述** | 统一 API 响应格式、错误码、权限注解、批量操作路径 |
| **依赖** | REQ-01 |
| **估时** | 4 天 |

**Sub-Requirements**:

**REQ-05.1: 统一 API 响应格式**
```typescript
// src/lib/api-response.ts
interface ApiResponse<T> {
  success: boolean
  data: T | null
  error?: {
    code: string          // "PERMISSION_DENIED" | "VALIDATION_ERROR" | "NOT_FOUND" | "INTERNAL_ERROR"
    message: string
    details?: unknown
  }
  meta?: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
}
```

**REQ-05.2: 权限中间件注解**
```typescript
// src/lib/with-permission.ts
// 每个管理 API 必须声明所需权限:

export const POST = withPermission('user.ban')(async (req, ctx) => {
  // This endpoint requires 'user.ban' permission
})

export const DELETE = withPermission('user.delete', { 
  dangerous: true, 
  confirmation: true 
})(async (req, ctx) => {
  // High-risk operation: requires 'user.delete' + audit logging
})
```

**REQ-05.3: 批量操作路径统一**
```
# 统一为: POST /api/admin/{resource}/batch
# 请求体: { action: "ban" | "delete" | "tag", ids: string[], params?: {...} }
# 响应: { success: true, data: { total, succeeded, failed, details } }

POST /api/admin/users/batch         → { action: "ban", ids: [...], params: { reason: "spam" } }
POST /api/admin/reports/batch       → { action: "dismiss", ids: [...] }
```

**REQ-05.4: API 错误码枚举**
```typescript
enum ApiErrorCode {
  PERMISSION_DENIED = "PERMISSION_DENIED",
  VALIDATION_ERROR = "VALIDATION_ERROR",
  NOT_FOUND = "NOT_FOUND",
  RATE_LIMITED = "RATE_LIMITED",
  CONFLICT = "CONFLICT",
  INTERNAL_ERROR = "INTERNAL_ERROR",
  UNAUTHORIZED = "UNAUTHORIZED",
}
```

---

#### REQ-06: RBAC 权限中间件与页面集成

| 属性 | 内容 |
|------|------|
| **描述** | 实现前后端权限校验，所有管理页面和 API 有权限保护 |
| **依赖** | REQ-01, REQ-05 |
| **估时** | 5 天 |

**Sub-Requirements**:

**REQ-06.1: 后端 API 权限中间件**
```typescript
// src/middleware/admin-rbac.ts
// 从 session 中获取当前用户的 adminRoles
// 查询 AdminUserRole + AdminRolePermission → 构建权限集合
// 比对 requiredPermission 与用户权限集合
// 不匹配 → 返回 403 + { error: { code: "PERMISSION_DENIED" } }
```

**REQ-06.2: 前端路由守卫**
```typescript
// src/lib/use-permission.ts
// React Hook: usePermission("user.ban") → boolean
// 用于条件渲染: {hasPermission("user.ban") && <BanButton />}
// 用于路由守卫: 在 layout.tsx 中检查，无权限 → 重定向 /admin/403

// src/app/admin/403/page.tsx
// "Access Denied — You don't have permission to view this page."
// + "Request Access" 按钮（向超管发送申请）
```

**REQ-06.3: 角色管理页面**
- 路由: `/admin/settings/roles`
- 角色列表页：卡片展示 7 个系统角色 + 自定义角色
- 角色详情抽屉：角色名称、描述、权限列表（按分类折叠）
- 创建自定义角色：名称 + 描述 + 权限选择（复选框按分类分组）
- 编辑权限：开启/关闭单个权限（立即生效）

**REQ-06.4: 管理员用户管理页面**
- 路由: `/admin/settings/admins`
- 管理员列表：头像、姓名、当前角色（标签）、部门、最后登录时间
- 分配角色：点击用户 → 选择角色（多选）+ 部门 + 过期时间（可选）
- 撤销角色：点击角色标签上的 × 按钮

**REQ-06.5: Seed 脚本**
```typescript
// prisma/seed-rbac.ts
// 创建 61 个 AdminPermission 记录
// 创建 7 个角色的 AdminRolePermission 关联
// 创建 Frank 的 SUPER_ADMIN AdminUserRole
```

---

### 5.2 P1 — Should-Have（显著改善体验，优先跟进）

#### REQ-07: 仪表盘增强

| 属性 | 内容 |
|------|------|
| **描述** | KPI 卡片增加趋势对比，添加自动刷新控制，空状态引导 |
| **依赖** | REQ-04 |
| **估时** | 3 天 |

**Sub-Requirements**:
- [ ] 每个 KPI 卡片显示：当前值 + 对比值（vs 昨日 ↑12% / vs 上周 ↓3%）
- [ ] 趋势方向：↑ 绿色（正向），↓ 红色（负向）
- [ ] 添加"Pause Auto-Refresh" / "Resume Auto-Refresh" 按钮
- [ ] 首次空状态：显示 Onboarding Checklist（"Complete your profile setup" → "Import users" → "Configure matching engine"）
- [ ] 每个 KPI 卡片独立加载（错误隔离）

---

#### REQ-08: 用户管理性能优化

| 属性 | 内容 |
|------|------|
| **描述** | 虚拟滚动、搜索防抖、批量操作进度、CSV 导出限制 |
| **依赖** | REQ-04 |
| **估时** | 3 天 |

**Sub-Requirements**:
- [ ] TanStack Table Virtual：超过 50 行启用虚拟滚动
- [ ] 搜索框防抖 300ms
- [ ] 批量操作显示实时进度（x/200 processing）
- [ ] CSV 导出上限 10,000 行，超过提示"Use date range filter to narrow results"
- [ ] 用户详情 7 个标签页改为懒加载（仅加载当前可见标签页数据）

---

#### REQ-09: 全局交互增强

| 属性 | 内容 |
|------|------|
| **描述** | 键盘快捷键、搜索防抖、乐观更新 |
| **依赖** | REQ-04 |
| **估时** | 2 天 |

**Sub-Requirements**:
- [ ] Cmd+K 全局搜索面板（参见 US-8）
- [ ] Esc 关闭弹窗/面板
- [ ] Ctrl+Enter 提交表单
- [ ] 列表页快速操作（封禁/标记）使用乐观更新（先更新 UI，后确认 API）

---

#### REQ-10: 数据库索引优化

| 属性 | 内容 |
|------|------|
| **描述** | 补齐关键查询路径的数据库索引 |
| **依赖** | 无 |
| **估时** | 2 天 |

**索引列表**:
```
User.createdAt                          → 用户新增统计
Match.createdAt                         → 匹配列表排序
IMMessage(conversationId, createdAt)    → 消息列表分页
UserReport(status, createdAt)           → 举报处理队列
Payment(createdAt, status)              → 支付流水查询
VIPMessage(vipUserId, createdAt)        → VIP 消息列表
Subscription(userId, status)            → 用户订阅查询
AdminAudit(category, createdAt)         → 审计日志筛选
AdminAudit(actorId)                     → 操作人审计查询
```

---

### 5.3 P2 — Future Considerations（架构预留，v3.1+）

| # | 需求 | 预留方式 |
|---|------|----------|
| P2-01 | 自定义角色 UI 编辑器（拖拽权限组） | CustomRole 模型已预留，UI 编辑器在 v3.1 |
| P2-02 | 深色模式 | CSS 变量体系支持 `data-theme="dark"` |
| P2-03 | 数据归档策略（90天+历史数据迁移冷存储） | 在 `@index([deletedAt])` 基础上扩展 |
| P2-04 | 乐观锁（数据并发编辑保护） | 模型预留 `version Int @default(1)` |
| P2-05 | CSV→PDF 报告导出 | API 响应格式已统一，新增格式只需扩展 |
| P2-06 | 实时通知（SSE/WebSocket） | API 基座已统一，实时通道作为独立模块接入 |
| P2-07 | Alert 告警系统实现 | AlertRule + Alert 模型已建，业务逻辑在 v3.2 |

---

## 6. Success Metrics

### 6.1 上线即测指标（Week 1）

| 指标 | 目标 | 测量方式 |
|------|------|----------|
| P0 Schema 迁移成功率 | 100%（零数据丢失） | 迁移前后数据量对比 |
| API 响应格式标准化覆盖率 | 100%（所有 `/api/admin/*` 端点） | 集成测试自动化检测 |
| 软删除功能覆盖率 | 6 个核心模型 100% | 单元测试 + 手动验证 |
| RBAC 权限检查覆盖率 | 100%（所有管理 API 端点） | byPass 测试每个端点 |

### 6.2 上线后追踪指标（Week 2-4）

| 指标 | 目标 | 测量方式 |
|------|------|----------|
| 页面首次加载骨架屏可见时间 | < 200ms | Chrome DevTools Performance |
| 5000 行用户列表滚动帧率 | ≥ 55fps | React DevTools Profiler |
| 搜索防抖后结果返回时间 | < 300ms（本地过滤）/ < 1000ms（API 查询） | Network 面板 |
| 组件级错误率 | < 0.1% 的页面受到影响 | Sentry/自定义错误追踪 |
| 审计日志写入延迟 | < 100ms（异步写入） | API 响应头计时 |

### 6.3 运营效率指标（Month 1-3）

| 指标 | 基线 | 目标 |
|------|------|------|
| 每日运营操作次数 | 无数据 | 建立基线 |
| 误操作恢复时间 | > 24h（手工恢复） | < 5min（软删除恢复） |
| 新管理员上手时间 | 无数据 | < 30min（引导清单 + Cmd+K） |
| 管理后台日均访问时长 | 无数据 | < 30min（自动化后减少） |

---

## 7. Open Questions

| # | 问题 | 需要谁回答 | 阻塞性 | 截止日期 |
|---|------|-----------|--------|----------|
| Q1 | Prisma SQLite 是否支持 `@relation` 反向关系的无缝迁移？需要使用 `db push` 还是完整 migration？ | Engineering | 是 | Sprint 1.1 前 |
| Q2 | 软删除中间件 (`prisma-extension-soft-delete`) 与 NextAuth v5 adapter 是否兼容？ | Engineering | 是 | Sprint 1.2 前 |
| Q3 | CustomRole 权限码存储为 `String[]`（JSON 数组）在 SQLite 中的查询性能如何？是否有更好的方案？ | Engineering | 否 | Sprint 1.1 中 |
| Q4 | `prisma-extension-soft-delete` 与 `prisma middleware`（@relation）一起使用是否有兼容性问题？ | Engineering | 否 | Sprint 1.2 中 |
| Q5 | Frank 期望的审计日志保留期限是多久？是否需要 GDPR 合规的数据删除能力？ | Frank | 否 | Sprint 2.1 前 |
| Q6 | 对于 `SincerityWallet` 关联到 Profile 而非 User 的问题，是否需要修复？ | Frank | 否 | Sprint 1.3 前 |
| Q7 | 双重聊天系统（ChatRoom + Conversation）是否需要在 v3.0 统一？目前是否还在同时使用？ | Engineering | 否 | Sprint 2.1 前 |

---

## 8. Timeline Considerations

### 8.1 硬性约束

| 约束 | 详情 |
|------|------|
| 预算限制 | ¥1000，AI API 成本需严格控制 |
| 人力资源 | Frank 单人开发 + Scout（AI）辅助 |
| 技术栈 | Next.js 15 + Prisma + SQLite + NextAuth v5 |
| 兼容性 | 必须兼容现有 30+ 模型和 93+ API 端点 |

### 8.2 依赖关系

```
REQ-01 (Schema Fix) ──── REQ-05 (API Standard) ──── REQ-06 (RBAC Middleware)
       │                         │
       └── REQ-02 (Audit)        └── REQ-04 (UI Components) ──── REQ-07 (Dashboard)
                                                       │
                                                       ├── REQ-08 (User Mgmt)
                                                       └── REQ-09 (Interaction)
                                               
REQ-03 (Soft Delete) ─ independent
REQ-10 (Indexes) ──── independent
```

### 8.3 分阶段交付计划

```
Phase 1: 数据基座 (Week 1-2, 10天)
├── Sprint 1.1 (5天): REQ-01 Schema 修复
│   ├── Day 1-2: P0-1 + P0-2 (User + AdminRoleAudit 关系)
│   ├── Day 3-4: P0-3 (CustomRole 模型)
│   └── Day 5: 迁移脚本 + staging 验证
├── Sprint 1.2 (5天): REQ-02 审计日志 + REQ-03 软删除
│   ├── Day 1-2: AdminAudit 模型 + 迁移
│   ├── Day 3-4: 软删除 + Prisma middleware
│   └── Day 5: REQ-10 索引补充
└── Sprint 1.3 (REQ-05 API 标准化，可并行启动)
    ├── Day 1-2: ApiResponse 格式 + 错误码
    ├── Day 3-4: 权限中间件注解 + 批量路径统一
    └── Day 5: Seed 脚本

Phase 2: 交互基座 (Week 3-4, 10天)
├── Sprint 2.1 (5天): REQ-04 全局三态 + Toast
│   ├── Day 1-2: Skeleton + EmptyState + ErrorBoundary 组件
│   ├── Day 3-4: Toast (Sonner) + ConfirmDialog
│   └── Day 5: 现有页面接入三态组件（dashboard + user list）
├── Sprint 2.2 (5天): REQ-06 RBAC 集成
│   ├── Day 1-2: 后端 API 权限中间件
│   ├── Day 3: 前端路由守卫 + 403 页面
│   ├── Day 4: 角色管理页面 + 管理员管理页面
│   └── Day 5: Seed 脚本 + 全面测试

Phase 3: 体验增强 (Week 5, 5天)
├── Sprint 3.1 (3天): REQ-07 仪表盘增强
└── Sprint 3.2 (2天): REQ-08 用户管理优化 + REQ-09 交互增强

Phase 4: 测试 & 上线 (Week 5-6, 3天)
├── E2E 测试 (Playwright)
├── RBAC 权限矩阵全面测试
├── 软删除 + 恢复流程测试
├── 性能测试 (5000 用户虚拟滚动)
└── 灰度上线 + 监控
```

### 8.4 里程碑

| 里程碑 | 日期 | 交付物 | 验收标准 |
|--------|------|--------|----------|
| M1: Schema Ready | Week 2 结束 | 迁移成功的数据库 | 所有 P0 关系通过 Prisma validate |
| M2: UI Base Ready | Week 4 结束 | 三态组件库 + Toast + RBAC 中间件 | 所有现有页面接入三态 |
| M3: Feature Complete | Week 5 结束 | 仪表盘增强 + 用户管理优化 + Cmd+K | 全部 AC 通过 |
| M4: Ship | Week 6 结束 | 生产部署 | 0 个 P0/P1 遗留缺陷 |

---

## 附录 A: 技术决策记录

| 决策 | 选择 | 理由 | 备选方案 |
|------|------|------|----------|
| UI 组件库 | shadcn/ui | 已在 v2.0 使用，Tree-shaking 优秀 | Radix UI 原版 |
| 表格 | TanStack Table | 虚拟滚动 + 排序 + 筛选 + 服务端分页一体 | AG Grid（太重）/ 原生 table |
| Toast | Sonner | shadcn/ui 默认集成，API 简洁 | react-hot-toast |
| 表单 | react-hook-form + zod | 轻量 + 类型安全 + 验证分离 | Formik + Yup |
| 软删除 | prisma-extension-soft-delete | 社区维护，与 Prisma Client Extension 兼容 | 手写 Prisma middleware |
| 审计日志 | 统一 AdminAudit 表 | 替代两套分散系统（AdminLog + AdminRoleAudit） | — |
| 权限注解 | `withPermission()` 高阶函数 | 声明式，编译时检查 | 装饰器（Next.js 不支持） |

---

## 附录 B: 变更记录

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-05-02 | v1.0 | 初始 PRD，基于 V3.0 调研报告编写 |

---

*Scout — LokFeel AI 协调员 | [V3.0 调研报告](./admin-dashboard-product-spec-v3.md)*
