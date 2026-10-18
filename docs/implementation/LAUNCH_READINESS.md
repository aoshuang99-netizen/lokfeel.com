# 上线就绪清单（Launch Readiness）

> **一句话结论（2026-10-18）**
> 除**支付凭据**外，全部工程项已闭合并留在生产上可复验；
> 支付通道已实现为**「未接入即受支持」**的受测状态 —— 填上 4 个环境变量即开始收费，**零代码改动**。
>
> 判据不是这句话，是下面三条可复跑的命令（§4）。

- **代码基线**：`f8ec1ec`（= 生产产物；含 Redis 缓存写入修复）
- **生产**：`https://app.lokfeel.com`（Netlify `lokfeel` / site `c46478e9-7ac8-4bcf-9052-7638b04fef83` + Cloudflare DNS）
- **生产部署**：`6ad4a0cfb568` ← `f8ec1ec`，`state=ready` —— **生产产物 = main**。
  （之后的提交若只改文档/脚本/测试，会带 `[skip netlify]`，不再重建产物。）
- **环境变量**：生产共 **40** 个；支付相关 **0** 个（这是唯一缺口，见 §2）
- **支付状态**：`payments.configured=false`，`missing=[CREEM_API_KEY, CREEM_WEBHOOK_SECRET, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET]`

### 最近一次全量预检（2026-10-18 · `npm run check:launch`）

| 步骤 | 结果 |
|---|---|
| 支付未接入契约 | ✅ 18/18 |
| Upstash 写入契约（含变异对照） | ✅ 12/12 |
| 真实邮件送达（delivered + bounced 双证） | ✅ 5/5 |
| Google OAuth 配置（含畸变对照） | ✅ 7/7 |
| 生产登录→会话→ICE/TURN（自建自删） | ✅ 28/28（`source=cloudflare-realtime`，3 条 TURN） |
| 对外跳转域名 | ✅ 13/0 |
| 发版生效面 | ✅ 6/6 + 2/2 对照 |
| 依赖安全 / 漂移 / SLO | ✅ 3/3 |
| **合计** | **10 步全绿 · 107 条断言 · 退出码 0** |


## 1. 除支付外，已完成什么

| 维度 | 状态 | 证据（可复跑 / 可查） |
|---|---|---|
| 业务闭环 AC-01~AC-24 | ✅ 24 PASS / 0 FAIL（AC-25 为外部依赖） | `docs/implementation/FINAL_ACCEPTANCE_REPORT.md` §3 |
| 多租户隔离 | ✅ 应用级（libSQL 无 RLS） | `tests/tenancy` 120 例 · `verify:ac19:bridge` 越权六条 |
| 认证 / OAuth | ✅ **真实登录链路已自动化取证**（生产注册→登录→会话→受保护端点→删号复验 28/28） | `npm run verify:prod:session` → **28/28**（每次跑完 `User` 计数回到基线：12922→12922）· `node scripts/qa/verify-oauth-authorize.mjs` → **7/7**（Google 未报 `redirect_uri_mismatch`/`invalid_client`）· 生产匿名 API 一律 401 |
| 数据库 | ✅ Turso，C0–C9 全部就位 | `npm run connection:migrate -- verify` → 255/255 · 65 张表 |
| 缓存 / 限流 | ✅ Upstash（**写入/删除契约已真实往返验证**） | `/api/health` → `redis.backend=upstash, degraded=false` · `npm run verify:redis:contract` → 12/12（含旧写法变异对照） |
| 邮件通道 | ✅ **真实送达已取证**（Resend `last_event=delivered`，并配 `bounced` 变异对照） | `npm run verify:email:delivery` → 5/5 |
| 实时音视频（TURN） | ✅ **生产 ICE 已取数**：`source=cloudflare-realtime`，3 条 TURN 且带凭据 | `npm run verify:ice`（四来源齐备 + 优先级 `static → cloudflare-realtime → cloudflare → stun-only`）· 生产实测：匿名 **401**（有意）→ 登录后 **200**，`source=cloudflare-realtime`，3 条 `turns:` 且带凭据 · 回滚 `npm run turn:rollback` |
| 即时通讯 | ✅ Pusher + Upstash | `verify:pusher` · `tests/im-call-signaling` |
| 数据生命周期 | ✅ 导出 / 删除计划 / 执行删除 / 缓存失效 | `npm run verify:ac10:lifecycle` → 68/0 |
| 性能基线 | ✅ SLO 9 条规则 · 48/48 断言 | `npm run check:slo` · `PERFORMANCE_BASELINE.md` |
| 依赖安全（生产可达） | ✅ high 0 / critical 0 | `npm run check:deps` · `DEPENDENCY_RISK.md` §7 |
| CI 门禁 | ✅ 11 job（9 success + 2 skipped） | lint / deps / migration-drift 三道棘轮 + Jest + Build + E2E |
| **支付未接入时的行为** | ✅ **已受测**：503 + `PAYMENT_NOT_CONFIGURED`，`/api/health` 自报缺口 | `npm run verify:payment:off` · CI e2e job 已纳入 |

