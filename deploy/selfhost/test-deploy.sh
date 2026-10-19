#!/usr/bin/env bash
# deploy/selfhost/deploy.sh 的自证脚本（本地夹具，不碰生产、不联网）
#
# 用法：bash deploy/selfhost/test-deploy.sh
# 覆盖：正常发布 / 静态资源手拷 / ISR 缓存软链 / 健康检查失败自动回滚
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
T="$(mktemp -d "${TMPDIR:-/tmp}/lokfeel-deploy.XXXXXX")"
PORT=$(( 19500 + RANDOM % 400 ))
PIDS=()
cleanup() {
  for p in ${PIDS[@]+"${PIDS[@]}"}; do kill "$p" 2>/dev/null; done
  wait 2>/dev/null
  rm -rf "$T"
}
trap cleanup EXIT

pass=0; fail=0
ok()   { pass=$((pass+1)); echo "✅ $*"; }
bad()  { fail=$((fail+1)); echo "❌ $*"; }
check(){ if eval "$2" >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi; }

mkdir -p "$T/bin" "$T/src" "$T/root/shared" "$T/health/api"
printf '%s\n' '{"status":"healthy","dbLatency":12}' > "$T/health/api/health"

# ── 桩件
printf '#!/bin/sh\nexec "$@"\n' > "$T/bin/sudo"
printf '#!/bin/sh\nexit 0\n'   > "$T/bin/systemctl"
printf '#!/bin/sh\nexit 0\n'   > "$T/bin/flock"
printf '#!/bin/sh\nexit 0\n'   > "$T/bin/npx"
cat > "$T/bin/npm" <<'SH'
#!/bin/sh
# npm 桩：模拟 next build 产出 standalone 结构
if [ "$1" = "run" ] && [ "$2" = "build" ]; then
  mkdir -p .next/standalone/.next .next/static
  echo '// fake server' > .next/standalone/server.js
  echo 'body{}' > .next/static/app.css
  exit 0
fi
exit 0
SH
chmod +x "$T/bin/"*

# ── 夹具仓库
(
  cd "$T/src"
  git init -q .
  printf '{"name":"lokfeel","version":"1.0.0"}\n' > package.json
  printf '{}\n' > package-lock.json
  printf '<html>v1</html>\n' > index.html
  mkdir -p public && printf 'logo\n' > public/logo.svg
  git add -A && git -c user.email=t@t -c user.name=t commit -qm v1
) >/dev/null

python3 -m http.server "$PORT" --directory "$T/health" >/dev/null 2>&1 &
PIDS+=($!)
sleep 1

run() {
  PATH="$T/bin:$PATH" bash "$HERE/deploy.sh" \
    --repo="$T/src" --branch=main --root="$T/root" --service=lokfeel \
    --env-file="$T/none.env" --health="http://127.0.0.1:$PORT$1" --migrate 2>&1
}

outA="$(run /api/health)"; rcA=$?
check "A1 正常发布退出码 0"                "[[ $rcA -eq 0 ]]"
check "A2 打印发布成功"                    "echo \"\$outA\" | grep -q '发布成功'"
check "A3 current 指向 .next/standalone"   "readlink '$T/root/current' | grep -q '/.next/standalone'"
check "A4 standalone/server.js 存在"       "[[ -f '$T/root/current/server.js' ]]"
check "A5 .next/static 已手拷"             "[[ -f '$T/root/current/.next/static/app.css' ]]"
check "A6 public 已手拷"                   "[[ -f '$T/root/current/public/logo.svg' ]]"
check "A7 ISR 缓存软链到 shared"           "[[ \"\$(readlink -f '$T/root/current/.next/cache')\" == \"\$(readlink -f '$T/root/shared/next-cache')\" ]]"
check "A8 写入 REVISION"                   "[[ -s '$T/root/current/REVISION' ]]"
REL1="$(readlink "$T/root/current")"

outB="$(run /api/nope)"; rcB=$?
check "B1 健康检查失败退出码非 0"          "[[ $rcB -ne 0 ]]"
check "B2 打印回滚"                        "echo \"\$outB\" | grep -q '已回滚'"
check "B3 current 回到上一 release"        "[[ \"\$(readlink -f '$T/root/current')\" == \"\$(readlink -f '$REL1')\" ]]"

echo
echo "ASSERTIONS=$((pass+fail)) → ${pass} PASS / ${fail} FAIL"
[[ $fail -eq 0 ]] && exit 0 || exit 1
