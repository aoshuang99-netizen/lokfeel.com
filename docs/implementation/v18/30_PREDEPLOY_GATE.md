# 发布前最终门禁（WB18-30）

> 一页回答一个问题：**现在按 Runbook 发版，会不会把已经验证过的东西搞坏？**
> 本文只写可复算的事实与命令。取不到的值写 `UNKNOWN`，不写估计值。

- 核验时间：2026-10-23 07:00–08:20Z
- 发布候选（Release SHA）：**批准时 `main` 的 HEAD**
  - 本文核验时 = `ff23b23`：它是 `bba8c36`（E2E 27 条全绿的那一版）+ 2 个**纯文档**提交，代码零差异
  - 判据不写死 SHA，而是：**`/api/health.commit` 必须等于你实际推送的那一个**
- 生产现行（Production Commit）：`dc102cd`
- 生产域名：`app.lokfeel.com`（Netlify `lokfeel.netlify.app` + Cloudflare 代理）

---

## 1. 判定摘要

| 项 | 结论 | 依据 |
|---|---|---|
| HEAD 与远端一致 | **PASS** | 核验时本地 `ff23b23` == `origin/main`（`git rev-parse` / `ls-remote` 核对）。判据是这条等式成立，不是某个具体 SHA |
| 工作树干净 | **PASS** | `git status --short` 空 |
| 发布候选 CI | **PASS** | 见 §3.1：17 项 **15 成功 / 2 跳过 / 0 失败**，含 E2E 浏览器冒烟 success |
| 需要数据库迁移 | **不需要** | `git diff dc102cd..bba8c36 -- prisma/` = **0 文件**，迁移脚本 = **0 文件** |
| 回滚目标可用 | **PASS** | 部署 `6ad85eb3122dcb59f86a64c3`（`dc102cd`，state=ready） |
| **是否可发** | **工程侧 GO / 授权侧 BLOCKED** | `D-10` 未批准 ⇒ **不执行部署** |

> 一句话：**工程上已经没有"不知道该怎么做"的部分了；剩下的是"谁点头"。**

---

## 2. 事实快照

### 2.1 代码

| 项 | 值 |
|---|---|
| `git rev-parse HEAD`（核验时） | `ff23b23` |
| `git ls-remote origin refs/heads/main`（核验时） | 同上（`ff23b23`） |
| 工作树 | 干净（无未提交改动） |
| 与生产差距 | **47 个提交 / 110 个文件 / +16,262 −487** |
| `prisma/` 差异 | `git diff --stat dc102cd..HEAD -- prisma/` = **空** |
| 迁移脚本差异 | `git diff --name-only dc102cd..HEAD -- scripts/tenancy scripts/connection \| wc -l` = **0** |

### 2.2 生产构建身份（发布前基线）

```json
{ "status": "healthy", "dbLatency": 4770, "version": "unknown" }
```

- **没有 `commit` 字段** ⇒ 这正是 OPS-11 要解决的那件事，也是"发布成功"最硬的判据：
  **发布前它不存在，发布后它必须等于 `ff23b23`。**
- `version: "unknown"` 是旧实现的证据（读 `npm_package_version`，Netlify 直接起 Node ⇒ 恒为 unknown）。
- 首次读到的 `dbLatency: 4770` **不是缓存假象**：随后连打三次得到 `138 / 10 / 6`ms。
  响应头是 `cache-control: no-store,max-age=0` + `cf-cache-status: DYNAMIC`。
  所以 4770ms 是**冷启动时第一次连远程 Turso** 的真实成本 —— 这条对 WB18-36 有用（见 §5）。

### 2.3 关键路由（发布前）

| 路由 | 状态 | 说明 |
|---|---|---|
| `/` | 200 | 3.0s（curl 总耗时，非 lab 条件） |
| `/login` | 200 | `cache-control: public` ← **本轮修掉的缺陷** |
| `/pricing` | **307 → `/pay.html`** | HEAD 已修；生产仍是旧行为 |
| `/pay.html` | 200 | 独立业务入口，保留 |
| `/refunds` | 200 | |
| `/hlua` | **404** | HEAD 已建页；生产仍是 404 |
| `/workspace` | 307 → `/login?callbackUrl=%2Fworkspace` | 匿名正确 |
| `/console` | 307 → `/login?callbackUrl=%2Fconsole` | 匿名正确 |
| `/api/payments/cancel` | **404** | HEAD 已有；生产 404 ⇒ 也是"版本真的换了"的第二证据 |

> ⚠️ `/pricing` 307、`/hlua` 404、`/api/payments/cancel` 404 **不是缺陷**，
> 是"HEAD 修好了但还没发"。发布后这三条应当分别变成 **200 / 200 / 401（匿名）**。

### 2.4 环境变量（只列存在性，不输出值）

Netlify 站点级共 **44** 个变量。与发布相关的关键项：

