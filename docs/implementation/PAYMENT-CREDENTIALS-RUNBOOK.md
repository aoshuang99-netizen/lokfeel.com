# 支付凭据填写说明（唯一入口）

> **2026-10-21 实测**：生产站点 `lokfeel`（`c46478e9-7ac8-4bcf-9052-7638b04fef83`）现有 **43** 个环境变量，
> 缺的正好是下面这 4 个。`/api/health` 此刻自报 `payments.configured=false`、
> `missing=[CREEM_API_KEY, CREEM_WEBHOOK_SECRET, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET]`。
>
> **本文件替代「去面板一个个粘贴」。** 面板路径写在 §5，只在你明确拒绝跑脚本时才用。

---

## 0. 一句话：你只需给 2 个 key

```bash
# ① 把两把 key 写进 .env.payment.local（已被 .gitignore 的 .env*.local 覆盖）
#    CREEM_API_KEY=creem_xxx
#    STRIPE_SECRET_KEY=sk_live_xxx

export NETLIFY_AUTH_TOKEN=nfp_xxx          # 已有的那个 token

npm run payment:apply -- --dry-run         # 只看计划：校验格式、探活、列出现有端点
npm run payment:apply                      # 真写 → 真建 webhook → 真部署 → 真复验
```

**为什么只用 2 个**：另外两个 `whsec_` 由 provider 的接口**现造现返回**，
脚本拿到后立刻写进 Netlify —— 全程不落盘、不进 shell 历史、不进 `ps`。

| 变量 | 谁提供 | 来源（精确到菜单） | 线上格式校验 |
|---|---|---|---|
| `CREEM_API_KEY` | **你** | Creem Dashboard → Settings → **API Keys**（先切到 Live） | `^creem_[A-Za-z0-9_-]{6,}$` |
| `CREEM_WEBHOOK_SECRET` | 🤖 脚本 | `POST https://api.creem.io/v1/webhooks` 的响应体 `secret` | 长度 ≥ 16 |
| `STRIPE_SECRET_KEY` | **你** | Stripe Dashboard → Developers → **API keys** → Secret key → *Reveal* | `^(sk\|rk)_(test\|live)_[A-Za-z0-9]{8,}$` |
| `STRIPE_WEBHOOK_SECRET` | 🤖 脚本 | `POST https://api.stripe.com/v1/webhook_endpoints` 的响应体 `secret` | `^whsec_[A-Za-z0-9]{8,}$` |

> 上面三个正则不是抄的：脚本运行时从 `src/lib/payments/availability.ts` **读出来**。
> 源码改了脚本自动跟随；源码读不出（改名/重构）脚本直接报错，而不是拿旧规则悄悄放行。

**别顺手改的三样东西**：`CREEM_ENV` 已是 `production`（只接受 `production` / `test`，
写 `staging`/`TEST` 会让线上 fail-closed 拒绝实例化）；`AUTH_URL` 已就位；
`CREEM_MONTHLY_PRODUCT_ID` / `CREEM_YEARLY_PRODUCT_ID` 是可选（订阅页走实时产品列表）。

---

## 1. 为什么两个 webhook secret 必须自动建，而不是让你抄

这不是为了省事，是三个**会静默出错**的点：

1. **secret 只在创建端点的那一次响应里出现**。Stripe 关掉弹窗就再也看不到（只能 Roll），
   Creem 同理。于是「人」成了唯一的传递介质，而复制最常带进来的是换行、少一位、粘成上一条。
2. **端点订阅的事件必须与代码里的 `switch` 对齐**。少订一个 = 付款成功但账不入库，
   **没有任何报错**，只在月底对账时发现。脚本直接读两个 route 的 `case "..."`，不靠记忆。
3. **端点的 API 版本必须等于代码钉的版本**。本仓库钉在 `2026-08-26.dahlia`
   （`src/lib/stripe/config.ts`）；面板里选「账号默认」会让同一个事件在不同 handler 里
   解析出不同字段（dahlia 起 `Invoice.payment_intent` 已被移除）。
   脚本从源码读这个版本号，写进端点的 `api_version`。

---

## 2. 脚本实际做了什么（8 步，每步都会打印）

