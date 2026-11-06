# 53 · V20.4 Cloudflare Runtime Evidence（Batch 1 全栈运行时）

> 采集时间：2026-11-06 18:30–18:50 (GMT+8)
> 凭据：Cloudflare API Token（`/tmp/cf_api_token.txt`，`chmod 600`，**不入库**）、GitHub PAT（仅读）。
> 所有值经 API/HTTP 实测；推断处显式标注。

---

## 1. 最重要的一个发现：生产其实不在 Cloudflare Workers 上

```
$ curl -sSI https://app.lokfeel.com/login
HTTP/2 200
server: cloudflare
x-nf-request-id: 01M6R7BD7BFA5WN1HZ0CDNDMT9
cf-cache-status: DYNAMIC
cf-ray: a56380c04d2ae5e0-AMS
cache-control: private,no-store,max-age=0,must-revalidate
```

`x-nf-request-id` 是 **Netlify 的请求 ID**。`server: cloudflare` + `cf-ray` 说明前面挂了 Cloudflare 代理（orange cloud）。

**结论（实测，非推断）：`app.lokfeel.com` = Cloudflare CDN/代理 → 回源 Netlify Functions。Cloudflare Workers 不是生产承载者。**

这直接决定了两件事：

1. 「Cloudflare 生产版本」在本项目里有**两个不同对象**，不能混为一谈：

   | 对象 | 是什么 | 是否承载真实流量 |
   |---|---|---|
   | `app.lokfeel.com` | CF 代理 + Netlify 源站 | **是**（真实生产） |
   | Worker `lokfeel-app` | OpenNext 产物部署到 CF Workers | **否**（无自定义域/路由接管，见 §3） |

2. 生产 TTFB 2060ms（见 `55`）的根因方向是**跨境 + CF 代理回源 Netlify 冷启动**，不是 Worker 冷启动。

---

## 2. 配置映射表（环境 → 变量 → 绑定方式 → 依赖 → 验证状态）

### 2.1 Cloudflare Workers（`lokfeel-app` / `lokfeel-preview`）

`wrangler.jsonc` 与 `wrangler.preview.jsonc` 的**全部**内容（逐行核对，无省略）：

```jsonc
{
  "main": ".open-next/worker.js",
  "name": "lokfeel-app",
  "compatibility_date": "2025-09-01",
  "compatibility_flags": ["nodejs_compat", "global_fetch_strictly_public"],
  "assets": { "directory": ".open-next/assets", "binding": "ASSETS" },
  "services": [{ "binding": "WORKER_SELF_REFERENCE", "service": "lokfeel-app" }]
}
```

**没有 `vars`、没有 `d1_databases`、没有 `kv_namespaces`、没有 `hyperdrive`、没有 `secrets`。**

Cloudflare API 交叉验证：

| Worker | bindings | 类型 |
|---|---|---|
| `lokfeel-app` | 2 条 | `assets`(ASSETS) + `service`(WORKER_SELF_REFERENCE) |
| `lokfeel-preview` | 2 条 | 同上 |

```
GET /accounts/{acc}/workers/scripts/{worker}/secrets  →  lokfeel-app: 0 条
                                                          lokfeel-preview: 0 条
```

### 2.2 运行时变量清单（真实来源：`.env.production`，只列键名，不落值）

代码里引用 **101 个** `process.env.*`；`.env.production` 提供 30+ 个真实键：

