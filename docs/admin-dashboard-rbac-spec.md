# LokFeel 管理后台 — RBAC 权限体系设计文档

> **文档版本**: v2.1 | **日期**: 2026-05-02 | **作者**: Scout
> **状态**: Draft — 待评审
> **变更说明**: 新增管理后台完整 RBAC 权限体系，7个角色、45+精细权限、权限矩阵、数据库设计

---

## 一、设计目标

### 1.1 核心需求

| # | 需求 | 描述 |
|---|------|------|
| 1 | 角色分级 | 超级管理员统一调配，其他角色按职能分工 |
| 2 | 精细权限 | 每个功能点有独立的增/删/改/查权限 |
| 3 | 数据隔离 | 运营人员只能看到被授权的数据范围 |
| 4 | 操作审计 | 所有权限变更和敏感操作全程留痕 |
| 5 | 高危保护 | 删除/封禁/退款等高危操作需二次确认 |
| 6 | 临时权限 | 支持设置有效期，过期自动失效 |

### 1.2 权限模型选择

**模型**: ABAC（属性-Based）+ RBAC（角色-Based）混合

- 基础层：RBAC（角色-权限关联）
- 增强层：ABAC（按部门、数据范围进一步约束）
- 审计层：每次权限变更写入 `AdminRoleAudit`

---

## 二、角色定义

### 2.1 角色总览

| 角色 | 代码 | 适用范围 | 初始创建 |
|------|------|----------|----------|
| 超级管理员 | `SUPER_ADMIN` | 全系统，唯一，不可删除 | Frank (创始人) |
| 管理员 | `ADMIN` | 除权限管理外的所有功能 | 按需创建 |
| 审核员 | `MODERATOR` | 举报处理、内容审核、用户封禁 | 按需创建 |
| 分析师 | `ANALYST` | 只读数据分析，可导出 | 按需创建 |
| 客服 | `SUPPORT` | 用户查看 + 基础操作 | 按需创建 |
| 创意运营 | `CREATIVE` | AI推广图全生命周期管理 | 按需创建 |
| VIP客服 | `VIP_AGENT` | VIP收件箱专属 | 按需创建 |

### 2.2 角色详细说明

#### 🔴 SUPER_ADMIN（超级管理员）
```
- 所有权限（无任何限制）
- 可创建/编辑/删除其他管理员账号
- 可分配和撤销任何角色
- 可创建/编辑/删除权限定义
- 可配置系统参数
- 可查看完整审计日志
- 唯一约束：全系统只有 1-2 个超管账号
```

#### 🟠 ADMIN（管理员）
```
- 用户管理：增删改查 + 封禁 + 标签
- 匹配管理：查看 + 手动匹配 + 取消
- 聊天管理：查看 + 消息操作
- 支付管理：查看 + 退款
- 内容审核：举报处理 + 规则引擎
- Bot系统：查看 + 调控
- AI推广图：全生命周期
- AI客服：查看 + 配置
- VIP收件箱：查看 + 处理
- 数据分析：全部只读 + 导出
- 系统配置：查看 + 编辑（不含角色管理）

- ⚠️ 无权限：角色管理、权限定义、审计日志查看
```

#### 🟡 MODERATOR（审核员）
```
- 用户管理：查看 + 封禁（不含删除）
- 内容审核：举报处理全流程
- 聊天管理：敏感内容查看
- 用户追踪：查看用户行为轨迹

- ⚠️ 无权限：支付操作、BOT调控、AI工具管理、数据导出
```

#### 🔵 ANALYST（分析师）
```
- 数据分析：全部只读视图
- 数据导出：CSV/Excel 导出
- 用户管理：仅查看（不含操作）

- ⚠️ 无权限：任何写操作、内容审核、支付
```

#### 🟢 SUPPORT（客服）
```
- 用户管理：仅查看个人用户详情
- 举报处理：基础举报查看（不含处理）
- VIP收件箱：消息处理 + 回复
- 系统配置：仅查看通知配置

- ⚠️ 无权限：封禁用户、退款操作、数据导出
```

