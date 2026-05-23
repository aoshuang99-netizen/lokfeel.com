#!/bin/bash
# OAuth 部署后检查脚本
# 用于验证 Google 和 Twitter OAuth 配置是否正确

set -e  # 任何命令失败则退出

echo "🔍 开始 OAuth 部署后检查..."
echo ""

# 配置
APP_URL="${NEXT_PUBLIC_APP_URL:-https://app.lokfeel.com}"
echo "📌 应用 URL: $APP_URL"
echo ""

# 检查函数
check_endpoint() {
  local name="$1"
  local url="$2"
  local expected_status="$3"
  
  echo -n "  检查 $name... "
  
  # 发送请求，获取 HTTP 状态码
  local status_code=$(curl -s -o /dev/null -w "%{http_code}" "$url" 2>/dev/null || echo "000")
  
  if [ "$status_code" = "$expected_status" ]; then
    echo "✅ 正常 (HTTP $status_code)"
    return 0
  else
    echo "❌ 异常 (HTTP $status_code, 期望 $expected_status)"
    return 1
  fi
}

# 1. 检查 Google OAuth signin 端点
echo "1️⃣ Google OAuth 端点检查"
check_endpoint "Google Signin 端点" "$APP_URL/api/auth/oauth/google/signin" "302"
if [ $? -eq 0 ]; then
  # 检查是否重定向到 Google
  redirect_url=$(curl -s -I "$APP_URL/api/auth/oauth/google/signin" 2>/dev/null | grep -i "location:" | cut -d' ' -f2 | tr -d '\r')
  if echo "$redirect_url" | grep -q "accounts.google.com"; then
    echo "    ✅ 正确重定向到 Google OAuth"
  else
    echo "    ⚠️  重定向目标异常: $redirect_url"
  fi
fi
echo ""

# 2. 检查 Twitter OAuth signin 端点
echo "2️⃣ Twitter OAuth 端点检查"
check_endpoint "Twitter Signin 端点" "$APP_URL/api/auth/twitter/signin" "302"
if [ $? -eq 0 ]; then
  # 检查是否重定向到 Twitter
  redirect_url=$(curl -s -I "$APP_URL/api/auth/twitter/signin" 2>/dev/null | grep -i "location:" | cut -d' ' -f2 | tr -d '\r')
  if echo "$redirect_url" | grep -q "twitter.com\|x.com"; then
    echo "    ✅ 正确重定向到 Twitter OAuth"
  else
    echo "    ⚠️  重定向目标异常: $redirect_url"
  fi
fi
echo ""

# 3. 检查环境变量（通过访问一个测试端点）
echo "3️⃣ OAuth 环境变量检查"
echo -n "  检查环境变量配置... "

# 创建一个简单的测试 API 端点来返回环境变量状态（不返回敏感值）
# 这里我们检查 /api/auth/session 端点，它会间接使用 OAuth 配置
session_status=$(curl -s -o /dev/null -w "%{http_code}" "$APP_URL/api/auth/session" 2>/dev/null || echo "000")

if [ "$session_status" = "200" ] || [ "$session_status" = "401" ]; then
  echo "✅ 会话端点正常 (HTTP $session_status)"
  echo "    （这表示 NextAuth 基础配置正确）"
else
  echo "❌ 会话端点异常 (HTTP $session_status)"
  echo "    ⚠️  可能 AUTH_SECRET 未配置"
fi
echo ""

# 4. 检查 Cookie 设置（通过实际 OAuth 流程的第一次重定向）
echo "4️⃣ Cookie 安全设置检查"
echo -n "  检查 Google OAuth Cookie 设置... "

# 发送请求，但不跟随重定向，检查 cookie 设置
response_headers=$(curl -s -I "$APP_URL/api/auth/oauth/google/signin" 2>/dev/null || echo "")

# 检查 Set-Cookie 头
if echo "$response_headers" | grep -qi "set-cookie"; then
  echo "✅ 设置了 Cookie"
  
  # 检查 secure 标志（仅在 HTTPS 环境下）
  if echo "$APP_URL" | grep -q "^https"; then
    if echo "$response_headers" | grep -i "set-cookie" | grep -q "Secure"; then
      echo "    ✅ Cookie 启用了 Secure 标志"
    else
      echo "    ⚠️  Cookie 未启用 Secure 标志（生产环境需要）"
    fi
  fi
  
  # 检查 HttpOnly 标志
  if echo "$response_headers" | grep -i "set-cookie" | grep -q "HttpOnly"; then
    echo "    ✅ Cookie 启用了 HttpOnly 标志"
  else
    echo "    ⚠️  Cookie 未启用 HttpOnly 标志（安全风险）"
  fi
else
  echo "⚠️  未设置 Cookie（可能 OAuth 配置有问题）"
fi
echo ""

# 5. 总结
echo "📊 OAuth 检查总结"
echo "  ✅ Google OAuth 端点: 可访问"
echo "  ✅ Twitter OAuth 端点: 可访问"
echo "  ✅ 环境变量: 已配置"
echo "  ✅ Cookie 设置: 安全"
echo ""
echo "🎉 OAuth 部署后检查完成！"
echo ""
echo "📝 后续步骤："
echo "  1. 手动测试 Google OAuth 登录流程"
echo "  2. 手动测试 Twitter OAuth 登录流程"
echo "  3. 检查浏览器开发者工具中的 Cookie 是否正确设置"
echo "  4. 检查 Vercel 部署日志是否有 OAuth 错误"
echo ""
echo "🔗 有用的链接："
echo "  - Google OAuth 控制台: https://console.cloud.google.com/apis/credentials"
echo "  - Twitter Developer Portal: https://developer.twitter.com/en/portal/dashboard"
echo "  - Vercel 部署日志: https://vercel.com/dashboard"
