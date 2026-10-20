#!/usr/bin/env bash
# cron 安装器 + 执行器 的自证（本机可跑，不需要 Linux systemd）
#
# 为什么值得写：这套东西的核心风险不是"跑不起来"，而是"跑了但方法/频率不对"。
#   - 方法错 ⇒ 405，日志像"路由不存在"
#   - 频率错 ⇒ 机器人慢半拍，没人怀疑调度器
# 所以断言直接落在**生成出来的 unit 文本**与**执行器的退出码**上。
set -uo pipefail
cd "$(dirname "$0")"

PASS=0; FAIL=0
check() { # name, command-string
  if eval "$2" >/dev/null 2>&1; then printf 'PASS  %s\n' "$1"; PASS=$((PASS+1));
  else printf 'FAIL  %s\n       %s\n' "$1" "$2"; FAIL=$((FAIL+1)); fi
}

T="$(mktemp -d /tmp/lkcron.XXXXXX)"
PIDS=()
cleanup() { for p in ${PIDS[@]+"${PIDS[@]}"}; do kill "$p" 2>/dev/null; done; wait 2>/dev/null; rm -rf "$T"; }
trap cleanup EXIT

D1="$T/units1"; D2="$T/units2"
bash install-cron.sh --dest "$D1" >"$T/gen1.log" 2>&1 || { echo "生成失败"; cat "$T/gen1.log"; exit 1; }
bash install-cron.sh --dest "$D2" >"$T/gen2.log" 2>&1

echo "=== 生成物 ==="
check "G1 生成 8 个已启用 timer"        '[[ "$(ls "$D1"/lokfeel-cron-*.timer 2>/dev/null | wc -l | tr -d " ")" == "8" ]]'
check "G2 生成 8 个对应 service"        '[[ "$(ls "$D1"/lokfeel-cron-*.service 2>/dev/null | wc -l | tr -d " ")" == "8" ]]'
check "G3 bot-tick 为每分钟"            'grep -q "^OnCalendar=\*-\*-\* \*:\*:00$" "$D1/lokfeel-cron-bot-tick.timer"'
check "G4 bot-chat 为每 5 分钟"          'grep -q "OnCalendar=\*-\*-\* \*:0/5:00" "$D1/lokfeel-cron-bot-chat.timer"'
check "G5 bot-online 为每 15 分钟"       'grep -q "OnCalendar=\*-\*-\* \*:0/15:00" "$D1/lokfeel-cron-bot-online.timer"'
check "G6 日清任务钉 UTC 且 Persistent"  'grep -q "02:00:00 UTC" "$D1/lokfeel-cron-cleanup-soft-delete.timer" && grep -q "^Persistent=true" "$D1/lokfeel-cron-cleanup-soft-delete.timer"'
check "G7 bot-tick 用 GET"              'grep -q "ExecStart=.* bot-tick GET$" "$D1/lokfeel-cron-bot-tick.service"'
check "G8 停用项不生成 timer"            '[[ ! -f "$D1/lokfeel-cron-migrate-avatars.timer" && ! -f "$D1/lokfeel-cron-lifecycle-sweep.timer" ]]'
check "G9 unit 里不出现明文 secret"      '! grep -rq "CRON_SECRET=" "$D1"'
check "G10 幂等（两次生成完全一致）"      'diff -r "$D1" "$D2"'

echo
echo "=== 执行器退出码（真起一个假服务端） ==="
cat >"$T/srv.py" <<'PY'
import http.server, sys
class H(http.server.BaseHTTPRequestHandler):
    def _r(self):
        p = self.path
        code = 200 if p.endswith('/ok') else 401 if p.endswith('/unauth') else 405
        self.send_response(code); self.send_header('Content-Length','2'); self.end_headers()
        self.wfile.write(b'ok')
    do_GET = do_POST = _r
    def log_message(self, *a): pass
s = http.server.HTTPServer(('127.0.0.1', 0), H)
print(s.server_address[1], flush=True)
s.serve_forever()
PY
python3 "$T/srv.py" >"$T/port" 2>/dev/null &
PIDS+=($!)
for _ in $(seq 1 50); do [[ -s "$T/port" ]] && break; sleep 0.1; done
PORT="$(head -1 "$T/port")"
check "E0 假服务端已就绪"                '[[ -n "${PORT:-}" ]]'

run() { CRON_BASE="http://127.0.0.1:$PORT" bash run-cron.sh "$@" >/dev/null 2>&1; echo $?; }

check "E1 缺 CRON_SECRET → 78"          '[[ "$(env -u CRON_SECRET bash run-cron.sh ok GET >/dev/null 2>&1; echo $?)" == "78" ]]'
check "E2 方法非法 → 64"                '[[ "$(CRON_SECRET=x bash run-cron.sh ok PATCH >/dev/null 2>&1; echo $?)" == "64" ]]'
check "E3 2xx → 0"                      '[[ "$(CRON_SECRET=x bash -c "CRON_BASE=http://127.0.0.1:$PORT bash run-cron.sh ok GET" >/dev/null 2>&1; echo $?)" == "0" ]]'
check "E4 401 → 75（鉴权失败）"          '[[ "$(CRON_SECRET=x bash -c "CRON_BASE=http://127.0.0.1:$PORT bash run-cron.sh unauth GET" >/dev/null 2>&1; echo $?)" == "75" ]]'
check "E5 405 → 76（方法用反）"          '[[ "$(CRON_SECRET=x bash -c "CRON_BASE=http://127.0.0.1:$PORT bash run-cron.sh wrong POST" >/dev/null 2>&1; echo $?)" == "76" ]]'
check "E6 连不上 → 69"                  '[[ "$(CRON_SECRET=x bash -c "CRON_BASE=http://127.0.0.1:1 bash run-cron.sh ok GET" >/dev/null 2>&1; echo $?)" == "69" ]]'

echo
TOTAL=$((PASS+FAIL))
echo "SELFTEST ASSERTIONS=$TOTAL → $PASS PASS / $FAIL FAIL"
[[ $FAIL -eq 0 ]] || exit 1