#### 🟣 CREATIVE（创意运营）
```
- AI推广图：全生命周期（模板/生成/A-B测试/素材）
- 数据分析：仅 AI 推广图相关数据

- ⚠️ 无权限：用户数据、支付、内容审核
```

#### 🟡 VIP_AGENT（VIP客服）
```
- VIP收件箱：全部功能（消息/工单/绩效）
- VIP用户管理：查看 + 配置（不含删除）
- 用户管理：仅VIP用户查看
- 数据分析：VIP相关指标

- ⚠️ 无权限：其他模块操作、数据导出
```

---

## 三、权限定义（45项）

### 3.1 权限编码规范

```
{模块}.{操作}

模块: user | match | chat | payment | content | bot | analytics |
      ai_creative | ai_support | vip | system | rbac
操作: view | create | edit | delete | export | action_special
```

### 3.2 权限分类表

#### 用户管理（USER）
| 权限代码 | 名称 | 危险 | 分类 |
|----------|------|------|------|
| `user.view` | 查看用户列表 | ✗ | USER |
| `user.view_detail` | 查看用户详情 | ✗ | USER |
| `user.edit` | 编辑用户资料 | ✗ | USER |
| `user.ban` | 封禁/解封用户 | ✓ | USER |
| `user.delete` | 删除用户 | ✓✓ | USER |
| `user.tag` | 管理用户标签 | ✗ | USER |
| `user.export` | 导出用户数据 | ✓ | USER |
| `user.tracking` | 查看用户行为追踪 | ✗ | USER |

#### 匹配管理（MATCHING）
| 权限代码 | 名称 | 危险 | 分类 |
|----------|------|------|------|
| `match.view` | 查看匹配列表 | ✗ | MATCHING |
| `match.view_detail` | 查看匹配详情 | ✗ | MATCHING |
| `match.manual` | 手动创建匹配 | ✓ | MATCHING |
| `match.cancel` | 取消匹配 | ✓ | MATCHING |
| `match.engine` | 配置匹配引擎参数 | ✓ | MATCHING |

#### 聊天管理（CHAT）
| 权限代码 | 名称 | 危险 | 分类 |
|----------|------|------|------|
| `chat.view` | 查看会话列表 | ✗ | CHAT |
| `chat.view_detail` | 查看会话详情 | ✗ | CHAT |
| `chat.message_delete` | 删除消息 | ✓ | CHAT |
| `chat.sensitive` | 查看敏感词命中 | ✗ | CHAT |

#### 支付管理（PAYMENT）
| 权限代码 | 名称 | 危险 | 分类 |
|----------|------|------|------|
| `payment.view` | 查看支付数据 | ✗ | PAYMENT |
| `payment.refund` | 执行退款 | ✓✓ | PAYMENT |
| `payment.subscription` | 管理订阅 | ✓ | PAYMENT |
| `payment.config` | 配置支付参数 | ✓✓ | PAYMENT |

#### 内容审核（CONTENT）
| 权限代码 | 名称 | 危险 | 分类 |
|----------|------|------|------|
| `content.report.view` | 查看举报列表 | ✗ | CONTENT |
| `content.report.action` | 处理举报 | ✓ | CONTENT |
| `content.consent` | 管理同意请求 | ✓ | CONTENT |
| `content.rule` | 配置规则引擎 | ✓ | CONTENT |

#### Bot系统（BOT）
| 权限代码 | 名称 | 危险 | 分类 |
|----------|------|------|------|
| `bot.view` | 查看Bot列表 | ✗ | BOT |
| `bot.edit` | 编辑Bot配置 | ✓ | BOT |
| `bot.learning` | 管理Bot学习 | ✓ | BOT |
| `bot.delete` | 删除Bot | ✓✓ | BOT |

#### AI推广图（AI_CREATIVE）
| 权限代码 | 名称 | 危险 | 分类 |
|----------|------|------|------|
| `ai_creative.view` | 查看推广图 | ✗ | AI_CREATIVE |
| `ai_creative.template` | 管理模板 | ✓ | AI_CREATIVE |
| `ai_creative.generate` | 触发生成任务 | ✓ | AI_CREATIVE |
| `ai_creative.abtest` | 管理A/B测试 | ✓ | AI_CREATIVE |
| `ai_creative.asset` | 管理素材库 | ✓ | AI_CREATIVE |

