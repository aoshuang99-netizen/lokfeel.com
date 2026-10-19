#!/usr/bin/env bash
# LokFeel 发布脚本（Next.js standalone · releases + current 软链 · 失败自动回滚）
#
# 两种模式：
#   1) 服务器构建（默认）：git archive → npm ci → prisma generate → next build
#   2) CI 构建（推荐给小内存机器）：--prebuilt=/path/to/standalone-dir
#
# 用法：
#   ./deploy.sh --repo=git@github.com:aoshuang99-netizen/lokfeel.com.git --branch=main \
#      --root=/srv/lokfeel --service=lokfeel --env-file=/etc/lokfeel/env \
#      --migrate --health=http://127.0.0.1:3000/api/health
#   ./deploy.sh ... --prebuilt=/tmp/standalone --dry-run
#
# 约定：
#   · current 软链指向 <release>/.next/standalone（systemd 的 WorkingDirectory）
#   · ISR 缓存放 shared/next-cache，跨 release 复用（否则每次发版全量重建）
#   · 迁移在切流量之前；迁移失败不切 current
set -Eeuo pipefail

REPO=""; BRANCH="main"; ROOT="/srv/lokfeel"; SERVICE="lokfeel"
ENV_FILE="/etc/lokfeel/env"; HEALTH="http://127.0.0.1:3000/api/health"
PREBUILT=""; DO_MIGRATE=0; DRY_RUN=0; KEEP=5; SKIP_BUILD=0

for a in "$@"; do
  case "$a" in
    --repo=*)     REPO="${a#*=}" ;;
    --branch=*)   BRANCH="${a#*=}" ;;
    --root=*)     ROOT="${a#*=}" ;;
    --service=*)  SERVICE="${a#*=}" ;;
    --env-file=*) ENV_FILE="${a#*=}" ;;
    --health=*)   HEALTH="${a#*=}" ;;
    --prebuilt=*) PREBUILT="${a#*=}" ;;
    --migrate)    DO_MIGRATE=1 ;;
    --skip-build) SKIP_BUILD=1 ;;
    --keep=*)     KEEP="${a#*=}" ;;
    --dry-run)    DRY_RUN=1 ;;
    -h|--help)    sed -n '2,22p' "$0"; exit 0 ;;
    *) echo "未知参数：$a" >&2; exit 64 ;;
  esac
done
[[ -n "$REPO" || -n "$PREBUILT" ]] || { echo "需要 --repo 或 --prebuilt" >&2; exit 64; }

log()  { printf '\033[1;36m[%s]\033[0m %s\n' "$(date -u +%H:%M:%S)" "$*"; }
warn() { printf '\033[1;33m[WARN]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[FAIL]\033[0m %s\n' "$*" >&2; exit 1; }
run()  { if (( DRY_RUN )); then echo "  + $*"; else "$@"; fi; }

swap_link() {
  local target="$1" link="$2"
  ln -sfn "$target" "${link}.new"
  mv -T "${link}.new" "$link" 2>/dev/null || ln -sfn "$target" "$link"
}

# 只有「源站仅被 Tunnel 访问」时才可信的请求头由 cloudflared 注入；
# 这里不写死任何代理头处理 —— Next 侧依赖 AUTH_URL 与 trustHost。

# ── 0. 锁
mkdir -p "$ROOT"
exec 9>"$ROOT/.deploy.lock"
flock -n 9 || die "另一个发布进程正在运行"

# ── 1. preflight
log "preflight"
command -v node >/dev/null || die "缺 node"
node -e 'process.exit(+process.versions.node.split(".")[0] >= 22 ? 0 : 1)' \
  || die "Node 版本 < 22（当前 $(node -v)）"
command -v npm  >/dev/null || die "缺 npm"
command -v tar  >/dev/null || die "缺 tar"
mkdir -p "$ROOT/releases" "$ROOT/shared/next-cache" "$ROOT/shared/logs"
avail_kb=$(df -Pk "$ROOT" | awk 'NR==2{print $4}')
(( avail_kb > 3*1024*1024 )) || die "磁盘可用 <3G（当前 $((avail_kb/1024))M）"
mem_gb=$(awk '/MemTotal/{printf "%d", $2/1024/1024}' /proc/meminfo 2>/dev/null || echo 0)
swap_gb=$(awk '/SwapTotal/{printf "%d", $2/1024/1024}' /proc/meminfo 2>/dev/null || echo 0)
if (( mem_gb > 0 && mem_gb < 4 && swap_gb < 3 )) && (( ! DRY_RUN )); then
  warn "内存 ${mem_gb}G / swap ${swap_gb}G：next build 可能 OOM，建议 CI 构建后 --prebuilt"
fi
[[ -f "$ENV_FILE" ]] || warn "env 文件不存在：${ENV_FILE}（构建与运行都会缺变量）"

TS="$(date -u +%Y%m%dT%H%M%S)"
NEW="$ROOT/releases/$TS"
PREV="$(readlink -f "$ROOT/current" 2>/dev/null || true)"
mkdir -p "$NEW"

# ── 2. 取代码
if [[ -n "$PREBUILT" ]]; then
  log "使用预构建产物 $PREBUILT"
  (( DRY_RUN )) || cp -a "$PREBUILT"/. "$NEW"/
  SHA="prebuilt:$(date -u +%Y%m%dT%H%M%S)"