| 类别 | 键 | 依赖服务 | 是否注入 CF Worker |
|---|---|---|---|
| 数据 | `DATABASE_URL`、`TURSO_AUTH_TOKEN` | Turso (libSQL) | **否** |
| 缓存 | `UPSTASH_REDIS_REST_URL`、`UPSTASH_REDIS_REST_TOKEN`、`UPSTASH_API_KEY` | Upstash Redis | **否** |
| 认证 | `AUTH_SECRET`、`AUTH_URL`、`NEXTAUTH_URL` | 自签 JWT | **否** |
| OAuth | `GOOGLE_CLIENT_ID/SECRET`、`TWITTER_CLIENT_ID`、`NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID` | Google / X | **否** |
| Firebase | `FIREBASE_PROJECT_ID`、`FIREBASE_CLIENT_EMAIL`、`FIREBASE_PRIVATE_KEY`、`NEXT_PUBLIC_FIREBASE_*` | Firebase Admin | **否** |
| 支付 | `CREEM_API_KEY`、`CREEM_WEBHOOK_SECRET`、`CREEM_MONTHLY_PRODUCT_ID`、`CREEM_YEARLY_PRODUCT_ID`、`CREEM_ENV` | Creem | **否** |
| 邮件 | `SMTP_HOST/PORT/USER/PASSWORD/FROM`、`RESEND_API_KEY` | SMTP / Resend | **否** |
| 运维 | `CRON_SECRET`、`ADMIN_CREDENTIALS_ENABLED` | 内部 | **否** |

> **结论：CF Workers 上没有任何运行时配置。** 若现在把域名切到 `lokfeel-app`，`DATABASE_URL` 缺失 ⇒ DB/Auth/Cache/支付/邮件**全部不可用**。这是「CF 全栈运行时未恢复」的确切含义。

### 2.3 GitHub Secrets

`GET /repos/.../actions/secrets`（只读名称）：

```
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
```

仅够 `wrangler deploy`，不含任何业务凭据。

### 2.4 GitHub Environments

| Environment | protection_rules | reviewers |
|---|---|---|
| `production` | **0** | **0** |
| （第二个环境） | **0** | **0** |

**这是治理空壳**：`cloudflare-production.yml` 声明了 `environment: production`，但该环境没有审批人。也就是说「必须人工批准才能发布生产」在 GitHub 侧**并不成立**。这是 P1，登记在 `57`。

---

## 3. 部署与隔离证据

| Worker | `modified_on` | `etag` | 说明 |
|---|---|---|---|
| `lokfeel-preview` | **2026-11-06T11:12:23Z** | `8104b76d…72c6` | 本轮 `rc/v20.4@e1a0dea` push 触发（run `42208114255`），deployment `97a3a4de-828d-4cc9-8aa2-67aa592aa83c`，author `aoshuang99@gmail.com`，source `wrangler` |
| `lokfeel-app` | 2026-11-06T03:26:46Z | `c08b5cdc…358f` | **未变** ⇒ 生产 worker 未被 preview 覆盖 |

前一次 preview 部署为 `4d5b274f`（08:34:47Z，对应 `e5fa762`），本次为 `97a3a4de`（11:12:22Z，对应 `e1a0dea`）。
两次 `modified_on` 都精确落在对应 run 的时窗内，而 `lokfeel-app` 全程停在 `03:26:46Z` —— **隔离是时间戳级的硬证据，不是"配置看起来正确"**。

Zone：`lokfeel.com`（`76bdd5ac9efcf5a612ee4b6269b06a2a`）状态 `active`。
`workers.dev` 子域：`aoshuang99`；`lokfeel-app` / `lokfeel-preview` 均 `enabled=true`。

### 3.1 绑定清单（API 直读，非推断）

| Worker | bindings | secrets 数量 |
|---|---|---|
| `lokfeel-preview` | `ASSETS`(assets) + `WORKER_SELF_REFERENCE`(service) | **0** |
| `lokfeel-app` | `ASSETS`(assets) + `WORKER_SELF_REFERENCE`(service) | **0** |

`GET /accounts/{id}/workers/scripts/lokfeel-preview/secrets` → `count = 0`。
既没有 `DATABASE_URL`，也没有 `NEXTAUTH_SECRET`、Upstash、Firebase、WorkBuddy LLM 任何一项。
`compatibility_date = 2025-09-01`。

