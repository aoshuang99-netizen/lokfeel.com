#!/usr/bin/env bash
# LokFeel 香港源站初始化（Ubuntu 24.04 / Debian 12，幂等）
#
#   bash bootstrap.sh --dry-run     # 只打印将做什么（任何系统可跑，用于评审）
#   sudo bash bootstrap.sh          # 真执行
#   sudo bash bootstrap.sh --check  # 只体检，不改任何东西
#
# 目标拓扑：cloudflared 出站长连 → 127.0.0.1:3000，**源站零入站端口**。
# 所以本脚本**不会**开放 80/443；开放它们等于把「CF 挡在前面」变成一句口号
# —— 攻击者直接打 IP 即可绕过 WAF 与地理封禁。
#
# 只做「机器就绪」，不做「业务上线」：
#   业务由 deploy/selfhost/deploy.sh 落 releases，cron 由 cron/install-cron.sh 装。
set -euo pipefail

DRY=0
CHECK=0
SKIP_UFW=0
ALLOW_OTHER_PORTS=0

while (($#)); do
  case "$1" in
    --dry-run) DRY=1; shift ;;
    --check) CHECK=1; shift ;;
    --skip-ufw) SKIP_UFW=1; shift ;;
    --allow-other-ports) ALLOW_OTHER_PORTS=1; shift ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    *) echo "未知参数: $1" >&2; exit 64 ;;
  esac
done

log()  { printf '\033[1;36m[%s]\033[0m %s\n' "$(date -u +%H:%M:%S)" "$*"; }
warn() { printf '\033[1;33m[WARN]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[FAIL]\033[0m %s\n' "$*" >&2; exit 1; }
run()  { if (( DRY )); then echo "  + $*"; else "$@"; fi; }

# ── 0. 预检 ────────────────────────────────────────────────
if [[ "$(uname -s)" != "Linux" ]]; then
  (( DRY )) || die "本脚本只支持 Linux（当前 $(uname -s)）；用 --dry-run 可查看计划"
  warn "非 Linux：仅打印计划，不执行"
fi

if (( ! DRY && ! CHECK )); then
  [[ ${EUID:-0} -eq 0 ]] || die "需要 root"
fi

DISTRO_ID="unknown"; DISTRO_VER="0"; MEM_KB=0
if [[ -r /etc/os-release ]]; then
  # shellcheck disable=SC1091
  . /etc/os-release
  DISTRO_ID="${ID:-unknown}"; DISTRO_VER="${VERSION_ID:-0}"
fi
MEM_KB=$(awk '/MemTotal/{print $2}' /proc/meminfo 2>/dev/null || echo 0)
ARCH=$(uname -m)

log "系统：${DISTRO_ID} ${DISTRO_VER} · ${ARCH} · 内存 $((MEM_KB/1024)) MB"
case "$DISTRO_ID" in
  ubuntu|debian) ;;
  *) (( DRY )) || die "只支持 ubuntu/debian（当前 ${DISTRO_ID}）；如需其他发行版请改本脚本" ;;
esac
case "$ARCH" in
  x86_64|aarch64) ;;
  *) warn "架构 ${ARCH} 未验证（cloudflared/NodeSource 都有 arm64 包，但未实测）" ;;
esac

(( MEM_KB > 0 && MEM_KB < 3800000 )) && warn "内存 < 4G：构建会 OOM，请只用 --prebuilt（CI 构建）或先加 swap"

if (( CHECK )); then
  log "体检模式：不修改任何文件"
  echo "--- 已装组件 ---"
  for c in node npm cloudflared ufw git; do
    printf '%-12s %s\n' "$c" "$(command -v "$c" || echo '(缺)')"
  done
  echo "--- 监听端口（非回环）---"
  ss -lntp 2>/dev/null | awk 'NR==1 || $4 !~ /^127\.|^\[::1\]/' || true
  echo "--- swap ---"
  (free -m 2>/dev/null || true) | awk '/Swap/{print "Swap: "$2" MB"}'
  echo "--- lokfeel 用户/目录 ---"
  id lokfeel 2>/dev/null || echo "用户 lokfeel: (缺)"
  ls -ld /srv/lokfeel /etc/lokfeel 2>/dev/null || true
  exit 0
fi

# ── 1. 基础包 ──────────────────────────────────────────────
log "安装基础包"
run env DEBIAN_FRONTEND=noninteractive apt-get update -qq
run env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
  curl ca-certificates gnupg git ufw rsync jq logrotate openssl