else
  BARE="$ROOT/repo.git"
  if [[ ! -d "$BARE" ]]; then
    log "clone --bare $REPO"
    run git clone --bare --filter=blob:none "$REPO" "$BARE"
  fi
  log "fetch $BRANCH"
  run git --git-dir="$BARE" fetch --prune origin "+refs/heads/$BRANCH:refs/heads/$BRANCH"
  if (( DRY_RUN )) && [[ ! -d "$BARE" ]]; then SHA="<dry-run>"
  else SHA="$(git --git-dir="$BARE" rev-parse "refs/heads/$BRANCH")"; fi
  log "目标提交 $SHA"
  if (( ! DRY_RUN )); then
    git --git-dir="$BARE" archive "$SHA" | tar -x -C "$NEW"
    [[ -f "$NEW/package-lock.json" ]] || die "缺 package-lock.json，npm ci 无法保证可复现"
  fi
fi

# ── 3. 构建（standalone）
if [[ -z "$PREBUILT" ]] && (( ! SKIP_BUILD )); then
  log "构建（BUILD_TARGET=standalone）"
  if (( ! DRY_RUN )); then
    [[ -f "$ENV_FILE" ]] && { set -a; . "$ENV_FILE"; set +a; }
    export BUILD_TARGET=standalone NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
    ( cd "$NEW" && npm ci --include=dev --no-audit --no-fund ) || die "npm ci 失败"
    ( cd "$NEW" && npx prisma generate ) || die "prisma generate 失败"
    ( cd "$NEW" && npm run build ) || die "next build 失败"
    # standalone 不含 static/public —— 必须手拷，否则线上无样式/404
    [[ -d "$NEW/.next/standalone" ]] || die "未产出 .next/standalone（BUILD_TARGET 是否生效？）"
    mkdir -p "$NEW/.next/standalone/.next"
    cp -r "$NEW/.next/static" "$NEW/.next/standalone/.next/static"
    [[ -d "$NEW/public" ]] && cp -r "$NEW/public" "$NEW/.next/standalone/public"
    # standalone 的 server.js 用相对路径找 .next，需带上 node_modules 里被 trace 的部分（Next 已自带）
    ln -sfn "$ROOT/shared/next-cache" "$NEW/.next/standalone/.next/cache"
    printf '%s\n%s\n' "$SHA" "$TS" > "$NEW/REVISION"
  fi
else
  [[ -e "$NEW/server.js" ]] || warn "预构建产物根目录未见 server.js（期望 standalone 根）"
  (( DRY_RUN )) || ln -sfn "$ROOT/shared/next-cache" "$NEW/.next/cache" 2>/dev/null || true
  (( DRY_RUN )) || printf '%s\n%s\n' "$SHA" "$TS" > "$NEW/REVISION"
fi

# ── 4. 迁移（切流量前）
if (( DO_MIGRATE )); then
  log "prisma migrate deploy"
  if (( ! DRY_RUN )); then
    [[ -f "$ENV_FILE" ]] && { set -a; . "$ENV_FILE"; set +a; }
    ( cd "$NEW" && npx prisma migrate deploy ) || die "迁移失败，已中止（current 未切换）"
  fi
else
  warn "未传 --migrate，跳过数据库迁移"
fi

# ── 5. 原子切换
TARGET="$NEW"
if [[ -f "$NEW/.next/standalone/server.js" ]]; then TARGET="$NEW/.next/standalone"; fi
# REVISION 必须落在 current 指向的那一层，否则线上无法自证版本
(( DRY_RUN )) || printf '%s\n%s\n' "$SHA" "$TS" > "$TARGET/REVISION"
log "切换 current → $TARGET"
(( DRY_RUN )) || swap_link "$TARGET" "$ROOT/current"

# ── 6. 重启 + 健康检查
log "重启 $SERVICE"
sudo systemctl restart "$SERVICE" || die "systemctl restart 失败"

health_ok=0
for i in $(seq 1 12); do
  body="$(curl -sS --max-time 5 "$HEALTH" 2>/dev/null || true)"
  if printf '%s' "$body" | grep -q '"status":"healthy"'; then health_ok=1; break; fi
  warn "健康检查 $i/12：$(printf '%s' "$body" | head -c 120)"
  sleep 3
done

if (( ! health_ok )); then
  warn "发布失败，开始回滚"
  if [[ -n "$PREV" && -d "$PREV" ]]; then
    swap_link "$PREV" "$ROOT/current"
    sudo systemctl restart "$SERVICE" || true
    die "已回滚到 ${PREV}（新 release 保留在 $NEW 供排查）"
  fi
  die "无上一版本可回滚，请人工介入"
fi
log "发布成功：${SHA} → current（release ${TS}）"

# ── 7. 清理旧 release
if (( ! DRY_RUN )); then
  olds=()
  while IFS= read -r d; do olds+=("$d"); done < <(ls -1dt "$ROOT"/releases/*/ 2>/dev/null | tail -n +$((KEEP+1)) || true)
  for d in ${olds[@]+"${olds[@]}"}; do
    [[ -d "$d" ]] || continue
    case "$(basename "$d")" in
      [0-9]*T[0-9]*) rm -rf -- "$d" ;;
      *) warn "跳过非版本目录：$d" ;;
    esac
  done
fi
log "完成"
