#!/usr/bin/env bash
# =============================================================================
# tunnel-once.sh 的夹具自证
#
# 不联网、不碰真实 CF：用假的 cloudflared / dig / systemctl / curl 跑完整流程，
# 验证「点一次之后到底会不会做对事」，特别是三件容易做错的事：
#   ① prepare 阶段绝不能动 DNS（否则等于提前切流量）
#   ② switch 之前必须留下旧 CNAME（否则回滚无从下手）
#   ③ 幂等：重跑不能把已有配置覆盖成占位符
# =============================================================================
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
SCRIPT="deploy/selfhost/tunnel-once.sh"

T="$(mktemp -d "${TMPDIR:-/tmp}/tunonce.XXXXXX")"
PASS=0; FAIL=0
check() { # check "描述" "shell 条件"
  if eval "$2"; then PASS=$((PASS + 1)); printf '  [ OK ] %s\n' "$1"
  else FAIL=$((FAIL + 1)); printf '  [FAIL] %s   ⟵ %s\n' "$1" "$2"; fi
}
cleanup() { rm -rf "$T"; }
trap cleanup EXIT

mkdir -p "$T/bin" "$T/cf" "$T/unit" "$T/state" "$T/home"
UUID="11111111-2222-3333-4444-555555555555"
export FAKE_STATE="$T/state" FAKE_LOG="$T/state/calls.log"
: > "$FAKE_LOG"
echo "lokfeel.netlify.app." > "$FAKE_STATE/cname"   # 线上现状

# ── 假 cloudflared ─────────────────────────────────────────────────────────
cat > "$T/bin/cloudflared" <<'SH'
#!/usr/bin/env bash
echo "cloudflared $*" >> "$FAKE_LOG"
[[ "$1" == "--version" ]] && { echo "cloudflared version 2026.10.0 (fake)"; exit 0; }
[[ "$1" == "--no-autoupdate" ]] && { echo "run (fake)"; exit 0; }
sub="$2"; shift 2
cert=""; positional=()
while (( $# )); do
  case "$1" in
    --origincert) cert="$2"; shift 2 ;;
    --config) shift 2 ;;
    --overwrite-dns) shift ;;
    -*) shift ;;
    *) positional+=("$1"); shift ;;
  esac
done
case "$sub" in
  login)
    mkdir -p "$(dirname "$cert")"
    printf -- "-----BEGIN CERTIFICATE-----\nfake\n" > "$cert"
    echo "A browser window should have opened. If not, visit:"
    echo "https://dash.cloudflare.com/argotunnel?callback=fake"
    exit 0 ;;
  list)
    echo "ID                                    NAME       CREATED"
    [[ -f "$FAKE_STATE/tunnel" ]] && echo "$(cat "$FAKE_STATE/tunnel")  lokfeel    2026-10-20"
    exit 0 ;;
  create)
    name="${positional[0]:-}"
    [[ -z "$name" ]] && { echo "missing name" >&2; exit 1; }
    echo "11111111-2222-3333-4444-555555555555" > "$FAKE_STATE/tunnel"
    mkdir -p "$HOME/.cloudflared"
    echo '{"AccountTag":"fake"}' > "$HOME/.cloudflared/11111111-2222-3333-4444-555555555555.json"
    echo "Created tunnel ${name} with id 11111111-2222-3333-4444-555555555555"
    exit 0 ;;
  route)
    # 注意：positional = (dns, <name>, <host>)。第一个是子命令 dns，host 才是最后一个。
    # 夹具最初取 positional[0]，把 "dns" 当成了目标域名 —— 这类"取错数组下标"的错
    # 在假实现里不会报错，只会让被测脚本看起来失败，很容易误判成真 bug。
    host="${positional[$(( ${#positional[@]} - 1 ))]:-}"
    # 真实形态是 <UUID>.cfargotunnel.com.（dig 会带结尾点），故意保留结尾点
    echo "11111111-2222-3333-4444-555555555555.cfargotunnel.com." > "$FAKE_STATE/cname"
    echo "Updated CNAME record: ${host} -> cfargotunnel"
    exit 0 ;;
  ingress|info|validate)
    exit 0 ;;
  *) exit 0 ;;
esac
SH

