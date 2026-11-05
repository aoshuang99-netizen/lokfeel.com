# 35 · V20.2 Cloudflare Secrets 与后端服务验收

> 对应 V20.2 作战令 Batch 3。结论先行：**完整环境变量注册表已从源码实际提取（95 个唯一 `process.env.*` 引用 + `.env.example` + `wrangler.jsonc` 绑定）**；**运行时验收全部 BLOCKED**——缺 Cloudflare/GitHub Secrets 与第三方凭据，无法做数据库读写 / 登录 / Provider 健康检查等真实调用。不伪造「可用」。

## 方法
- `grep -rhoE "process\.env\.[A-Za-z0-9_]+" src` → 95 个唯一变量。
- 交叉参考 `.env.example`（13KB，含前缀约定）与 `wrangler.jsonc` 绑定（`ASSETS`、`WORKER_SELF_REFERENCE`）。
- ⚠️ `WORKBUDDY_LLM_ENDPOINT` / `WORKBUDDY_LLM_KEY` / `WORKBUDDY_LLM_MODEL` **未**出现在 `process.env.*` 字面量中——源码经「传入 env 对象」间接访问（见 V20.0 记忆），grep 漏捕；其运行时位置需在 `runtime.ts` / provider 装配处人工确认，不能凭字面量判定「无此变量」。

## 注册表（按服务分组）

### 数据库 · Turso / libSQL
`DATABASE_URL`、`DATABASE_AUTH_TOKEN`、`TURSO_AUTH_TOKEN`
- 注入位置：Cloudflare Worker 运行时（生产用 Turso over HTTPS）。
- 运行时验收：数据库读写 / 租户隔离 → **BLOCKED（缺 TURSO_AUTH_TOKEN / 真实 Turso 库）**。

### 缓存 · Upstash Redis
`UPSTASH_REDIS_REST_URL`、`UPSTASH_REDIS_REST_TOKEN`
- 运行时验收：缓存读写 → **BLOCKED（缺 Upstash 凭据）**。

### 认证 / 会话
`NEXTAUTH_SECRET`、`NEXTAUTH_URL`、`NEXTAUTH_AUTH_URL`、`AUTH_SECRET`、`AUTH_URL`、`CRON_SECRET`
- 运行时验收：登录 + Session 恢复 → **BLOCKED（缺 NEXTAUTH_SECRET / 真实用户库）**。

### OAuth
`GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`、`GOOGLE_OAUTH_CLIENT_ID`、`TWITTER_CLIENT_ID`、`TWITTER_CLIENT_SECRET`、`TWITTER_OAUTH_CALLBACK_PATH`
- 运行时验收：OAuth 回调 → **BLOCKED（缺各 provider 凭据）**。

### Agent Provider · WorkBuddy / OpenAI
`OPENAI_API_KEY`；`WORKBUDDY_LLM_ENDPOINT` / `WORKBUDDY_LLM_KEY` / `WORKBUDDY_LLM_MODEL`（间接访问，见上）
- 注入：Cloudflare Secrets（**仅服务端**，禁止 `NEXT_PUBLIC_*`）。
- 运行时验收：Provider 健康检查、真实 Agent 执行（S2）→ **BLOCKED（缺 WORKBUDDY_LLM_* 或 OPENAI_API_KEY）**。

### 邮件 · Resend / SMTP
`RESEND_API_KEY`、`SMTP_HOST`、`SMTP_PORT`、`SMTP_USER`、`SMTP_PASSWORD`、`SMTP_FROM`、`EMAIL_VERIFICATION_ENABLED`
- 运行时验收：邮件投递 → **BLOCKED（缺 RESEND_API_KEY / SMTP 凭据）**。

### 实时 · Pusher
`PUSHER_APP_ID`、`PUSHER_KEY`、`PUSHER_SECRET`、`PUSHER_CLUSTER`、`NEXT_PUBLIC_PUSHER_KEY`、`NEXT_PUBLIC_PUSHER_CLUSTER`、`NEXT_PUBLIC_USE_PUSHER`
- 运行时验收：实时通道 → **BLOCKED（缺 Pusher 凭据）**。

### WebRTC / TURN
`TURN_URLS`、`TURN_USERNAME`、`TURN_CREDENTIAL`、`TURN_API_TOKEN`、`TURN_TOKEN_ID`、`NEXT_PUBLIC_TURN_URLS`、`NEXT_PUBLIC_TURN_USERNAME`、`NEXT_PUBLIC_TURN_CREDENTIAL`、`NEXT_PUBLIC_USE_TURN`、`NEXT_PUBLIC_STUN_URLS`、`TWILIO_ACCOUNT_SID`、`TWILIO_AUTH_TOKEN`、`TWILIO_FROM_NUMBER`
- 运行时验收：WebRTC 信令 / TURN → **BLOCKED（缺 TURN/Twilio 凭据）**。

