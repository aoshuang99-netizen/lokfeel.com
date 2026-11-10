# 14 · 收银台对接 Dodo Payments + 订阅套餐设置

> 状态词严格按：PASS / FAIL / BLOCKED / NOT_TESTED
> 每条结论附路径、命令、退出码或日志。**没有真实凭据的链路一律不得标 PASS。**

---

## 0. 一句话结论

收银台代码已完整落地并可构建、可验签、可幂等入账；
**唯一未完成的是把 Dodo 的真实凭据与 6 个商品 id 填进环境变量**——
在此之前所有支付入口返回 `503 PAYMENT_NOT_CONFIGURED`（这是**设计上的正确行为**，不是故障）。

| 结论 | 状态 | 证据 |
|---|---|---|
| 类型检查 | PASS | `npx tsc --noEmit` → exit 0 |
| Lint（新增文件） | PASS | `npx eslint src/lib/payments/dodo …` → exit 0，0 warning |
| 生产构建 | PASS | `next build` → exit 0；路由表含 `/api/webhooks/dodo`、`/api/payments/dodo/*`、`/checkout/success` |
| 单元测试 | PASS | 4 套 73 例 + 全量商业/计费 17 套 357 例 → exit 0 |
| **验签端到端** | **PASS** | 本地 `next start` + 真签名，4 条路径见 §5 |
| 未配置时 503 契约 | PASS | `POST /api/webhooks/dodo` → 503 + `PAYMENT_NOT_CONFIGURED` |
| **真实扣款/开通** | **NOT_TESTED** | 缺 `DODO_PAYMENTS_API_KEY` 等 3 项凭据（人工项） |
| 真实 webhook 投递 | NOT_TESTED | 需先在 Dodo 控制台注册端点 |

---

## 1. 目录结构（新增）

```
src/config/subscription-plans.ts         ← 套餐**唯一**事实源（价格/限额引用/商品 env 映射）
src/lib/payments/dodo/config.ts          ← 运行时配置解析（fail-closed，绝不回落 live）
src/lib/payments/dodo/signature.ts       ← Standard Webhooks 验签（纯函数）
src/lib/payments/dodo/events.ts          ← 事件 → 账本命令（纯函数）
src/lib/payments/dodo/client.ts          ← 最小 REST 客户端（零 SDK 依赖）
src/lib/payments/dodo/store.ts           ← 账本读写（唯一 IO）
src/app/api/payments/dodo/checkout/route.ts
src/app/api/payments/dodo/plans/route.ts
src/app/api/payments/dodo/subscription/route.ts
src/app/api/webhooks/dodo/route.ts
src/components/billing/plan-cards.tsx    ← 定价卡片 + 结账按钮
src/app/(public)/pricing/page.tsx        ← 重写为真实收银台入口
src/app/(public)/checkout/success/page.tsx
```

**没有新增数据库表、没有 schema 变更** —— 订阅与款项写入既有的
`BillingEvent` 事件账本（`prisma/schema/billing.prisma`），因此**本次发布不需要迁移**。

---

## 2. 订阅套餐（`src/config/subscription-plans.ts`）

审批留痕：`PRICING_APPROVAL = { approvedBy: product-owner, approvedAt: 2026-11-10,
basis: "V20.5 GA 上线指令 · 订阅套餐定价", version: "2026-11-10.1" }`

| 档位 | 月付 | 年付 | 折合月付 | 年付省 | 试用 | 席位 | 提案/月 | 介绍/月 | 成果/月 | 核验/月 | Agent 额度/月 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **Starter** | $49.00 | $490.00 | $40.83 | 17% | 14 天 | 25 | 200 | 30 | 100 | 25 | $5,000（5000 分） |
| **Growth** ★ | $149.00 | $1,490.00 | $124.17 | 17% | 14 天 | 100 | 1,500 | 200 | 800 | 200 | $25,000 |
| **Scale** | $399.00 | $3,990.00 | $332.50 | 17% | 14 天 | 500 | 不限 | 不限 | 不限 | 不限 | $100,000 |

★ = 页面高亮"最受欢迎"。

### 2.1 三条结构性约束（不是文案约定，是代码保证）

1. **金额只在 `subscription-plans.ts` 出现。** `display` 由 `cents` 派生，
   `validatePlanCatalog()` 在 CI 里比对两者，不一致即红。
2. **配额不复制。** `plan.limits` 是 `PLAN_LIMITS[id]` 的**引用**（`toBe` 断言），
   改配额必须改 `src/lib/billing/plans.ts` 一处。
3. **年付 = 月付 × 10。** 由 `yearlyOf()` 计算，`yearlySavingsPercent` 恒为 17%；
   "年付反而更贵"在结构上不可能发生。