cat > "$T/bin/dig" <<'SH'
#!/usr/bin/env bash
# 只实现 dig +short CNAME <host>
[[ -f "$FAKE_STATE/cname" ]] && cat "$FAKE_STATE/cname" || echo ""
SH

cat > "$T/bin/systemctl" <<'SH'
#!/usr/bin/env bash
case "$1" in
  is-active) [[ -f "$FAKE_STATE/active" ]] && exit 0 || exit 3 ;;
  enable)    touch "$FAKE_STATE/active"; exit 0 ;;
  *)         exit 0 ;;
esac
SH

cat > "$T/bin/curl" <<'SH'
#!/usr/bin/env bash
printf '200'
SH
chmod +x "$T/bin/"*
export PATH="$T/bin:$PATH"
export HOME="$T/home"

ARGS=(--dir "$T/cf" --unit-dir "$T/unit" --verify-tries 1 --verify-interval 0)

echo "===================== 1) prepare（应：点 1 次，不动 DNS） ====================="
bash "$SCRIPT" --stage prepare "${ARGS[@]}" > "$T/o1.log" 2>&1
RC1=$?
sed -n '6,60p' "$T/o1.log"
check "prepare 退出码 0" "[[ $RC1 -eq 0 ]]"
check "cert.pem 已生成" "[[ -f '$T/cf/cert.pem' ]]"
check "config.yml 写入真实 UUID（无 <UUID> 占位）" "grep -q 'tunnel: $UUID' '$T/cf/config.yml' && ! grep -q '<UUID>' '$T/cf/config.yml'"
check "config 指向本地 3000" "grep -q 'service: http://127.0.0.1:3000' '$T/cf/config.yml'"
check "凭据从 ~/.cloudflared 挪到 CF_DIR" "[[ -f '$T/cf/$UUID.json' ]]"
check "systemd unit 已写且 ExecStart 为绝对路径" "grep -q '^ExecStart=/' '$T/unit/cloudflared-lokfeel.service'"
check "🔴 prepare 阶段 DNS 未被改动" "grep -q 'netlify' '$FAKE_STATE/cname'"
check "🔴 prepare 阶段未调用 route dns" "! grep -q 'tunnel route' '$FAKE_LOG'"
check "服务已置 active" "[[ -f '$FAKE_STATE/active' ]]"

echo
echo "===================== 2) prepare 重跑（应：幂等，不覆盖配置） ====================="
SUM1="$(cksum < "$T/cf/config.yml")"
bash "$SCRIPT" --stage prepare "${ARGS[@]}" > "$T/o2.log" 2>&1
RC2=$?
SUM2="$(cksum < "$T/cf/config.yml")"
check "重跑退出码 0" "[[ $RC2 -eq 0 ]]"
check "识别出「隧道已存在」" "grep -q '隧道已存在' '$T/o2.log'"
check "已授权则不再 login（不重复弹授权）" "grep -q '无需再次授权' '$T/o2.log'"
check "配置未被重写（校验和一致）" "[[ '$SUM1' == '$SUM2' ]]"

echo
echo "===================== 3) switch（应：留备份 + 改 DNS + 复核） ====================="
bash "$SCRIPT" --stage switch "${ARGS[@]}" > "$T/o3.log" 2>&1
RC3=$?
sed -n '6,40p' "$T/o3.log"
check "switch 退出码 0" "[[ $RC3 -eq 0 ]]"
check "🔴 切换前留了 dns-before-*.txt" "ls '$T/cf'/dns-before-*.txt >/dev/null 2>&1"
check "🔴 备份里记着旧值 lokfeel.netlify.app" "grep -q 'cname=lokfeel.netlify.app' '$T/cf'/dns-before-*.txt"
check "备份值已去掉结尾点（可直接粘进 CF 面板）" "! grep -q 'cname=lokfeel.netlify.app.\$' '$T/cf'/dns-before-*.txt"
check "备份里写了回滚指引" "grep -q '回滚' '$T/cf'/dns-before-*.txt"
check "DNS 已指向 cfargotunnel" "grep -q 'cfargotunnel' '$FAKE_STATE/cname'"
check "复核判定为 PASS" "grep -q '解析已指向隧道' '$T/o3.log'"

