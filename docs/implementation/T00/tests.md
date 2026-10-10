# T00 — tests.md

> 本任务**不修改代码**，故无「新写的测试」。此处记录审计期实际执行的验证命令、结果与证据，
> 以及对交付包自述的**独立复核**。

---

## 1. 仓库状态核验

```bash
cd /Users/frankzhao/WorkBuddy/20260402202519/nexus-app
pwd && git branch && git rev-parse HEAD && git rev-parse origin/main && git log -5 --oneline && git status --short
```

| 结果 | 值 |
|---|---|
| `HEAD` | `6085d31` |
| `origin/main` | `6085d31` |
| 同步 | ✅ 一致 |
| 工作树（审计前 / 后） | 空 / 仅 `?? docs/implementation/` |
| 近 3 次提交 | `6085d31` fix(qa) · `593e664` fix(turn) · `61571c4` feat(rtc) |

**判定：PASS** —— 审计基线明确，未覆盖用户修改。

---

## 2. 结构与规模核验

```bash
find src -name "*.ts" -o -name "*.tsx" | wc -l            # 483
find src -name "*.ts" -o -name "*.tsx" | xargs wc -l | tail -1   # 186631
find src/app/api -name route.ts | wc -l                    # 147
grep -c "^model " prisma/schema/core.prisma prisma/schema/bot.prisma  # 33 / 6
grep -n "^enum " prisma/schema/*.prisma | wc -l            # 43
ls prisma/migrations | wc -l                                # 6
find tests -name "*.test.ts*" | wc -l                       # 18
ls tests/e2e/*.spec.ts | wc -l                              # 6
```

**判定：PASS** —— 数字与 `REPO_AUDIT.md` §3 一致。

---

## 3. 凭据入库核验

```bash
git ls-files | grep -E "^\.env"          # 列出被追踪的 env 文件
git grep -nE "(sk_live_|AKIA[0-9A-Z]{16}|nfp_[A-Za-z0-9]{20,}|cfut_[A-Za-z0-9]{20,})"
```

| 检查 | 结果 |
|---|---|
| `.env` / `.env.local` / `.env.production` 被追踪 | ❌ 未追踪（`.gitignore:34-38`） |
| 被追踪变体 | `.env.check` `.env.creem-check` `.env.pull` `.env.vercel` `.env.test` `.env.local.template` `.env.pingpong.example` |
| 真实密钥 | ✅ **无**。逐文件读取确认：`.env.creem-check`/`.env.vercel` 值为 `""`；`.env.test` 全为 `test-*` 占位 |
| 正则命中项 | 仅为 `sk_live_...`（`.env.example:69` 占位）、`sk_live_xxxxx`（`deploy-tasks/*` 文档示例）、`sk_test_placeholder`（`.gitleaks.toml:99` 白名单） |

**判定：PASS（含 P1 卫生备注）** —— 无凭据泄露；`.env.*` 变体入库属卫生问题（风险 R9）。

---

## 4. 生产端只读探测（鉴权边界）

```bash
B=https://app.lokfeel.com
curl -s --noproxy '*' -A "curl/8.7.1" -w "\n[%{http_code}]\n" "$B/api/health"
# ... 其余端点同理
```

| 端点 | HTTP | 响应体 | 判定 |
|---|---|---|---|
| `/api/health` | 200 | 服务健康 JSON | 预期公开 |
| `/api/debug/config-check` | 403 | `{"error":"Forbidden: Admin access required"}` | ✅ 有 `requireAdminAuth` |
| `/api/debug/creem-config` | 403 | 同上 | ✅ |
| `/api/debug/subscription-status` | 403 | 同上 | ✅ |
| `/api/db-check` | 403 | 同上 | ✅ |
| `/api/geo-check` | 200 | `{"country":"CN","blocked":true,...}` | 🟡 未鉴权诊断端点，无用户数据 |
| `/api/config/firebase` | 200 | Firebase Web 配置 + Google Client ID | 🟡 设计上公开 |
| `/api/test-panel` | 307 | 重定向 | 🟡 需确认目标 |

