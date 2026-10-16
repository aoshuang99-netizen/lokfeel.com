#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════
# AC-24 · 性能基线 —— 本地隔离环境准备（建库 + 生产构建）
#
# ## 为什么需要这个脚本
#
#   压测必须打在**本机构建产物**上，而不是生产站：
#     · 生产站是跨境 Netlify 共享 serverless，测出来的是网络抖动，不是本仓代码成本
#     · 对生产开并发压测本身就是一种攻击
#   于是需要一个**可复跑**的隔离环境 —— 这个脚本就是那一步。
#
# ## ⚠️ 安全闸（本仓真实坑，见 CI_GATES.md §4ter）
#
#   `scripts/tenancy/migrate.mjs` 与 `scripts/connection/migrate.mjs` 的优先级是
#       args.url  >  .env / .env.local  >  进程环境变量
#   ——**`.env` 文件优先于环境变量**。而本仓 `.env.local` 里就是**生产 Turso**。
#   裸跑 `apply` 会**静默打到生产库**。
#   因此这里：
#     ① 一律显式传 `--url=`（覆盖 .env）
#     ② 断言 URL 必须以 `file:` 开头，否则立刻退出
#     ③ 只用进程环境变量驱动 `prisma db push` / `next build` / `next start`
#        （Next.js 与 dotenv 均不覆盖已存在的进程变量 —— 已实证，见 PERFORMANCE_BASELINE.md）
#
# 用法：
#   bash scripts/perf/prepare-env.sh [--db=perf-baseline.db] [--skip-build]
# ══════════════════════════════════════════════════════════════════════
set -euo pipefail

DB_NAME="perf-baseline.db"
SKIP_BUILD=0
for arg in "$@"; do
  case "$arg" in
    --db=*)       DB_NAME="${arg#--db=}" ;;
    --skip-build) SKIP_BUILD=1 ;;
    *) echo "未知参数：$arg"; exit 2 ;;
  esac
done

URL="file:./${DB_NAME}"

# ── 安全闸 ①：URL 必须是本地文件 ────────────────────────────────────────
case "$URL" in
  file:*) ;;
  *) echo "🔴 拒绝执行：URL 必须以 file: 开头（当前：$URL）"; exit 1 ;;
esac

echo "════════════════════════════════════════════════════════════"
echo " AC-24 性能基线 · 隔离环境准备"
echo " 目标库：$URL"
echo " 提交：  $(git rev-parse --short HEAD 2>/dev/null || echo 'unknown')"
echo "════════════════════════════════════════════════════════════"

echo ""
echo "── 1/4 建基线 schema（prisma db push，显式 --url 覆盖 .env）──"
DATABASE_URL="$URL" npx prisma db push --accept-data-loss --url="$URL"

echo ""
echo "── 2/4 应用自定义批次（tenancy，显式 --url）──"
node scripts/tenancy/migrate.mjs apply --batch=ALL --yes --url="$URL"

echo ""
echo "── 3/4 应用自定义批次（connection，显式 --url）──"
node scripts/connection/migrate.mjs apply --batch=ALL --yes --url="$URL"

if [ "$SKIP_BUILD" -eq 1 ]; then
  echo ""
  echo "⏭  跳过构建（--skip-build）"
else
  echo ""
  echo "── 4/4 生产构建（进程 env 驱动，Next 不覆盖已存在变量）──"
  DATABASE_URL="$URL" npm run build
fi

echo ""
echo "✅ 环境就绪：$URL"
echo "   启动：DATABASE_URL=\"$URL\" npm run start"
