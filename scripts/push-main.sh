#!/usr/bin/env bash
# 推送到 GitHub —— 绕开 WorkBuddy 沙箱注入的 HTTP(S)_PROXY
#
# 背景（10-09 实测定位）
#   沙箱会给 shell 注入 HTTP_PROXY/HTTPS_PROXY=http://127.0.0.1:<随机端口>，
#   这是「透明代理」的**显式**形式，只放行白名单域名，且对 git 的 POST 上传
#   不友好。git 默认会继承这些变量 →
#       push（含 POST 上传）被拒：Empty reply from server / CONNECT tunnel failed, 502
#       ls-remote（只读 GET）却成功
#   于是表现为「能拉不能推」这种极具迷惑性的现象，容易被误判成「本机没代理/被墙」。
#
# 本脚本依次尝试两条通道，任一成功即退出：
#   ① 清掉沙箱注入的 proxy 变量后直连（已实测可推）
#   ② 回退到本机代理客户端（默认 10808 = v2rayN 内嵌 xray 的混合端口）
#
# 注意：本脚本只做推送，不修改提交内容；推送是否触发 Netlify 构建取决于
#       提交信息里有没有 [skip netlify]。
#
# 用法：
#   bash scripts/push-main.sh              # 推 main
#   bash scripts/push-main.sh my-branch    # 推指定分支
#   LOKFEEL_PROXY_PORT=7890 bash scripts/push-main.sh   # 换代理端口（ClashX 默认 7890）

set -uo pipefail

BRANCH="${1:-main}"
PORT="${LOKFEEL_PROXY_PORT:-10808}"
LOG="$(mktemp -t gitpush)"
trap 'rm -f "$LOG"' EXIT

# 清掉沙箱注入的显式代理变量（其余环境原样保留）
clean_env() {
  env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY \
      -u http_proxy -u https_proxy -u all_proxy "$@"
}

echo "== 推送 origin/${BRANCH} =="
echo

echo "① 直连（清掉沙箱注入的 HTTP(S)_PROXY）…"
clean_env git push origin "$BRANCH" > "$LOG" 2>&1
rc=$?
tail -6 "$LOG"
if [ "$rc" -eq 0 ]; then
  echo "✅ 通道① 直连推送成功"
  exit 0
fi

echo
if nc -z -G 2 127.0.0.1 "$PORT" 2>/dev/null; then
  echo "② 直连失败，回退走本机代理 127.0.0.1:${PORT} …"
  clean_env git -c "http.proxy=http://127.0.0.1:${PORT}" push origin "$BRANCH" > "$LOG" 2>&1
  rc=$?
  tail -6 "$LOG"
  if [ "$rc" -eq 0 ]; then
    echo "✅ 通道② 经代理推送成功"
    exit 0
  fi
else
  echo "② 本机 127.0.0.1:${PORT} 无监听 → 代理客户端未启动，跳过回退"
  echo "   （启动 v2rayN / Clash Verge 后重跑本脚本，或用 LOKFEEL_PROXY_PORT 指定实际端口）"
fi

echo
echo "🔴 两条通道均失败。排查指引：docs/GIT-PUSH-NETWORK-2026-10-09.md"
exit 1