---

## 2. 唯一剩余动作：填 4 个环境变量

| 变量 | 作用 | 缺了会怎样 | 取哪里 |
|---|---|---|---|
| `CREEM_API_KEY` | 订阅结算（`/api/payments/creem/checkout`）+ 产品列表 | 订阅页显示「暂时不可用」，无法付费 | Creem Dashboard → API Keys（`creem_…`） |
| `CREEM_WEBHOOK_SECRET` | 订阅开通/续费/退订入账（验签） | 付款成功但**不会开通**（webhook 被拒） | Creem Dashboard → Webhooks → 签名密钥 |
| `STRIPE_SECRET_KEY` | 卡验证（SetupIntent）+ 管理员退款 | 卡验证 503；后台退款 503 | Stripe Dashboard → Developers → API keys（`sk_…`） |
| `STRIPE_WEBHOOK_SECRET` | 订阅/发票事件入账、退款对账 | 退款与记账事件被拒（400） | Stripe Dashboard → Webhooks → 端点 `whsec_…` |

可选（**不影响上线**）：`CREEM_MONTHLY_PRODUCT_ID` / `CREEM_YEARLY_PRODUCT_ID` —— 只服务旧的 `{plan}` 请求体；
订阅页走实时产品列表，用 `{productId}` 下单。

`CREEM_ENV` 已配置为 `production`。**它只接受 `production` / `test` 两个字面量**：
写错（`staging`、`TEST`）会**拒绝实例化**而不是静默打到生产 —— 这一条是为「以为在沙箱、其实在收真钱」设的闸。

> ⚠️ **接入前必须由业务方确认的一件事（工程无法代替）**
> `docs/PAYMENT-COMPLIANCE.md` 记录：公开检索到的条款显示 Creem 禁止「交友网站服务」类业务、
> Stripe 将在线交友列为受限类。**该结论未经法务复核**，但它是「选哪个通道」的前提。
> 工程侧已做到「支付无关化」：换通道只需替换 §2 的变量与对应 provider 适配层，不牵动业务代码。

---

## 3. 接入步骤（沙箱 → 真探测 → 生产）

```bash
# ① 写入本地（不提交）
#    .env.local 里填 4 个 test/live 凭据
#    CREEM_ENV=test        ← 沙箱先跑，别一上来就 live

# ② 离线体检：变量分类 + 契约漂移（不联网、不花钱）
npm run verify:payment:channel

# ③ 真实探测：只打只读端点，不创建会话、不产生费用
npm run verify:payment:channel -- --probe
#    默认拒绝 sk_live_；确需验证 live 时显式加 -- --probe --allow-live

# ④ 退款链路（Stripe test mode，真实 API）
npm run qa:refund:testmode -- sub_xxx

# ⑤ 写进生产并重新部署（Netlify）
#    Site settings → Environment variables → 逐个添加（scope: all）
#    或用 CLI：
#    netlify env:set CREEM_API_KEY "creem_xxx" --site c46478e9-7ac8-4bcf-9052-7638b04fef83
#    （4 个变量同理）→ 触发一次部署使新变量生效

# ⑥ 生产完成判据（三条，全绿才算接完）
curl -s "https://app.lokfeel.com/api/health?t=$(date +%s)" | python3 -m json.tool | sed -n '/"payments"/,/}/p'
#    → configured: true, charging: true, missing: []

curl -s -o /dev/null -w '%{http_code}\n' -X POST https://app.lokfeel.com/api/webhooks/stripe \
  -H 'stripe-signature: t=1,v1=deadbeef' -H 'content-type: application/json' -d '{}'
#    → 400（缺/错签名）。**不再是 503** —— 说明验签分支已接管，配置已生效

curl -s -o /dev/null -w '%{http_code}\n' https://app.lokfeel.com/api/payments/creem/products
#    → 200（未接入时是 503）
```

---

## 4. 完成判据（可复跑）