#### AI客服（AI_SUPPORT）
| 权限代码 | 名称 | 危险 | 分类 |
|----------|------|------|------|
| `ai_support.view` | 查看AI客服数据 | ✗ | AI_SUPPORT |
| `ai_support.template` | 管理响应模板 | ✓ | AI_SUPPORT |
| `ai_support.knowledge` | 管理知识库 | ✓ | AI_SUPPORT |
| `ai_support.routing` | 配置路由规则 | ✓ | AI_SUPPORT |
| `ai_support.qa` | 质检与绩效 | ✗ | AI_SUPPORT |

#### VIP管理（VIP）
| 权限代码 | 名称 | 危险 | 分类 |
|----------|------|------|------|
| `vip.view` | 查看VIP收件箱 | ✗ | VIP |
| `vip.reply` | 回复VIP消息 | ✓ | VIP |
| `vip.grant` | 授予VIP资格 | ✓ | VIP |
| `vip.revoke` | 取消VIP资格 | ✓ | VIP |
| `vip.user` | 管理VIP用户 | ✓ | VIP |
| `vip.ticket` | 管理工单 | ✓ | VIP |
| `vip.performance` | 查看绩效数据 | ✗ | VIP |

#### 数据分析（ANALYTICS）
| 权限代码 | 名称 | 危险 | 分类 |
|----------|------|------|------|
| `analytics.view` | 查看分析数据 | ✗ | ANALYTICS |
| `analytics.export` | 导出分析报告 | ✓ | ANALYTICS |
| `analytics.funnel` | 查看转化漏斗 | ✗ | ANALYTICS |

#### 系统配置（SYSTEM）
| 权限代码 | 名称 | 危险 | 分类 |
|----------|------|------|------|
| `system.config.view` | 查看系统配置 | ✗ | SYSTEM |
| `system.config.edit` | 编辑系统配置 | ✓ | SYSTEM |
| `system.audit` | 查看审计日志 | ✗ | SYSTEM |
| `system.health` | 查看系统健康 | ✗ | SYSTEM |

#### 权限管理（RBAC）
| 权限代码 | 名称 | 危险 | 分类 |
|----------|------|------|------|
| `rbac.role.view` | 查看角色列表 | ✗ | RBAC |
| `rbac.role.create` | 创建角色 | ✓ | RBAC |
| `rbac.role.edit` | 编辑角色 | ✓ | RBAC |
| `rbac.role.delete` | 删除角色 | ✓✓ | RBAC |
| `rbac.user.assign` | 分配管理员角色 | ✓✓ | RBAC |
| `rbac.user.revoke` | 撤销管理员角色 | ✓✓ | RBAC |
| `rbac.permission.view` | 查看权限定义 | ✗ | RBAC |
| `rbac.permission.edit` | 编辑权限定义 | ✓✓ | RBAC |

---

## 四、权限矩阵

### 4.1 角色-权限矩阵

> ✅ = 有此权限  |  — = 无此权限  |  ⚠️ = 需二次确认