### 2.2 商品绑定（六个环境变量）

| 档位 | 月付 | 年付 |
|---|---|---|
| STARTER | `DODO_PRODUCT_STARTER_MONTHLY` | `DODO_PRODUCT_STARTER_YEARLY` |
| GROWTH | `DODO_PRODUCT_GROWTH_MONTHLY` | `DODO_PRODUCT_GROWTH_YEARLY` |
| SCALE | `DODO_PRODUCT_SCALE_MONTHLY` | `DODO_PRODUCT_SCALE_YEARLY` |

**只放变量名，不放值。** 前端**永远不接触** `product_id`：
请求体只接受 `{ plan, interval }`，商品 id 由服务端 `resolvePlanTarget()` 决定。
理由与 Creem 的 B-16 结论逐字相同：让前端自报商品 id 等于允许它买任意商品。

---

## 3. 接口契约

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/api/payments/dodo/plans` | 公开 | 套餐目录 + `checkoutReady` + 缺失**变量名** |
| POST | `/api/payments/dodo/checkout` | 登录 + `billing.manage` | 创建会话，返回 `checkoutUrl` |
| GET | `/api/payments/dodo/subscription` | 登录 + `billing.read` | 当前组织订阅（由账本派生） |
| POST | `/api/webhooks/dodo` | 签名 | Dodo 事件入口 |

### 3.1 结账状态码

| 码 | 含义 | 前端动作 |
|---|---|---|
| 200 | 会话创建成功 | `location.assign(checkoutUrl)` |
| 400 | 参数非法 | 就地提示 |
| 401 | 未登录 | 跳 `/login?callbackUrl=/pricing` |
| 403 | 角色无 `billing.manage` | 提示"让所有者/管理员操作" |
| 409 | 组织已有生效订阅 / 无组织 | 提示去"管理订阅"，**不重复售卖** |
| 503 | 通道未配置或套餐未绑定商品 | 按钮显示"在线开通即将开放" |
| 502 | 上游失败/超时 | 提示稍后重试（**不回显上游响应体**） |

### 3.2 幂等

`Idempotency-Key = lf-dodo-<orgId>-<plan>-<interval>-<15minBucket>`：
窗口内双击/重试复用同一会话，跨窗口可新建（放弃支付后仍能重试）。
裸 `Date.now()` 会让判重永远失效 —— 这是 Creem 侧 B-17 踩过的坑。

---

## 4. Webhook

**注册地址**（Dodo 控制台 → Developer → Webhooks）：

```
https://app.lokfeel.com/api/webhooks/dodo
```

⚠️ test 与 live 是**两套端点、两套密钥**，不要混用。

### 4.1 验签（Standard Webhooks）

```
待签串 = `${webhook-id}.${webhook-timestamp}.${rawBody}`   ← 原始字节，不重新序列化
密钥   = whsec_ 前缀去掉后 base64 解码
摘要   = base64(HMAC-SHA256(待签串, 密钥))
头     = webhook-signature: 空格分隔的 `v1,<digest>`，任一匹配即通过
时间   = |now − webhook-timestamp| > 300s ⇒ 拒绝（防重放）
```

**401 vs 200 的分界**（写错会变成无限重投）：

| 情形 | 响应 | 理由 |
|---|---|---|
| 签名错误 / 时间戳过期 / 缺头 | **401** | 重投是合理的（可能在轮换密钥） |
| 事件不认识 / 无 `organizationId` / 未绑定商品 | **200 + ignored** | 重投一万次结果一样 |
| 账本内核拒绝（非法迁移） | **200 + deferred** | 让它在日志里"需要人看"，而不是自动消失 |

### 4.2 事件 → 账本映射

| Dodo 事件 | 账本命令（按序） |
|---|---|
| `payment.succeeded`（首单，订阅未开通） | `SUBSCRIPTION_STARTED` → `CHARGE_CREATED` → `CHARGE_SUCCEEDED` |
| `payment.succeeded`（续费） | `CHARGE_CREATED` → `CHARGE_SUCCEEDED` |
| `payment.failed` | `CHARGE_CREATED` → `CHARGE_FAILED`（reason 必填） |
| `subscription.active`（未订阅） | `SUBSCRIPTION_STARTED` |
| `subscription.active`（已 ACTIVE） | `PLAN_CHANGED`（否则内核判非法迁移） |
| `subscription.renewed` | 与 `payment.succeeded` **同一组幂等键** ⇒ 后到者整体回放 |
| `subscription.plan_changed` | `PLAN_CHANGED` |
| `subscription.cancelled` / `expired` | `SUBSCRIPTION_CANCELED` |
| `subscription.on_hold` / `past_due`（带 `payment_id`） | `CHARGE_CREATED` → `CHARGE_FAILED` |
| `subscription.updated` / `paused` / `unpaused` / `update_payment_method` | 仅记录，不动账本 |

**为什么必须展开成多条**：账本内核拒绝"凭空造钱"——
`CHARGE_SUCCEEDED` 必须有同 `chargeId` 的 `CHARGE_CREATED` 在前，
且 `CHARGE_CREATED` 只允许在 `ACTIVE`/`PAST_DUE` 时发生。
把三条压成一条只能在审计面上开洞。

---

## 5. 已实测（本地 `next start`，非模拟）

实例：`PORT=3124`，注入**假凭据**（`DODO_PAYMENTS_ENVIRONMENT=test_mode`）后逐条打：

```
BAD_SIG  -> 401 {"reason":"no_matching_signature"}
GOOD_SIG -> 200 {"ok":true,"ignored":"no_organization_in_metadata"}
STALE_TS -> 401 {"reason":"timestamp_out_of_tolerance"}     ← 时间戳偏移 4000s
NO_HEAD  -> 401 {"reason":"missing_headers"}
```

未配置实例（`PORT=3123`，无 Dodo 环境变量）：

```
GET  /api/payments/dodo/plans   -> 200，checkoutReady:false，
                                   missing:["DODO_PAYMENTS_API_KEY","DODO_PAYMENTS_ENVIRONMENT"]
