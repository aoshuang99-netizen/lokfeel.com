# 05 · Dodo 真实全链路（T4）

| 项 | 值 |
|---|---|
| 状态 | **`BLOCKED`**（缺 test_mode 凭据）· 账本 `NO_SAMPLE` · 代码侧事件覆盖 **14/14** |
| 不允许的替代 | 自签自验、CLI 伪造事件、`HTTP 200` 当业务成功、零账本样本写 PASS |

## 1. 现状：三段分离

| 段 | 状态 | 依据 |
|---|---|---|
| ① API/Webhook **已配置** | ✅ 存在 | `plans.missing=[]`、`environment=live_mode`、`health.payments.channels["dodo.webhook"]=true` |
| ② 代码**能处理**多少事件 | ✅ 14 种（见 §2） | `src/lib/payments/dodo/events.ts` |
| ③ **真实投递 → 验签 → 落账 → 权益** | ❌ `NOT_TESTED` | 全库 `BillingEvent=0`、`CHARGE_*=0`、旧结算键 0 |

"① 已配置"是本轮反复强调**不能**当作完成的那一项。

## 2. 事件覆盖矩阵（代码侧，逐条对照过源码）

| Dodo 事件 | 代码是否处理 | 备注 |
|---|---|---|
| `payment.succeeded` | ✅ | 结算键分态（R-15） |
| `payment.failed` | ✅ | 失败不得开通，且不得覆盖后续成功 |
| `subscription.active` | ✅ | 权益生效 |
| `subscription.renewed` | ✅ | 续费不重复入账 |
| `subscription.cancelled` / `expired` | ✅ | 到期收权 |
| `subscription.failed` | ✅ | 支付失败状态 |
| `subscription.on_hold` / `past_due` | ✅ | 风险态 |
| `subscription.paused` / `unpaused` | ✅ | 暂停/恢复 |
| `subscription.plan_changed` | ✅ | 档位变更 |
| `subscription.updated` | ✅ | 通用更新 |
| `subscription.update_payment_method` | ✅ | 支付方式变更 |

**代码侧 14/14 已覆盖**；但 **Provider 侧的"事件订阅清单"是否真的投递了这 14 种，`NOT_TESTED`** —— 没有 Dodo API 读订阅配置的凭据。总令里"不止九个事件"的担忧，在代码层不成立（早已扩到 14），在**商户配置层**仍待核。

## 3. 缺什么才能跑（D4）

- `test_mode` 的 API key 与 webhook secret（**不要**贴聊天，走受控存储注入）；
- 一个 Dodo 测试商户下已绑定的 SKU（或允许我按目录创建测试商品）；
- 一个可达的 webhook endpoint（Preview 域名即可，需在 Dodo 后台登记）。

## 4. 拿到之后我会跑的 10 条（一条都不省）

1. test 模式发起订阅 → 记录 checkout session id 与 provider 原始响应；
2. 收 webhook：保存 `webhook-id` / `webhook-timestamp` / `webhook-signature` 与**原始 body**；
3. 验签失败必须 4xx 且不落账（负控）；
4. 同一 event 重放 100 次 → `BillingEvent` 恰好 1 条；
5. `failed → succeeded`（R-15 核心）→ 成功入账且权益开通；
6. `succeeded → failed`（乱序）→ 成功不被撤销；
7. 续费与 `payment.succeeded` 异 ID → 不重复入账；
8. 退款 / 取消 / 过期 → 权益按规则回收；
9. `paused` / `unpaused` / `plan_changed` / `updated` → 状态与权益一致；
10. 四方对账：**Provider event ↔ BillingEvent ↔ Subscription ↔ Console 可见权益**，零差异；零样本记 `NO_SAMPLE`。

## 5. Live 扣款（D5）

不在本轮范围。未获 D5 授权前我不会发起任何真实扣款；生产收银台保持关闭。