---

## 4. 逐项运行时验证

| # | 项目 | 环境 | 结果 | 证据 |
|---|---|---|---|---|
| 1 | `/api/health` | 本地 prod | **PASS** | 200；`status=healthy`、`dbLatency=1646ms` |
| 2 | `/api/health` | 生产 | **PASS** | 200；DB/Upstash/Firebase `configured=true` |
| 3 | DB 连通 | 本地 prod | **PASS** | 真实 Turso：读到 User / Profile / Organization / Membership 表；latency 1646ms |
| 4 | DB 写入 | 本地 prod | **PASS** | `POST /api/v1/missions` → 201，随后 `GET` 读回同一条（items=2） |
| 5 | 缓存（Upstash） | 本地 prod | **PASS** | health：`backend=upstash, configured=true, degraded=false, degradeCount=0` |
| 6 | Session 创建 | 本地 prod | **PASS** | `POST /api/auth/login` → 200 + 下发 `authjs.session-token` |
| 7 | Session 恢复 | 本地 prod | **PASS** | 带 cookie 访问 `/workspace` → 200（匿名同路径 → 307 到 /login） |
| 8 | 组织租户隔离 | 本地 prod | **PASS** 6/6 | 恶意 `organizationId` 被忽略、列表非空且 `foreign=0`（详见 `57` §3） |
| 9 | Agent Provider 可用 | 生产 | **PASS** 9/9 | `provider=workbuddy`、真实 token 461/270（详见 `56`） |
| 10 | Agent Provider 可用 | 本地 | **BLOCKED（诚实降级）** | `provider=none`、run `FAILED/NO_DEGRADE_PATH`、token 0 |
| 11 | OAuth 授权请求 + 回调失败路径 | 生产 | **PASS 21/21** | 授权请求 8 项参数合规（PKCE S256、`redirect_uri` 指向生产域、state 43 字符）；三种坏回调全部 307 回登录页、**零 session cookie**、零 5xx。`scripts/qa/v204-oauth-shape.mjs`。真实成功回调仍 **NOT_TESTED**（需真人授权），详见 §4.4 |
| 12 | Preview HTTP 实测 | CF Workers | **FAIL（运行时不可用，非网络）** | 已打通出境通道后实测：`/favicon.ico` **200 / 25931B**（ASSETS 正常）；`/`、`/login`、`/workspace`、`/api/health`、`/robots.txt` **全部 500** `{"message":"Server failed to respond."}` 61B。详见 §4.1 |
| 13 | 异常日志与追踪 | — | **BLOCKED** | 无 Workers Logs / Tail 访问；Sentry 未在本轮核对 |
| 14 | 无 Stub Provider 进生产构建 | 生产 | **PASS** | 生产 `provider=workbuddy`（非 `stub`/`none`）；本地缺凭据时诚实降级为 `none` 而非伪造 |
| 15 | 无密钥泄漏 | 仓库 | **PASS** | 全部 `.env*` 均 ignored、历史零提交（详见 `57`） |

---

### 4.1 推翻旧结论：Preview「网络不可达」是错的，真实症状是 500

上一版本文档把第 12 项记为 `BLOCKED（本地网络无法访问 *.workers.dev）`。**这个结论是错的，本轮已推翻。**

| 通道 | 结果 |
|---|---|
| 本机默认出口（本地代理，走境内） | `CONNECT tunnel failed, response 502`，`http=000` |
| 直连（`--noproxy '*'`） | `Connection timed out after 15013ms` |
| **SOCKS5 `127.0.0.1:10808`（sing-box → Bright Data 美国住宅出口）** | **真实 HTTP 响应** |

也就是说：**不是 worker 不可达，是我之前的测量通道没有出境。** 换成出境通道后立刻拿到真实响应。

实测矩阵（`https://lokfeel-preview.aoshuang99.workers.dev`，出口 `cf-ray: a563b079fc3db341-SJC`）：