| # | 步骤 | 关键点 |
|---|---|---|
| 1 | 读凭据 | 优先级：`.env.payment.local` < `--stdin` JSON/ENV < 进程环境变量。**不接受 `--key=value`**（argv 会进 `ps`） |
| 2 | 格式校验 | 用线上同一套正则；不符直接 exit 2，不写任何东西 |
| 3 | 安全闸 | `sk_live_` 需 `--allow-live`；**test 凭据写生产需 `--allow-test-in-prod`**（见 §6 的假绿陷阱） |
| 4 | key 探活 | `GET /v1/account`（Stripe），只读、零费用。key 无效在这里就停 |
| 5 | 建/复用端点 | 先 `list` 再 `create`（幂等）。Creem 已存在时先试 `GET /webhooks/{id}/secret` 取回 |
| 6 | 写 Netlify | `POST /accounts/{id}/env?site_id=`；**写入后读回逐字比对**（写成功 ≠ 写对了） |
| 7 | 触发部署 | `POST /sites/{id}/builds` → 轮询到 `state=ready`。**变量没变更就不重复部署** |
| 8 | 生产复验 | `/api/health` 的 `payments` + Stripe webhook 400 + Creem webhook 4xx + Creem 产品列表 200 |

报告落在 `reports/payment-credentials-apply-<ts>.json`，**只含掩码与时间戳**（有一次自测专门验它不含明文）。

常用开关：

```bash
--dry-run                  # 只读：校验 + 探活 + 列端点，不写不建不部署
--no-deploy                # 写变量但不触发构建（等你下次正常发版生效）
--no-webhook-create        # 端点已在面板建好，只用你给的 secret
--rotate-stripe            # 删旧端点建新的（旧的 secret 取不回时用；期间可能丢少量事件）
--rotate-creem
--allow-live               # 放行 sk_live_（真扣款）
--allow-test-in-prod       # 放行「test 凭据写生产」（仅沙箱联调期）
--stdin                    # 从管道读 JSON，值不进 shell 历史
```

退出码：`0` 完成 · `1` 执行失败 · `2` 被安全闸拦下（**未做任何写入**）· `3` 复验不通过 · `64` 参数不足。

---

## 3. 半自动：你已经有 secret 了

```bash
CREEM_API_KEY=creem_x STRIPE_SECRET_KEY=sk_live_x \
STRIPE_WEBHOOK_SECRET=whsec_x CREEM_WEBHOOK_SECRET=whsec_y \
npm run payment:apply -- --no-webhook-create
```

只要 4 个值都给了，脚本不会再去建端点，直接进入第 6 步。

---

## 4. 首次接入建议顺序（沙箱 → 生产）

```bash
# 1) 沙箱：CREEM_ENV=test + sk_test_，先确认链路通（不产生真实扣款）
printf 'CREEM_API_KEY=creem_test_xxx\nSTRIPE_SECRET_KEY=sk_test_xxx\nCREEM_ENV=test\n' > .env.payment.local
npm run payment:apply -- --allow-test-in-prod --dry-run
npm run payment:apply -- --allow-test-in-prod

# 2) 用测试卡跑一次订阅（Stripe 测试卡 4242 4242 4242 4242）
#    判据：DB 里出现 Payment 记录、订阅状态变 active、webhook 日志有 200

# 3) 换 live：把 .env.payment.local 的两把 key 换成 live，CREEM_ENV 去掉
npm run payment:apply -- --allow-live
```

> 第 1 步会让你在生产站点上出现 `configured=true` 但收不到钱。**联调结束必须换回 live**，
> 否则就是 §6 表格第一行的假绿。脚本会在这种情况下打 `⚠️` 并在报告里留痕。

---

## 5. 纯手工路径（不跑脚本时照这张表）

### 5.1 Stripe（`STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET`）

1. Dashboard → **Developers → API keys** → *Secret key* → **Reveal** → 复制（`sk_live_…` 或 `sk_test_…`）。
2. Dashboard → **Developers → Webhooks → Add endpoint**
   - **Endpoint URL**：`https://app.lokfeel.com/api/webhooks/stripe`
   - **Events**（7 个，一个都不能少 —— 这些正是 `route.ts` 的 `case`）：
     `checkout.session.completed`、`customer.subscription.created`、
     `customer.subscription.updated`、`customer.subscription.deleted`、
     `invoice.payment_succeeded`、`invoice.payment_failed`、`setup_intent.succeeded`
   - **API version**：选 `2026-08-26.dahlia`。**不要**选 "account default"（见 §1 第 3 点）。
3. 建好后进端点详情 → **Signing secret → Reveal** → 复制 `whsec_…`。

### 5.2 Creem（`CREEM_API_KEY` + `CREEM_WEBHOOK_SECRET`）

1. Dashboard → **Settings → API Keys** → 切到 Live → 复制 `creem_…`。
2. Dashboard → **Webhooks → Add**（或直接调 `POST https://api.creem.io/v1/webhooks`）
   - URL：`https://app.lokfeel.com/api/webhooks/creem`
   - Events（4 个，且**只能**从平台枚举里选）：
     `checkout.completed`、`subscription.active`、`subscription.canceled`、`subscription.past_due`
   - 创建响应/成功页里的 `secret` 就是 `CREEM_WEBHOOK_SECRET`（只出现这一次）。

