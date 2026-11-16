# R03 | 现网保护核查（LIVE_READONLY_GET，2026-11-16 15:09 GMT+8）

取证方式：`curl --noproxy '*'` 仅 GET，未携带任何凭据，未采集 `set-cookie` / `Authorization`。生产健康端点自报 `commit=b50e53e`、`commitSource=env`、`builtAt=2026-11-14T08:38:05.985Z`。证据等级 **LIVE**；本地源码 6bab34c 状态另列，不得混为线上。

## 1. 确认的现网风险（BLOCKER，尚未修复）

| # | 端点 | LIVE 事实 | 判定 |
|---|---|---|---|
| P0-1 | `GET /pricing` | HTTP 200，可见 `From $89/mo`、`$89.00 / 月`、`$199.00 / 月`、`$449.00 / 月` | **FAIL**：D1 未批准定价对外可见 |
| P0-2 | `GET /api/payments/dodo/plans` | HTTP 200，`checkoutReady:true`、`commercialApproval.status:"APPROVED"`、`approvedAt:"2026-11-13"`、`environment:"live_mode"`、`catalogVersion:"2026-11-13.1"`、`plans[3]` 含 `amountCents 8900/19900/44900` 与 `display "$89.00"/"$199.00"/"$449.00"` | **FAIL**：JSON 端点暗泄未批价格并声明可结账 |
| P0-3 | `GET /api/health` | `payments.charging:true`，`channels.dodo.checkout:true`、`dodo.webhook:true` | **风险**：结账通道在生产处于开启态 |
| P0-4 | `GET /` | HTTP 200，未命中 V22 Hero 文案，仍为 `b50e53e` 旧首页 | 版本不一致，非安全问题但影响逐页验收 |
| P0-5 | `GET /api/v1/health` | 404 | NOT_APPLICABLE（该端点不存在，不算失败） |

说明：`/pricing` 命中的 `$12/$20/$23` 是 React Flight 序列化标记（形如 `"$L11"`、`"$12"`），**不是价格**；不得把它们计入价格泄漏证据。真实可见金额是上表四项。

## 2. 根因（源码事实，非推测）

- 本地 `6bab34c` 已实现 `PRICING_APPROVED=false` 的 SSR 门（`(public)/pricing/page.tsx:36-37`）与 JSON 门（`api/payments/dodo/plans/route.ts:38-49`），并有 3/3 单测 `tests/api/v22-pricing-json-gate.test.ts`。
- 但生产运行的是 `b50e53e`，该修复**未部署**；`docs/v22/W02_LIVE_AUDIT.md` 已记录同一现象。
- `src/config/products.ts:116-154` 仍有 `connection-os status:'APPROVED'`、`displayPrice:'From $89/mo'`、`approvalRef:'PRICING_APPROVAL 2026-11-13.1'`；`config/subscription-plans.ts:57-72` 的 `PRICING_APPROVAL {approvedBy:'product-owner'}` 属于**代码自设批准值**，`pricing-gate.ts:2-21` 注释已点名这正是未批价格泄漏到生产的原因。
- `src/lib/payments/commercial-gate.ts:30-44` 的 `approved = pricing.status === 'APPROVED' && Boolean(approvalRef)` 只认 `products.ts` 自设值，**未与 `PRICING_APPROVED` 联动** —— 这是本地候选里仍需修的旁路。

## 3. 最小可逆热修复候选（已写入代码，未部署、未推送）

| 改动 | 文件 | 可逆性 |
|---|---|---|
| 商业门增加 `PRICING_APPROVED` 联动，使 `commercial-gate.enabled` 在 D1 未批时恒 false | `src/lib/payments/commercial-gate.ts` | 单文件布尔条件，revert 即可 |
| `products.ts` 的 `connection-os` 不再自称 `APPROVED`；`displayPrice()` 在 `!PRICING_APPROVED` 时返回 null | `src/config/products.ts` | 目录语义修正，不动金额常量与历史 Webhook |
| 新增 fail-closed 负例单测：未批准时 SSR/JSON/checkout 三处均不产生金额或 session | `tests/api/v23-pricing-fail-closed.test.ts` | 测试文件 |

**未做**（需 Owner 单独批准）：推送、部署、摘除生产 `DODO_PAYMENTS_API_KEY`、修改任何 Netlify env、真实扣款、回滚。

## 4. 不影响既有合法权益

`pricing-gate.ts` 与 `plans/route.ts` 的修复只作用于「展示与新建结账」。历史订阅、`webhooks/dodo` 验签账本、`BillingEvent` 事件溯源、`resolvePlanTarget` 反向解析保持原样；本轮未触碰任何 Webhook 或账本代码。

## 5. 决策请求

见 `OWNER_DECISIONS.md` 第 D-03 项：请 Owner 在「部署最小可逆热修复」与「生产摘除 Dodo 支付密钥」之间选择其一，或明确暂不处置并接受该 LIVE 风险。WorkBuddy 不擅自改生产。
