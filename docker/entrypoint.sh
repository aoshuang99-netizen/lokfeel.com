#!/bin/sh
# ==============================================================================
# LokFeel 容器入口脚本
# ==============================================================================
# 职责：
#   1. 校验必要环境变量是否齐备（缺失即快速失败，而不是启动后运行时报错）
#   2. 等待数据库可连接
#   3. 按配置执行数据库迁移
#   4. 移交 PID 1 给应用进程
#
# 设计原则：fail fast + 明确报错。自托管场景下，
# 一条清晰的错误信息能省掉用户一小时的排查。
# ==============================================================================

set -eu

log()  { printf '\033[0;36m[lokfeel]\033[0m %s\n' "$1"; }
warn() { printf '\033[0;33m[lokfeel][warn]\033[0m %s\n' "$1"; }
die()  { printf '\033[0;31m[lokfeel][fatal]\033[0m %s\n' "$1" >&2; exit 1; }

# ── 1. 必要环境变量校验 ──────────────────────────────────────────────────────
log "校验环境变量…"

[ -n "${DATABASE_URL:-}" ]      || die "缺少 DATABASE_URL。请参考 .env.example 与 docs/SELF-HOSTING.md"
[ -n "${NEXTAUTH_SECRET:-}" ]   || die "缺少 NEXTAUTH_SECRET。请生成一个随机值：openssl rand -base64 32"
[ -n "${NEXTAUTH_URL:-}" ]      || warn "未设置 NEXTAUTH_URL，认证回调地址可能不正确（生产环境必须设置）"

# 拒绝明显不安全的占位值，避免"能跑起来但不安全"的部署
case "${NEXTAUTH_SECRET}" in
  changeme|secret|placeholder|*placeholder*|*changeme*)
    die "NEXTAUTH_SECRET 看起来是占位值，拒绝启动。请生成真实随机密钥。"
    ;;
esac

if [ -z "${REDIS_URL:-}" ] && [ -z "${UPSTASH_REDIS_REST_URL:-}" ]; then
  warn "未配置 Redis（REDIS_URL 或 UPSTASH_REDIS_REST_URL）。限流、缓存与实时消息广播将不可用。"
fi

# ── 2. 等待数据库 ────────────────────────────────────────────────────────────
DB_WAIT_TIMEOUT="${DB_WAIT_TIMEOUT:-60}"
log "等待数据库就绪（最长 ${DB_WAIT_TIMEOUT}s）…"

i=0
until node -e "
const { Client } = require('pg');
const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false } });
c.connect().then(() => c.end()).then(() => process.exit(0)).catch(() => process.exit(1));
" >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -ge "$DB_WAIT_TIMEOUT" ]; then
    die "等待数据库超时（${DB_WAIT_TIMEOUT}s）。请确认 DATABASE_URL 可达、数据库已启动、网络策略允许访问。"
  fi
  sleep 1
done
log "数据库已就绪。"

# ── 3. 数据库迁移 ────────────────────────────────────────────────────────────
# MIGRATE_ON_START:
#   deploy（默认）—— 生产环境，应用已有迁移（prisma migrate deploy）
#   push          —— 开发/试用环境，直接同步 schema（不生成迁移文件）
#   skip          —— 由外部流程管理迁移（如 Helm hook / 独立 Job）
MIGRATE_ON_START="${MIGRATE_ON_START:-deploy}"

case "$MIGRATE_ON_START" in
  deploy)
    log "执行数据库迁移（prisma migrate deploy）…"
    npx prisma migrate deploy || die "数据库迁移失败。请检查迁移文件与数据库权限。"
    ;;
  push)
    warn "使用 prisma db push（仅建议用于开发/试用环境，生产环境请使用 deploy）"
    npx prisma db push --skip-generate || die "数据库 schema 同步失败。"
    ;;
  skip)
    log "已跳过迁移（MIGRATE_ON_START=skip），由外部流程负责。"
    ;;
  *)
    die "MIGRATE_ON_START 取值非法：${MIGRATE_ON_START}（可选：deploy | push | skip）"
    ;;
esac

# ── 4. 可选：写入种子数据（默认关闭）────────────────────────────────────────
if [ "${SEED_ON_START:-false}" = "true" ]; then
  warn "SEED_ON_START=true —— 正在写入种子数据（仅供本地演示，请勿在生产环境启用）"
  if [ -f "./prisma/seed.ts" ]; then
    npx tsx ./prisma/seed.ts || warn "种子脚本执行失败，已跳过。"
  else
    warn "未找到 prisma/seed.ts，跳过。"
  fi
fi

# ── 5. 启动应用 ──────────────────────────────────────────────────────────────
log "启动应用，端口 ${PORT:-3000}…"
exec "$@"
