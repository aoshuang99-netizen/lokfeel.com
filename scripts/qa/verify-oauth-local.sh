#!/usr/bin/env bash
# P1-c 验证：Google OAuth 的 state / PKCE 强制校验
#
# 用法:
#   本地  bash scripts/qa/verify-oauth-local.sh                （需 dev server 于 :3099）
#   生产  QA_BASE_URL=https://app.lokfeel.com bash scripts/qa/verify-oauth-local.sh
#
# 说明: 生产复验无需真实 Google 账号 —— 本脚本只验证两道安全关卡（state 绑定、PKCE 强制），
#       第 5 项刻意使用伪造 code，期望失败点推进到 token exchange，以证明合法流程未被误伤。
set -uo pipefail
B="${QA_BASE_URL:-http://localhost:3099}"
pass=0; fail=0
ck() { if [ "$2" = "1" ]; then pass=$((pass+1)); echo "  ✅ $1"; else fail=$((fail+1)); echo "  ❌ $1"; fi; }

echo "════════ 1) signin 是否下发 state（授权 URL + cookie）════════"
HDR=$(curl -sD - -o /dev/null --max-time 30 --get "$B/api/auth/oauth/google/signin" --data-urlencode 'callbackUrl=/dashboard')
LOC=$(printf '%s' "$HDR" | grep -i '^location:' | tr -d '\r')
STATE_PARAM=$(printf '%s' "$LOC" | sed -n 's/.*[?&]state=\([^&]*\).*/\1/p')
STATE_COOKIE=$(printf '%s' "$HDR" | grep -i 'set-cookie: google-oauth-state=' | tr -d '\r' | sed 's/.*google-oauth-state=\([^;]*\).*/\1/')
VERIFIER_COOKIE=$(printf '%s' "$HDR" | grep -i 'set-cookie: google-pkce-verifier=' | tr -d '\r' | sed 's/.*google-pkce-verifier=\([^;]*\).*/\1/')
echo "  授权 URL host : $(printf '%s' "$LOC" | sed -n 's|^location: \(https\?://[^/?]*\).*|\1|p' | tr -d '\r')"
echo "  state 长度    : ${#STATE_PARAM}"
echo "  state 值一致  : $([ -n "$STATE_PARAM" ] && [ "$STATE_PARAM" = "$STATE_COOKIE" ] && echo 是 || echo 否)"
echo "  pkce 长度     : ${#VERIFIER_COOKIE}"
[ -n "$STATE_PARAM" ] && ck "授权 URL 携带 state" 1 || ck "授权 URL 携带 state" 0
[ -n "$STATE_PARAM" ] && [ "$STATE_PARAM" = "$STATE_COOKIE" ] && ck "state 同时写入 httpOnly cookie 且一致" 1 || ck "state 同时写入 httpOnly cookie 且一致" 0
[ -n "$VERIFIER_COOKIE" ] && ck "PKCE code_verifier 已写入 cookie" 1 || ck "PKCE code_verifier 已写入 cookie" 0

echo
echo "════════ 2) 回调 state 不匹配 → 必须拒绝 ════════"
R=$(curl -sD - -o /dev/null --max-time 30 -H "Cookie: google-oauth-state=AAA; google-pkce-verifier=BBB" \
  "$B/api/auth/oauth/google/callback?code=fakecode&state=WRONG")
L=$(printf '%s' "$R" | grep -i '^location:' | tr -d '\r')
echo "  → $L"
printf '%s' "$L" | grep -qi 'error=' && ck "state 不匹配被拒绝（重定向到 /login?error=）" 1 || ck "state 不匹配被拒绝" 0

echo
echo "════════ 3) 回调缺 state → 必须拒绝 ════════"
R=$(curl -sD - -o /dev/null --max-time 30 -H "Cookie: google-pkce-verifier=BBB" \
  "$B/api/auth/oauth/google/callback?code=fakecode")
L=$(printf '%s' "$R" | grep -i '^location:' | tr -d '\r')
echo "  → $L"
printf '%s' "$L" | grep -qi 'error=' && ck "缺 state 被拒绝" 1 || ck "缺 state 被拒绝" 0

echo
echo "════════ 4) state 正确但缺 PKCE cookie → 必须拒绝（旧代码会放行）════════"
R=$(curl -sD - -o /dev/null --max-time 30 -H "Cookie: google-oauth-state=GOODSTATE" \
  "$B/api/auth/oauth/google/callback?code=fakecode&state=GOODSTATE")
L=$(printf '%s' "$R" | grep -i '^location:' | tr -d '\r')
echo "  → $L"
printf '%s' "$L" | grep -qi 'error=' && ck "缺 PKCE 被拒绝（不再静默降级）" 1 || ck "缺 PKCE 被拒绝" 0

echo
echo "════════ 5) state + PKCE 都正确 → 应通过两道关卡（随后才在换取 token 处失败）════════"
R=$(curl -sD - -o /dev/null --max-time 40 -H "Cookie: google-oauth-state=GOODSTATE; google-pkce-verifier=GOODVERIFIER" \
  "$B/api/auth/oauth/google/callback?code=fakecode&state=GOODSTATE")
L=$(printf '%s' "$R" | grep -i '^location:' | tr -d '\r')
echo "  → $L"
printf '%s' "$L" | grep -qiE 'token(\+|%20)exchange' \
  && ck "两道安全关卡通过（失败点已推进到 token exchange，说明合法流程未被误伤）" 1 \
  || ck "两道安全关卡通过" 0

echo
echo "════════ 结果：$pass 通过 / $fail 失败 ════════"
exit $(( fail == 0 ? 0 : 1 ))
