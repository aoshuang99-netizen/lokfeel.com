#!/usr/bin/env bash
# /usr/local/bin/lokfeel-cron.sh
#
# 单个 cron 端点的执行器。由 systemd timer 触发（见 install-cron.sh），
# 也可以手工跑：  lokfeel-cron.sh bot-tick GET
#
# 设计要点：
#   1. **显式方法**。`bot-tick`/`bot-online`/`bot-chat`/`bot-match`/`status`
#      只导出 GET；`migrate-avatars` 只导出 POST。方法错了 Next 返回 405，
#      而 405 在日志里长得像「端点不存在」，极易误诊。
#      因此退出码区分 401/405/5xx，让 `systemctl --failed` 一眼看出是哪类问题。
#   2. **只打回环**。源站不暴露公网，cron 走 127.0.0.1，不经过 CF / 不计费。
#   3. 不打印 secret；失败时只截取响应体前 300 字节。
set -euo pipefail

NAME="${1:?用法: lokfeel-cron.sh <endpoint-name> [GET|POST]}"
METHOD="${2:-GET}"
BASE="${CRON_BASE:-http://127.0.0.1:3000}"
SECRET="${CRON_SECRET:-}"

if [[ -z "$SECRET" ]]; then
  echo "[cron:$NAME] CRON_SECRET 未设置（应来自 /etc/lokfeel/env）" >&2
  exit 78   # EX_CONFIG
fi

case "$METHOD" in
  GET|POST) ;;
  *) echo "[cron:$NAME] 不支持的方法: $METHOD" >&2; exit 64 ;;
esac

# 回环地址必须绕过 HTTP(S)_PROXY：本机/机房常设全局代理，curl 会把
# 127.0.0.1:3000 送去代理，得到 502（看起来像"服务挂了"）而不是"连不上"。
NOPROXY=()
case "$BASE" in
  http://127.0.0.1*|http://localhost*|http://[::1]*) NOPROXY=(--noproxy '*') ;;
esac

BODY="$(mktemp)"
trap 'rm -f "$BODY"' EXIT

START=$(date +%s)
# 注意：curl 失败时仍会打印 -w 的 "000"，若这里再 `|| echo 000` 就会拼成
# "000000"，case 落到兜底分支、退出码 1 —— 「连不上」与「业务报错」就分不开了。
CODE=$(curl -sS "${NOPROXY[@]}" --max-time 180 -o "$BODY" -w '%{http_code}' \
  -X "$METHOD" \
  -H "Authorization: Bearer $SECRET" \
  -H 'User-Agent: lokfeel-cron/1.0' \
  "$BASE/api/cron/$NAME" 2>/dev/null) || CODE="${CODE:-000}"
[[ -n "$CODE" ]] || CODE=000
DUR=$(( $(date +%s) - START ))

case "$CODE" in
  2*)
    echo "[cron:$NAME] $METHOD $CODE ${DUR}s"
    exit 0
    ;;
  401|403)
    echo "[cron:$NAME] $METHOD $CODE ${DUR}s — 鉴权失败：CRON_SECRET 与服务端不一致" >&2
    head -c 300 "$BODY" >&2; echo >&2
    exit 75   # EX_TEMPFAIL：配置问题，值得告警
    ;;
  405)
    echo "[cron:$NAME] $METHOD 405 ${DUR}s — 方法不被该路由接受（GET/POST 用反了）" >&2
    exit 76
    ;;
  404)
    echo "[cron:$NAME] $METHOD 404 ${DUR}s — 路由不存在（检查端点名）" >&2
    exit 77
    ;;
  000)
    echo "[cron:$NAME] 连接失败：$BASE 未监听（lokfeel.service 是否在跑？）" >&2
    exit 69
    ;;
  *)
    echo "[cron:$NAME] $METHOD $CODE ${DUR}s" >&2
    head -c 300 "$BODY" >&2; echo >&2
    exit 1
    ;;
esac
