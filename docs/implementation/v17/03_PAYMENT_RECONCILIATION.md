# 03 支付对账与真实交易闭环（WB17-03）

**执行时间**：2026-10-21 17:10（GMT+8）
**对应门禁**：PAY-01、PAY-09、PAY-10

---

## 1. 状态：BLOCKED（外部条件）

| 门禁 | 判据 | 当前 |
|---|---|---|
| PAY-01 未配置时行为正确 | 返回 503 + `PAYMENT_NOT_CONFIGURED`，绝不假装可用 | **PASS**（生产实测，见 §2） |
| PAY-09 真实交易三方对账 | 服务商订单 / 内部 Payment / 订阅权益三方一致 | **BLOCKED**：无凭据，无法产生真实交易 |
| PAY-10 大陆结账可用 | 大陆网络能完成付款 | **BLOCKED**：Gumroad 结账域不可达（已实测）；Creem/Stripe 同样未验证 |

按 V17 §6.2：BLOCKED 不等于 FAIL，也不等于 SKIPPED。它表示"代码已就绪，缺外部输入"。

---

## 2. 生产实测（2026-10-21 17:05，`app.lokfeel.com`）

```
GET  /api/payments/creem/products        503  {"code":"PAYMENT_NOT_CONFIGURED",
                                               "channel":"creem.checkout","missing":["CREEM_API_KEY"]}
POST /api/webhooks/creem                 503  {"channel":"creem.webhook","missing":["CREEM_WEBHOOK_SECRET"]}
POST /api/webhooks/stripe                503  {"channel":"stripe.webhook",
                                               "missing":["STRIPE_SECRET_KEY","STRIPE_WEBHOOK_SECRET"]}
POST /api/payments/creem/checkout        401  {"error":"Unauthorized"}
POST /api/payments/verify-card           401  {"success":false,"error":"Unauthorized"}
POST /api/payments/confirm-verification  401  {"success":false,"error":"Unauthorized"}
```

### 一处必须纠正的说法

历史上记的是"7 个支付入口统一 503"。实测：**结账类入口先撞鉴权（401），登录后才轮到支付闸（503）**。
顺序是 `requireAuth → paymentConfigured`，这是正确的（不该向匿名者暴露支付配置状态），
但"统一 503"的描述不准确 —— 它只在**已登录**时成立。

对 V17 的影响：PAY-01 的判据应表述为
「**已登录**用户在未配置支付时得到 503 + 机器可读 code；匿名用户得到 401」。
两者都是"默认拒绝"，只是拒绝层不同。

---

## 3. "闭环"到底需要哪五样证据

V17 要求"真实交易 → 权益激活 → 可对账"。把它拆成可核对的五项：

| # | 证据 | 从哪来 | 现在有吗 |
|---|---|---|---|
| E1 | 服务商侧订单/交易 id | Creem dashboard / Stripe dashboard / Gumroad sales | ✗ |
| E2 | 内部 `Payment` 行（金额、币种、状态、外部 id） | `db.payment` | ✗（只有测试桩） |
| E3 | `Subscription` 状态与周期 | `db.subscription` | ✗ |
| E4 | 权益生效可观察（页面/接口能读到） | `/api/v1/billing/subscription` | ✗ |
| E5 | 收据/对账可追溯 | 服务商收据 + E2 的外键 | ✗ |

五项齐了才算 PASS。缺任何一项，"收钱"就是未验证的。

---

## 4. 已有的自动化（不需要重造）

| 能力 | 位置 | 作用 |
|---|---|---|
| 凭据灌注 | `npm run payment:apply` | 2 把 key → 建/复用 webhook、写 Netlify env、读回比对、触发部署、跑生产判据（25 条自测含变异） |
| 未接入判据 | `npm run verify:payment:off` | 18 条断言：所有入口在未配置时必须是 503 + code，不能 500/200 |
| 退款协议层 | `scripts/qa/refund-e2e.mjs` | 真实 Stripe SDK + 本地假服务端，5 场景 19 断言（CI 常态跑） |
| 事件矩阵 | `docs/implementation/v17/02_PAYMENT_EVENT_MATRIX.md` | 17 个 Creem 事件全覆盖，续费/退款/乱序有测试 |

也就是说：**工具链已经不需要新的脚手架**，缺的只是外部凭据与一次真实交易。

---

## 5. 关闭 BLOCKED 的操作顺序（需你提供凭据）

```bash
# 1) 把 2 把 key 写进 .env.payment.local（已被 .gitignore 覆盖）
#    CREEM_API_KEY=creem_xxx
#    STRIPE_SECRET_KEY=sk_live_xxx

# 2) 只读预演：校验格式 → 探活 → 列出现有端点（不写任何东西）
export NETLIFY_AUTH_TOKEN=nfp_xxx
npm run payment:apply -- --dry-run

# 3) 真写：建/复用 webhook → 写 Netlify env → 读回逐字比对 → 触发部署 → 等 ready
npm run payment:apply

# 4) 生产判据（应全部由 503 翻成 200/正常业务码）
npm run verify:payment:off     # 此时应"预期失败"——因为它断言的是"未接入"状态
curl -s https://app.lokfeel.com/api/health | jq .payments   # configured 应为 true
```

真实交易（E1–E5）只能用**真实付款**产生。按 V17「不能造假单」：
不允许用测试卡伪造生产订单，也不允许把 mock 数据写成"已对账"。

---

## 6. 大陆通道（PAY-10）

已实测（2026-10-21）：

| 目标 | 大陆直连 | 结论 |
|---|---|---|
| `app.lokfeel.com` | HTTP 200 / 1.4s | 页面可达 |
| `gumroad.com` | 12s 超时 + DNS 污染（202.160.129.164） | **结账不可达** |
| `shuangster00.gumroad.com/pass` | 同上 | 海外可用 |

因此 `/pay.html` 能打开 ≠ 大陆能付款。这一点在 `PRELAUNCH-CHECKLIST.md` P0-4 已登记，
V17 的 PAY-10 保持 **BLOCKED**，不在本文档里假装有解。

---

## 7. 状态

**BLOCKED**（PAY-01 PASS）

- 有证据：生产 6 条实测响应体（含 401/503 的分层顺序）。
- 有纠正：把"7 入口统一 503"改成"匿名 401 / 已登录 503"。
- 有边界：E1–E5 五项证据全缺，未用任何测试桩冒充。
