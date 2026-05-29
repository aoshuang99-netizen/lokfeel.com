#!/bin/bash
# 从 .env 加载变量并运行 bot 照片修复脚本
cd "$(dirname "$0")/.."

# 加载 .env
set -a
source .env
set +a

echo "✅ 环境变量已加载"
echo "DATABASE_URL prefix: ${DATABASE_URL:0:40}"
echo "TURSO_AUTH_TOKEN length: ${#TURSO_AUTH_TOKEN}"

# 运行修复脚本
echo ""
echo "🚀 开始执行 bot 照片修复..."
npx tsx scripts/db-fix-bot-photos.ts 2>&1
