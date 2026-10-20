#!/usr/bin/env bash
# 开机器前的本地体检 —— 所有"不需要服务器就能验"的项目串成一条命令。
#
#   bash deploy/selfhost/preflight.sh            # 常规（约 20s）
#   bash deploy/selfhost/preflight.sh --full     # 额外跑部署脚本自证（约 2min）
#
# 为什么要它：迁移当天最贵的不是执行，而是**发现某个门禁本来就是红的**。
# 那时你已经在改 DNS，回滚成本最高。这里把它们提前跑一遍。
#
# 输出约定：
#   PASS     已验证通过
#   WARN     不阻塞，但要知道
#   BLOCKED  缺前置（例如没有 Netlify token / 还没有服务器），不算通过
#   FAIL     真问题，必须先修
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1

SITE_ID="${LOKFEEL_SITE_ID:-c46478e9-7ac8-4bcf-9052-7638b04fef83}"
BASE="${LOKFEEL_BASE_URL:-https://app.lokfeel.com}"
FULL=0
[[ "${1:-}" == "--full" ]] && FULL=1

PASS=0; WARN=0; BLOCK=0; FAIL=0
row() { printf '%-8s %-34s %s\n' "$1" "$2" "${3:-}"; }
pass()  { row PASS    "$1" "${2:-}"; PASS=$((PASS+1)); }
warn()  { row WARN    "$1" "${2:-}"; WARN=$((WARN+1)); }
block() { row BLOCKED "$1" "${2:-}"; BLOCK=$((BLOCK+1)); }
fail()  { row FAIL    "$1" "${2:-}"; FAIL=$((FAIL+1)); }

echo "LokFeel 自托管 preflight · $(date -u +%FT%TZ)"
echo "repo=$(pwd)  base=$BASE"
echo "──────────────────────────────────────────────────────────────"

# 1. Node 版本（构建与脚本都依赖 22+）
if command -v node >/dev/null 2>&1; then
  MAJ=$(node -p 'process.versions.node.split(".")[0]')
  if (( MAJ >= 22 )); then pass "Node >= 22" "$(node -v)"; else fail "Node >= 22" "当前 $(node -v)"; fi
else
  fail "Node 可用" "未安装"
fi

# 2. 工作区是否干净（迁移只应从确定的提交开始）
DIRTY=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
if [[ "$DIRTY" == "0" ]]; then pass "工作区干净" "HEAD $(git rev-parse --short HEAD)"
else warn "工作区有改动" "${DIRTY} 个文件未提交"; fi

# 3. cron 方法一致性（防 405 静默失效）
if out=$(node scripts/ci/verify-cron-methods.mjs 2>&1); then
  pass "cron 方法一致" "$(echo "$out" | grep -E '^RESULT' | head -1)"
else
  fail "cron 方法一致" "$(echo "$out" | grep -E '^FAIL' | head -2 | tr '\n' ' ')"
fi

# 4. systemd cron 生成（频率/方法/幂等/退出码）
if out=$(bash deploy/selfhost/cron/test-cron.sh 2>&1); then
  pass "systemd cron 生成" "$(echo "$out" | tail -1)"
else
  fail "systemd cron 生成" "$(echo "$out" | grep '^FAIL' | head -2 | tr '\n' ' ')"
fi

# 5. bootstrap 只读自证（绝不开 80/443）
if out=$(bash deploy/selfhost/test-bootstrap.sh 2>&1); then
  pass "bootstrap 安全边界" "$(echo "$out" | tail -1)"
else
  fail "bootstrap 安全边界" "$(echo "$out" | grep '^FAIL' | head -2 | tr '\n' ' ')"
fi

# 6. 环境变量：导出 + 审计（需要 Netlify token；没有就 BLOCKED，不冒充通过）
TOKEN="${NETLIFY_AUTH_TOKEN:-${NETLIFY_API_TOKEN:-}}"
if [[ -z "$TOKEN" ]]; then
  block "环境变量导出/审计" "缺 NETLIFY_AUTH_TOKEN（不读取、不打印它的值）"
else
  if out=$(NETLIFY_AUTH_TOKEN="$TOKEN" node scripts/qa/netlify-env-export.mjs --site "$SITE_ID" --keys-only 2>&1); then
    NKEYS=$(echo "$out" | sed -n 's/^KEYS=//p' | tail -1)
    TMP=$(mktemp /tmp/lk-env.XXXXXX); chmod 600 "$TMP"
    if NETLIFY_AUTH_TOKEN="$TOKEN" node scripts/qa/netlify-env-export.mjs --site "$SITE_ID" --out "$TMP" >/dev/null 2>&1; then
      if out2=$(NETLIFY_AUTH_TOKEN="$TOKEN" node scripts/qa/selfhost-env-audit.mjs --env-file "$TMP" --netlify --site "$SITE_ID" 2>&1); then
        pass "环境变量导出/审计" "${NKEYS:-?} 键，$(echo "$out2" | grep -E '^RESULT' | head -1)"
      else
        fail "环境变量审计" "$(echo "$out2" | grep -E '^  FAIL' | head -3 | tr '\n' ' ')"
      fi
    else
      fail "环境变量导出" "写入临时文件失败"
    fi
    rm -f "$TMP"
  else
    fail "环境变量导出" "Netlify API 不可用（token 失效或站点 ID 变化）"
  fi
fi

# 7. 边缘是否在位（决定"换回源"而不是"接 CF"）
HDR=$(curl -sS -D - -o /dev/null --max-time 20 "$BASE/" 2>/dev/null)
if echo "$HDR" | grep -qi '^cf-ray:'; then
  if echo "$HDR" | grep -qi '^x-nf-request-id:'; then
    pass "边缘在位 / 回源=Netlify" "cf-ray 有；x-nf-request-id 有（迁移后应消失）"
  else
    pass "边缘在位 / 回源=非 Netlify" "cf-ray 有；可能已切到自有源站"
  fi
else
  fail "边缘在位" "无 cf-ray —— 域名可能已不在 CF 代理下"
fi

# 8. 回源门禁（迁移前应为 8 PASS / 0 FAIL / 3 BLOCKED）
if out=$(node scripts/qa/selfhost-gate.mjs 2>&1); then
  pass "回源门禁" "$(echo "$out" | grep -E '^ASSERTIONS' | head -1)"
else
  RC=$?
  SUMMARY=$(echo "$out" | grep -E '^ASSERTIONS' | head -1)
  if (( RC == 2 )); then block "回源门禁（迁移前）" "${SUMMARY}（S2–S4 等服务器）"
  else fail "回源门禁" "$SUMMARY"; fi
fi

# 9. 可选：部署脚本自证（含回滚路径，约 2min）
if (( FULL )); then
  if out=$(bash deploy/selfhost/test-deploy.sh 2>&1); then
    pass "部署脚本（含回滚）" "$(echo "$out" | tail -1)"
  else
    fail "部署脚本（含回滚）" "$(echo "$out" | grep '^❌' | head -2 | tr '\n' ' ')"
  fi
else
  row "SKIP" "部署脚本自证" "加 --full 运行（约 2min）"
fi

echo "──────────────────────────────────────────────────────────────"
echo "PASS=$PASS  WARN=$WARN  BLOCKED=$BLOCK  FAIL=$FAIL"
if (( FAIL > 0 )); then
  echo "结论：**不可开工** —— 先修 FAIL"
  exit 1
fi
if (( BLOCK > 0 )); then
  echo "结论：本地就绪；BLOCKED 项需要服务器/凭据才能验"
  exit 2
fi
echo "结论：全绿"
