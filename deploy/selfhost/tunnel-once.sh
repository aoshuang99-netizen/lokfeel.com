#!/usr/bin/env bash
# =============================================================================
# LokFeel · Cloudflare Tunnel 「只点一次」安装器
#
#   人在回路只有一处：cloudflared tunnel login 弹出的授权页点一下。
#   其余（建隧道 / 写 config / 装 systemd / 改 DNS / 复核解析）全部非交互。
#
#   为什么不用 API Token：Tunnel 的 DNS 记录只能由 CF 侧写，给 Token 也能做，
#   但那要求把 Zone:DNS:Edit + Tunnel:Edit 的 Token 交出来并在服务器上长期存放；
#   而 login 拿到的 cert.pem 只覆盖「这一个账号的隧道操作」，范围更小、更易吊销。
#
# 用法（在服务器上，sudo）：
#   bash tunnel-once.sh --stage prepare     # T-1d：点 1 次，建隧道+配置+服务，不动 DNS
#   bash tunnel-once.sh --stage switch      # T0  ：改 DNS（备份旧记录），开始回源本机
#   bash tunnel-once.sh --stage status      # 随时：只读体检
#   bash tunnel-once.sh --stage rollback    # 出问题时：给出恢复 CNAME 的确切值
#
# 所有 stage 都支持 --dry-run（只打印将执行的动作）。
# =============================================================================
set -Eeuo pipefail

# ── 默认参数（可按需覆盖）──────────────────────────────────────────────────
TUNNEL_NAME="lokfeel"
TUNNEL_HOST="app.lokfeel.com"
SERVICE_URL="http://127.0.0.1:3000"
CF_DIR="/etc/cloudflared"
UNIT_DIR="/etc/systemd/system"
STAGE="prepare"
DRY_RUN=0
FORCE=0
VERIFY_TRIES=12
VERIFY_INTERVAL=5
CFD="${CLOUDFLARED_BIN:-cloudflared}"
SYSTEMD_UNIT="cloudflared-lokfeel"
FALLBACK_ORIGIN="lokfeel.netlify.app"   # 回滚目标（当前线上回源）

# ── 输出 ───────────────────────────────────────────────────────────────────
if [[ -t 1 ]]; then
  C_R=$'\033[1;36m'; C_G=$'\033[1;32m'; C_Y=$'\033[1;33m'; C_E=$'\033[1;31m'; C_0=$'\033[0m'
else
  C_R=""; C_G=""; C_Y=""; C_E=""; C_0=""
fi
log()  { printf '%s[%s]%s %s\n' "$C_R" "$(date -u +%H:%M:%S)" "$C_0" "$*"; }
ok()   { printf '  %s[ OK ]%s %s\n' "$C_G" "$C_0" "$*"; }
warn() { printf '  %s[WARN]%s %s\n' "$C_Y" "$C_0" "$*" >&2; }
bad()  { printf '  %s[FAIL]%s %s\n' "$C_E" "$C_0" "$*" >&2; }
die()  { printf '%s[STOP]%s %s\n' "$C_E" "$C_0" "$*" >&2; exit 1; }
run()  { if (( DRY_RUN )); then printf '      + %s\n' "$*"; else "$@"; fi; }

PASS=0; FAIL=0; SKIP=0
pass() { PASS=$((PASS + 1)); ok "$*"; }
fail() { FAIL=$((FAIL + 1)); bad "$*"; }
skip() { SKIP=$((SKIP + 1)); printf '  [SKIP] %s\n' "$*"; }

usage() {
  sed -n '2,26p' "$0" | sed 's/^# \{0,1\}//'
  cat <<'TXT'

可选参数：
  --name <名>            隧道名，默认 lokfeel
  --host <域名>          对外域名，默认 app.lokfeel.com
  --service <url>        回源地址，默认 http://127.0.0.1:3000
  --dir <目录>           cert.pem 与 config.yml 所在目录，默认 /etc/cloudflared
  --unit-dir <目录>      systemd unit 目录，默认 /etc/systemd/system
  --verify-tries <n>     切换后解析复核次数，默认 12
  --verify-interval <s>  复核间隔秒，默认 5
  --dry-run              只打印，不执行、不写文件
  --force                隧道已存在/配置将被覆盖时也继续
TXT
}