| 权限代码 | SUPER_ADMIN | ADMIN | MODERATOR | ANALYST | SUPPORT | CREATIVE | VIP_AGENT |
|---------|:-----------:|:-----:|:---------:|:--------:|:-------:|:--------:|:---------:|
| **用户管理** ||||||||
| user.view | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅* |
| user.view_detail | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅* |
| user.edit | ✅ | ✅ | — | — | — | — | — |
| user.ban | ✅ | ✅ | ✅ | — | — | — | — |
| user.delete | ✅⚠️ | — | — | — | — | — | — |
| user.tag | ✅ | ✅ | ✅ | — | — | — | — |
| user.export | ✅ | ✅ | — | ✅⚠️ | — | — | — |
| user.tracking | ✅ | ✅ | ✅ | — | — | — | — |
| **匹配管理** ||||||||
| match.view | ✅ | ✅ | ✅ | ✅ | — | — | — |
| match.view_detail | ✅ | ✅ | ✅ | ✅ | — | — | — |
| match.manual | ✅ | ✅⚠️ | — | — | — | — | — |
| match.cancel | ✅ | ✅⚠️ | — | — | — | — | — |
| match.engine | ✅ | ✅⚠️ | — | — | — | — | — |
| **聊天管理** ||||||||
| chat.view | ✅ | ✅ | ✅ | — | — | — | — |
| chat.view_detail | ✅ | ✅ | ✅ | — | — | — | — |
| chat.message_delete | ✅ | ✅⚠️ | — | — | — | — | — |
| **支付管理** ||||||||
| payment.view | ✅ | ✅ | — | ✅ | — | — | — |
| payment.refund | ✅⚠️ | ✅⚠️ | — | — | — | — | — |
| payment.subscription | ✅ | ✅ | — | — | — | — | — |
| payment.config | ✅⚠️ | — | — | — | — | — | — |
| **内容审核** ||||||||
| content.report.view | ✅ | ✅ | ✅ | — | ✅ | — | — |
| content.report.action | ✅ | ✅ | ✅⚠️ | — | — | — | — |
| content.consent | ✅ | ✅ | ✅ | — | — | — | — |
| content.rule | ✅ | ✅⚠️ | — | — | — | — | — |
| **Bot系统** ||||||||
| bot.view | ✅ | ✅ | ✅ | ✅ | — | — | — |
| bot.edit | ✅ | ✅⚠️ | — | — | — | — | — |
| bot.learning | ✅ | ✅⚠️ | — | — | — | — | — |
| bot.delete | ✅⚠️ | — | — | — | — | — | — |
| **AI推广图** ||||||||
| ai_creative.view | ✅ | ✅ | — | — | — | ✅ | — |
| ai_creative.template | ✅ | ✅ | — | — | — | ✅⚠️ | — |
| ai_creative.generate | ✅ | ✅ | — | — | — | ✅⚠️ | — |
| ai_creative.abtest | ✅ | ✅ | — | — | — | ✅ | — |
| ai_creative.asset | ✅ | ✅ | — | — | — | ✅⚠️ | — |
| **AI客服** ||||||||
| ai_support.view | ✅ | ✅ | — | — | ✅ | — | — |
| ai_support.template | ✅ | ✅⚠️ | — | — | — | — | — |
| ai_support.knowledge | ✅ | ✅⚠️ | — | — | — | — | — |
| ai_support.routing | ✅ | ✅⚠️ | — | — | — | — | — |
| ai_support.qa | ✅ | ✅ | — | — | ✅ | — | — |
| **VIP管理** ||||||||
| vip.view | ✅ | ✅ | — | — | ✅ | — | ✅ |
| vip.reply | ✅ | ✅ | — | — | ✅⚠️ | — | ✅⚠️ |
| vip.grant | ✅ | ✅⚠️ | — | — | — | — | ✅⚠️ |
| vip.revoke | ✅ | ✅⚠️ | — | — | — | — | ✅⚠️ |
| vip.user | ✅ | ✅ | — | — | — | — | ✅⚠️ |
| vip.ticket | ✅ | ✅ | — | — | ✅⚠️ | — | ✅ |
| vip.performance | ✅ | ✅ | — | — | ✅ | — | ✅ |
| **数据分析** ||||||||
| analytics.view | ✅ | ✅ | — | ✅ | — | ✅ | ✅ |
| analytics.export | ✅ | ✅⚠️ | — | ✅⚠️ | — | — | — |
| analytics.funnel | ✅ | ✅ | — | ✅ | — | — | — |
| **系统配置** ||||||||
| system.config.view | ✅ | ✅ | — | — | ✅ | — | — |
| system.config.edit | ✅ | ✅⚠️ | — | — | — | — | — |
| system.audit | ✅ | — | — | — | — | — | — |
| system.health | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **权限管理** ||||||||
| rbac.role.view | ✅ | — | — | — | — | — | — |
| rbac.role.create | ✅⚠️ | — | — | — | — | — | — |
| rbac.role.edit | ✅⚠️ | — | — | — | — | — | — |
| rbac.role.delete | ✅⚠️ | — | — | — | — | — | — |
| rbac.user.assign | ✅⚠️ | — | — | — | — | — | — |
| rbac.user.revoke | ✅⚠️ | — | — | — | — | — | — |
| rbac.permission.view | ✅ | — | — | — | — | — | — |
| rbac.permission.edit | ✅⚠️ | — | — | — | — | — | — |