POST /api/payments/dodo/checkout-> 401（未登录，符合预期）
POST /api/webhooks/dodo         -> 503 PAYMENT_NOT_CONFIGURED（缺 3 个变量名）
```

> `missing` 只含**变量名**，不含值 —— 该数组会出现在公开端点，泄露一次就是事故。

---

## 6. 上线步骤（人工，按序）

1. **建商品**：Dodo 控制台 → Products，建 6 个商品（3 档 × 月/年），
   币种 USD，价格见 §2；订阅型商品周期分别为每月 / 每年。
2. **填环境变量**（Netlify → Site settings → Environment variables）：

   ```
   DODO_PAYMENTS_API_KEY        = <Developer → API Keys>
   DODO_PAYMENTS_ENVIRONMENT    = live_mode        # 先填 test_mode 验证
   DODO_PAYMENTS_WEBHOOK_KEY    = whsec_...
   DODO_PRODUCT_STARTER_MONTHLY = pdt_...
   …（共 6 个商品 id）
   ```

3. **注册 webhook**：`https://app.lokfeel.com/api/webhooks/dodo`，
   订阅事件：`payment.succeeded payment.failed subscription.active subscription.renewed
   subscription.plan_changed subscription.cancelled subscription.expired
   subscription.on_hold subscription.past_due`
4. **验通道**：`curl -s https://app.lokfeel.com/api/health | jq .payments`
   → `channels["dodo.checkout"]` / `["dodo.webhook"]` 均 true，`missing` 为空。
5. **验页面**：`/pricing` 的按钮文案从"在线开通即将开放"变为"订阅 Starter/Growth/Scale"。
6. **真付一笔**（test_mode + 测试卡），确认 Console 计费页出现正确档位；
   再用 Dodo 控制台"Send Example"复验一次 webhook。

**回滚**：删掉 `DODO_PAYMENTS_*` 六个变量 → 一键回到"未接入"，
页面自动降级为"即将开放"，不会有半开状态。

---

## 7. 风险与已知缺口

| # | 风险 | 现状 | 处置 |
|---|---|---|---|
| R1 | 订阅绑定在**组织**上，不是个人 | 设计如此（Connection OS 是组织态产品） | 个人开发者场景需再讨论，属产品决策 |
| R2 | 已有生效订阅时**不支持自助升级** | 409 + 引导到"管理订阅" | Dodo 有 `change-plan` API，可作为后续迭代（本次未接） |
| R3 | 自助取消/改卡未接 | 未接 | 可用 Customer Portal（`createCustomerPortalSession` 已实现，未挂 UI） |
| R4 | 税/发票 | Dodo 作为 MoR 处理 | 无需自建 |
| R5 | 退款 | 后台手工（Dodo 控制台） | `/api/admin/subscriptions/[id]/refund` 仍是 Stripe 通道，未扩到 Dodo |
| R6 | 一次性商品 | 不收（`LIFETIME` 仍 `notForSale`） | 有意为之 |

---

## 8. 与旧通道的关系

`availability.ts` 的 `charging` 由 AND 改为 **OR**：
`(dodo.checkout && dodo.webhook) || (creem.checkout && creem.webhook)`。
迁移期两套网关并存时，"旧通道还开着、新通道已接好"不应被判成"完全不能收款"。
`configured` 仍要求全部通道就绪（保持严格语义不变）。