> 代码里还有 `subscription.created` / `subscription.cancelled` / `payment.succeeded` /
> `payment.failed` 四个 `case`，但**它们不在 Creem 的事件枚举里**，永远收不到 —— 是死分支。
> 脚本会把这四个打印出来并从订阅里剔除（订阅不存在的类型会直接 400）。

### 5.3 写进 Netlify

面板：Site configuration → Environment variables → **Add a variable**，逐个添加，
**Scope 选 all**，注意不要多带空格/换行。或走 CLI：

```bash
for kv in "CREEM_API_KEY=creem_xxx" "CREEM_WEBHOOK_SECRET=whsec_xxx" \
          "STRIPE_SECRET_KEY=sk_live_xxx" "STRIPE_WEBHOOK_SECRET=whsec_xxx"; do
  netlify env:set "${kv%%=*}" "${kv#*=}" --site c46478e9-7ac8-4bcf-9052-7638b04fef83
done
```

然后**必须重新部署**：变量是部署时注入的，改完不部署等于没改。

---

## 6. 症状对照（"明明填了还是不行"）

| 症状 | 真因 | 处理 |
|---|---|---|
| `/api/health` → `configured=false`，`missing=["X"]` | 变量没进**这个** deploy | 重新部署；或 `--dry-run` 再看一次读回 |
| `malformed=["X"]` | 格式错：带引号/换行、`sk_test` 写成 `sk_live`、`whsec` 少几位 | 用脚本重写（它会 sanitize 并读回校验） |
| 付款成功但**不开通** | 端点事件没订全，或 secret 与端点不匹配 | `POST` 一次假签名：Stripe 期望 400、Creem 期望 4xx；503 说明变量没生效 |
| Creem checkout 502 | key 的 mode 与 `CREEM_ENV` 不匹配（test key 打 prod 服务器） | 对齐：`CREEM_ENV=test` ↔ `test-api.creem.io` |
| 后台退款 503 | `stripe.refund` 通道只看 `STRIPE_SECRET_KEY` | 补 key（不需要 whsec） |
| `configured=true` 但一分钱没收到 | **test 凭据写进了生产** | 换 live key 重跑；这就是 `--allow-test-in-prod` 默认拒绝的原因 |
| 订阅页显示"暂时不可用" | 前端按 `PAYMENT_NOT_CONFIGURED` 降级 | 同上，先看 `/api/health` 的 `missing` |

---

## 7. 完成判据（4 条，全绿才算接完）

```bash
npm run verify:payment:channel                  # 期望：✅ 5/5 通道就绪，exit 0
npm run verify:payment:channel -- --probe       # 期望：两个 provider 都 HTTP 200
curl -s "https://app.lokfeel.com/api/health?t=$(date +%s)" | python3 -m json.tool | sed -n '/"payments"/,/}/p'
                                                # 期望：configured: true, charging: true, missing: []
npm run verify:payment:off                      # 期望：**变红**（exit 1）
```

第 4 条是**反向对照**：它断言的是「未接入」。接完还绿，说明配置没生效或守卫被绕过 ——
那才是更危险的情形。

---

## 8. 回滚

删掉对应变量 → 重新部署 → 立刻回到「未接入」：7 个入口 503、订阅页显示「暂时不可用」，
**不影响登录 / 匹配 / IM / 视频**。没有数据迁移、没有 schema 变更，支付接入是纯配置动作。

```bash
# 只暂停收费（保留卡验证）
#   删 CREEM_API_KEY → charging=false
```

---

## 9. 需要你做的三件事

1. **Creem 后台切到 Live，复制 API key**（并确认你能看到 Webhooks 菜单 —— 如果看不到，
   说明账号还没通过审核，脚本会在建端点时 403）。
2. **Stripe 后台复制 Secret key**（`Developers → API keys`）。
3. 把这两个值写进 `.env.payment.local`（或直接贴给我），然后说一句"跑"。

### 一条必须由业务方拍板的前置

`docs/PAYMENT-COMPLIANCE.md` 记录：公开检索到的条款显示 **Creem 禁止「交友网站服务」类业务**、
Stripe 将在线交友列为受限类。该结论**未经法务复核**，但它是「选哪个通道」的前提。
工程侧已做到支付无关化：换通道只需替换 §0 那两把 key 与对应 provider 适配层，不牵动业务代码。
