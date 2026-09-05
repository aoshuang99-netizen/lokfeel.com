# Pusher 配置完成指南

## ✅ 已完成的自动化步骤

1. ✅ WebRTC 视频通话功能已开发并完成
2. ✅ TypeScript 错误已全部修复
3. ✅ 代码已部署到 Vercel（Deployment: `nexus-mohift63q`）
4. ✅ 域名已绑定（app.lokfeel.com → 最新部署）
5. ✅ Pusher 环境变量框架已添加到 Vercel

## ⚠️ 需手动完成（5-10 分钟）

### 步骤 1: 获取 Pusher 凭证

1. **访问 Pusher Dashboard**: https://dashboard.pusher.com/
2. **登录或注册**（如果没有账号）
3. **创建新应用**:
   - App Name: `LokFeel Production`
   - Cluster: `us3`（美国东部）
   - 勾选: `Client events` 和 `Webhooks`
4. **复制凭证**（App Credentials 部分）:
   - `App ID`
   - `Key`
   - `Secret`
   - `Cluster`（通常是 `us3`）

### 步骤 2: 添加到 Vercel

**方法 A: 使用自动化脚本**（推荐）

```bash
cd /Users/frankzhao/WorkBuddy/20260402202519/nexus-app
node scripts/update-pusher-env.js
```

此脚本会交互式询问你的 Pusher 凭证，然后自动更新 Vercel 环境变量。

**方法 B: 手动更新**

1. 访问: https://vercel.com/team_mB47XaxLSdmchbYenno9qN5u/nexus-app/settings/environment-variables
2. 更新以下变量为实际值：
   - `PUSHER_APP_ID`
   - `PUSHER_KEY`
   - `PUSHER_SECRET`
   - `NEXT_PUBLIC_PUSHER_KEY`
3. `PUSHER_CLUSTER` 和 `NEXT_PUBLIC_PUSHER_CLUSTER` 已设置为 `us3`（无需修改）

### 步骤 3: 重新部署

添加环境变量后，**必须重新部署**才能使环境变量生效：

```bash
cd /Users/frankzhao/WorkBuddy/20260402202519/nexus-app
npx vercel deploy --prod --yes --force \
  --token "$VERCEL_TOKEN" \
  --scope team_mB47XaxLSdmchbYenno9qN5u
```

## 🧪 验证配置

部署完成后，验证 Pusher 是否工作：

1. 访问 https://app.lokfeel.com/dashboard/chats
2. 打开两个浏览器窗口（或两个不同的浏览器）
3. 登录两个不同的账号
4. 互相发送消息
5. **预期结果**: 消息应该实时显示（无需刷新页面）

## 📞 验证 WebRTC 视频通话

1. 在聊天页面，点击视频按钮（摄像头图标）
2. **预期结果**: 视频通话弹窗应该打开
3. 测试音频/视频开关、挂断功能

## 🔧 故障排查

### Pusher 不工作

1. 检查浏览器控制台是否有错误
2. 验证 Vercel 环境变量是否正确设置
3. 检查 Pusher Dashboard 的 Debug Console（是否有事件）

### WebRTC 不工作

1. 检查浏览器是否支持 WebRTC（Chrome/Edge/Firefox/Safari 都支持）
2. 允许浏览器访问摄像头和麦克风
3. 检查控制台错误

## 📊 当前状态

| 功能 | 状态 | 说明 |
|------|------|------|
| 生产环境 | ✅ 在线 | https://app.lokfeel.com |
| WebRTC UI | ✅ 完成 | 视频通话 UI 已部署 |
| Pusher 环境变量 | ⚠️ 待配置 | 需要添加实际凭证 |
| 实时消息 | ⚠️ 待启用 | 需要 Pusher 凭证 |
| 视频通话 | ⚠️ 待验证 | 需要 Pusher 信令 |

## 🚀 快速完成命令

如果你想让我帮你完成配置，请：

1. **提供 Pusher 凭证**（回复以下内容）:
   ```
   PUSHER_APP_ID=your_app_id
   PUSHER_KEY=your_key
   PUSHER_SECRET=your_secret
   PUSHER_CLUSTER=us3
   ```

2. **或者让我打开 Pusher Dashboard**（我会引导你完成）

---

**预计完成时间**: 5-10 分钟（手动配置）+ 2-3 分钟（重新部署）

**完成后**: LokFeel 将拥有完整的实时消息 + WebRTC 视频通话功能！
