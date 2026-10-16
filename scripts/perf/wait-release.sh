#!/usr/bin/env bash
# 等待发版生效（免凭据 · 只读）—— 轮询生产 HTTP 面
#
# 判据设计（与 scripts/qa/verify-released-surface.mjs 同一思路）：
#   · 未发版信号：新路由 404
#   · 已生效信号：新路由非 404（401/403 = 路由存在但被守卫拦下）
#   · 🔴 必须有正向对照：/api/health 必须 200，否则"404"可能只是全站异常（假绿）
#
# 用法：bash scripts/perf/wait-release.sh [max_minutes]
set -uo pipefail

BASE="${LOKFEEL_PROD_ORIGIN:-https://app.lokfeel.com}"
MAX_MIN="${1:-12}"
NEW_PATH="/api/v1/bridges"

code_of() {
  curl -s -o /dev/null -w '%{http_code}' -m 20 \
    -H 'cache-control: no-cache' -H 'pragma: no-cache' \
    "${BASE}$1?cb=$(date +%s%N)" 2>/dev/null || echo "000"
}

start=$(date +%s)
deadline=$((start + MAX_MIN * 60))

echo "目标：${BASE}   新路由：${NEW_PATH}   上限：${MAX_MIN} 分钟"
echo

while [ "$(date +%s)" -lt "$deadline" ]; do
  health=$(code_of /api/health)
  bridges=$(code_of "$NEW_PATH")
  elapsed=$(( $(date +%s) - start ))
  ts=$(date +%H:%M:%S)

  if [ "$health" != "200" ]; then
    echo "[$ts +${elapsed}s] ⚠️  对照 /api/health=${health}（非 200）—— 站点异常，本轮不判"
  elif [ "$bridges" = "404" ]; then
    echo "[$ts +${elapsed}s] ⏳ 未生效（对照 health=200 ✅，新路由 404）"
  else
    echo "[$ts +${elapsed}s] 🟢 已生效！对照 health=${health} ✅  新路由 ${NEW_PATH}=${bridges}"
    echo
    echo "RELEASE_LIVE=1"
    exit 0
  fi
  sleep 25
done

echo
echo "RELEASE_LIVE=0   （${MAX_MIN} 分钟内未见生效；对照健康=${health} 最后值，新路由=${bridges}）"
exit 1