| 路径 | 状态 | 字节 | TTFB | 响应体 |
|---|---|---|---|---|
| `/favicon.ico` | **200** | 25931 | 2.43s | 二进制 ICO（正常） |
| `/` | **500** | 61 | 5.38s | `{"message":"Server failed to respond.","details":{}}` |
| `/login` | **500** | 61 | 1.91s | 同上 |
| `/workspace` | **500** | 61 | 3.38s | 同上 |
| `/api/health` | **500** | 61 | 3.75s | 同上 |
| `/robots.txt` | **500** | 61 | 3.55s | 同上 |

响应头里 **CSP / HSTS / X-Frame-Options / report-to 全部正常下发**，说明 Next 应用与 middleware 确实在跑；
`cache-control: private, no-cache, no-store` 也符合预期。**唯一出问题的是业务渲染这一步。**

### 4.2 根因闭合：静态能出、动态全崩 ⇒ 缺的是运行时凭据

`/favicon.ico` 走 `ASSETS` 绑定，200；所有需要执行服务端代码的路由，500。
结合 §3.1 的 `secrets = 0`，因果链完全闭合：

```
ASSETS 绑定存在            → 静态资源 200
WORKER_SELF_REFERENCE 存在 → worker 能自调用
secrets = 0 / vars = 0     → Prisma 拿不到 DATABASE_URL      → 初始化抛错
                           → NextAuth 拿不到 NEXTAUTH_SECRET  → 同样抛错
                           → 所有 SSR 路由进入错误分支 → 统一 500 + 61B JSON
```

这不是「配置写错」，而是**从未注入**。所以判定用 `FAIL`（运行时真的不可用）而不是 `BLOCKED`（说不清原因）——
原因现在说得清了。

### 4.3 反向交叉验证：`lokfeel-app` 也是 500 ⇒ 生产根本不在 Workers 上

| 目标 | 结果 |
|---|---|
| `https://lokfeel-app.aoshuang99.workers.dev/` | **500**，同样 61B JSON |
| `https://lokfeel-app.aoshuang99.workers.dev/login` | **500**，同样 61B JSON |
| `https://app.lokfeel.com/login` | **200**，`server: cloudflare` + `x-nf-request-id: 01M6R9996BPDV6BKDB3A3W7CYZ` |

如果生产真的跑在 `lokfeel-app` 这个 worker 上，那么 `app.lokfeel.com` 也该是 500。它不是。
**两条独立证据（`x-nf-request-id` 与 worker 自身 500）指向同一结论：`app.lokfeel.com` 是 Cloudflare 代理回源 Netlify，Worker 只是挂在旁边、没有承载流量。**

> 这条结论对发布决策至关重要：所谓「发布到 Cloudflare」目前**没有可用的运行时**；
> 真实承载面是 Netlify。二者必须先做一次明确选择（见 `58` §5）。

### 4.4 OAuth：不测"能不能登录成功"，只测"拒绝是否彻底"

上一版把第 11 项记为 `NOT_TESTED（需真人授权）`。这个理由只对**成功回调**成立。
授权请求的形状、坏回调的拒绝行为，都不需要真人 —— 而它们恰恰是最容易出事的地方：

| 风险 | 若出错 | 可自动化验证？ |
|---|---|---|
| `redirect_uri` 写错域 / 残留 localhost | 上线后全员登录失败 | 是 |
| 无 PKCE / 无 state | 授权码拦截、CSRF | 是 |
| 验签失败仍下发 session | **直接账号接管** | 是 |

`scripts/qa/v204-oauth-shape.mjs`（21 项断言，**21 PASS / 0 FAIL**）：

**① 授权请求形状（8/8 PASS）**