echo
echo "===================== 4) status（应：全线 PASS） ====================="
bash "$SCRIPT" --stage status "${ARGS[@]}" > "$T/o4.log" 2>&1
RC4=$?
sed -n '6,40p' "$T/o4.log"
check "status 退出码 0" "[[ $RC4 -eq 0 ]]"
check "报告已在隧道回源（提醒改代码即改线上）" "grep -q '已在隧道回源' '$T/o4.log'"
check "本机回源 200 判定通过" "grep -q '本机回源.*200' '$T/o4.log'"

echo
echo "===================== 5) rollback 指引（应：给出旧 CNAME） ====================="
bash "$SCRIPT" --stage rollback "${ARGS[@]}" > "$T/o5.log" 2>&1
check "rollback 退出码 0" "[[ $? -eq 0 ]]"
check "回滚目标是 lokfeel.netlify.app" "grep -q 'lokfeel.netlify.app' '$T/o5.log'"
check "说明为何不自动回滚" "grep -q 'cert.pem 只覆盖隧道操作' '$T/o5.log'"

echo
echo "===================== 6) 防护：无 cert 直接 switch 必须拒绝 ====================="
mkdir -p "$T/cf2"
bash "$SCRIPT" --stage switch --dir "$T/cf2" --unit-dir "$T/unit" > "$T/o6.log" 2>&1
RC6=$?
check "无 cert 时 switch 退出码 1" "[[ $RC6 -eq 1 ]]"
check "报错指向 prepare" "grep -q '先跑 --stage prepare' '$T/o6.log'"
CNAME_NOW="$(cat "$FAKE_STATE/cname")"
# 此时 DNS 已被用例 3 切到隧道，所以判据是"执行前后一致"，不是"仍是 netlify"
check "🔴 且没有偷偷改 DNS（与执行前一致）" "[[ \"$CNAME_NOW\" == 11111111-2222-3333-4444-555555555555.cfargotunnel.com. ]]"

echo
echo "===================== 7) dry-run（应：什么都不写） ====================="
mkdir -p "$T/cf3"
BEFORE_CALLS=$(wc -l < "$FAKE_LOG")
bash "$SCRIPT" --stage prepare --dir "$T/cf3" --unit-dir "$T/unit2" --dry-run > "$T/o7.log" 2>&1
RC7=$?
check "dry-run 退出码 0" "[[ $RC7 -eq 0 ]]"
check "dry-run 未生成 config.yml" "[[ ! -f '$T/cf3/config.yml' ]]"
check "dry-run 未生成 cert.pem" "[[ ! -f '$T/cf3/cert.pem' ]]"
# 只读调用（--version / tunnel list）允许；变更类（login/create/route）一次都不许有
NEW_CALLS="$(tail -n +$((BEFORE_CALLS + 1)) "$FAKE_LOG" | tr '\n' '|')"
check "dry-run 无变更类调用（login/create/route）" "[[ \"$NEW_CALLS\" != *'tunnel login'* && \"$NEW_CALLS\" != *'tunnel create'* && \"$NEW_CALLS\" != *'tunnel route'* ]]"

echo
echo "===================== 8) 静态边界 ====================="
check "脚本自身不监听任何端口（无 0.0.0.0 / --url）" "! grep -qE '0\\.0\\.0\\.0|--url' '$SCRIPT'"
check "不写死 /root 家目录" "! grep -q '/root/' '$SCRIPT'"
python3 - "$SCRIPT" > "$T/fw.txt" <<'PYEOF'
import re, sys
src = open(sys.argv[1], encoding='utf-8').read()
pat = re.compile(r'\$[A-Za-z_][A-Za-z0-9_]*[\u3000-\u303f\uff00-\uffef]')
for i, line in enumerate(src.splitlines(), 1):
    if pat.search(line):
        print('%d: %s' % (i, line.strip()))
PYEOF
check "变量紧邻全角标点（会导致 unbound）不存在" "[[ ! -s '$T/fw.txt' ]]"

echo
echo "------------------------------------------------------------"
printf ' 结果：%s PASS / %s FAIL\n' "$PASS" "$FAIL"
[[ $FAIL -eq 0 ]] || exit 1
exit 0