while (( $# )); do
  case "$1" in
    --name)            TUNNEL_NAME="${2:?--name 需要值}"; shift 2 ;;
    --host)            TUNNEL_HOST="${2:?--host 需要值}"; shift 2 ;;
    --service)         SERVICE_URL="${2:?--service 需要值}"; shift 2 ;;
    --dir)             CF_DIR="${2:?--dir 需要值}"; shift 2 ;;
    --unit-dir)        UNIT_DIR="${2:?--unit-dir 需要值}"; shift 2 ;;
    --stage)           STAGE="${2:?--stage 需要值}"; shift 2 ;;
    --verify-tries)    VERIFY_TRIES="${2:?}"; shift 2 ;;
    --verify-interval) VERIFY_INTERVAL="${2:?}"; shift 2 ;;
    --dry-run)         DRY_RUN=1; shift ;;
    --force)           FORCE=1; shift ;;
    -h|--help)         usage; exit 0 ;;
    *)                 die "未知参数：$1（--help 看用法）" ;;
  esac
done

case "$STAGE" in
  prepare|switch|status|rollback) ;;
  *) die "未知 stage：${STAGE}（prepare|switch|status|rollback）" ;;
esac

CERT="$CF_DIR/cert.pem"
CONF="$CF_DIR/config.yml"
# cert.pem 可以放在 --dir，但 cloudflared 默认去 ~/.cloudflared 找；两者用同一个目录最省心
export TUNNEL_ORIGIN_CERT="$CERT"
cfd() { "$CFD" "$@"; }

echo "============================================================"
echo " LokFeel · Tunnel 安装器"
echo "   stage   : $STAGE"
echo "   tunnel  : $TUNNEL_NAME"
echo "   host    : $TUNNEL_HOST"
echo "   origin  : $SERVICE_URL"
echo "   dir     : $CF_DIR"
(( DRY_RUN )) && echo "   dry-run : 是（不执行任何写操作）"
echo "============================================================"

# ── 0. 前置检查 ─────────────────────────────────────────────────────────────
require_cfd() {
  if ! command -v "$CFD" >/dev/null 2>&1; then
    die "找不到 ${CFD}。先跑 bootstrap.sh，或 apt install cloudflared"
  fi
  local v
  v="$("$CFD" --version 2>&1 | head -1)" || true
  ok "cloudflared 可用：${v:-未知版本}"
}

have_cert() { [[ -f "$CERT" ]]; }

# ── 1. 唯一的一次点击 ───────────────────────────────────────────────────────
do_login() {
  log "步骤 1/5 · 授权（唯一需要点击的地方）"
  if have_cert; then
    skip "已有 ${CERT}，无需再次授权"
    return 0
  fi
  if (( DRY_RUN )); then
    printf '      + %s tunnel login --origincert %s\n' "$CFD" "$CERT"
    skip "dry-run：跳过交互式授权"
    return 0
  fi
  mkdir -p "$CF_DIR"
  log "下面会打印一个链接。在浏览器打开它、登录 Cloudflare、选 lokfeel.com 这个 Zone、点 Authorize。"
  log "点完回来这里会自动继续（最多等 10 分钟）。"
  # 注意：login 会阻塞等浏览器；把输出接到管道会丢失 URL 之外的进度信息，
  # 所以直接前台跑，让用户看到原始提示。
  set +e
  "$CFD" tunnel login --origincert "$CERT"
  local rc=$?
  set -e
  if (( rc != 0 )) || ! have_cert; then
    die "授权未完成（cloudflared 退出码 ${rc}，cert.pem 不存在）。浏览器里是否点了 Authorize？"
  fi
  pass "授权完成：${CERT}"
  if ! (( FORCE )); then
    chmod 600 "$CERT" 2>/dev/null || true
  fi
}

# ── 2. 建隧道（幂等）────────────────────────────────────────────────────────
tunnel_uuid() {
  # 从 config.yml 读，或从 tunnel list 里按名字找；不用 jq，避免多一个依赖
  local uuid=""
  if [[ -f "$CONF" ]]; then
    uuid="$(awk '/^tunnel:/{print $2; exit}' "$CONF" 2>/dev/null || true)"
  fi
  if [[ -z "$uuid" ]] && have_cert; then
    uuid="$("$CFD" tunnel list --origincert "$CERT" 2>/dev/null \
      | awk -v n="$TUNNEL_NAME" '$2 == n {print $1; exit}' || true)"
  fi
  printf '%s' "$uuid"
}

