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

| Worker | `modified_on` | 说明 |
|---|---|---|
| `lokfeel-preview` | **2026-11-06T08:34:48Z** | 本轮 RC push 触发的新部署，version `34eaafc4-682a-4f37-9a1a-f9eb1ac153a2` |
| `lokfeel-app` | 2026-11-06T03:26:46Z | **未变** ⇒ 生产 worker 未被 preview 覆盖 |

Zone：`lokfeel.com`（`76bdd5ac9efcf5a612ee4b6269b06a2a`）状态 `active`。
`workers.dev` 子域：`lokfeel-app` / `lokfeel-preview` 均 `enabled=true`。

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
| 11 | OAuth 回调 | — | **NOT_TESTED** | 需真实第三方授权交互，本轮未做 |
| 12 | Preview HTTP 实测 | CF Workers | **BLOCKED** | 本地网络无法访问 `*.workers.dev`（代理 502 / 直连超时）；worker 侧 `enabled=true` |
| 13 | 异常日志与追踪 | — | **BLOCKED** | 无 Workers Logs / Tail 访问；Sentry 未在本轮核对 |
| 14 | 无 Stub Provider 进生产构建 | 生产 | **PASS** | 生产 `provider=workbuddy`（非 `stub`/`none`）；本地缺凭据时诚实降级为 `none` 而非伪造 |
| 15 | 无密钥泄漏 | 仓库 | **PASS** | 全部 `.env*` 均 ignored、历史零提交（详见 `57`） |

---

## 5. 支付状态（与发布边界一致）

`/api/health` 返回：`payments.configured=false`、`charging=false`。

与 V20.4「支付与法律未闭合时保持关闭」的要求一致。**未做任何真实扣款**。

---

## 6. 本批次结论

| 验收项 | 判定 |
|---|---|
| Preview 部署成功 | **PASS**（run `42188252454`；worker version `34eaafc4`） |
| Preview 与候选 SHA 一致 | **PASS**（部署由 `rc/v20.4@e5fa762` 的 push 触发） |
| HTTP 及业务 API 有真实响应 | **PASS**（本地 prod 全链路） |
| DB / Auth / Cache 必需链路 | **PASS**（本地 prod，真实 Turso + Upstash） |
| OAuth 回调 | **NOT_TESTED** |
| Provider 可用性 | **PASS**（生产）/ 本地诚实 BLOCKED |
| Cloudflare Worker 作为运行时 | **BLOCKED**——零绑定，无法承载业务 |
| 无密钥泄漏 | **PASS** |

**Batch 1 判定：本地全栈链路 PASS；「把 Cloudflare 作为统一运行时」这一目标 BLOCKED。**

**为什么 BLOCKED 而不是 FAIL**：不是配置写错了，而是**从未注入**。要恢复，必须把 §2.2 的变量以 Cloudflare Secrets 形式注入 `lokfeel-app`，并确认 Turso / Upstash 从 CF 边缘可达。这一步需要凭据与一次真实发布授权，属于外部依赖，本轮不动。

> 边界说明：本轮**没有**为了「让 CF 看起来能用」而往 worker 里塞任何临时凭据。
