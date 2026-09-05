#!/bin/bash

# Pusher 环境变量自动配置脚本
# 使用方法: ./configure-pusher.sh

set -e

echo "🚀 Pusher 环境变量自动配置"
echo "================================"
echo ""

# 检查是否已有凭证
if [ -f "/Users/frankzhao/WorkBuddy/20260402202519/nexus-app/.pusher-credentials.json" ]; then
    echo "✅ 发现已保存的 Pusher 凭证"
    source <(jq -r 'to_entries | .[] | "export \(.key)=\(.value)"' /Users/frankzhao/WorkBuddy/20260402202519/nexus-app/.pusher-credentials.json)
else
    echo "⚠️  未找到 Pusher 凭证"
    echo ""
    echo "请选择操作："
    echo "1) 我已经有了 Pusher 凭证（输入）"
    echo "2) 帮我打开 Pusher Dashboard（手动获取）"
    echo ""
    read -p "请选择 (1/2): " choice
    
    if [ "$choice" = "1" ]; then
        read -p "PUSHER_APP_ID: " PUSHER_APP_ID
        read -p "PUSHER_KEY: " PUSHER_KEY
        read -p "PUSHER_SECRET: " PUSHER_SECRET
        read -p "PUSHER_CLUSTER [us3]: " PUSHER_CLUSTER
        PUSHER_CLUSTER=${PUSHER_CLUSTER:-us3}
        
        # 保存凭证
        cat > /Users/frankzhao/WorkBuddy/20260402202519/nexus-app/.pusher-credentials.json <<EOF
{
  "PUSHER_APP_ID": "$PUSHER_APP_ID",
  "PUSHER_KEY": "$PUSHER_KEY",
  "PUSHER_SECRET": "$PUSHER_SECRET",
  "PUSHER_CLUSTER": "$PUSHER_CLUSTER"
}
EOF
        echo "✅ 凭证已保存"
    else
        echo "🌐 正在打开 Pusher Dashboard..."
        open "https://dashboard.pusher.com/"
        echo "请手动获取凭证，然后重新运行此脚本"
        exit 0
    fi
fi

# 读取凭证
PUSHER_APP_ID=$(jq -r '.PUSHER_APP_ID' /Users/frankzhao/WorkBuddy/20260402202519/nexus-app/.pusher-credentials.json)
PUSHER_KEY=$(jq -r '.PUSHER_KEY' /Users/frankzhao/WorkBuddy/20260402202519/nexus-app/.pusher-credentials.json)
PUSHER_SECRET=$(jq -r '.PUSHER_SECRET' /Users/frankzhao/WorkBuddy/20260402202519/nexus-app/.pusher-credentials.json)
PUSHER_CLUSTER=$(jq -r '.PUSHER_CLUSTER' /Users/frankzhao/WorkBuddy/20260402202519/nexus-app/.pusher-credentials.json)

echo ""
echo "📋 凭证信息："
echo "  App ID: $PUSHER_APP_ID"
echo "  Key: $PUSHER_KEY"
echo "  Cluster: $PUSHER_CLUSTER"
echo ""

# 添加到 Vercel
echo "🚀 正在添加到 Vercel..."

VERCEL_TOKEN="${VERCEL_TOKEN:?VERCEL_TOKEN env var is required to push Pusher env vars to Vercel}"
PROJECT_ID="prj_QMkgqlqeJdqMb8Ky4IYyt4zHMJpK"

# 添加环境变量函数
add_env() {
    local key=$1
    local value=$2
    
    echo "  添加 $key..."
    curl -s -X POST "https://api.vercel.com/v9/projects/$PROJECT_ID/env" \
      -H "Authorization: Bearer $VERCEL_TOKEN" \
      -H "Content-Type: application/json" \
      -d "{\"key\":\"$key\",\"value\":\"$value\",\"type\":\"encrypted\",\"target\":[\"production\"]}" \
      | jq -r '.id // .error // "success"' > /dev/null
}

add_env "PUSHER_APP_ID" "$PUSHER_APP_ID"
add_env "PUSHER_KEY" "$PUSHER_KEY"
add_env "PUSHER_SECRET" "$PUSHER_SECRET"
add_env "PUSHER_CLUSTER" "$PUSHER_CLUSTER"
add_env "NEXT_PUBLIC_PUSHER_KEY" "$PUSHER_KEY"
add_env "NEXT_PUBLIC_PUSHER_CLUSTER" "$PUSHER_CLUSTER"

echo "✅ 环境变量已添加到 Vercel！"
echo ""

# 重新部署
echo "🚀 正在重新部署（使环境变量生效）..."
cd /Users/frankzhao/WorkBuddy/20260402202519/nexus-app
npx vercel deploy --prod --yes --force \
  --token "$VERCEL_TOKEN" \
  --scope team_mB47XaxLSdmchbYenno9qN5u

echo ""
echo "✅ 部署完成！"
echo "🌐 生产环境: https://app.lokfeel.com"
echo ""
echo "📋 下一步："
echo "1. 访问 https://app.lokfeel.com/dashboard/chats"
echo "2. 发送测试消息，验证 Pusher 实时消息"
echo "3. 测试 WebRTC 视频通话功能"
