# H后台管理员登录指南

## 登录入口

**后台专用登录页面：** http://localhost:3000/admin/login

> ⚠️ 与前台用户登录（/login）完全分离，采用深色ERP主题设计

---

## 测试账号

### 演示账号（推荐首次使用）

| 账号 | 密码 | 角色 | 说明 |
|------|------|------|------|
| `admin` | `Admin@2026!` | SUPER_ADMIN | 超级管理员，拥有所有权限 |
| `moderator` | `Mod@2026!` | MODERATOR | 内容审核员 |
| `analyst` | `Analyst@2026!` | ANALYST | 数据分析师 |

### 其他说明

- 可使用数据库中已有的管理员用户登录
- 支持使用 **邮箱** 或 **用户名** 登录

---

## UI设计差异

### 后台登录 vs 前台登录

| 特性 | 前台登录 (/login) | 后台登录 (/admin/login) |
|------|-------------------|------------------------|
| **主题** | 浅色主题（白+棕） | 深色主题（#0a0a0f） |
| **Logo** | 心形图标 + LokFeel | 盾牌图标 + Admin Console |
| **标题** | "Welcome Back" | "Admin Console · 红墙计划" |
| **输入框** | Email + Password | 管理员账号 + 登录密码 |
| **按钮文案** | "Sign In →" | "进入管理后台" |
| **背景** | 纯色 + 模糊效果 | 网格图案 + 蓝色光晕 |
| **OAuth** | Google/Discord | ❌ 无（仅密码登录） |
| **版本标识** | 无 | 右下角 "v2.0.0 · ERP Console" |

---

## 功能清单

### 已实现

1. ✅ **独立登录页面** - `/admin/login` 深色ERP主题
2. ✅ **会话管理** - Cookie-based session
3. ✅ **角色显示** - 登录后在Header显示用户名和角色
4. ✅ **登出功能** - 点击头像 → 退出登录
5. ✅ **会话持久化** - 24小时有效期

### 目录结构

```
src/
├── app/
│   ├── (admin)/admin/
│   │   ├── login/
│   │   │   └── page.tsx        # 后台登录页（深色主题）
│   │   ├── users/page.tsx       # 用户管理
│   │   ├── matches/page.tsx     # 匹配管理
│   │   ├── content/page.tsx     # 内容管理
│   │   └── page.tsx            # 仪表盘
│   └── api/admin/
│       ├── login/route.ts       # 登录API
│       ├── logout/route.ts      # 登出API
│       └── session/route.ts     # 会话查询API
├── components/admin/
│   └── admin-header.tsx         # 后台顶部导航（含用户菜单）
└── lib/
    └── admin-auth.ts            # 会话验证工具
```

---

## 登录流程

### 1. 访问登录页
```
http://localhost:3000/admin/login
```

### 2. 输入凭据
```
账号: admin
密码: Admin@2026!
```

### 3. 点击「进入管理后台」

### 4. 成功登录后
- 自动跳转到 `/admin` 仪表盘
- Header显示管理员信息
- 可点击头像 → 退出登录

---

## 权限角色

| 角色 | 权限说明 |
|------|----------|
| SUPER_ADMIN | 最高权限，可管理所有后台功能 |
| ADMIN | 管理员，可访问所有功能 |
| MODERATOR | 审核员，可审核内容和匹配 |
| ANALYST | 分析师，可查看数据 |
| SUPPORT | 客服，可查看用户信息 |

---

## 注意事项

1. **会话安全**
   - Session存储在HttpOnly Cookie中
   - 有效期24小时
   - 生产环境自动启用Secure标志

2. **错误处理**
   - 用户名或密码错误：显示"用户名或密码错误"
   - 会话过期：自动跳转登录页

3. **开发环境**
   - Demo账号可直接使用
   - 数据库管理员用户也可登录

---

**生成时间：** 2026-05-04 16:20