do_create() {
  log "步骤 2/5 · 创建隧道"
  local uuid
  uuid="$(tunnel_uuid)"
  if [[ -n "$uuid" ]]; then
    skip "隧道已存在：${TUNNEL_NAME} (${uuid})"
    TUNNEL_ID="$uuid"
    return 0
  fi
  if (( DRY_RUN )); then
    printf '      + %s tunnel create %s\n' "$CFD" "$TUNNEL_NAME"
    TUNNEL_ID="<dry-run-uuid>"
    skip "dry-run：跳过创建"
    return 0
  fi
  local out
  out="$("$CFD" tunnel create --origincert "$CERT" "$TUNNEL_NAME" 2>&1)" || {
    printf '%s\n' "$out" >&2
    die "cloudflared tunnel create 失败"
  }
  printf '%s\n' "$out"
  # 输出形如：Created tunnel lokfeel with id 4a1b...  （版本不同措辞会变，两种都试）
  uuid="$(printf '%s' "$out" | sed -n 's/.*with id \([0-9a-f-]\{36\}\).*/\1/p' | head -1)"
  [[ -n "$uuid" ]] || uuid="$(printf '%s' "$out" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)"
  [[ -n "$uuid" ]] || die "创建成功但解析不出 UUID，请手工执行 cloudflared tunnel list"
  TUNNEL_ID="$uuid"
  # create 会把凭据写到 ~/.cloudflared/<uuid>.json；挪到 CF_DIR（与实际 cert 同目录）
  local src="${HOME}/.cloudflared/${uuid}.json"
  if [[ -f "$src" && "$src" != "$CF_DIR/${uuid}.json" ]]; then
    run mv -f "$src" "$CF_DIR/${uuid}.json"
  fi
  run chmod 600 "$CF_DIR/${uuid}.json" 2>/dev/null || true
  pass "隧道创建：${TUNNEL_ID}"
}

# ── 3. 写 config.yml ────────────────────────────────────────────────────────
do_config() {
  log "步骤 3/5 · 写 ${CONF}"
  local uuid="${TUNNEL_ID:-$(tunnel_uuid)}"
  [[ -n "$uuid" ]] || die "还不知道隧道 UUID，无法写配置"
  if [[ -f "$CONF" ]] && (( ! FORCE )); then
    if grep -q "tunnel: ${uuid}" "$CONF" 2>/dev/null; then
      skip "config.yml 已指向该隧道，保持不动"
      return 0
    fi
    local bak="${CONF}.bak.$(date -u +%Y%m%dT%H%M%SZ)"
    run cp -p "$CONF" "$bak"
    warn "已有 config.yml 指向别的隧道，原文件备份到 ${bak}"
  fi
  if (( DRY_RUN )); then
    printf '      + 写 %s（tunnel: %s → %s）\n' "$CONF" "$uuid" "$SERVICE_URL"
    skip "dry-run：跳过写配置"
    return 0
  fi
  mkdir -p "$CF_DIR"
  cat > "$CONF" <<YAML
# 由 deploy/selfhost/tunnel-once.sh 生成于 $(date -u +%Y-%m-%dT%H:%M:%SZ)
# 校验：cloudflared tunnel ingress validate
#       cloudflared tunnel ingress rule https://${TUNNEL_HOST}/api/health
# 凭据 600，永不入 git。
tunnel: ${uuid}
credentials-file: ${CF_DIR}/${uuid}.json
retries: 5
grace-period: 30s

ingress:
  # Next.js standalone 直接监听 127.0.0.1:3000（不额外加 nginx）
  - hostname: ${TUNNEL_HOST}
    service: ${SERVICE_URL}
    originRequest:
      connectTimeout: 15s
      keepAliveConnections: 64
      keepAliveTimeout: 90s
      # 长 AI 请求：CF 免费/Pro 回源上限 100s，这里放宽只影响本地等待，不改变 524
      httpHostHeader: ${TUNNEL_HOST}
      noHappyEyeballs: false
      disableChunkedEncoding: false

  - service: http_status:404
YAML
  chmod 644 "$CONF"
  pass "配置已写入（${TUNNEL_HOST} → ${SERVICE_URL}）"

  if "$CFD" tunnel ingress validate --config "$CONF" >/dev/null 2>&1; then
    pass "ingress 校验通过"
  else
    warn "ingress validate 失败（旧版本可能不支持该校验，请在 status 里复核）"
  fi
}

