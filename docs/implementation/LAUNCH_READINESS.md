# 上线就绪清单（Launch Readiness）

> **一句话结论（2026-10-18）**
> 除**支付凭据**外，全部工程项已闭合并留在生产上可复验；
> 支付通道已实现为**「未接入即受支持」**的受测状态 —— 填上 4 个环境变量即开始收费，**零代码改动**。
>
> 判据不是这句话，是下面三条可复跑的命令（§4）。

- **代码基线**：`17fa159`（本文件所在提交）
- **生产**：`https://app.lokfeel.com`（Netlify `lokfeel` / site `c46478e9-7ac8-4bcf-9052-7638b04fef83` + Cloudflare DNS）
- **生产部署**：`6ad496cc45dad08b37f9d444` ← `17fa159`，`state=ready`（75s）
- **环境变量**：生产共 **40** 个；支付相关 **0** 个（这是唯一缺口，见 §2）
- **支付状态**：`payments.configured=false`，`missing=[CREEM_API_KEY, CREEM_WEBHOOK_SECRET, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET]`

### 本次发版的生产实证（2026-10-18）

| 复验项 | 命令 | 结果 |
|---|---|---|
| 支付缺口可观测 | `curl /api/health` | ✅ 200 healthy · `payments.configured=false` · 4 个缺失变量名精确列出 · `malformed=[]` |
| payment-off 契约 | `node scripts/qa/verify-payment-off.mjs --base=https://app.lokfeel.com` | ✅ **18/18 通过**（products 503、两个 webhook 503、checkout/refund 401、**零 500**、无凭据片段） |
| 发版生效面 | `npm run verify:released:surface` | ✅ **6/6 达期望 + 2/2 正向对照** |
| 对外跳转域名 | `node scripts/qa/verify-public-origin.mjs` | ✅ **13 通过 / 0 失败**（0 处部署域名泄漏） |
| 缓存 / 限流后端 | `/api/health` | ✅ `redis.backend=upstash, degraded=false` |

---

## 1. 除支付外，已完成什么

| 维度 | 状态 | 证据（可复跑 / 可查） |
|---|---|---|
| 业务闭环 AC-01~AC-24 | ✅ 24 PASS / 0 FAIL（AC-25 为外部依赖） | `docs/implementation/FINAL_ACCEPTANCE_REPORT.md` §3 |
| 多租户隔离 | ✅ 应用级（libSQL 无 RLS） | `tests/tenancy` 120 例 · `verify:ac19:bridge` 越权六条 |
| 认证 / OAuth | ✅ 跳转与守卫已验；**真实登录建议人工点一次** | `verify-public-origin` 13/0（Google `redirect_uri` 落在公开域名）· 生产匿名 API 一律 401 · ⚠️ 生产 QA 账号已于 2026-10-17 清理，最后一次**真实登录**取证为 2026-10-16（`verify:agent:connectivity:server` 22/0） |
| 数据库 | ✅ Turso，C0–C9 全部就位 | `npm run connection:migrate -- verify` → 255/255 · 65 张表 |
| 缓存 / 限流 | ✅ Upstash | `/api/health` → `redis.backend=upstash, degraded=false` · `check:redis` 17/17 |
| 邮件通道 | 🟡 生产已配 `RESEND_API_KEY`（变量存在），**未做真实外发冒烟** | `scripts/qa/verify-email-channel.mjs --send you@…` 可当场补证 |
| 实时音视频 | ✅ TURN 已激活（Cloudflare Realtime） | `/api/health` → `source=cloudflare-realtime` · 回滚 `npm run turn:rollback` |
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

## 4bis. 上线前建议人工点一遍的三件事

工程能自动验的都验了；下面三件**必须由人来点**（自动化会打到真实用户或真实收款）：

| # | 动作 | 为什么自动化替代不了 |
|---|---|---|
| 1 | 用一个真实 Google 账号从 `/login` 走完登录 → 进 `/dashboard` | 生产 QA 账号已清理（避免在生产库留测试凭据）；OAuth 授权页的人工同意无法脚本化 |
| 2 | 在订阅页点一次「Upgrade」（**接支付后**） | 会创建真实收款会话；应人工确认金额/币种/文案与 `src/config/plans.ts` 一致 |
| 3 | 收一封真实邮件（`verify:email:channel --send you@…`） | 投递结果取决于 Resend 域名验证状态，只有收件箱能证明 |

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
| 2026-10-18 | 首次生成。新增 `src/lib/payments/availability.ts`（单一判定）+ `not-configured.ts`（503 统一出口），7 个入口收敛同一语义；`CREEM_ENV` 误配 fail-closed；`/api/health` 暴露 `payments` 接入进度；新增单测、`verify:payment:channel`、`verify:payment:off` 与 CI 门禁。 |