> \* VIP_AGENT 的 `user.*` 权限仅限 VIP 用户范围  
> ⚠️ = 需二次确认（危险操作）

---

## 五、数据库设计

### 5.1 数据模型

```
┌──────────────┐
│    User      │  (复用现有 User 表)
│──────────────│
│ id           │
│ email        │
│ role (UserRole)│ ← 原有：USER/ADMIN/SUPER_ADMIN（登录认证用）
└──────┬───────┘
       │ 1:N
       ▼
┌──────────────┐
│ AdminUserRole │  (管理员-角色关联)
│──────────────│
│ id           │  ← 多对多（1个管理员可有多个角色）
│ userId       │
│ role         │  ← AdminRole enum
│ department   │
│ title        │
│ grantedAt    │
│ grantedBy    │
│ expiresAt    │
└──────────────┘
       │
       ▼
┌──────────────┐
│ AdminRole    │  (角色枚举: 7个预定义)
│──────────────│
│ SUPER_ADMIN  │
│ ADMIN        │
│ MODERATOR    │
│ ANALYST      │
│ SUPPORT      │
│ CREATIVE     │
│ VIP_AGENT    │
└──────────────┘

┌─────────────────────┐
│   AdminPermission   │
│─────────────────────│
│ id                  │
│ code                │  ← "user.ban"
│ name                │  ← "封禁用户"
│ category            │  ← PermissionCategory
│ isActive            │
│ isDangerous         │  ← 危险标记
└────────┬────────────┘
         │ N:N
         ▼
┌─────────────────────┐
│ AdminRolePermission │
│─────────────────────│
│ role                │
│ permissionId        │
│ grantedAt           │
│ grantedBy           │
└─────────────────────┘

┌─────────────────┐
│  AdminRoleAudit │  (审计日志)
│─────────────────│
│ id               │
│ actorId           │ ← 谁执行
│ targetUserId      │ ← 谁被变更
│ action            │ ← role.granted / permission.updated
│ details (JSON)    │
│ reason            │ ← 必填
│ createdAt         │
└─────────────────┘
```

### 5.2 Prisma Schema 变更摘要

```prisma
// 新增枚举
enum AdminRole {
  SUPER_ADMIN
  ADMIN
  MODERATOR
  ANALYST
  SUPPORT
  CREATIVE
  VIP_AGENT
}

enum PermissionCategory {
  USER | MATCHING | CHAT | PAYMENT | CONTENT | BOT |
  AI_CREATIVE | AI_SUPPORT | VIP | ANALYTICS | SYSTEM | RBAC
}

// 新增模型
model AdminPermission {
  id          String @id
  code        String @unique
  name        String
  category    PermissionCategory
  isActive    Boolean
  isDangerous Boolean
  rolePermissions AdminRolePermission[]
}

model AdminRolePermission {
  id           String @id
  role         AdminRole
  permissionId String
  permission   AdminPermission
  grantedAt    DateTime
  grantedBy    String?
  @@unique([role, permissionId])
}

model AdminUserRole {
  id         String    @id
  userId     String
  user       User      @relation(...)
  role       AdminRole
  department String?
  title      String?
  isActive   Boolean
  grantedAt  DateTime
  grantedBy  String?
  expiresAt  DateTime?
  @@unique([userId, role])
}

model AdminRoleAudit {
  id        String @id
  actorId   String
  actorRole AdminRole
  action    String
  details   String? // JSON
  reason    String?
  createdAt DateTime
}
```

---

## 六、API 设计

### 6.1 权限检查 API

