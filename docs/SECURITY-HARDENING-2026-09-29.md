# 生产暴露面收敛与运维风险处置方案

> 2026-09-29 · 基线 `f629aeed`（Netlify deploy 已 ready，`/api/health` healthy）
> 本文所有结论均来自实测（HTTP 探测 / GitHub API / Netlify API / git），非推断。

---

## 一、本轮已修

### 1.1 生产环境 10 个调试/测试页裸奔

扫描方式：`public/**` 静态资源 + `src/app/**` 路由页，逐个用 `git grep` 查引用，再对线上发 HTTP 请求确认。

| 路径 | 线上 | 代码引用 | 处置 |
|---|---|---|---|
| `/firebase-diagnostic.html` | 200 | 0 | **删除**（内含硬编码 Google API Key） |
| `/auth-diagnostic.html` | 200 | 0 | **删除** |
| `/gis-diagnostic.html` | 200 | 0 | **删除** |
| `/oauth-debug.html` | 200 | 0 | **删除** |
| `/test-apis.html` | 200 | 0 | **删除** |
| `/admin-test-panel.html` | 200 | 0 | **删除**（"Admin Dashboard V3 功能测试面板"） |
| `/test/e2e-panel.html` | 200 | 0 | **删除**（Creem 全流程测试面板） |
| `/test/mock-payment.html` | 200 | 1 | **保留**（见下） |
| `/debug/google-oauth` | 200 | 0 | **加服务端 admin 守卫** |
| `/admin-test` | 200 | 0 | **加服务端 admin 守卫** |

**为什么保留 `mock-payment.html`**：`src/app/api/test/mock-checkout/route.ts:101` 会生成
`${appUrl}/test/mock-payment?session_id=…`，是本地 mock 支付流程的一环。且它在线上是**惰性的**：

- 它调用的 `POST/PATCH /api/test/mock-checkout` 三个导出方法**均有** `NODE_ENV === "production"` 守卫（线上实测 404）
- `/api/webhooks/creem` 的 mock 旁路已被 `allowMock = !isProd && !webhookSecret` 关死
  （`route.ts:37-41`，对 mock 签名头直接 401）
- 即：线上保留该文件不构成可利用路径，删除反而破坏开发流程

**为什么对 `/debug` 与 `/admin-test` 用守卫而非删除**：仓库已有现成范式
`src/app/(admin)/layout.tsx` —— 服务端组件，先查 `admin_session` cookie，再回退 NextAuth，
否则 `redirect("/admin-login")`。新增的 `src/app/debug/layout.tsx` 与
`src/app/admin-test/layout.tsx` **逐行复用该逻辑**，未引入任何新鉴权机制，
既能封住公网访问，又保留运维/QA 能力（`/admin-login` 线上实测 200，重定向目标有效）。

### 1.2 GitHub 密钥告警 #1

- 位置：`public/firebase-diagnostic.html:85`（提交 `e7986495`），`secret_type=google_api_key`，
  `publicly_leaked=true`，自 **2026-05-09** 挂至今日未处理。
- **关键判断**：这个 key 本来就是**公开的** —— `/api/config/firebase`（未鉴权，实测 200）
  主动把同一份 `apiKey/authDomain/projectId/appId` 下发给浏览器。所以重点不是"撤 key"，而是**给 key 加限制**。
- 本轮已做：删除仓库中该文件（唯一的硬编码副本）。
- 待用户操作：Google Cloud Console 中为该 key 加 **API 限制**（Identity Toolkit、Token Service 等）
  + **HTTP referrer 限制**（`https://app.lokfeel.com/*`、`https://lokfeel.com/*`）。
  完成后可将告警 #1 标记为 resolved（删除 HEAD 不影响历史 blob，历史改写对公开仓库不值当）。

### 1.3 "git push 全败"是误判 —— 实为间歇性网络

| 证据 | 结果 |
|---|---|
| `GIT_CURL_VERBOSE=1 git ls-remote` | CONNECT 隧道 **200**、TLS 1.3 握手**成功**、请求已发出 → 79 秒后 `Empty reply from server` |
| 同 URL 两轮探测 | 第 1 轮 `000`(10s) / 第 2 轮 **`200`(0.87s)** |
| `github.com/git/git.git/info/refs`（公开仓库） | 同样超时 → **非本仓库问题** |
| 其他主机 | `api.github.com` 200、`codeload.github.com` 301、`raw.githubusercontent.com` **000** |

结论：CN 网络对 GitHub 特定路径的**间歇性干扰**，不是权限/配置问题。
**对策 = 重试**：`for i in 1 2 3 …; do git fetch && break; sleep 3; done` —— 实测一次就成功。

**副作用修正**：此前为绕开该问题改走 Git Data API 推送，代价是 GitHub 规范化时区
（`+0800`→`+0000`）并去掉消息尾换行，导致本地/远端 **sha 分叉（树一致）**。
现已 `git fetch` 成功并对齐：

```
origin/main = f629aee   tree = 5e275324d259e4a218e2f1174e979599d62e802a
本地 HEAD    = f629aee   tree = 5e275324d259e4a218e2f1174e979599d62e802a
git diff origin/main HEAD  →  空
```

**Git Data API 兜底路径废弃**（得不偿失；重试足够）。

---

## 二、待决策事项

### D1 · Netlify 额度兜底（最高优先）

