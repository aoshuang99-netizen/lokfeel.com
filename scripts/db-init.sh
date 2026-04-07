#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════
# Nexus 数据库初始化脚本
# 用途：在 Neon PostgreSQL 上推送 schema + 运行种子数据
# ═══════════════════════════════════════════════════════════════════════

set -e

echo "╔══════════════════════════════════════════════╗"
echo "║       Nexus 数据库初始化脚本 v1.0           ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# 检查 DATABASE_URL
if [ -z "$DATABASE_URL" ]; then
  echo "❌ 错误：DATABASE_URL 未设置"
  echo ""
  echo "请先设置环境变量："
  echo "  export DATABASE_URL='postgresql://user:password@host/nexus?sslmode=require'"
  echo ""
  echo "获取 Neon 连接字符串："
  echo "  1. 访问 https://neon.tech → 创建免费账号"
  echo "  2. 创建新项目 → 选择 'Serverless PostgreSQL'"
  echo "  3. 复制 'Connection String' (带 ?sslmode=require)"
  exit 1
fi

echo "✅ DATABASE_URL 已设置"
echo "   连接到: $(echo $DATABASE_URL | sed 's|postgresql://[^:]*:[^@]*@||' | cut -d'/' -f1)"
echo ""

# Step 1: 生成 Prisma Client
echo "── Step 1: 生成 Prisma Client ──"
npx prisma generate
echo "✅ Prisma Client 生成成功"
echo ""

# Step 2: 推送 Schema（不使用 migrations，适合初始化）
echo "── Step 2: 推送数据库 Schema ──"
npx prisma db push --accept-data-loss
echo "✅ Schema 推送成功"
echo ""

# Step 3: 运行种子数据（可选）
echo "── Step 3: 运行种子数据 ──"
read -p "是否运行演示数据种子？(y/n，生产环境建议选 n): " RUN_SEED
if [ "$RUN_SEED" = "y" ] || [ "$RUN_SEED" = "Y" ]; then
  npx tsx prisma/seed.ts
  echo "✅ 种子数据插入成功"
else
  # 只插入超级管理员账号（无演示数据）
  echo "仅初始化管理员账号..."
  npx tsx prisma/init-admin.ts 2>/dev/null || echo "⚠️  init-admin.ts 不存在，跳过"
  echo "✅ 跳过演示数据"
fi
echo ""

echo "╔══════════════════════════════════════════════╗"
echo "║          数据库初始化完成！                 ║"
echo "╠══════════════════════════════════════════════╣"
echo "║  下一步：在 Vercel 配置 DATABASE_URL        ║"
echo "║  vercel env add DATABASE_URL production     ║"
echo "╚══════════════════════════════════════════════╝"
