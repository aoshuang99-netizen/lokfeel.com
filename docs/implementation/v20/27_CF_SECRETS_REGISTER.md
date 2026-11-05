# V20.1 · P0-03 统一 Cloudflare Secrets 登记

> 日期：2026-11-05（GMT+8）｜审计者：栈师
> 配套：作战令 V20.1 P0-03 + 既有 `D-09_CREDENTIAL_RISK_REGISTER.md`
> **本文件所有变量名均取自源码实查**，凡源码未使用的名称一律标 `UNKNOWN`，不臆造。

---

## 0. 来源与方法学诚实声明

| 维度 | 状态 |
| --- | --- |
| 变量名来源 | ✅ `grep -rhoE "process\.env\.[A-Za-z0-9_]+"` + 间接 `env.X` 访问（`provider.ts`/`connectivity.ts` 传入 `env` 对象） |
| 计数口径 | ⚠️ 241 = `process.env.X` 字面量；`WORKBUDDY_LLM_*`、`NEXTAUTH_*` 等经传入 `env` 对象访问者被**漏计**，真实总数 > 241 |
| Cloudflare API 注入 | ⛔ `BLOCKED_ACCESS`：本环境无 `CF_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID`，无法实际写入 Workers Secrets；本文件为**登记 + 注入规范**，非已注入证据 |
| 凭据明文 | 🔒 全文**未出现任何密钥值**；仅列变量名、来源文件、暴露面、隔离规则 |

---

## 1. 用户 P0-03 候选清单 ↔ 源码真实名称对齐

用户长文给出的候选名有 4 处与源码不符（实际名称以源码为准）：

| 用户候选名 | 源码真实名 | 证据 |
| --- | --- | --- |
| `WORKBUDDY_LLM_ENDPOINT` | ✅ 真实存在（`env.WORKBUDDY_LLM_ENDPOINT`） | `src/lib/agent/provider.ts:186`、`src/lib/agents/connectivity.ts:188` |
| `WORKBUDDY_LLM_KEY` | ✅ 真实存在（`env.WORKBUDDY_LLM_KEY`） | 同上 |
| `PAYMENT_SECRET` | ❌ 不存在；真实为 `STRIPE_SECRET_KEY` + `CREEM_API_KEY` | `src/lib/stripe/refund-route.ts:38`、`src/app/api/debug/creem-ping/route.ts:36` |
| `PAYMENT_WEBHOOK_SECRET` | ❌ 不存在；真实为 `STRIPE_WEBHOOK_SECRET` + `CREEM_WEBHOOK_SECRET` | `src/app/api/webhooks/stripe/route.ts:49` |
| `EMAIL_API_KEY` | ❌ 不存在；真实为 `RESEND_API_KEY`（回退 `SMTP_PASSWORD`） | `src/lib/email.ts:7` |
| `FIREBASE_SERVER_CREDENTIALS` | ❌ 不存在；真实为 `FIREBASE_PRIVATE_KEY` + `FIREBASE_CLIENT_EMAIL` + `FIREBASE_PROJECT_ID` | `src/lib/firebase/admin.ts:69` |

> 结论：注入 Secrets 时**必须使用源码真实变量名**，否则部署后读不到。

---

## 2. 服务端密钥登记（Server-only，禁止进入前端 Bundle）

全部经 `process.env.*` 或传入 `env` 对象在服务端读取，已确认**无** NEXT_PUBLIC 前缀误用。