| 证据字段 | 实测值 | 含义 |
|---|---|---|
| `auto_topup_enabled` | **False** | 额度耗尽仍会**整站 503**（2026-09-29 真实事故的根因，未消除） |
| `credit_alert_percentage` | **None** | 无额度告警 |
| `plan_credits` / `credits.used` | 1000 / **0** | 新周期 9/29→10/29，满额 |
| `has_stripe_payment_method` | **True** | 支付方式已绑定，具备开自动充值条件 |
| `plan_auto_topup_amount` / `per_unit_cost` | 500.00 / 0.01 | 触发即充 500 credits（≈$5） |
| `lifecycle_state` / `usages_exceeded` | active / `[]` | 当前健康 |

**动作**：① 打开 auto topup；② 设额度告警阈值（如 80%）。
**说明**：这是计费动作，需你确认后再执行（技术上可通过 API 写 `auto_topup_enabled`）。

### D2 · 泄漏凭证吊销

- **Vercel token** —— 合并 `drag-19` 时被 GitHub Push Protection 拦下的那个（提交 `3829146`，
  已随压缩提交从历史移除，但 token 本身仍应视为已泄漏）
- **只读 fine-grained PAT** —— `github_pat_11B7FHZ…`（已验证只读、无法推送，但仍在流通）
- 需你在各自控制台吊销。

### D3 · 5 个 dependabot PR 攒批（建议与 D4 同批发）

| PR | 变更 | 判断 |
|---|---|---|
| #17 | eslint 9 → 10 | 需验证新规则报错 |
| #18 | framer-motion 12 → 13 | ⚠️ 该仓库有 **swipe-card drag 回归**前科，须单独回归 |
| #19 | @types/node 20 → **26** | ❌ 版本选错，应改 **22.x**（构建运行时是 Node 22） |
| #20 | @sentry/nextjs 10 → 11 | 需验证初始化 |
| #21 | webrtc-adapter 8 → 9 | 需验证 WebRTC 通话 |

**成本**：本地攒批 + 单次 push = **15 credits**（逐个合 = 5×15 = 75）。

### D4 · 生产安全响应头（当前一条都没有）

`public/_headers` 仅有一条 `_next/static` 缓存规则；全仓库 `git grep` **无**
`X-Frame-Options` / `Content-Security-Policy`。

建议（风险已评估）：

```
/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: SAMEORIGIN
  Permissions-Policy: camera=(self), microphone=(self), geolocation=(self)
```

风险评估：全仓唯一 `<iframe>` 是 `src/app/layout.tsx:154` 的 **GTM noscript**（我们嵌别人，
不影响被嵌）；WebRTC 视频通话与地理围栏均**同源**，故 `camera/microphone/geolocation=(self)` 不破坏功能。
**故意不加 CSP** —— Next.js 内联脚本多，贸然上 CSP 会白屏。

### D5 · 生产 Redis 未配置

`/api/health` → `redis: { backend: "memory", configured: false }`。
多实例下速率限制与缓存不共享。需 Upstash 凭证；`check:redis` 17 项门禁已就绪。

### D6 · 生产残留 debug/test API（15 条）

已逐条核实守卫，结论是**当前无未授权可利用项**：

| 路由 | 守卫 |
|---|---|
| `/api/test/mock-checkout`（POST/GET/PATCH） | `NODE_ENV==='production'` → 404 |
| `/api/test/run-e2e` | `CRON_SECRET`（实测 401） |
| `/api/admin/generate-test-users` | `withPermission` |
| `/api/diagnostic/firebase` | `requireAdminAuth`（实测 403） |
| `/api/debug/*`（9 条） | `requireAdminAuth`（实测 403） |

可选加固：Netlify `_redirects` 在生产屏蔽 `/api/debug/*`、`/api/test/*`（dev 不走 `_redirects`，
不影响本地）。**但 `/api/diagnostic/firebase` 建议保留** —— 它是排障时要用的探针。

---

## 三、验证基线

| 检查 | 结果 |
|---|---|
| `tsc --noEmit` | 0 错误 |
| `chat:invariants` / `chat:refs` / `verify:bot` / `verify:geo` / `check:redis` | 全绿（222 / 0 阻断 / 111 / 67 / 17） |
| 首页 | 200 |
| `/api/health` | `healthy`，`dbLatency ≈ 296ms`，`botModule.enabled=true (env)`，`firebaseAdmin{sdkLoaded/configured/initialized=true, appCount=1}` |
| 已删页面 | 404 |
| `/debug/google-oauth`、`/admin-test` | 307 → `/admin-login` |

---

## 四、行动清单

| # | 谁 | 事项 | 验收 |
|---|---|---|---|
| 1 | 已完成 | 删除 7 个孤儿调试页 + 2 个路由加 admin 守卫 | 上线后 404 / 307 |
| 2 | **你** | Netlify 开 auto topup + 额度告警（D1） | 账户 `auto_topup_enabled=true` |
| 3 | **你** | Google Cloud Console 给 Firebase web key 加 referrer/API 限制（1.2） | 完成后我关掉 GitHub 告警 #1 |
| 4 | **你** | 吊销 Vercel token 与只读 fine-grained PAT（D2） | 两处控制台均无该凭证 |
| 5 | 我 | dependabot 5 PR 攒批 + 安全响应头，单次发版（D3+D4） | 门禁全绿 + 生产验证 |
| 6 | 待定 | Redis 凭证接入（D5） | `redis.configured=true` |
| 7 | 待定 | `_redirects` 屏蔽生产 debug API（D6） | `/api/debug/*` → 404 |