```
# 获取当前管理员的权限列表
GET  /api/admin/rbac/permissions/me
Response: { permissions: string[], roles: AdminRole[], department?: string }

# 获取角色列表
GET  /api/admin/rbac/roles

# 获取某个角色的权限列表
GET  /api/admin/rbac/roles/:role

# 创建角色（含权限）
POST /api/admin/rbac/roles
Body: { role, permissions: string[], description? }
Required: rbac.role.create

# 更新角色权限
PATCH /api/admin/rbac/roles/:role
Body: { permissions: string[] }
Required: rbac.role.edit

# 删除角色
DELETE /api/admin/rbac/roles/:role
Required: rbac.role.delete

# 获取管理员列表
GET  /api/admin/rbac/users?role=&department=&page=&size=

# 分配角色给管理员
POST /api/admin/rbac/users/:userId/roles
Body: { role, department?, expiresAt?, reason }
Required: rbac.user.assign

# 撤销管理员角色
DELETE /api/admin/rbac/users/:userId/roles/:role
Body: { reason }
Required: rbac.user.revoke

# 获取权限定义列表
GET  /api/admin/rbac/permissions?category=&active=

# 创建新权限
POST /api/admin/rbac/permissions
Required: rbac.permission.edit

# 更新权限定义
PATCH /api/admin/rbac/permissions/:id
Required: rbac.permission.edit

# 获取审计日志
GET  /api/admin/rbac/audit?actor=&target=&action=&from=&to=&page=&size=
Required: rbac.permission.edit
```

---

## 七、权限检查中间件

### 7.1 前端路由守卫

```typescript
// lib/rbac.ts
export const ROLE_PERMISSIONS: Record<AdminRole, string[]> = {
  SUPER_ADMIN: ['*'], // 全部权限
  ADMIN: ['user.*', 'match.*', 'chat.*', 'payment.*', 'content.*', 'bot.*', 'analytics.*', 'ai_creative.*', 'ai_support.*', 'vip.*', 'system.*'],
  MODERATOR: ['user.view', 'user.view_detail', 'user.ban', 'user.tracking', 'content.*', 'chat.view', 'chat.view_detail'],
  ANALYST: ['user.view', 'user.view_detail', 'match.view', 'match.view_detail', 'bot.view', 'analytics.*'],
  SUPPORT: ['user.view', 'user.view_detail', 'content.report.view', 'vip.*', 'system.config.view', 'system.health', 'ai_support.view', 'ai_support.qa'],
  CREATIVE: ['ai_creative.*', 'analytics.view'],
  VIP_AGENT: ['user.view', 'user.view_detail', 'vip.*', 'analytics.view', 'ai_support.view', 'ai_support.qa'],
};

export function hasPermission(role: AdminRole, permission: string): boolean {
  const perms = ROLE_PERMISSIONS[role];
  if (perms.includes('*')) return true;
  const [module] = permission.split('.');
  return perms.includes(permission) || perms.includes(`${module}.*`);
}

// 路由守卫 Hook
export function useCan(action: string) {
  const { role } = useAdminProfile();
  return hasPermission(role, action);
}
```

### 7.2 后端 API 中间件

```typescript
// middleware/rbac.ts
export async function requirePermission(
  req: Request,
  permission: string
) {
  const session = await getServerSession();
  if (!session) throw new AuthError('Unauthorized');

  const profile = await getAdminProfile(session.userId);
  if (!profile) throw new AuthError('Not an admin');

  const has = hasPermission(profile.role, permission);
  if (!has) {
    // 写审计日志
    await prisma.adminRoleAudit.create({
      data: {
        actorId: session.userId,
        actorRole: profile.role,
        action: 'permission.denied',
        details: JSON.stringify({ permission, path: req.url }),
      }
    });
    throw new AuthError('Forbidden');
  }
}
```

---

## 八、管理后台页面

### 8.1 RBAC 路由规划

```
/admin/settings                    → 系统设置（现有）
/admin/settings/roles             → 角色管理列表
/admin/settings/roles/new          → 创建角色
/admin/settings/roles/[role]       → 编辑角色（权限配置）
/admin/settings/users              → 管理员列表
/admin/settings/users/[userId]     → 管理员详情（角色分配）
/admin/settings/permissions        → 权限定义管理
/admin/settings/audit              → 审计日志
```