```
response_type         = code
client_id             = 185541962106-g…（真实 Google Client ID，非占位符）
redirect_uri          = https://app.lokfeel.com/api/auth/callback/google   ← 指向生产域，无 localhost
scope                 = openid email profile
state                 = 43 字符
code_challenge        = 43 字符
code_challenge_method = S256
access_type / prompt  = offline / consent
```

**② 坏回调拒绝（3 类 × 4 项 = 12/12 PASS）**

| 场景 | 跳转 | 5xx | session cookie |
|---|---|---|---|
| `error=access_denied` | `/login?error=Google authorization failed: access_denied` | 无 | **未下发** |
| `code=fake-code&state=fake-state` | `/login?error=Security check failed. Please start the sign-in again.` | 无 | **未下发** |
| 空参数 | `/login?error=Google callback missing authorization code` | 无 | **未下发** |

第二行是重点：**伪造 code 被 state/PKCE 校验直接拦下，且没有建会话**。
这正是"账号接管"类漏洞的入口，现在有证据它是关着的。

**仍未覆盖**：真实 code 交换（需要真人点一次 Google 授权）。
这一项如实保留为 `NOT_TESTED`，不用"失败路径通过"冒充"成功路径可用"。

---

## 5. 支付状态（与发布边界一致）

`/api/health` 返回：`payments.configured=false`、`charging=false`。

与 V20.4「支付与法律未闭合时保持关闭」的要求一致。**未做任何真实扣款**。

---

## 6. 本批次结论

| 验收项 | 判定 |
|---|---|
| Preview 部署成功 | **PASS**（run `42208114255`；deployment `97a3a4de`，`modified_on 11:12:23Z`） |
| Preview 与候选 SHA 一致 | **PASS**（部署由 `rc/v20.4@e1a0dea` 的 push 触发） |
| Preview 隔离，不覆盖生产 worker | **PASS**（`lokfeel-app` 全程 `03:26:46Z` 未变） |
| Preview 静态资源可服务 | **PASS**（`/favicon.ico` 200 / 25931B） |
| Preview 动态路由可服务 | **FAIL**（5 条路由全部 500 / 61B） |
| HTTP 及业务 API 有真实响应 | **PASS**（本地 prod 全链路） |
| DB / Auth / Cache 必需链路 | **PASS**（本地 prod，真实 Turso + Upstash） |
| OAuth 授权请求 + 回调拒绝 | **PASS 21/21**（真实成功回调 NOT_TESTED） |
| Provider 可用性 | **PASS**（生产）/ 本地诚实 BLOCKED |
| Cloudflare Worker 作为运行时 | **FAIL**——零绑定，静态能出、动态全崩（§4.1–4.3） |
| 无密钥泄漏 | **PASS** |

**Batch 1 判定：本地全栈链路 PASS；Preview 能部署、能出静态、但动态路由全 500；「把 Cloudflare 作为统一运行时」FAIL。**

**为什么从 BLOCKED 改判 FAIL**：上一版只能说「访问不到」，那是测量缺陷。现在能访问了，症状明确为 500，且根因已由「静态 200 / 动态 500 / `secrets=0`」三者闭合。**说不清原因的才叫 BLOCKED，说得清的是 FAIL。**

**修复路径（未执行，需一次授权）**：把 §2.2 的变量以 Cloudflare Secrets 注入 `lokfeel-preview`，再重跑一次 preview 部署。
但这里有一个不能绕过的安全问题：**这些是生产数据库与认证签名密钥**，注入到 `lokfeel-preview.aoshuang99.workers.dev` 等于开了一个
**公网无鉴权入口直连生产库**。因此本项**不能由工程侧单方面执行**，必须同时满足：
① 提供独立的预览库/预览签名密钥；或 ② 明确接受该风险并给出访问控制（Cloudflare Access）。
这条转成 `58` 的决策项 D-11。

> 边界说明：本轮**没有**为了「让 CF 看起来能用」而往 worker 里塞任何临时凭据，也没有把生产密钥写进任何 preview 环境。
