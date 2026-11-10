# 15 · Dodo 订阅套餐写入记录（live_mode）

> 执行时间：2026-11-10 16:20–16:45 GMT+8
> 商户：`bus_0Ng0ykFDg2w98yyU3Xwy7`（lokfeel）
> 环境：**live_mode**（真实可收款商品，非测试）
> 脚本：`scripts/ops/dodo-provision-plans.ts`（幂等，可重复执行）

---

## 1. 结果摘要

| 档位 | 周期 | 金额 | 状态 | `DODO_PRODUCT_*` → product_id |
|---|---|---|---|---|
| STARTER | 月付 | $49.00 | **已创建** | `DODO_PRODUCT_STARTER_MONTHLY` = `pdt_0NrdGj3pC4ibJ6Oljxn81` |
| STARTER | 年付 | $490.00 | **已创建** | `DODO_PRODUCT_STARTER_YEARLY` = `pdt_0NrdGjJ4J6YOnJZ4pCdGf` |
| GROWTH | 月付 | $149.00 | **已创建** | `DODO_PRODUCT_GROWTH_MONTHLY` = `pdt_0NrdGjSPkO55wB1t76sB2` |
| GROWTH | 年付 | $1,490.00 | **已创建** | `DODO_PRODUCT_GROWTH_YEARLY` = `pdt_0NrdGjapl7pWTfInwAvCV` |
| SCALE | 月付 | $399.00 | **已创建** | `DODO_PRODUCT_SCALE_MONTHLY` = `pdt_0NrdGjgAfanjOrHpT1N2s` |
| SCALE | 年付 | $3,990.00 | **BLOCKED** | 未绑定（见 §2） |

5/6 就绪。**未就绪的那一格不是配置错误，是外部金额上限**，且已做逐格降级（见 §4）。

---

## 2. `SCALE` 年付为何建不出来：商户单笔上限 $3,000

### 事实

```
POST /products  {"price": {"price": 399000, ...}}
→ 422 {"code":"CART_AMOUNT_EXCEEDS_LIMIT",
       "message":"The price is more than the cart value limit of this business."}
```

### 二分探测（每次创建后立即 `DELETE` 归档，不留垃圾）

```
162000 OK     242500 OK     282800 OK
302900 REJ    292900 OK     297900 OK
300400 REJ    299200 OK     299800 OK
300100 REJ
```

边界：**$2,998.00 通过 / $3,001.00 拒绝 ⇒ 上限正好 $3,000.00/笔**。

补充判定（各 1 次探测，均已归档）：

| 形态 | 金额 | 结果 |
|---|---|---|
| 一次性 `one_time_price` | $3,990 | REJ `CART_AMOUNT_EXCEEDS_LIMIT` |
| 订阅 `recurring_price` | $2,999 | OK |
| 订阅 `recurring_price` | $3,010 | REJ `CART_AMOUNT_EXCEEDS_LIMIT` |

⇒ 这是**对全部商品类型生效的购物车金额上限**，不是订阅专属。换商品形态绕不过去。

### 为什么不能"改价绕过"

$3,990 是已批准报价（`PRICING_APPROVAL` 2026-11-10.1），且年付 = 月付 × 10 是代码里的结构保证。
为迁就通道上限而把 Scale 年付改成 $2,999，等于在无人决策的情况下改掉对外报价 —— 不做。

### 解除路径（需人工，二选一）

1. **提高上限**：向 Dodo 申请把该商户单笔上限提到 ≥ $4,000（`support@dodopayments.com`）。
   文档未提供自助配置项，`GET /businesses` 对本 API Key 返回 403。
   → 解除后**只需重跑脚本**，会自动补建这一个 SKU，其余 5 个识别为已存在。
2. **改报价**：把 Scale 年付降到 ≤ $2,999（商业决策，需同步改 `PRICING_APPROVAL` 版本号）。

---

## 3. Webhook 端点：发现并修正了一处会导致"收了钱不开通"的错配

注册时端点已存在，但地址指向**错误的主机与路径**：

```
修正前  ep_3LuKXrpSgrEHRPcph0bBySPDc57 → https://lokfeel.com/          ← 静态首页，不是我们的路由
修正后  ep_3LuKXrpSgrEHRPcph0bBySPDc57 → https://app.lokfeel.com/api/webhooks/dodo
```

若原样上线：客户付款成功，Dodo 把 `payment.succeeded` POST 到 `lokfeel.com/` 的 HTML 页面，
Next.js 的路由**永远不会被调用**，订阅不会被开通，而支付页会告诉客户"已成功"。
这是本次最值钱的一处修正。