### 8.2 角色管理页面

```
角色管理 /admin/settings/roles
├── 角色卡片列表
│   ├── SUPER_ADMIN（不可编辑）
│   ├── ADMIN（可编辑权限）
│   ├── MODERATOR
│   ├── ANALYST
│   ├── SUPPORT
│   ├── CREATIVE
│   └── VIP_AGENT
│
├── 创建角色按钮（+ 新建角色）
│   ├── 角色名称
│   ├── 角色描述
│   ├── 部门（选填）
│   └── 权限选择器（分类勾选）
│
└── 审计日志入口（查看角色变更历史）
```

### 8.3 管理员列表页面

```
管理员管理 /admin/settings/users
├── 管理员列表（表格）
│   ├── 姓名 / Email
│   ├── 当前角色（可多个）
│   ├── 部门
│   ├── 最近登录
│   ├── 状态（活跃/过期）
│   └── 操作（编辑/停用/删除）
│
├── 搜索/筛选（按角色、部门、状态）
│
└── 分配角色按钮
    ├── 选择管理员（User ID / Email）
    ├── 选择角色（单选/多选）
    ├── 部门（选填）
    ├── 有效期（可选）
    └── 变更原因（必填）
```

---

## 九、高危操作保护

### 9.1 二次确认操作

| 操作 | 确认内容 | 附加条件 |
|------|----------|----------|
| 删除用户 | "此操作不可恢复，确定删除吗？" | 输入用户名确认 |
| 退款 | "确认退款 $X 给用户 Y？" | 输入金额+选择原因 |
| 取消匹配 | "取消后将通知双方，确定吗？" | 填写取消原因 |
| 编辑引擎参数 | "修改匹配引擎参数可能影响线上匹配" | 超管邮件通知 |
| 删除角色 | "删除后所有使用此角色的管理员将失去对应权限" | 输入角色名确认 |
| 撤销超管权限 | "确定要撤销自己的超管权限吗？" | 需另一个超管确认 |

### 9.2 危险权限自动告警

- 当 `rbac.user.assign` 被使用时 → 发送邮件通知所有 SUPER_ADMIN
- 当 `payment.refund` 单日超过 5 次 → 触发安全告警
- 当 `user.delete` 被使用 → 自动备份用户数据

---

## 十、实施路线图

### Phase 1: RBAC 基础框架（Week 1-2）
```
[ ] 添加 Prisma RBAC 模型 + migration
[ ] 初始化权限数据（45项权限 + 7个角色）
[ ] 创建 SUPER_ADMIN 账号（Frank）
[ ] 权限检查中间件
[ ] 基础角色管理页面（角色列表 + 详情）
```

### Phase 2: 管理员管理 + 审计（Week 3）
```
[ ] 管理员列表页面
[ ] 角色分配/撤销功能
[ ] AdminRoleAudit 审计日志记录
[ ] 审计日志查看页面
```

### Phase 3: 高危保护 + UI 优化（Week 4）
```
[ ] 二次确认弹窗组件
[ ] 危险权限标记 + 高亮
[ ] 路由守卫（前端）
[ ] 权限不足时的友好提示页面
```

### Phase 4: 数据隔离 + 临时权限（Week 5）
```
[ ] 部门级数据隔离（VIP客服只能看VIP用户）
[ ] 临时权限功能（expiresAt）
[ ] 权限变更通知
[ ] RBAC 权限管理页面（创建/编辑自定义角色）
```

---

## 十一、风险与注意事项

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 超管账号丢失 | 无法管理其他管理员 | 至少保留 2 个超管账号 |
| 权限越级 | 低权限账号获取高权限 | 审计日志 + 实时告警 |
| 权限定义被误删 | 影响线上功能 | `isActive` 软删除，不物理删除 |
| 权限与页面不匹配 | 用户看到空白页面 | 路由守卫兜底，显示"权限不足"提示 |

---

> **下一步**: 评审本文档 → 确认角色定义 → 开始 Phase 1 开发
> **作者**: Scout（LokFeel AI协调员）