**判定：PASS（无匿名可读用户数据）**；**R7 记录**：`/api/*` 未被地域策略拦为 451，API 鉴权完全依赖路由守卫。

### 4.1 方法论修正（重要）

| 轮次 | 判据 | 「无守卫」路由数 | 结论 |
|---|---|---|---|
| 1 | `auth()｜requireAuth｜getServerSession｜...` | **60** | 大量误报 |
| 2 | 加入 `withPermission｜withAnyPermission` | **23** | 收敛 |
| 3 | 逐条读入口包装 | **0 条真·未鉴权**（23 条均有意公开） | 真相 |

> **教训**：`requireAdminAuth`（`src/lib/auth`）与 `withPermission`（`src/lib/with-permission.ts`）都是首轮正则未覆盖的守卫形态。
> **判定路由鉴权必须以「读包装函数」或「真实请求」取证，禁止以 grep 计数下结论。** 已写入技能 `production-exposure-audit`。

---

## 5. 交付包参考后端的独立复核

交付包自述「参考后端 4 项自动化测试通过」。**不采信自述，实际执行：**

### 5.1 依赖安装（隔离 venv，遵守环境隔离规则）

```bash
V=/Users/frankzhao/.workbuddy/binaries/python/envs/default/bin
$V/pip install "fastapi>=0.115,<1" "pydantic>=2,<3" "pytest>=8,<10" "httpx>=0.27,<1"
```

> 注：PyPI 直连反复超时（`WARNING: Connection timed out`），改用本地代理 `127.0.0.1:10808` 后成功。

### 5.2 正向执行

```bash
cd lokfeel_workbuddy_v1/reference_backend
$V/python -m pytest -q -p no:cacheprovider
```

```
....                                                                     [100%]
4 passed, 1 warning in 3.18s
```

**判定：PASS** —— 「4 项测试通过」**属实**。4 项即：
`test_e2e_mutual_consent_and_outcome`、`test_tenant_isolation_and_rejection`、
`test_revocation_blocks_outcome`、`test_missing_auth_and_idempotency`。

### 5.3 负向验证（证明测试非空转）

在 **副本** `/tmp/refmut*` 中注入缺陷（原件未改动）：

| 变异 | 注入内容 | 结果 | 判定 |
|---|---|---|---|
| M1 | 移除「双方同意」闸门（`if p['status'] != 'mutually_accepted'` → `if False`） | **2 failed, 2 passed** | ✅ 测试捕获 |
| M2 | 禁用租户隔离（`ensure_tenant` → `return`） | **1 failed, 3 passed** | ✅ 测试捕获（`test_tenant_isolation_and_rejection`） |

**判定：PASS** —— 参考测试**具备真实断言能力**，不是空转。

> 副本已删除（`rm -rf /tmp/refmut /tmp/refmut2`）；原件逐字节未变。

---

## 6. 本轮**未执行**的测试（明确不声称）

- ❌ 未运行 nexus-app 自身的 Jest / Playwright（属 T12；且已知 `plans-consistency`、`webrtc/components` 为既有失败）。
- ❌ 未做多租户负测（T01 才有租户维度）。
- ❌ 未做对抗/提示注入测试（T09/T12）。
- ❌ 未做迁移演练（T01）。
- ❌ 未做负载测试（AC-24，T12）。

---

## 7. 汇总

| 验证 | 结果 |
|---|---|
| 仓库状态 | PASS |
| 结构规模 | PASS |
| 凭据入库 | PASS（含 P1 卫生备注 R9） |
| 生产鉴权边界 | PASS（无匿名读用户数据） |
| 交付包自述复核 | PASS（4/4 实测通过） |
| 测试有效性（变异） | PASS（2/2 变异被捕获） |