| 分组 | 存在 | 缺失 |
|---|---|---|
| 数据库 | `DATABASE_URL`、`TURSO_AUTH_TOKEN` | — |
| 认证 | `AUTH_SECRET`、`AUTH_URL`、`NEXTAUTH_URL`、`GOOGLE_CLIENT_ID/SECRET`、`TWITTER_CLIENT_ID` | — |
| 缓存 | `UPSTASH_REDIS_REST_URL/TOKEN` | — |
| 邮件 | `RESEND_API_KEY` | — |
| AI | `WORKBUDDY_LLM_ENDPOINT/KEY/MODEL` | — |
| 实时 | `PUSHER_*`、`TURN_*` | — |
| **支付** | — | **`CREEM_API_KEY`、`CREEM_WEBHOOK_SECRET`、`STRIPE_SECRET_KEY`、`STRIPE_WEBHOOK_SECRET`** |

**支付四键缺失是"设计如此"，不是故障**：`/api/health.payments` 自报
`configured:false / charging:false` 并列出这 4 个名字，7 个结账入口统一 503 + `PAYMENT_NOT_CONFIGURED`。
🔴 发布**不得**顺手补上这 4 个变量 —— 那会让"免费受控 Beta"变成"未验收就收费"。

### 2.5 数据库

- schema 与迁移脚本差异均为 **0** ⇒ 本次发布**不需要**任何 `prisma migrate` / `db push`。
- 发布铁律不变：**先迁移后发版**。本次的"迁移"是空操作，所以顺序风险为零。

### 2.6 回滚标识

| 项 | 值 |
|---|---|
| 当前生产部署 ID | `6ad85eb3122dcb59f86a64c3` |
| 对应提交 | `dc102cd` |
| 时间 / 状态 | 2026-10-21T06:41Z / `ready` |
| 回滚方式 A | Netlify 控制台对该部署点 **Restore deploy** |
| 回滚方式 B | `git revert <release-sha>` 后推送（触发新构建，约 3–5 分钟） |
| 注意 | 同站上一个部署 `5151513`（06:35Z）是 **error** 状态 ⇒ 这个站点的构建**失败过**，回滚要确认构建成功再宣布完成 |

### 2.7 错误率基线

**UNKNOWN**。理由：Sentry 已接入（`withSentryConfig`），但本会话没有 Sentry 读取凭据，
无法取发布前 24h 的错误计数。**不编一个数字。**
发布后以 `/api/health` + 路由状态码为最小可观测量，Sentry 基线待有凭据时补。

---

## 3. Runbook 九条前置逐条核验

| # | 判据 | 结论 | 证据 |
|---|---|---|---|
| 1 | 头提交 CI 全绿 | **PASS**（`bba8c36`，代码与 HEAD 相同） | 17 项 **15 成功 / 2 跳过（Perf 手动、DCO）/ 0 失败**；另有 CodeQL run `39920104205` success。Lint 15:53:05→15:54:39 success ⇒ W02 里"Lint 仍在跑"的疑问已闭合。`bba8c36` 之后的 3 个提交**只改文档**，同样带 `[skip netlify]` |
| 2 | 构建身份可读 | **PASS（逻辑）/ 待发布复验** | `tests/lib/build-info.test.ts` 覆盖非法 SHA→unknown；CI Build 通过。生产出现 `commit` 字段只能在发布后验证 |
| 3 | 验收台账不漂移 | **PASS** | `npm run check:acceptance` → `42 条 = 29 PASS / 0 FAIL / 13 BLOCKED` |
| 4 | 商业契约不串线 | **PASS** | `npm run check:products` → **5/5**（含 9 条自证）；本轮被 R2 抓过一次并已修 |
| 5 | 未接入支付仍是合法状态 | **PASS** | `/api/health.payments.configured=false`、`missing` 恰为 4 个键；CI `支付凭据灌注自证` success |
| 6 | 双组织隔离是行为级证据 | **PASS** | CI `租户作用域审计（跨租户风险）` success；Jest 内 `withTenant` 真相表与 `discloseSubject()` fail-closed 用例 |
| 7 | 移动端无溢出、触控 ≥24px | **PASS（85 条全绿，含 4 视口 legacy）** | 见 §3.1 |
| 8 | 数据库无待迁移差异 | **PASS** | §2.5；CI `Migration`（含 `schema 漂移棘轮`）success |
| 9 | 服务端认证导航通 | **PASS** | CI `认证面导航契约探针`（纯 HTTP 3 轮）success |

### 3.1 E2E 用例数的变化（本轮）

| 组 | `d922bf9` | `bba8c36`（E2E 实跑于此） | 构成 |
|---|---|---|---|
| 公开面移动端 | 12 | 12 | 2 视口 × 6 路由 |
| 认证面 9 屏 | 18 | 18 | globalSetup + storageState |
| `/workspace` 页签 | 12 | 12 | 2 视口 × 6 页签，每页签先证 `aria-current` 转移 |
| **legacy B2C 版面** | 0 | **24** | **4 视口 × 6 屏**（WB18-34） |
| legacy 交互探针 | 0 | **3** | 只读（资料编辑 / 连接空态 CTA / 聊天出路） |
| **认证页缓存头** | 0 | **10** | 7 个认证入口 + `/api/health` + `/api/auth/session` + `/` 反证 |
| **合计** | **42** | **85** | 2×(6+9+6) + 6 + 27 + 10 |

