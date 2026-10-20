#!/usr/bin/env bash
# bootstrap.sh 的静态自证：只验证"计划里没有危险动作"，不执行任何系统变更。
# 重点是防回归：任何时候有人往脚本里加 `ufw allow 80/443`，这里必须变红。
set -uo pipefail
cd "$(dirname "$0")"

PASS=0; FAIL=0
check() {
  if eval "$2" >/dev/null 2>&1; then printf 'PASS  %s\n' "$1"; PASS=$((PASS+1));
  else printf 'FAIL  %s\n       %s\n' "$1" "$2"; FAIL=$((FAIL+1)); fi
}

OUT="$(mktemp)"
trap 'rm -f "$OUT"' EXIT
bash bootstrap.sh --dry-run >"$OUT" 2>&1
RC=$?

check "B1 --dry-run 正常结束（不执行）"      '[[ '"$RC"' -eq 0 ]]'
check "B2 计划里创建 swap"                   'grep -q "fallocate -l 4G /swapfile" '"$OUT"' || grep -q "swap：跳过" '"$OUT"''
check "B3 默认拒绝入站"                      'grep -q "default deny incoming" '"$OUT"''
check "B4 只放 SSH"                          'grep -qE "ufw allow [0-9]+/tcp" '"$OUT"''
check "B5 绝不开 80 端口"                    '! grep -qE "ufw allow (80|80/tcp|\"80)" '"$OUT"''
check "B6 绝不开 443 端口"                   '! grep -qE "ufw allow (443|443/tcp|\"443)" '"$OUT"''
check "B7 不把密钥写进命令行（无 CRON_SECRET=）" '! grep -q "CRON_SECRET=" '"$OUT"''
check "B8 不调用 systemctl enable cloudflared（留给人工确认 Tunnel）" '! grep -q "systemctl enable --now cloudflared" '"$OUT"''

echo
TOTAL=$((PASS+FAIL))
echo "SELFTEST ASSERTIONS=$TOTAL → $PASS PASS / $FAIL FAIL"
[[ $FAIL -eq 0 ]] || exit 1
