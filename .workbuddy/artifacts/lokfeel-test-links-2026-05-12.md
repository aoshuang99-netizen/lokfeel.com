# LokFeel 测试链接与页面索引

**日期**: 2026-05-12
**用途**: 记录错误、持续修复的参考文档

---

## 🔗 生产环境 URL

| 类型 | URL | 说明 |
|------|-----|------|
| **App 首页** | https://app.lokfeel.com | 主应用入口，未登录自动跳转 /login |
| **Landing Page** | https://lokfeel.com | 营销落地页 |
| **管理后台** | https://app.lokfeel.com/admin/login | Admin 管理入口 |

---

## 🔐 登录相关页面

| 页面 | URL | 说明 |
|------|-----|------|
| **登录页** | https://app.lokfeel.com/login | Email/密码 + Google OAuth + X/Twitter OAuth |
| **注册页** | https://app.lokfeel.com/register | 邮箱注册流程 |
| **忘记密码** | https://app.lokfeel.com/forgot-password | 密码重置申请 |
| **重置密码** | https://app.lokfeel.com/reset-password | 密码重置执行（需 token） |
| **邮箱验证** | https://app.lokfeel.com/verify-request | 发送验证码页面 |
| **自动登录** | https://app.lokfeel.com/auto-login | Token 自动登录（魔法链接） |

---

## 📊 Dashboard 页面（需登录）

| 页面 | URL | 说明 |
|------|-----|------|
| **Dashboard 首页** | https://app.lokfeel.com/dashboard | 主仪表盘 |
| **个人资料** | https://app.lokfeel.com/dashboard/profile | 编辑个人资料 |
| **查看资料** | https://app.lokfeel.com/dashboard/profile/[id] | 查看他人资料 |
| **发现/Explore** | https://app.lokfeel.com/dashboard/explore | 浏览匹配推荐 |
| **连接/Connections** | https://app.lokfeel.com/dashboard/connections | 匹配列表 |
| **聊天列表** | https://app.lokfeel.com/dashboard/chats | 聊天室列表 |
| **聊天室** | https://app.lokfeel.com/dashboard/chats/[roomId] | 单个聊天室 |
| **通知** | https://app.lokfeel.com/dashboard/notifications | 系统通知 |
| **Onboarding** | https://app.lokfeel.com/dashboard/onboarding | 新用户引导 |
| **设置** | https://app.lokfeel.com/dashboard/settings | 账户设置 |
| **订阅** | https://app.lokfeel.com/dashboard/subscription | 套餐选择 |
| **订阅成功** | https://app.lokfeel.com/dashboard/subscription/success | 支付成功页 |
| **取消订阅** | https://app.lokfeel.com/dashboard/subscription/cancel | 取消订阅页 |
| **用户管理** | https://app.lokfeel.com/dashboard/users/[userId] | 用户详情（Admin） |

---

## 🔌 API 端点（Auth 相关）

### 登录/注册 API

| 端点 | 方法 | URL | 说明 |
|------|------|-----|------|
| **Credentials 登录** | POST | `/api/auth/login` | Email + 密码登录，返回 JWT session |
| **NextAuth Handler** | GET/POST | `/api/auth/[...nextauth]` | NextAuth 核心路由 |
| **CSRF Token** | GET | `/api/auth/csrf` | 获取 CSRF token |
| **用户注册** | POST | `/api/auth/register` | 邮箱 + 密码 + 验证码注册 |
| **检查用户** | GET | `/api/auth/check-user?email=xxx` | 检查邮箱是否已注册 |
| **邮箱验证码** | POST | `/api/auth/verify` | 发送/验证邮箱验证码 |
| **忘记密码** | POST | `/api/auth/forgot-password` | 发送密码重置邮件 |
| **重置密码** | POST | `/api/auth/reset-password` | 执行密码重置 |
| **魔法链接** | POST | `/api/auth/magic-link` | 发送自动登录链接 |
| **自动登录** | GET | `/api/auth/auto-login?token=xxx` | Token 自动登录 |
| **Firebase Bridge** | POST | `/api/auth/firebase-bridge` | Firebase token → NextAuth session |

### Google OAuth API

| 端点 | 方法 | URL | 说明 |
|------|------|-----|------|
| **Google 回调（自定义）** | GET | `/api/auth/callback/google` | 直接 token exchange + JWT encode |
| **完整 Google 流程** | GET → 302 → GET | `点击按钮 → Google → /api/auth/callback/google → /dashboard` |

