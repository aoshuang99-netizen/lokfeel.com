# 09 · 支付就绪度

> 现场取自生产聚合端点（2026-10-21）：
> `GET https://app.lokfeel.com/api/health` → `payments`
>
> 结论：**BLOCKED_BY_CREDENTIALS**。代码侧已收口到"填 4 个变量即可收费"，但
> 没有凭据就不存在真实扣款证据，AC-25 不得标 PASS。

## 一、现场

```json
{
  "configured": false,
  "charging": false,
  "channels": {
    "creem.checkout": false,
    "creem.webhook": false,
    "stripe.card": false,
    "stripe.refund": false,
    "stripe.webhook": false
  },
  "missing": [
    "CREEM_API_KEY",
    "CREEM_WEBHOOK_SECRET",
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET"
  ],
  "malformed": []
}
```

- `configured=false` → 7 个收费入口统一返回 **503 + `PAYMENT_NOT_CONFIGURED`**（不是 500、不是静默成功）。
- `malformed=[]` → 没有任何"填了但格式不对"的变量，缺口是纯缺席。
- 配置位置：Netlify 站点 `lokfeel`（`app.lokfeel.com`）→ Site configuration → Environment variables，
  作用域 production / deploy-preview / branch-deploy 三处都要设。

## 二、代码侧已完成的部分（不依赖凭据）

| 能力 | 状态 | 证据 |
|---|---|---|
| 环境变量存在性与格式校验 | 完成 | `/api/health` 的 `payments` 块（`missing` / `malformed` 分离） |
| 未配置时的统一行为 | 完成 | 7 入口 503 `PAYMENT_NOT_CONFIGURED`；`verify:payment-off` 生产 **18/18** |
| Checkout 会话创建（Stripe / Creem 双通道） | 完成，未真实扣款 | 单测 + 沙箱 |
| Webhook 签名校验 + 重放保护 | 完成 | `BillingEvent` 记录事件 id，重复投递幂等 |
| 退款状态机（`amount_paid` − 有效退款 = 可退余额） | 完成 | `scripts/qa/refund-e2e.mjs`：5 场景 19 断言 + 变异，CI 常态跑 |
| 金额 / 币种 / 订单状态服务端校验 | 完成 | 不以客户端提交金额为准 |
| 账单页与订阅管理 | 完成 | `/dashboard/subscription`（legacy 承载，路由未动） |

### 一个已修复的潜伏缺陷（与本轮无关，但属于支付链路）

`Invoice.payment_intent` 自 API 版本 `dahlia` 起已移除；旧代码用 `latest_invoice.payment_intent`
取支付意图，且未 `expand`，拿到的是字符串 → 退款会静默走错分支。
现统一走 `invoice.payments[].payment.payment_intent`；`latest_invoice` 必须 `expand`。

## 三、凭据到位后的验收步骤（必须逐条留证）

| # | 步骤 | 通过的判据 | 证据形式 |
|---|---|---|---|
| 1 | 填入 4 个变量（生产作用域） | `/api/health.payments.configured=true`，`missing=[]` | 端点响应截图/JSON |
| 2 | 用测试卡完成一次订阅 | 返回 200，`Subscription.status=ACTIVE`，`BillingEvent` 有新行 | DB 查询结果 |
| 3 | Webhook 真实投递 | Stripe 后台事件状态 `200`，且服务端 `BillingEvent` 幂等（重复投递不新增行） | 事件 id + 行数 |
| 4 | 账单页显示真实金额与周期 | 金额 = 套餐配置值，周期 = 服务端 `currentPeriodEnd` | 页面截图 |
| 5 | 退款（部分 + 全额） | 可退余额 = `amount_paid` − 有效退款之和；重复退款被拒 | 端点响应 + DB |
| 6 | 凭据错误时的降级 | 故意置错一个变量 → `/api/health` 报 `malformed`，收费入口 503 | 端点响应 |

> 第 1 步之后 AC-25 才能从 BLOCKED 变为可执行；**在第 2–5 步留下证据前，AC-25 仍不得标 PASS**。

## 四、不做的事

- 不向任何人口头或书面索要密钥明文；凭据只进 Netlify 环境变量。
- 不把沙箱支付当作真实扣款写进验收。
- 不在 `configured=false` 的情况下把支付相关入口隐藏成"没这个功能" —— 503 + 明确错误码比静默消失更诚实。

## 五、复跑

```bash
curl -s https://app.lokfeel.com/api/health | jq .payments
npm run verify:payment-off          # 7 入口 × 未配置行为
node scripts/qa/refund-e2e.mjs      # 退款协议层 5 场景
```