# ── 2. swap（不足 4G 且当前无 swap 时）────────────────────
if (( MEM_KB > 0 && MEM_KB < 3800000 )) && ! swapon --show | grep -q .; then
  log "创建 4G swap（构建与 ISR 缓存会吃掉内存）"
  run fallocate -l 4G /swapfile
  run chmod 600 /swapfile
  run mkswap /swapfile
  run swapon /swapfile
  if ! grep -q '^/swapfile' /etc/fstab 2>/dev/null; then
    run bash -c "printf '/swapfile none swap sw 0 0\n' >> /etc/fstab"
  fi
else
  log "swap：跳过（内存充足或已有 swap）"
fi

# ── 3. Node 22 ─────────────────────────────────────────────
NODE_OK=0
if command -v node >/dev/null 2>&1; then
  MAJ=$(node -p 'process.versions.node.split(".")[0]')
  (( MAJ >= 22 )) && NODE_OK=1
fi
if (( NODE_OK )); then
  log "Node 已满足：$(node -v)"
else
  log "安装 Node 22（NodeSource）"
  if (( DRY )); then
    echo "  + curl -fsSL https://deb.nodesource.com/setup_22.x | bash -"
    echo "  + apt-get install -y nodejs"
  else
    curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/nodesource_setup.sh
    bash /tmp/nodesource_setup.sh
    rm -f /tmp/nodesource_setup.sh
    env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs
    node -v
  fi
fi

# ── 4. cloudflared ─────────────────────────────────────────
if command -v cloudflared >/dev/null 2>&1; then
  log "cloudflared 已装：$(cloudflared --version 2>/dev/null | head -1)"
else
  log "安装 cloudflared（Cloudflare apt 源）"
  if (( DRY )); then
    echo "  + install -d /usr/share/keyrings"
    echo "  + curl -fsSL https://pkg.cloudflare.com/cloudflare-public-v2.gpg -o /usr/share/keyrings/cloudflare-public-v2.gpg"
    echo "  + echo 'deb [signed-by=/usr/share/keyrings/cloudflare-public-v2.gpg] https://pkg.cloudflare.com/cloudflared any main' > /etc/apt/sources.list.d/cloudflared.list"
    echo "  + apt-get update && apt-get install -y cloudflared"
  else
    install -d -m 0755 /usr/share/keyrings
    curl -fsSL https://pkg.cloudflare.com/cloudflare-public-v2.gpg -o /usr/share/keyrings/cloudflare-public-v2.gpg
    echo 'deb [signed-by=/usr/share/keyrings/cloudflare-public-v2.gpg] https://pkg.cloudflare.com/cloudflared any main' \
      > /etc/apt/sources.list.d/cloudflared.list
    env DEBIAN_FRONTEND=noninteractive apt-get update -qq
    env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq cloudflared
  fi
fi

# ── 5. 用户与目录 ──────────────────────────────────────────
log "创建系统用户与目录"
if id lokfeel >/dev/null 2>&1; then
  log "用户 lokfeel 已存在"
else
  run useradd --system --create-home --home-dir /var/lib/lokfeel --shell /usr/sbin/nologin lokfeel
fi
run install -d -m 0755 -o lokfeel -g lokfeel /srv/lokfeel/releases
run install -d -m 0750 -o lokfeel -g lokfeel /srv/lokfeel/shared
run install -d -m 0750 -o lokfeel -g lokfeel /srv/lokfeel/shared/.next-cache
run install -d -m 0750 -o lokfeel -g lokfeel /srv/lokfeel/shared/uploads
run install -d -m 0750 -o root   -g lokfeel /etc/lokfeel
run install -d -m 0755 -o lokfeel -g lokfeel /var/log/lokfeel

# env 模板：只给键名与占位符，绝不写真实密钥
if [[ ! -f /etc/lokfeel/env ]]; then
  log "写入 env 模板（/etc/lokfeel/env，640 root:lokfeel）"
  if (( DRY )); then
    echo "  + 写入 /etc/lokfeel/env（模板）"
  else
    cat >/etc/lokfeel/env <<'ENVEOF'
# /etc/lokfeel/env —— 600 root:lokfeel，永不入 git
# 生成：从 Netlify 导出同名变量；或用 `npx netlify env:list --plain`。
# 至少这些必须显式设置（缺一个就会出现"本地正常、线上登录失败"）：
NODE_ENV=production
AUTH_URL=https://app.lokfeel.com
NEXTAUTH_URL=https://app.lokfeel.com
AUTH_SECRET=请填写32字节随机值
NEXTAUTH_SECRET=请填写32字节随机值
NEXT_PUBLIC_SITE_URL=https://app.lokfeel.com
CRON_SECRET=请填写
DATABASE_URL=libsql://...
# 其余 ~70 个键（Creem/Stripe/SMTP/Firebase/Pusher/Upstash）按 .env.example 补全
ENVEOF
    chown root:lokfeel /etc/lokfeel/env
    chmod 640 /etc/lokfeel/env
  fi
