# Pusher 免费注册配置指南 — LokFeel

## 1. 注册账号

1. 打开 **https://dashboard.pusher.com/accounts/sign_up**
2. 用 GitHub 或 Email 注册（推荐 GitHub 一键登录）
3. 登录后进入 Dashboard

## 2. 创建新 App

1. 点击 **"Create new app"** 按钮
2. 填写信息：
   - **App name**: `lokfeel-production`（或任意名称）
   - **Cluster/Region**: 选择 **`ap1` (Singapore)** — 对中国用户延迟最低
   - 其他选项保持默认
3. 点击 **Create app**

## 3. 获取 API Keys

创建成功后，进入 App → **App Keys** 标签页，复制以下 4 个值：

| Key | 示例 | 用途 |
|-----|------|------|
| **App ID** | `1892345` | 服务端识别你的应用 |
| **Key** | `a1b2c3d4e5f6g7h8i9j0` | 客户端连接 |
| **Secret** | `x1y2z3...` | 服务端签名（⚠️ 绝不暴露） |
| **Cluster** | `ap1` | 新加坡节点 |

## 4. 配置 Vercel 环境变量

在 nexus-app 目录执行以下命令（将占位符替换为你的实际值）：

```bash
cd /Users/frankzhao/WorkBuddy/20260402202519/nexus-app

# === 敏感变量（仅服务端使用） ===

# App ID — 服务端 + 客户端都用
npx vercel env add PUSHER_APP_ID production
# 粘贴你的 App ID，如: 1892345

# Secret — 仅服务端，⚠️ 绝不暴露给客户端
npx vercel env add PUSHER_SECRET production
# 粘贴你的 Secret

# === 公开变量（客户端可见） ===

# Key — 客户端连接需要
npx vercel env add NEXT_PUBLIC_PUSHER_KEY production
# 粘贴你的 Key

# Cluster — 默认 ap1 (Singapore)
npx vercel env add NEXT_PUBLIC_PUSHER_CLUSTER production
# 粘贴: ap1

# 启用 Pusher 开关
npx vercel env add NEXT_PUBLIC_USE_PUSHER production
# 粘贴: true
```

> **注意**: `vercel env add` 会交互式要求输入值，粘贴后按回车确认。每条命令执行时，选择环境为 **Production** + **Preview** + **Development**（全选）。

## 5. 本地开发 .env.local 配置

在 nexus-app 根目录创建/编辑 `.env.local`：

```env
PUSHER_APP_ID=你的App_ID
NEXT_PUBLIC_PUSHER_KEY=你的Key
PUSHER_SECRET=你的Secret
NEXT_PUBLIC_PUSHER_CLUSTER=ap1
NEXT_PUBLIC_USE_PUSHER=true
```

## 6. Pusher Dashboard 安全配置（可选但推荐）

登录 Pusher Dashboard → 你的 App → **Settings** 标签：

1. **Allowed Origins**: 添加以下域名
   - `https://app.lokfeel.com`（生产）
   - `http://localhost:3000`（本地开发）
2. **Enable stats**: 保持开启（监控消息量）

## 7. 验证连接

配置完成后，本地启动项目验证：

```bash
cd /Users/frankzhao/WorkBuddy/20260402202519/nexus-app
npm run dev
```

打开浏览器 Console (F12)，检查是否有 Pusher 连接日志：
- ✅ `Pusher : Connection established` → 成功
- ❌ `Pusher : Error` → 检查 key 和 cluster 是否正确

## 8. 免费额度确认

| 指标 | Sandbox 免费额度 | LokFeel 需求 |
|------|-----------------|-------------|
| 每日消息数 | **200,000** | 100并发 × 1000条/天 ≈ 5万 ✅ |
| 并发连接 | **100** | MVP阶段足够 ✅ |
| 费用 | **$0** | 永久免费 ✅ |

> **超出额度时**: Pusher 会发邮件提醒，不会直接断开连接。

## 代码已就位的部分

你的 nexus-app 已经有以下 Pusher 基础设施：

- ✅ `src/lib/pusher.ts` — 服务端/客户端 Pusher 实例
- ✅ `src/app/api/im/pusher/auth/route.ts` — 认证端点
- ✅ `src/lib/im/websocket/pusher-bridge.ts` — 消息桥接
- ✅ `src/hooks/use-im-pusher.ts` — 客户端订阅 hook
- ✅ `src/hooks/use-realtime.ts` — 实时消息 hook
- ✅ `src/hooks/useIM.ts` — IM 完整 hook（含 Pusher + 轮询 fallback）

**只差 3 步**: 配置环境变量 → 修复 auth bug → 接线到聊天页面。

---

## ⚠️ 重要提醒

1. **PUSHER_SECRET 绝不能** 放在前端代码中，只能通过 `vercel env` 或 `.env.local` 配置
2. **NEXT_PUBLIC_** 前缀的变量会暴露给浏览器，所以 Key 和 Cluster 是公开的（这是 Pusher 设计）
3. **中国大陆网络**: Pusher ap1 (Singapore) 节点在中国大陆通常可直连，延迟 ~50-100ms。如果被墙，需要通过 Vercel API 端点做服务端中转（代码已支持 auth endpoint 模式）