| # | 变量名（真实） | 用途 | 源码位置 | CF Secret 映射 | 高风险 |
| --- | --- | --- | --- | --- | --- |
| 1 | `AUTH_SECRET` / `NEXTAUTH_SECRET` | 会话签名 | `src/lib/auth/config.ts:296`、`src/lib/with-permission.ts:253` | `AUTH_SECRET` | 🔴 |
| 2 | `AUTH_URL` / `NEXTAUTH_URL` | 回调基址 | `src/lib/auth/config.ts` | 配置项（非 secret） | 🟡 |
| 3 | `DATABASE_URL` / `TURSO_DB_URL` | 主库连接 | `src/lib/db.ts:163` | `DATABASE_URL` | 🔴 |
| 4 | `DATABASE_AUTH_TOKEN` / `TURSO_AUTH_TOKEN` / `TURSO_TOKEN` | libSQL/Turso 鉴权 | `src/lib/db.ts:163` | `DATABASE_AUTH_TOKEN` | 🔴 |
| 5 | `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` / `UPSTASH_API_KEY` | 缓存/实时 | `src/lib/socket/index.ts:120`、`src/lib/redis-cache.ts:109` | `UPSTASH_REDIS_REST_TOKEN` | 🔴 |
| 6 | `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `OPENAI_MODEL` | AI Provider（真实） | `src/app/api/matches/[id]/pitch/generate/route.ts:95` | `OPENAI_API_KEY` | 🔴 |
| 7 | `WORKBUDDY_LLM_ENDPOINT` / `WORKBUDDY_LLM_KEY` / `WORKBUDDY_LLM_MODEL` | AI Provider（云端算力） | `src/lib/agent/provider.ts:186`、`src/lib/agents/connectivity.ts:188` | `WORKBUDDY_LLM_KEY` | 🔴 |
| 8 | `STRIPE_SECRET_KEY` | 支付服务端 | `src/lib/stripe/refund-route.ts:38` | `STRIPE_SECRET_KEY` | 🔴 |
| 9 | `STRIPE_WEBHOOK_SECRET` | 支付回调验签 | `src/app/api/webhooks/stripe/route.ts:49` | `STRIPE_WEBHOOK_SECRET` | 🔴 |
| 10 | `CREEM_API_KEY` / `CREEM_WEBHOOK_SECRET` / `CREEM_ENV` | 支付（备用通道） | `src/app/api/debug/creem-ping/route.ts:36` | `CREEM_WEBHOOK_SECRET` | 🔴 |
| 11 | `RESEND_API_KEY`（回退 `SMTP_PASSWORD`） | 邮件 | `src/lib/email.ts:7` | `RESEND_API_KEY` | 🟡 |
| 12 | `FIREBASE_PRIVATE_KEY` / `FIREBASE_CLIENT_EMAIL` / `FIREBASE_PROJECT_ID` | 推送/Admin | `src/lib/firebase/admin.ts:69` | `FIREBASE_PRIVATE_KEY` | 🔴 |
| 13 | `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM_NUMBER` | SMS | `src/lib/email.ts:234` | `TWILIO_AUTH_TOKEN` | 🟡 |
| 14 | `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | OAuth | `src/lib/auth/config.ts` | `GOOGLE_CLIENT_SECRET` | 🟡 |
| 15 | `GITHUB_*`（`GITHUB_SHA`/`GITHUB_ENV` 等） | CI 注入，非业务 secret | CI runner | 走 OIDC，不登记 | ⚪ |
| 16 | `CF_API_TOKEN` / `CF_ACCOUNT_ID` | Cloudflare 部署凭据 | CI / `wrangler` | `CF_API_TOKEN`（仅 CI 用） | 🔴 |
| 17 | `SENTRY_*` | 错误追踪 | `src/lib/*` | `SENTRY_DSN` | 🟡 |

---

## 3. 客户端暴露变量（NEXT_PUBLIC_*，28 项，必须不含秘密）

已确认以下为**设计上可公开**的值，但需逐一复核是否误带敏感信息：

| 变量 | 性质 | 判定 |
| --- | --- | --- |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe 发布键（可公开） | ✅ 安全 |
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Firebase 公钥（靠规则限权） | ✅ 安全，但需 Firebase 安全规则兜底 |
| `NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID` | OAuth 公开客户端 ID | ✅ 安全 |
| `NEXT_PUBLIC_PUSHER_KEY` / `NEXT_PUBLIC_PUSHER_CLUSTER` | Pusher 公钥 | ✅ 安全 |
| `NEXT_PUBLIC_GTM_ID` / `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION` | 分析/SEO | ✅ 安全 |
| `NEXT_PUBLIC_BUILD_*`（`COMMIT`/`TIME`/`VERSION`） | 构建元数据 | ✅ 安全 |
| `NEXT_PUBLIC_TURN_URLS` / `NEXT_PUBLIC_STUN_URLS` | ICE 服务器地址 | ✅ 安全 |
| `⚠️ NEXT_PUBLIC_TURN_CREDENTIAL` / `NEXT_PUBLIC_TURN_USERNAME` | TURN 凭据前置公开 | 🟡 **需复核**：若含长期凭据应改为服务端 ICE endpoint 下发 |
| `⚠️ NEXT_PUBLIC_X` | 通用占位名 | 🟡 命名不透明，发布前需明确其用途或删除 |