### X/Twitter OAuth API

| 端点 | 方法 | URL | 说明 |
|------|------|-----|------|
| **Twitter 发起登录** | GET | `/api/auth/twitter/signin` | 生成 PKCE → 重定向到 Twitter 授权 |
| **Twitter 回调（自定义）** | GET | `/api/auth/twitter/callback` | 直接 token exchange + JWT encode |
| **完整 Twitter 流程** | GET → 302 → GET | `/api/auth/twitter/signin → Twitter → /api/auth/twitter/callback → /dashboard` |

### LinkedIn OAuth API

| 端点 | 方法 | URL | 说明 |
|------|------|-----|------|
| **LinkedIn 回调** | GET | `/api/auth/linkedin` | LinkedIn OAuth 回调 |

### 调试/诊断 API

| 端点 | 方法 | URL | 说明 |
|------|------|-----|------|
| **Auth 诊断** | GET | `/api/auth/diagnostic` | Auth 环境变量和配置诊断 |
| **E2E 测试** | GET | `/api/auth/e2e-test` | 登录流程端到端测试 |
| **Debug Auth** | GET | `/api/debug-auth` | ⚠️ 调试端点（未保护） |
| **DB 检查** | GET | `/api/db-check` | 数据库连接检查 |
| **健康检查** | GET | `/api/health` | 应用健康状态 |

---

## ⏰ Cron 端点（定时任务）

| 端点 | URL | 说明 |
|------|-----|------|
| **Bot 在线** | `/api/cron/bot-online` | 设置 Bot 在线状态 |
| **Bot 匹配** | `/api/cron/bot-match` | Bot 主动发起匹配 |
| **Bot 聊天** | `/api/cron/bot-chat` | Bot 主动发送消息 |
| **Bot 学习** | `/api/cron/bot-learning` | Bot 对话学习 |
| **Bot Tick** | `/api/cron/bot-tick` | Bot 心跳 |
| **清理软删除** | `/api/cron/cleanup-soft-delete` | 清理过期软删除数据 |
| **Cron 状态** | `/api/cron/status` | 定时任务执行状态 |

---

## 🧪 快速测试命令 (curl)

### 生产环境健康检查
```bash
# 基础健康检查
curl -s -o /dev/null -w "%{http_code}" https://app.lokfeel.com/api/health

# 数据库连接检查
curl -s https://app.lokfeel.com/api/db-check

# Auth 诊断
curl -s https://app.lokfeel.com/api/auth/diagnostic
```

### Credentials 登录测试
```bash
# Bot 登录测试（验证 session 创建）
curl -s -X POST https://app.lokfeel.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"bot-f00001@lokfeel.bot","password":"BotUser2026!Secure"}' \
  -c /tmp/lokfeel-cookies.txt

# 验证 Session（使用上一步的 cookie）
curl -s https://app.lokfeel.com/api/auth/check-user \
  -b /tmp/lokfeel-cookies.txt

# 错误密码测试
curl -s -X POST https://app.lokfeel.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"bot-f00001@lokfeel.bot","password":"wrong_password"}'
```

### Google OAuth 测试
```bash
# 测试 Google 回调（假 code → 应返回中文错误信息）
curl -s -o /dev/null -w "%{http_code}\n%{redirect_url}" \
  "https://app.lokfeel.com/api/auth/callback/google?code=fake_test_code"

# 测试 Google OAuth 流程入口（获取 CSRF → POST）
curl -s https://app.lokfeel.com/api/auth/csrf -c /tmp/csrf.txt
CSRF_TOKEN=$(grep csrf-token /tmp/csrf.txt | grep -o 'csrf-token=[^;]*' | cut -d= -f2)
curl -s -X POST https://app.lokfeel.com/api/auth/signin/google \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "csrfToken=$CSRF_TOKEN&callbackUrl=/dashboard&json=true" \
  -b /tmp/csrf.txt
```

### X/Twitter OAuth 测试
```bash
# 测试 Twitter 回调（假 code → 应返回中文错误信息）
curl -s -o /dev/null -w "%{http_code}\n%{redirect_url}" \
  "https://app.lokfeel.com/api/auth/twitter/callback?code=fake_test_code&state=test"

# 测试 Twitter 登录入口（应 302 重定向到 Twitter 授权页）
curl -s -o /dev/null -w "%{http_code}\n%{redirect_url}" \
  "https://app.lokfeel.com/api/auth/twitter/signin"
```