### Firebase
`FIREBASE_PROJECT_ID`、`FIREBASE_CLIENT_EMAIL`、`FIREBASE_PRIVATE_KEY` + `NEXT_PUBLIC_FIREBASE_*`（6 项）
- 运行时验收：推送 → **BLOCKED（缺 Firebase 私钥）**。

### 支付 / Webhook
`STRIPE_SECRET_KEY`、`STRIPE_WEBHOOK_SECRET`、`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`、`CREEM_API_KEY`、`CREEM_WEBHOOK_SECRET`、`CREEM_ENV`、`CREEM_MONTHLY_PRODUCT_ID`、`CREEM_YEARLY_PRODUCT_ID`、`CREEM_SUCCESS_URL`、`PINGPONG_*`(4)、`GUMROAD_ACCESS_TOKEN`、`GUMROAD_WEBHOOK_SECRET`
- 运行时验收：Webhook 签名验证 / 退款 → **BLOCKED（缺 Stripe/Creem/PingPong/Gumroad 凭据；此部分涉及真实扣款，须 D-10 + 测试账号授权，详见 D-09 凭据风险台账）**。

### 管理后台
`ADMIN_KEY`、`ADMIN_PASSWORD`、`ADMIN_ROLE`、`ADMIN_SECRET`、`ADMIN_USERNAME`
- 运行时验收：管理操作 → **BLOCKED（缺管理员凭据）**。

### 归档 / 构建 / 其它
`S3_ARCHIVE_BUCKET`（归档）、`BOT_ENGINE_TICK_ENABLED`（Cron 开关）、`COMMIT_REF`/`GITHUB_SHA`/`VERCEL_ENV`/`NODE_ENV`/`PORT`/`npm_package_version`（构建期）、`NEXT_PUBLIC_*`（公开变量，**非服务端秘密**）。

### ⚠️ 待清理项
源码引用了 `X`、`XXX` 两个异常变量名（极可能是测试 mock 残留或误写）。**未见生产用途**，建议核查 `tests/` 或遗留代码后移除，避免误判为真实配置。

## Secrets 管理边界（作战令要求）
- `NEXT_PUBLIC_*` = 构建期注入的公开变量，**不得**当作服务端秘密。
- 服务端秘密（Provider/DB/Redis/邮件/支付）→ Cloudflare Worker Secrets 或 GitHub Actions Secrets，**不**进仓库、不进 `.env.example` 明文。
- `.env.example` 仅为占位说明，CI 用占位值（`d4ad0d4` 已验证 `npm ci` + `cf:build` 在占位下通过）。

## 运行时验收（11 项，全部 BLOCKED — 诚实标注）
| # | 验收项 | 状态 | 阻塞凭据 |
|---|---|---|---|
| 1 | 数据库读写验证 | BLOCKED | TURSO_AUTH_TOKEN + 真实 Turso |
| 2 | 登录 / Session 恢复 | BLOCKED | NEXTAUTH_SECRET + 用户库 |
| 3 | 租户隔离 | BLOCKED | 同上（依赖 DB） |
| 4 | Provider 健康检查 | BLOCKED | WORKBUDDY_LLM_* / OPENAI_API_KEY |
| 5 | 失败重试 | 部分（S1 单测覆盖 stub 失败路径） | 真实 Provider 重试待 S2 |
| 6 | Webhook 签名验证 | BLOCKED | 各支付 provider webhook secret |
| 7 | Cron Triggers 等价性 | 静态已审计（`cron-method-gate` 在 CI） | 需协调 Netlify 旧 cron 避免双跑 |
| 8 | 无凭据时诚实 unavailable | ✅ 代码层（`resolveProviderMode` 缺凭据返 unavailable） | — |
| 9 | 生产禁用 Stub | ✅ 代码层（生产+stub 硬抛错，S1 单测覆盖） | — |
| 10 | 无跨租户数据访问 | 静态审计（`tenancy-scoping-gate` 在 CI） | 运行时待 S3 |
| 11 | Secrets 未泄漏 | 静态（gitleaks 在 CI） | 运行时待 Secrets 注入后复扫 |

## 结论
静态注册表完整、CI 已内置 gitleaks / tenancy / cron 门禁；**运行时验收因缺凭据全 BLOCKED**，不冒充可用。待 `CLOUDFLARE_API_TOKEN` + 各第三方凭据经 Secrets 注入后，在 Preview 隔离库重跑本表 1–7、10–11。