> ⚠️ **85 是静态枚举值**：对 6 个 spec 文件的数组长度与循环结构逐个数出来的
> （`VIEWPORTS`=2、`ROUTES`=6、`AUTHED_ROUTES`=9、`VIEWS`=6、`LEGACY_VIEWPORTS`=4 ×
> `LEGACY_ROUTES`=6 + 3 探针、`AUTH_ENTRY`=7 + 3）。
> CI 的 `passed` 计数在**无 token 时读不到**（job log 需 admin、Playwright 报告是需鉴权的 artifact），
> 所以这里不写"CI 报告 85 passed"，只写"结构上共 85 条，且 E2E job 的结论是 success"。
> 上一版本文写「78 条」，是当时把缓存组误记为 8 条（实际 10 条：7+2+1）导致的估算偏差，
> `35_AUTH_NAVIGATION_STABILITY.md` 已同步更正。

> 用例变多不等于更严格，但这一轮的三组各自守的是**之前完全没有证据**的地方：
> legacy 线一条版面证据都没有、认证页缓存策略从没人验过。

---

## 4. 本轮新发现的发布风险（发布前必须知道）

1. **认证入口页被公共缓存**（已修，待发布生效）
   `next.config.ts` 给 `/login`、`/register` 写了 `public, s-maxage=300`，
   而这两个页面会 `await auth()` 并据此 `redirect()`。生产实测 `age` 从 106 涨到 193、
   `/register` 的 `age` 是 173745（≈ 部署至今）。详见 `35_AUTH_NAVIGATION_STABILITY.md`。

2. **发布后 `/login` 与 `/register` 的响应头会变**
   从 `public` 变成 `private, no-store`。如果有外部监控/探针依赖旧值，需要在发布后复核一次。

3. **首页 `age: 173686`**
   同一份部署内，`/` 的边缘缓存年龄接近 48 小时。这不影响发布（新部署会生成新的缓存条目），
   但说明"改了首页文案要等 CDN"这件事在这个站是真实存在的。

4. **冷启动的 DB 首次连接约 4.8s**
   第一次请求打到空闲函数时，`dbLatency` 实测 4770ms（随后 138/10/6ms）。
   发布后的第一波访问会踩到这个，**不要把它当成"发布把库搞坏了"**。

---

## 5. 发布时人工必须盯的 5 件事

1. 发版提交的**标题与正文都不能**出现 `[skip netlify]`（否则 Netlify 不构建）。
2. 构建日志里 `next build` 的 `Compiled successfully` 与 Netlify 的 `Deploy is live`。
3. 部署完成后立刻 `curl -s https://app.lokfeel.com/api/health`，**`commit` 必须等于 `ff23b23`**。
   只要这一条不成立，后面所有"看起来正常"都不算数。
4. `/pricing` 必须 200（不再 307 到 Hlua Pass）、`/hlua` 必须 200。
5. 前 10 分钟盯 5xx 与函数冷启动（预期首批请求 3–5s，属正常）。

---

## 6. 没做到的（不粉饰）

| 项 | 状态 | 原因 |
|---|---|---|
| 生产错误率基线 | **UNKNOWN** | 无 Sentry 读取凭据 |
| 发布后五项冒烟 | **未执行** | `D-10` 未批准，生产仍是 `dc102cd`（见 `32_PRODUCTION_SMOKE_EVIDENCE.md` 的前置条件） |
| 1440 桌面触控尺寸 | **已覆盖**（不再是缺口） | 本轮改为**四视口同一把尺子**，1440 也判红；当时只报出页脚 4 个 16px 链接，已修。原表格写"桌面只统计不判红"是**过期表述**，代码里那段 annotation 分支本就是死代码 —— 见 `34_LEGACY_MOBILE_AUDIT.md` §2 |
| `/dashboard/chats/[roomId]` 聊天输入区 | **仍无证据** | 夹具没有真实会话 + 长连接页面无法稳定测量 ⇒ UX-08 继续 BLOCKED 的**唯一**剩余项 |
| 真实扣款 | **NOT_APPLICABLE** | 支付四键缺失，属设计 |

---

## 7. 结论

**工程侧：GO。** 九条前置全部成立，且不需要数据库迁移，回滚路径有具体部署 ID。

**执行侧：BLOCKED。** `D-10` 未获批准，本轮**不部署**。
`22_RELEASE_RUNBOOK.md` §3 的动作清单已经可以照着执行；
一旦批准，从"开始发布"到"`commit` 字段等于 `ff23b23`"预计 5–8 分钟（含构建）。
