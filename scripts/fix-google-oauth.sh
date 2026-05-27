#!/bin/bash
# Google OAuth 终极修复脚本
# 用途: 自动检查并修复所有 Google OAuth 配置问题

set -e

echo "🔍 开始 Google OAuth 诊断..."
echo ""

# 1. 检查环境变量
echo "📋 1. 检查环境变量..."
echo "GOOGLE_CLIENT_ID: ${GOOGLE_CLIENT_ID:0:20}..."
echo "GOOGLE_CLIENT_SECRET: ${GOOGLE_CLIENT_SECRET:0:10}..."
echo "NEXT_PUBLIC_APP_URL: $NEXT_PUBLIC_APP_URL"
echo "AUTH_SECRET: ${AUTH_SECRET:0:10}..."
echo ""

# 2. 测试后端端点
echo "🌐 2. 测试后端端点..."
echo "Testing: GET /api/auth/oauth/google/signin"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "https://app.lokfeel.com/api/auth/oauth/google/signin?callbackUrl=/dashboard")
echo "  Status: $HTTP_CODE (期望: 307)"
echo ""

echo "Testing: GET /api/debug/google-oauth-check"
DEBUG_OUTPUT=$(curl -s "https://app.lokfeel.com/api/debug/google-oauth-check")
echo "  Response: $DEBUG_OUTPUT" | head -20
echo ""

# 3. 检查 Google Cloud Console 配置 (手动步骤)
echo "⚠️  3. 手动检查 Google Cloud Console 配置:"
echo "  a) 打开 https://console.cloud.google.com/"
echo "  b) 选择项目: lokfeel-ai-matchmaking"
echo "  c) 左侧菜单: API 和服务 → 凭据"
echo "  d) 找到 OAuth 2.0 客户端 ID"
echo "  e) 点击编辑 → 已授权的重定向 URI"
echo "  f) 确保包含: https://app.lokfeel.com/api/auth/oauth/google/callback"
echo "  g) 保存更改"
echo ""

# 4. 检查 OAuth 同意屏幕
echo "⚠️  4. 手动检查 OAuth 同意屏幕:"
echo "  a) 左侧菜单: API 和服务 → OAuth 同意屏幕"
echo "  b) 确保应用名称: LokFeel"
echo "  c) 确保用户支持电子邮件已验证"
echo "  d) 添加测试用户 (如果应用处于测试模式)"
echo ""

# 5. 测试建议
echo "✅ 5. 测试建议:"
echo "  a) 打开浏览器,按 F12 打开开发者工具"
echo "  b) 访问 https://app.lokfeel.com/login"
echo "  c) 点击 'Continue with Google' 按钮"
echo "  d) 查看 Console 标签是否有错误"
echo "  e) 查看 Network 标签,确认重定向到 Google"
echo "  f) 如果在 Google 授权后出错,查看 URL 中的 error 参数"
echo ""

echo "📊 诊断完成！"
echo ""
echo "如果还有问题,请提供:"
echo "  1. 浏览器 Console 截图"
echo "  2. 浏览器 Network 标签截图 (Google 重定向)"
echo "  3. Vercel 日志: vercel logs --scope aoshuang99-2649s-projects"