### 用户检查
```bash
# 检查邮箱是否已注册
curl -s "https://app.lokfeel.com/api/auth/check-user?email=bot-f00001@lokfeel.bot"
```

---

## 🐛 已知问题 & 修复记录

### 已修复 (2026-05-12)

| 问题 | 根因 | 修复 | Commit |
|------|------|------|--------|
| Google OAuth 点击后页面消失 | `signIn()` 静默失败 | 改用手动 POST fetch | `8cb4824` |
| X/Twitter OAuth 点击后空白 | 同上 | 内联错误处理 | `8cb4824` |
| Credentials 登录失败 | fetch 吞掉 307 redirect | 自定义 `/api/auth/login` + JWT encode | `a935400` |
| JWT Session 解密失败 | salt 不匹配 cookie name | salt = cookie name | `882bf30` |
| OAuth 回调页消失 | NextAuth PrismaAdapter 冷启动失败 | 自定义 callback + 直接 JWT encode | `16c3028` |
| 注册页 gender 硬编码 | handleSendCode 硬编码 woman | 改为 formData.gender | 已修复 |

### 待修复 / 注意事项

| 问题 | 严重性 | 说明 |
|------|--------|------|
| 调试端点未保护 | 🔴 高 | `/api/debug-auth`, `/api/db-check`, `/api/cron/status` 无认证 |
| Cron 端点无认证 | 🟡 中 | 除 bot-learning 外均无认证 |
| Admin 会话可伪造 | 🔴 高 | base64 编码非加密 |
| DB 延迟 ~3s | 🟡 中 | Turso 目标 <500ms |
| GFW 限制 | 🟡 中 | 中国用户需 VPN 访问 Google/Twitter |
| IM 未暂存文件 | 🟢 低 | OAuth 修复中的 IM 相关改动未提交 |

---

## 📱 浏览器测试检查清单

### 登录流程测试

- [ ] **Credentials 登录**: 打开 /login → 输入邮箱密码 → 点击登录 → 到达 /dashboard
- [ ] **Google OAuth**: 打开 /login → 点击 Google 按钮 → 跳转 accounts.google.com → 授权 → 到达 /dashboard
- [ ] **X/Twitter OAuth**: 打开 /login → 点击 X 按钮 → 跳转 twitter.com 授权 → 到达 /dashboard
- [ ] **注册流程**: 打开 /register → 填写信息 → 获取验证码 → 完成注册 → 到达 /dashboard
- [ ] **忘记密码**: 打开 /forgot-password → 输入邮箱 → 收到重置邮件 → 重置密码

### Dashboard 功能测试

- [ ] **Onboarding**: 新用户首次登录 → 完成 onboarding → 到达 dashboard
- [ ] **个人资料编辑**: /dashboard/profile → 修改资料 → 保存
- [ ] **Explore 浏览**: /dashboard/explore → 浏览推荐用户
- [ ] **匹配功能**: 点击喜欢/跳过 → 匹配成功提示
- [ ] **聊天功能**: /dashboard/chats → 进入聊天室 → 发送消息
- [ ] **通知功能**: /dashboard/notifications → 查看通知列表

### 错误场景测试

- [ ] **错误密码**: Credentials 登录输入错误密码 → 显示错误信息
- [ ] **空表单**: 未填必填项点击提交 → 显示验证错误
- [ ] **未登录访问 Dashboard**: 直接访问 /dashboard → 跳转到 /login
- [ ] **OAuth 取消**: Google/Twitter 授权页点击取消 → 返回 /login 带错误信息
- [ ] **网络断开**: 登录过程中断网 → 友好错误提示

---

## 📝 错误记录模板

测试时发现新错误，请按以下格式记录：

```
### [日期时间] 错误描述
- **页面/端点**: URL
- **复现步骤**:
  1. xxx
  2. xxx
- **预期行为**: xxx
- **实际行为**: xxx
- **错误信息**: (截图或控制台错误)
- **浏览器/设备**: Chrome/Safari/iOS/Android
- **严重性**: 🔴 高 / 🟡 中 / 🟢 低
```

---

*最后更新: 2026-05-12 15:05 CST*
