#!/usr/bin/env bash
# 安装 LokFeel 的 systemd cron（替代 Netlify scheduled function）
#
# 用法：
#   sudo bash deploy/selfhost/cron/install-cron.sh              # 写到 /etc/systemd/system 并启用
#   bash deploy/selfhost/cron/install-cron.sh --dest /tmp/x      # 只生成文件（自证/评审用）
#   bash deploy/selfhost/cron/install-cron.sh --dry-run           # 只打印
#
# 为什么不用一个 timer 打全部端点（Netlify 就是那么做的）：
#   各端点的设计频率不同，统一小时级等于把 bot-tick（设计每分钟）降频 60 倍。
#   线上症状是「机器人还能动，但反应慢半拍」，没人会怀疑到调度器。
#
# 频率来源：各 route.ts 文件头的注释（bot-tick 每分钟 / bot-chat 5 分钟 /
# bot-online 15 分钟 / bot-match 每小时 / cleanup 每天 02:00 UTC）。
set -euo pipefail

DEST="/etc/systemd/system"
DRY=0
RUN_SYSTEMCTL=1

while (($#)); do
  case "$1" in
    --dest) DEST="$2"; shift 2 ;;
    --dest=*) DEST="${1#*=}"; shift ;;
    --dry-run) DRY=1; shift ;;
    --no-systemctl) RUN_SYSTEMCTL=0; shift ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "未知参数: $1" >&2; exit 64 ;;
  esac
done

[[ "$DEST" != "/etc/systemd/system" ]] && RUN_SYSTEMCTL=0

# name | OnCalendar | method | enabled | persistent
# ⚠️ 时间的时区语义：
#   - 带 `UTC` 后缀 = 绝对 UTC 时刻（跨时区搬家不会漂）
#   - 不带后缀 = 服务器本地时间；分钟/小时级任务与时区无关，故省略
JOBS=(
  "bot-tick|*-*-* *:*:00|GET|yes|no"
  "workflow-tick|*-*-* *:0/2:00|GET|yes|no"
  "bot-chat|*-*-* *:0/5:00|GET|yes|no"
  "bot-online|*-*-* *:0/15:00|GET|yes|no"
  "bot-match|*-*-* *:07:00|GET|yes|no"
  "bot-learning|*-*-* *:17:00|GET|yes|no"
  "status|*-*-* *:27:00|GET|yes|no"
  "cleanup-soft-delete|*-*-* 02:00:00 UTC|GET|yes|yes"
  "migrate-avatars|*-*-* 03:30:00 UTC|POST|no|yes"
  "lifecycle-sweep|*-*-* 04:10:00 UTC|GET|no|yes"
)

RUNNER="/usr/local/bin/lokfeel-cron.sh"
log() { printf '[%s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }
write() {
  local path="$1" content="$2"
  if (( DRY )); then
    echo "--- $path"; printf '%s' "$content"; echo
  else
    printf '%s' "$content" > "$path"
    chmod 644 "$path"
  fi
}

if (( ! DRY )) && [[ "$DEST" == "/etc/systemd/system" ]]; then
  [[ $EUID -eq 0 ]] || { echo "需要 root（或用 --dest）" >&2; exit 77; }
  # 执行器：从仓库同目录复制，避免"文档里是新的、服务器上还是旧的"
  HERE="$(cd "$(dirname "$0")" && pwd)"
  install -m 755 "$HERE/run-cron.sh" "$RUNNER"
  log "已安装执行器 $RUNNER"
fi

(( DRY )) || mkdir -p "$DEST"

ENABLED=()
DISABLED=()

for row in "${JOBS[@]}"; do
  IFS='|' read -r NAME CAL METHOD ON PERSIST <<<"$row"
  SVC="$DEST/lokfeel-cron-$NAME.service"
  TMR="$DEST/lokfeel-cron-$NAME.timer"

  if [[ "$ON" != "yes" ]]; then
    DISABLED+=("$NAME")
    if (( ! DRY )) && [[ -f "$TMR" ]]; then
      rm -f "$TMR" && log "已移除停用的 timer: $NAME"
    fi
    continue
  fi
  ENABLED+=("$NAME")

  write "$SVC" "# 由 install-cron.sh 生成；改频率请改脚本里的 JOBS 表，不要手改本文件
[Unit]
Description=LokFeel cron · $NAME
After=network-online.target lokfeel.service
Wants=network-online.target

[Service]
Type=oneshot
User=lokfeel
Group=lokfeel
EnvironmentFile=/etc/lokfeel/env
Environment=CRON_BASE=http://127.0.0.1:3000
# 显式方法：GET 之外的端点只有 migrate-avatars（POST）
ExecStart=$RUNNER $NAME $METHOD
TimeoutStartSec=200
Nice=10
"
  write "$TMR" "# 由 install-cron.sh 生成
[Unit]
Description=Timer · LokFeel cron · $NAME

[Timer]
OnCalendar=$CAL
AccuracySec=1s
RandomizedDelaySec=5
Persistent=$([[ "$PERSIST" == "yes" ]] && echo true || echo false)
Unit=lokfeel-cron-$NAME.service

[Install]
WantedBy=timers.target
"
done

if (( DRY )); then
  log "DRY-RUN：未写入任何文件"
  exit 0
fi

if (( RUN_SYSTEMCTL )); then
  systemctl daemon-reload
  for n in "${ENABLED[@]}"; do
    systemctl enable --now "lokfeel-cron-$n.timer" >/dev/null 2>&1 || {
      echo "启用失败: lokfeel-cron-$n.timer" >&2; exit 1; }
  done
  log "已启用 ${#ENABLED[@]} 个 timer"
else
  log "已生成文件到 ${DEST}（未调用 systemctl）"
fi

printf '\n%-24s %-28s %s\n' "JOB" "SCHEDULE" "STATE"
for row in "${JOBS[@]}"; do
  IFS='|' read -r NAME CAL METHOD ON _ <<<"$row"
  [[ "$ON" == "yes" ]] && st="enabled ($METHOD)" || st="disabled（手工触发）"
  printf '%-24s %-28s %s\n' "$NAME" "$CAL" "$st"
done
echo
echo "停用的：${DISABLED[*]:-无}"
echo "验收：systemctl list-timers 'lokfeel-cron-*' --no-pager"
echo "手工跑一次：sudo systemctl start lokfeel-cron-bot-tick.service && journalctl -u lokfeel-cron-bot-tick -n 20 --no-pager"
echo "（不要在命令行里 echo/cat CRON_SECRET —— 会留在 shell history 与进程列表里）"