| # | 命令 | 期望 | 说明 |
|---|---|---|---|
| 1 | `npm run verify:payment:channel` | exit 0，`5/5 通道就绪` | 离线；凭据格式 + 7 个入口守卫未漂移 |
| 2 | `npm run verify:payment:channel -- --probe` | exit 0，两个 provider `HTTP 200` | 只读端点，零费用 |
| 3 | `curl /api/health` | `payments.configured=true` | 生产唯一权威判据（公开、免鉴权、不泄值） |
| 4 | `npm run verify:payment:off` | exit 1 | **接入后该脚本必须变红**（它断言的是「未接入」）—— 红即证明状态真的翻转了 |

> 第 4 条是**反向对照**：如果接完凭据后 `verify:payment:off` 还是绿的，说明配置没生效，
> 或守卫被绕过 —— 那才是更危险的情形。

---

## 4bis. 上线前的人工项：已全部自动化（剩 1 步无法脚本化）

> 2026-10-18 更新：原「必须人工点一遍的四件事」已用四个可复跑脚本替代。
> 唯一残留的是 **Google 同意页上点一下「继续」** —— 那一步需要真人身份，
> 但它**之前**的所有配置错误（client_id 错、redirect_uri 未登记、scope 未开）
> 都由 `verify-oauth:authorize` 直接问 Google 拿答案。

| # | 原人工项 | 现在的自动化 | 命令 | 结果 |
|---|---|---|---|---|
| 1 | 真实 Google 账号走完登录 → 进 dashboard | ① 用**生产注册接口**自建 QA 账号 → 取验证码 → 建号 → 密码登录 → 验会话 → 打受保护端点 → **删号并复验计数归零**；② 直接拿生产 client_id 请求 Google authorize，解码 `authError` | `npm run verify:prod:session`<br>`node scripts/qa/verify-oauth-authorize.mjs` | ✅ 28/28 · ✅ 7/7 |
| 2 | 收一封真实邮件 | Resend 真发到 `delivered@resend.dev`，轮询 `GET /emails/{id}` 的 `last_event`；同时发一封到 `bounced@resend.dev` 作**变异对照** | `npm run verify:email:delivery` | ✅ 5/5（delivered + bounced 双证） |
| 3 | 点一次 Upgrade | **支付凭据未接入，按约定不做**；未接入时的行为由 503 契约守住 | `npm run verify:payment:off` | ✅ 18/18 |
| 4 | 登录后确认 ICE 不是 `stun-only` | 同一会话直接打 `/api/rtc/ice-servers`，断言 source≠stun-only、含 `turns:`、带凭据、不泄密钥 | `npm run verify:prod:session` | ✅ `source=cloudflare-realtime`，3 条 TURN |

**仍然需要人做的**：打开 `/login` → 点「Continue with Google」→ 在 Google 页面上点同意。
这不是工程遗漏，而是 OAuth 的设计前提（人机确认无法被脚本合法代办）。

### 为什么这些脚本"跑完不留痕"

- `verify:prod:session` 在 `finally` 里删号：按 `pragma foreign_key_list` 实测的 **39 条外键**
  逐表清理，再断言 `User` 总数回到基线（实测 `12922 → 12922`）。中途失败也会尽量清理。
- `verify:email:delivery` 只发信，不创建任何业务数据。
- `verify:redis:cache` 的探针键带随机后缀，跑完即删。

---

## 4ter. 一条命令跑完全部可自动化门禁

```bash
npm run check:launch                 # 10 项（在线 7 + 离线 3）
npm run check:launch -- --offline    # 只跑离线（无凭据环境）
npm run check:launch -- --json=reports/launch.json --verbose
```

| # | 步骤 id | 验什么 | 断言 |
|---|---|---|---|
| 1 | `payment` | 7 个支付入口的「未接入」契约（503 + 稳定码，绝不 500） | 18 |
| 2 | `cache` | Upstash 写入/删除契约（真实往返 + 旧写法变异对照） | 12 |
| 3 | `email` | 真实邮件送达 + 退信对照 | 5 |
| 4 | `oauth` | Google 授权端点配置 + 畸变 client_id 对照 | 7 |
| 5 | `session` | 注册→登录→会话→受保护端点→ICE/TURN→删号复验 | 28 |
| 6 | `origin` | 对外跳转不含部署专用域名 | 13 |
| 7 | `surface` | 发版生效面（新路由已可达） | 6 |
| 8 | `deps` | 生产可达依赖 high/critical = 0 | — |
| 9 | `drift` | schema ↔ 生产库逐列比对（`db push` 会删的列全部列出） | — |
| 10 | `slo` | 性能 SLO 规则 | — |