同时把事件过滤显式收紧到代码真正处理的 9 个（PATCH 时 `filter_types` 曾被清成 `null`，已恢复）：

```
payment.succeeded · payment.failed
subscription.active · subscription.renewed · subscription.plan_changed
subscription.cancelled · subscription.expired · subscription.past_due · subscription.on_hold
```

复核（`GET /webhooks`）：`url` 正确、`disabled=false`、9 个事件齐全。

---

## 4. 逐格降级：1 个 SKU 缺失不该让整页禁售

原实现 `readStoreReadiness().ready` = "凭据齐备 **且** 6 个 SKU 全绑定"。
在 §2 的约束下，这个定义会把**另外 5 个可售套餐一起禁掉** —— 页面显示"在线开通即将开放"，
一分钱收不到，且没有任何报错。

改为两层语义：

| 概念 | 含义 | 用在哪 |
|---|---|---|
| `ready` | 凭据齐备，能创建结账会话 | 页面级"通道是否接上" |
| `readSkuBindings()` | 逐 (档位, 周期) 是否已绑商品 | 单个按钮是否可点 |

`PlanCards` 新增可选 `bound` 属性：未绑定的那一格按钮禁用并就地说明
"年付这一档暂未开放在线开通（受支付通道单笔金额上限限制），可改选月付或联系我们"，
其余格子照常 `订阅 Growth`。

回归测试：`tests/billing/dodo-store-readiness.test.ts`（11 例，含"5/6 绑定时 ready 仍为 true"）。

---

## 5. 写入的环境变量（Netlify · site `c46478e9`）

| 键 | 值 |
|---|---|
| `DODO_PAYMENTS_API_KEY` | `dodo_live_6zPO…RXmaKy`（live） |
| `DODO_PAYMENTS_ENVIRONMENT` | `live_mode` |
| `DODO_PAYMENTS_WEBHOOK_KEY` | `whsec_wQh/…`（38 字符） |
| `DODO_PRODUCT_STARTER_MONTHLY` / `_YEARLY` | 见 §1 |
| `DODO_PRODUCT_GROWTH_MONTHLY` / `_YEARLY` | 见 §1 |
| `DODO_PRODUCT_SCALE_MONTHLY` | 见 §1 |
| `DODO_PRODUCT_SCALE_YEARLY` | **故意不设** ⇒ 该格降级，不报错 |

### 已知的安全妥协（待办）

Netlify 免费计划下**无法创建 secret 变量**：省略 `scopes` 时默认含 `post_processing`，
服务端拒绝 secret（`422 Secrets are not allowed to run in 'post_processing' scopes`）；
显式指定 scopes 需要付费（`403 Upgrade your Netlify account to set specific scopes`）。

所以这 8 个值目前以**普通变量**存储，在 Netlify 控制台对账号成员可见。
后续二选一：升级团队计划后改为 secret，或把 key 迁到 Netlify 之外（如仅注入 build）。

---

## 6. 幂等与复跑

```bash
DODO_PAYMENTS_API_KEY=... DODO_PAYMENTS_ENVIRONMENT=live_mode \
  npx tsx scripts/ops/dodo-provision-plans.ts --dry-run   # 只对账，不写
DODO_PAYMENTS_API_KEY=... DODO_PAYMENTS_ENVIRONMENT=live_mode \
  npx tsx scripts/ops/dodo-provision-plans.ts             # 补建缺失项
```

- 身份键 = `metadata.source='lokfeel_automation'` + `metadata.plan`，**不用 name**（人会改名）。
- 已存在且一致 → 跳过；已存在但不一致 → 报 **DRIFT** 并以退出码 1 结束，**不自动改价**（改价是不可逆商业动作）。
- 金额、周期、试用期全部从 `PLAN_CATALOG` 读，脚本内**零价格字面量**。
- 实测：第二次运行 5 个识别为"已存在"，无重复创建。

---

## 7. 状态

| 项 | 状态 | 判据 |
|---|---|---|
| 6 个商品写入 Dodo | **5 PASS / 1 BLOCKED** | `GET /products` 逐条 product_id |
| 商品金额与目录一致 | **PASS** | 脚本 DRIFT 检测 = 0 |
| Webhook 地址指向真实路由 | **PASS** | `GET /webhooks` → `app.lokfeel.com/api/webhooks/dodo` |
| Webhook 事件订阅 | **PASS** | 9/9 显式 |
| 环境变量写入 | **PASS** | Netlify API 复核 8/8 |
| 真实扣款 + 真实事件投递 | **NOT_TESTED** | 需要一张真实卡，不能伪造 |
| `SCALE` 年付可售 | **BLOCKED** | 单笔 $3,000 上限 |