# ── 4. systemd ──────────────────────────────────────────────────────────────
do_service() {
  log "步骤 4/5 · 安装 systemd 服务 ${SYSTEMD_UNIT}"
  if ! command -v systemctl >/dev/null 2>&1; then
    warn "没有 systemctl（容器？），跳过。请手工运行：${CFD} tunnel --config ${CONF} run"
    return 0
  fi
  local unit="${UNIT_DIR}/${SYSTEMD_UNIT}.service"
  local cfd_bin
  cfd_bin="$(command -v "$CFD" 2>/dev/null || echo "/usr/bin/${CFD}")"
  if (( DRY_RUN )); then
    printf '      + 写 %s 并 systemctl enable --now %s\n' "$unit" "$SYSTEMD_UNIT"
    skip "dry-run：跳过 systemd"
    return 0
  fi
  cat > "$unit" <<UNIT
[Unit]
Description=Cloudflare Tunnel for ${TUNNEL_NAME} (${TUNNEL_HOST})
After=network-online.target
Wants=network-online.target

[Service]
Type=notify
# Tunnel 只做出站长连，不需要任何监听端口
ExecStart=${cfd_bin} --no-autoupdate --config ${CONF} tunnel run
Restart=always
RestartSec=5
TimeoutStartSec=30
# 不设 ProtectSystem=strict：cloudflared 需要读 ${CF_DIR} 下的 cert/凭据
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT
  mkdir -p "$UNIT_DIR"
  systemctl daemon-reload >/dev/null 2>&1 || true
  systemctl enable --now "$SYSTEMD_UNIT" >/dev/null 2>&1 || true
  sleep 2
  if systemctl is-active --quiet "$SYSTEMD_UNIT"; then
    pass "服务已启动：${SYSTEMD_UNIT}"
  else
    warn "服务未处于 active，查看：journalctl -u ${SYSTEMD_UNIT} -n 50 --no-pager"
  fi
}

# ── 5. DNS ──────────────────────────────────────────────────────────────────
current_cname() {
  # 🔴 dig +short CNAME 的返回值带结尾点（"xxx.cfargotunnel.com."），
  # 而 CF 面板与 --overwrite-dns 用不带点的写法。不归一化的话，
  # 下面所有 `== *.cfargotunnel.com` 判定都会假失败 —— 而且看起来像"DNS 没生效"。
  local v
  v="$(dig +short CNAME "$TUNNEL_HOST" 2>/dev/null | head -1 | tr -d '\r')"
  v="${v%.}"
  printf '%s' "$v"
}

do_dns_switch() {
  log "步骤 5/5 · 切换 DNS（${TUNNEL_HOST} → ${TUNNEL_ID}.cfargotunnel.com）"
  local before
  before="$(current_cname)"
  local bak="$CF_DIR/dns-before-$(date -u +%Y%m%dT%H%M%SZ).txt"
  if (( DRY_RUN )); then
    printf '      + 备份当前 CNAME（当前=%s）到 %s\n' "${before:-<空>}" "$bak"
    printf '      + %s tunnel route dns %s %s\n' "$CFD" "$TUNNEL_NAME" "$TUNNEL_HOST"
    skip "dry-run：不改 DNS"
    return 0
  fi
  mkdir -p "$CF_DIR"
  {
    echo "# 切换前记录 · $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "host=${TUNNEL_HOST}"
    echo "cname=${before:-<none>}"
    echo "# 回滚：在 CF 面板把 ${TUNNEL_HOST} 的 CNAME 改回 ${before:-${FALLBACK_ORIGIN}}（橙云）"
  } > "$bak"
  chmod 644 "$bak"
  log "切换前 CNAME = ${before:-<空 / 可能只有 A 记录>}（已存 ${bak}）"

  if ! "$CFD" tunnel route dns --overwrite-dns --origincert "$CERT" "$TUNNEL_NAME" "$TUNNEL_HOST" 2>&1 | tail -3; then
    warn "route dns 失败。多半是 cert.pem 权限域不含该 Zone，或该域名已有同类型记录。"
    warn "退路：在 CF 面板手工把 ${TUNNEL_HOST} 的 CNAME 指向 ${TUNNEL_ID}.cfargotunnel.com（橙云）"
  fi

  log "复核解析（最多 ${VERIFY_TRIES} 次 / 间隔 ${VERIFY_INTERVAL}s）"
  local i=0 got=""
  while (( i < VERIFY_TRIES )); do
    i=$((i + 1))
    got="$(current_cname)"
    [[ "$got" == *".cfargotunnel.com" ]] && break
    (( i < VERIFY_TRIES )) && sleep "$VERIFY_INTERVAL"
  done
  if [[ "$got" == *".cfargotunnel.com" ]]; then
    pass "解析已指向隧道：${got}"
  else
    fail "解析仍是 ${got:-<空>}（DNS 传播最长 5 分钟，稍后重跑 --stage status 复核）"
  fi
}

