# 本地冒烟原始输出 · 2026-11-10

命令：`npx next build`（exit 0）→ `PORT=3123 npx next start` / `PORT=3124 npx next start`（注入假凭据）

## A. 未配置实例（PORT=3123，无 DODO_* 环境变量）

```
GET /api/payments/dodo/plans -> 200
{"ok":true,"provider":"dodo","currency":"USD","catalogVersion":"2026-11-10.1",
 "approvedAt":"2026-11-10","checkoutReady":false,
 "missing":["DODO_PAYMENTS_API_KEY","DODO_PAYMENTS_ENVIRONMENT"],"environment":null,
 "plans":[{"id":"STARTER",...,"intervals":{"monthly":{"amountCents":4900,"display":"$49.00","configured":false},
 "yearly":{"amountCents":49000,"display":"$490.00","perMonthDisplay":"$40.83","savingsPercent":17,"configured":false}}}, ...]}

POST /api/payments/dodo/checkout (无 cookie) -> 401
{"ok":false,"error":"Unauthorized"}

POST /api/webhooks/dodo (无签名, 未配凭据) -> 503
{"ok":false,"code":"PAYMENT_NOT_CONFIGURED","channel":"dodo.webhook",
 "missing":["DODO_PAYMENTS_API_KEY","DODO_PAYMENTS_ENVIRONMENT","DODO_PAYMENTS_WEBHOOK_KEY"],
 "error":"Webhook secret not configured","allChannelsConfigured":false}
```

## B. 已配假凭据实例（PORT=3124）

环境：`DODO_PAYMENTS_ENVIRONMENT=test_mode`，API key 长度为 16+ 的假值，
`DODO_PAYMENTS_WEBHOOK_KEY=whsec_<base64("lokfeel-e2e-signing-key")>`

同一份 body、同一时间戳，仅改动一个变量：

```
BAD_SIG  -> 401 {"ok":false,"error":"Invalid signature","reason":"no_matching_signature"}
GOOD_SIG -> 200 {"ok":true,"ignored":"no_organization_in_metadata","type":"payment.succeeded"}
STALE_TS -> 401 {"ok":false,"error":"Invalid signature","reason":"timestamp_out_of_tolerance"}
NO_HEAD  -> 401 {"ok":false,"error":"Invalid signature","reason":"missing_headers"}
```

判读：
- `GOOD_SIG → 200` 证明验签通过且 body 被正确解析（走到了业务层）；
- 其余三条各自**只差一件事**，证明拒绝是由该字段触发的，不是"反正都失败了"；
- `STALE_TS` 的时间戳偏移 4000s（> 300s 容忍窗口）。

## C. 构建产物路由（节选）

```
├ ƒ /api/payments/dodo/checkout
├ ƒ /api/payments/dodo/plans
├ ƒ /api/payments/dodo/subscription
├ ƒ /api/webhooks/dodo
├ ○ /checkout/success
├ ƒ /pricing
```

## D. 门禁

```
npx tsc --noEmit                 -> exit 0（无输出）
npx eslint src/lib/payments/dodo -> exit 0（0 error 0 warning）
npm run check:products           -> exit 0；--self-test 9/9 通过
npx jest tests/billing tests/commercial --silent -> exit 0；17 suites / 357 tests
npx next build                   -> exit 0
```
