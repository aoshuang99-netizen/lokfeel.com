# Admin Dashboard V4 自动化测试系统

## 🔧 问题诊断

所有测试返回 `Failed to fetch` 的原因：
- **本地文件协议 (file://)** 下的 fetch 无法跨域请求 HTTPS 站点
- 浏览器安全策略阻止了 `file://` → `https://` 的请求

## ✅ 解决方案

### 方案1: 使用 Vercel CLI 预览（推荐）

```bash
cd /Users/frankzhao/WorkBuddy/20260402202519/nexus-app
npx vercel dev
```

然后访问 `http://localhost:3000/admin-test`

### 方案2: 手动测试命令

直接使用 curl 验证各端点：

```bash
# 基础健康检查
curl -s -o /dev/null -w "状态: %{http_code}\n" https://app.lokfeel.com/api/health

# 登录页面
curl -s -o /dev/null -w "状态: %{http_code}\n" https://app.lokfeel.com/admin-login

# Dashboard（未登录应307重定向）
curl -s -o /dev/null -w "状态: %{http_code}\n" https://app.lokfeel.com/admin

# 带Cookie的Dashboard
curl -s -b "next-auth.session-token=YOUR_TOKEN" -o /dev/null -w "状态: %{http_code}\n" https://app.lokfeel.com/admin

# API端点
curl -s https://app.lokfeel.com/api/admin/session | jq .
curl -s https://app.lokfeel.com/api/admin/dashboard/summary | jq .
```

## 📊 快速测试脚本

```bash
#!/bin/bash
BASE_URL="https://app.lokfeel.com"

echo "=== Admin Dashboard V4 端点测试 ==="
echo ""

endpoints=(
  "/api/health:200"
  "/admin-login:200"
  "/admin:200|307"
  "/api/admin/session:200"
  "/api/admin/dashboard/summary:200"
  "/api/admin/users:200"
  "/api/admin/matches:200"
  "/api/admin/subscriptions:200"
  "/admin/users:200"
  "/admin/matches:200"
  "/admin/subscriptions:200"
  "/admin/analytics:200"
  "/admin/settings:200"
  "/admin/settings/admins:200"
  "/admin/settings/roles:200"
  "/admin/settings/audit:200"
  "/admin/settings/rbac:200"
)

passed=0
failed=0

for item in "${endpoints[@]}"; do
  url="${item%%:*}"
  expected="${item##*:}"
  
  status=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}${url}")
  
  if [[ "$expected" == *"$status"* ]]; then
    echo "✅ ${url} -> ${status}"
    ((passed++))
  else
    echo "❌ ${url} -> ${status} (期望: ${expected})"
    ((failed++))
  fi
done

echo ""
echo "=== 结果: ${passed} 通过, ${failed} 失败 ==="
```

## 🎯 需要认证的测试

需要先获取有效的 session token：

1. 在浏览器中登录 https://app.lokfeel.com/admin-login
2. 打开开发者工具 → Application → Cookies → next-auth.session-token
3. 复制 token 值

```bash
# 使用 session token 测试
TOKEN="YOUR_SESSION_TOKEN"

curl -s -H "Cookie: next-auth.session-token=${TOKEN}" \
  https://app.lokfeel.com/api/admin/session | jq .

curl -s -H "Cookie: next-auth.session-token=${TOKEN}" \
  https://app.lokfeel.com/api/admin/dashboard/summary | jq .
```

## 🔍 常见错误排查

| 错误 | 原因 | 解决方案 |
|------|------|----------|
| Failed to fetch | 本地文件协议 | 使用 `vercel dev` 或部署测试 |
| CORS error | 跨域限制 | 检查 Next.js CORS 配置 |
| 307 redirect | 未登录正常重定向 | 预期行为，无需修复 |
| 401 Unauthorized | session 无效 | 重新登录获取 token |
| 500 Internal Error | 服务器错误 | 检查 Vercel 日志 |

## 📁 相关文件

- 登录页面: `/app/(auth)/admin-login/page.tsx`
- 管理后台: `/app/(admin)/admin/page.tsx`
- API 路由: `/app/api/admin/**/route.ts`