# ── status / rollback ───────────────────────────────────────────────────────
do_status() {
  log "只读体检"
  local uuid; uuid="$(tunnel_uuid)"
  [[ -n "$uuid" ]] && pass "隧道：${TUNNEL_NAME} = ${uuid}" || fail "未找到隧道 ${TUNNEL_NAME}"
  have_cert && pass "cert.pem 存在（$(stat -c '%a' "$CERT" 2>/dev/null || echo '?')）" || fail "cert.pem 不存在"
  [[ -f "$CONF" ]] && pass "config.yml 存在" || fail "config.yml 不存在"
  if [[ -f "$CONF" ]] && "$CFD" tunnel ingress validate --config "$CONF" >/dev/null 2>&1; then
    pass "ingress 校验通过"
  else
    warn "ingress validate 未通过（或版本不支持）"
  fi
  if command -v systemctl >/dev/null 2>&1; then
    systemctl is-active --quiet "$SYSTEMD_UNIT" && pass "服务 active：${SYSTEMD_UNIT}" \
      || fail "服务未运行：${SYSTEMD_UNIT}"
  else
    skip "无 systemctl"
  fi
  local ip; ip="$(dig +short A "$TUNNEL_HOST" 2>/dev/null | head -1)"
  local cn; cn="$(current_cname)"
  log "DNS：CNAME=${cn:-<空>}  A=${ip:-<空>}"
  if [[ "$cn" == *".cfargotunnel.com" ]]; then
    warn "已在隧道回源 —— 现在改代码就是改线上，Netlify 已不在链路上"
  fi
  # 回源是否真的通（本机直连 origin）
  if command -v curl >/dev/null 2>&1; then
    local code
    code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 --noproxy '*' "${SERVICE_URL}/api/health" 2>/dev/null || echo 000)"
    [[ "$code" == "200" ]] && pass "本机回源 ${SERVICE_URL}/api/health = 200" \
                           || fail "本机回源 ${SERVICE_URL}/api/health = ${code}（应用没起？）"
  fi
}

do_rollback() {
  log "回滚指引（不改任何东西）"
  local last
  last="$(ls -1t "$CF_DIR"/dns-before-*.txt 2>/dev/null | head -1 || true)"
  local target="$FALLBACK_ORIGIN"
  if [[ -n "$last" ]]; then
    local v; v="$(awk -F= '$1=="cname"{print $2}' "$last" | head -1)"
    [[ -n "$v" && "$v" != "<none>" ]] && target="$v"
    pass "找到切换前记录：${last}（应恢复到 ${target}）"
    log "最近一次切换前记录：${last}"
  fi
  cat <<TXT
  在 Cloudflare 面板做这一步（约 30 秒，橙云保持开启）：
    1) DNS → 找到 ${TUNNEL_HOST} 这条 CNAME
    2) 目标改成：${target}
    3) 保存后等 1–2 分钟，然后跑：bash $0 --stage status

  为什么脚本不自动回滚：回滚要写「非隧道目标」的记录，
  而 cert.pem 只覆盖隧道操作；自动改需要额外一枚 DNS:Edit Token。
  为一次可能用不到的恢复动作长期存一枚可改全 Zone 的 Token，不划算。
TXT
}

# ── 调度 ────────────────────────────────────────────────────────────────────
case "$STAGE" in
  prepare)
    require_cfd
    do_login
    do_create
    do_config
    do_service
    log "prepare 完成。DNS 未改动 —— 线上仍是 Netlify。"
    log "下一步：先把应用跑起来（deploy.sh），确认 ${SERVICE_URL}/api/health = 200，再执行 --stage switch"
    ;;
  switch)
    require_cfd
    have_cert || die "缺少 ${CERT}：先跑 --stage prepare"
    TUNNEL_ID="$(tunnel_uuid)"
    [[ -n "$TUNNEL_ID" ]] || die "读不到隧道 UUID：先跑 --stage prepare"
    do_dns_switch
    echo
    log "切换后必须立刻跑门禁（S2/S3/S4 应由 BLOCKED 变 PASS）："
    printf '      node scripts/qa/selfhost-gate.mjs --origin-ip=<服务器公网IP> --expect-origin-closed\n'
    ;;
  status)   require_cfd; do_status ;;
  rollback) do_rollback ;;
esac

echo "------------------------------------------------------------"
printf ' 结果：%s PASS / %s FAIL / %s SKIP\n' "$PASS" "$FAIL" "$SKIP"
# 退出码语义：
#   0 = 该做的事都做成了（dry-run 只有 SKIP 也算 0）
#   1 = 有 FAIL，需要人处理
#   2 = 既没 PASS 也没 SKIP —— 说明压根没走到任何分支（参数/前置异常），不是"通过"
(( FAIL == 0 )) || exit 1
(( PASS > 0 || SKIP > 0 )) || exit 2
exit 0