退出码：`0` 全绿 · `1` 有失败 · `2` 有步骤无法取证（前置不可用）。
脚本还会检测「断言数少于预期」并提示 —— 防止某个步骤被提前短路却仍显示绿色。

---

## 5. 「未接入」为什么是受支持状态（而不是待办）

代码里 7 个支付入口共用一套判定（`src/lib/payments/availability.ts`）：

| 入口 | 未接入时 | 接入后 |
|---|---|---|
| `GET /api/payments/creem/products` | **503** `PAYMENT_NOT_CONFIGURED` | 200 产品列表（provider 故障则 502） |
| `POST /api/payments/creem/checkout` | 401（未登录）/ **503**（已登录） | 创建会话 → 跳转 |
| `POST /api/webhooks/creem` | **503**（生产环境） | 验签 → 入账 |
| `POST /api/webhooks/stripe` | **503** | 验签 → 入账（缺签名 400） |
| `POST /api/payments/verify-card` | **503** | SetupIntent |
| `POST /api/payments/confirm-verification` | **503** | 置 `cardVerified` |
| `POST /api/admin/subscriptions/:id/refund` | 401（未登录）/ **503**（管理员） | 退款 |

设计要点：
- **503 不是 500**：500 会被监控记成「服务端故障」，把「还没接」误报成事故；503 + 稳定码可被精确区分。
- **`/api/health` 自报缺口**：`payments.missing` 只回**变量名**，不回值（公开端点）。有断言钉住。
- **前端不出现死按钮**：订阅页按错误码显示「暂时不可用」，产品卡片整块不渲染。
- **CI 门禁**：e2e job（构建产物、无支付凭据）跑 `verify-payment-off.mjs`，把 503 写回 500 会立刻判红。

---

## 6. 回滚（接入之后出问题）

| 情形 | 动作 | 影响 |
|---|---|---|
| 凭据填错 / 通道被风控 | 删除对应环境变量 → 重新部署 | 回到「未接入」：入口 503，订阅页显示「暂时不可用」，**不影响登录/匹配/IM/视频** |
| 只想暂停收费 | 删 `CREEM_API_KEY` | `charging=false`，其余功能不变 |
| 代码回滚 | Netlify → Deploys → 回退到上一个 ready | 与变量改动互不依赖 |

**没有数据迁移、没有 schema 变更** —— 支付接入是纯粹的配置动作。

---

## 7. 已知边界（不阻塞上线，已登记）

| 项 | 状态 | 影响 |
|---|---|---|
| AC-25 付费价值 | ⛔ BLOCKED | 无真实试点客户 ⇒ 商业指标无法验收（外部依赖，不可 mock） |
| 11 张表 `organizationId` 未建模 | 🟡 | `prisma db push` 会删列；已冻结为漂移棘轮，`reviewBy=2026-12-15` |
| 隔离为应用级非 DB 级 | 🟡 | 迁 PG + RLS 前，跨租户隔离依赖 `withTenant` |
| dev 工具链 5 条 high | 🟡 | `braces` 等无上游修复版；dev-only，不进产物；生产侧 0/0 |
| Stripe live 语义未验 | 🟡 | 无 `sk_live_`；退款链路已用**真实 SDK + 真实 HTTP**在协议层验证（19 断言） |
| 邮件真实外发 | 🟡 | 变量已在生产，未做一次真实发送 |
| 生产性能 | 🟡 | 本地弱机基线；跨境 RTT / 冷启未测 |

---

## 8. 变更记录

| 日期 | 变更 |
|---|---|
| 2026-10-18（晚） | **全部人工项自动化**：新增 `verify:prod:session`（28）、`verify:redis:contract`（12）、`verify:email:delivery`（5）、`verify-oauth-authorize`（7）、`verify-schema-drift`（直连比对），并编排为 `npm run check:launch`（10 步 / 107 断言）。**同期修掉生产 P0**：Upstash SET 参数形态错误导致登录用户第二个鉴权请求起全线 401、DEL 用错方法导致失效空转（见 BACKLOG §7terdecies）。 |
| 2026-10-18 | 首次生成。新增 `src/lib/payments/availability.ts`（单一判定）+ `not-configured.ts`（503 统一出口），7 个入口收敛同一语义；`CREEM_ENV` 误配 fail-closed；`/api/health` 暴露 `payments` 接入进度；新增单测、`verify:payment:channel`、`verify:payment:off` 与 CI 门禁。 |