else
  log "env 已存在，保留不动（chmod 640）"
  run chown root:lokfeel /etc/lokfeel/env
  run chmod 640 /etc/lokfeel/env
fi

# ── 6. 防火墙：只放 SSH ────────────────────────────────────
if (( SKIP_UFW )); then
  warn "跳过防火墙（--skip-ufw）：源站可能暴露公网，Tunnel 的价值下降"
else
  SSH_PORT=$( (sshd -T 2>/dev/null | awk '/^port /{print $2; exit}') || echo 22)
  SSH_PORT=${SSH_PORT:-22}
  # 先看现有非回环监听端口：如果除了 SSH 还有别的，直接 enable ufw 会打断它们
  # `|| true`：容器/精简镜像里可能没有 ss，缺工具不应让脚本在 set -e 下静默退出
  OTHERS=$(ss -lnt 2>/dev/null | awk -v p="$SSH_PORT" '
    NR>1 { split($4,a,":"); port=a[length(a)];
           if ($4 !~ /^127\./ && $4 !~ /^\[::1\]/ && port != p) print port }' | sort -un | tr '\n' ' ' || true)
  if [[ -n "${OTHERS// /}" ]] && (( ! ALLOW_OTHER_PORTS )); then
    die "除 SSH(${SSH_PORT}) 外还有端口在监听：${OTHERS}
    直接启用 ufw 会切断这些服务。确认要一并关闭后加 --allow-other-ports；
    若这台机器还要跑别的站，先规划端口再执行。"
  fi
  log "防火墙：默认拒绝入站，只放 SSH/${SSH_PORT}"
  run ufw --force default deny incoming
  run ufw --force default allow outgoing
  run ufw allow "${SSH_PORT}/tcp"
  run ufw --force enable
fi

# ── 7. 内核参数与日志轮转 ──────────────────────────────────
log "写入 sysctl 与 logrotate"
if (( DRY )); then
  echo "  + /etc/sysctl.d/99-lokfeel.conf"
  echo "  + /etc/logrotate.d/lokfeel"
else
  cat >/etc/sysctl.d/99-lokfeel.conf <<'SYSCTL'
# LokFeel：SSE/WebSocket 长连较多
net.core.somaxconn = 1024
fs.file-max = 200000
# 源站内存吃紧时优先用 swap 换稳定（构建期）
vm.swappiness = 10
SYSCTL
  sysctl --system >/dev/null 2>&1 || warn "sysctl 应用失败（不阻塞）"

  cat >/etc/logrotate.d/lokfeel <<'LOGROTATE'
/var/log/lokfeel/*.log {
    daily
    rotate 14
    compress
    delaycompress
    missingok
    notifempty
    copytruncate
    su lokfeel lokfeel
}
LOGROTATE
fi

# ── 8. 结论 ───────────────────────────────────────────────
echo
if (( DRY )); then
  log "DRY-RUN 结束：未修改系统"
  exit 0
fi

log "机器就绪。接下来（按顺序）："
cat <<'NEXT'
  1) cloudflared tunnel login                       # 浏览器授权，只需一次
  2) cloudflared tunnel create lokfeel              # 记下 UUID
  3) cp deploy/selfhost/cloudflared.yml /etc/cloudflared/config.yml
     # 把 <UUID> 替换成真实值；凭据文件 chmod 600
  4) cloudflared tunnel ingress validate
  5) cloudflared service install && systemctl enable --now cloudflared
  6) CF 面板：app.lokfeel.com 的 CNAME → <UUID>.cfargotunnel.com（保持橙云）
  7) 补 /etc/lokfeel/env（缺一个都会在登录/支付上炸）
  8) bash deploy/selfhost/deploy.sh --repo=<git> --service=lokfeel --health=http://127.0.0.1:3000/api/health --migrate
  9) bash deploy/selfhost/cron/install-cron.sh
 10) node scripts/qa/selfhost-gate.mjs --origin-ip=<公网IP> --expect-origin-closed

⚠️ 端口 80/443 全程不开。cloudflared 是出站长连，不需要入站。
NEXT