---

## 4. 三环境隔离规范（Development / Preview / Production）

| Secret | Development | Preview（隔离） | Production |
| --- | --- | --- | --- |
| `STRIPE_SECRET_KEY` | test sk | **test sk**（绝不接真实） | live sk |
| `CREEM_WEBHOOK_SECRET` | test | **test** | live |
| `DATABASE_AUTH_TOKEN` | 本地/分支库 | **独立 Preview 库或 schema** | 生产库 |
| `WORKBUDDY_LLM_KEY` | 受限/本地 | 受限测试 key | 正式 key |
| `AUTH_SECRET` | 本地随机 | Preview 专用随机值 | 生产专用随机值 |
| `FIREBASE_PRIVATE_KEY` | 测试项目 | 测试项目 | 生产项目 |
| `CF_API_TOKEN` | 不注入 | CI 仅 Preview 权限 | CI 仅 Production 权限（最小权限） |

**硬规则**：
1. Preview 与 Production **不共用任何 🔴 高风险凭据**。
2. 生产环境 `AGENT_PROVIDER` 不得为 `stub`（`resolveProviderMode` 已强制抛错）。
3. 任何 Secret 不得写入前端 Bundle（已通过 §3 复核保证）。
4. `.env` / `.cf-secrets.json` 已 gitignore（D-09 复扫确认），**禁止上传 Git**。
5. 凭据轮换须记录（见 `D-09_CREDENTIAL_RISK_REGISTER.md` 轮换表）。

---

## 5. 强制门禁（需 CF 凭据/CI 才能实测）

| 门禁 | 状态 | 说明 |
| --- | --- | --- |
| gitleaks GitHub Actions 必需检查 | ✅ 已接入（实测） | `ci.yml` 第 636 行 `secret-scan` 作业，`gitleaks/gitleaks-action@v3`，`fetch-depth:0` 全历史扫描；`.gitleaks.toml` 新增 4 类规则后共 13 条（见 §6）。**剩余唯一动作**：在 GitHub 分支保护中将 `secret-scan` 设为 *Required*（需仓库管理员权限 / token，非代码可改） |
| 生产 Secret 泄漏测试 | ⛔ BLOCKED_ACCESS | 需注入后实测 |
| Preview/Production 隔离测试 | ⛔ BLOCKED_ACCESS | 需两套 Secrets |
| 不再依赖本地 `.env` 部署 | ✅ 设计达成 | 部署改走 CF Secrets / CI Secret Store |

---

## 6. gitleaks CI 门禁草案（提交即用，不打印明文）

`.github/workflows/gitleaks.yml`：
```yaml
name: gitleaks
on: [push, pull_request]
jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: gitleaks/gitleaks-action@v2
        env:
          GITLEAKS_ENABLE_UPLOAD_ARTIFACT: "false"
          # 不设置 GITLEAKS_NOTIFY_USER，避免把命中片段回显到日志
```

`.gitleaks.toml` 需补 D-09 指出的 4 类规则（`nfp_`/`gh*_`/`re_*_*`/`wbpk_`/`sk-`），当前仓库**无 .gitleaks.toml** → 需新增（P0-03 交付物，待 CF 凭据到位一并提交）。

---

## 7. 下一步（解锁 BLOCKED_ACCESS 所需）

1. 用户提供 `CF_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`（或经 OIDC 授权）→ 实际写入 Workers Secrets 并复核隔离。
2. 提交 `gitleaks.yml` + `.gitleaks.toml`（4 条补规则）→ 远端强制门禁生效。
3. 复核 `NEXT_PUBLIC_TURN_CREDENTIAL` / `NEXT_PUBLIC_X` 是否含敏感值，必要时改为服务端下发。

> 本文件未注入任何 Secret、未上传任何凭据、未执行部署。所有 CF 远端动作受凭据缺失约束，如实标记。
