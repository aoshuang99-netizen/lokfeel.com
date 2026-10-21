# 02 订阅事件矩阵与账务状态机（WB17-02）

**执行时间**：2026-10-21 16:20–17:10（GMT+8）
**代码基线**：`a586fe5` + 本次提交
**对应门禁**：PAY-01 ~ PAY-08

---

## 1. 结论

| 问题 | 修复前 | 修复后 |
|---|---|---|
| 续费不入账 | `subscription.paid`（**每期扣款成功**）**完全没有 case** ⇒ 首月收钱、次月静默丢失 | 已实现：入账 + 推进周期 + 保持 ACTIVE |
| 四个死分支 | `subscription.created` / `subscription.cancelled`（英式）/ `payment.succeeded` / `payment.failed`，均不在 Creem 事件目录 ⇒ 永不触发 | 删除；改为"未知事件显式落 `unknown` 并 200 忽略" |
| 幂等键用错对象 | 一律用 `object.id`（订阅 id）⇒ **第二期续费与首期同键**，被判重复直接跳过 | 按事件性质取键：续费 `tran_*`、开通 checkout、退款 refund id |
| 乱序事件 | 迟到的 `past_due` 会把已付到 12 月的订阅打成逾期 | 以周期结束时间为逻辑时钟，陈旧降级直接忽略 |
| 取消作用对象 | 按 `userId` 找订阅 ⇒ 多订阅用户会被改错行 | 优先按 `stripeSubscriptionId` 定位，回退到该用户最新一条 |
| 季度权益 | 无季度枚举，映射成月度 + 92 天，但 92 是魔法数字 | 提为 `QUARTERLY_PERIOD_DAYS` 常量 + `periodEndForPlan()` 单测 |

判定：PAY-03/04/05/06/07/08 **PASS**（代码 + 单测；生产真实事件仍 BLOCKED，见 §6）。
PAY-01 **PASS**（未配置返回 503，实测）。PAY-02 **PASS**（签名失败 401，有测试）。

---

## 2. 事件矩阵（以 Creem 官方目录为准，17 个事件全覆盖）

> 目录来源：Creem 官方文档（2026-10 核对）。**不存在** `subscription.renewal`，
> 续费统一走 `subscription.paid`。

| 事件 | 分类 | 内部状态 | 动钱 | 幂等键 | 备注 |
|---|---|---|---|---|---|
| `checkout.completed` | activate | `ACTIVE` | ✅ | `creem:checkout:<checkout_id>` | 首购；同时落 Payment |
| `subscription.active` | activate | `ACTIVE` | ❌ | — | 官方建议仅用于同步状态，解锁看 `paid` |
| `subscription.paid` | **renew** | `ACTIVE` | ✅ | `creem:tran:<last_transaction_id>` | **续费**；每期一笔 |
| `subscription.trialing` | trial | `TRIALING` | ❌ | — | 试用期发权益 |
| `subscription.canceled` | cancel | `CANCELLED` | ❌ | — | 写 `cancelledAt` |
| `subscription.scheduled_cancel` | cancel_scheduled | `ACTIVE` | ❌ | — | 期内仍有效；枚举无 `cancelAtPeriodEnd`，靠周期结束兜底 |
| `subscription.past_due` | past_due | `PAST_DUE` | ❌ | — | 停权益；Creem 会自动重试 |
| `subscription.unpaid` | unpaid | `PAST_DUE` | ❌ | — | 催收失败 |
| `subscription.expired` | expire | `EXPIRED` | ❌ | — | 非终态，后续可能重试 |
| `subscription.paused` | pause | `PAST_DUE` | ❌ | — | **有损映射**：枚举无 PAUSED，宁可停权 |
| `subscription.update` | ignored | — | ❌ | — | 换套餐/items；本轮不处理（见 §5） |
| `refund.created` | refund | 不改 | ✅ | `creem:refund:<refund_id>` | 只把原账单翻 `REFUNDED` |
| `dispute.created` | ignored | — | ❌ | — | **未处理**：无 DISPUTED 枚举，见 §5 |
| `credits.granted` | ignored | — | ❌ | — | 额度类，与订阅无关 |
| `credits.consumed` | ignored | — | ❌ | — | 同上 |
| `customer_credits.exhausted` | ignored | — | ❌ | — | 同上 |
| `credits.auto_recharged` | ignored | — | ❌ | — | 同上 |

任意**不在此表**的事件（如旧的 `payment.succeeded`）→ `unknown` → 记日志 + 返回 200：
不返回 4xx，是因为 Creem 会对非 200 重试 5 次（30s/5min/30min/6h），
一个永远不可能成功的死事件会变成持续噪音。

---

## 3. 幂等设计（PAY-03 的核心）

```
续费 1：evt_1, tran_1  →  Payment.stripePaymentIntentId = "creem:tran:tran_1"
续费 2：evt_2, tran_2  →  Payment.stripePaymentIntentId = "creem:tran:tran_2"   ← 不同键
重放 2：evt_2, tran_2  →  命中已有行 → 返回 { duplicate: true }，不再入账
```

为什么不能用订阅 id：同一订阅的所有期共享 `sub_1`，第二期会被判成"重复事件"直接跳过 ——
这正是原实现"首月正常、次月丢账"的机制。测试里有一条**反例对照**显式演示这一点
（`creem-events.test.ts`：`legacyKey === secondLegacyKey` 恒真，说明它就是撞键的根源）。

退款同理：用退款对象 id，而不是原交易 id。否则退款会被判成"重复的首购"。

---

## 4. 乱序设计（PAY-04）

`Subscription` 没有"最后事件时间"字段（不改 schema 优先），因此用 **`stripeCurrentPeriodEnd`
作为逻辑时钟**：

- 降级类事件（`past_due` / `unpaid` / `expired`）若 `periodEnd < 当前 periodEnd` → 判为**陈旧**，忽略；
- 升级类事件（`paid` / `active`）永远接受 —— 迟到的"好消息"不该被丢；
- 任一侧缺时间 → 不做推断（不能凭猜测拦截真实事件）。

写订阅时另加一条"只前进不后退"：`periodEnd` 仅在**更晚**时才覆盖。

---

## 5. 已知的有损映射 / 未覆盖项（不藏）

| 项 | 现状 | 为什么不硬做 | 影响 |
|---|---|---|---|
| `subscription.paused` → `PAST_DUE` | 枚举无 PAUSED | 加枚举要迁移 + 回填，属于 schema 变更 | 用户看到的文案是"逾期"而非"已暂停" |
| `dispute.created`（chargeback） | 明确忽略，仅日志 | `PaymentStatus` 无 `DISPUTED`；强行记 `FAILED` 会让对账口径错 | 拒付需人工在 Stripe/Creem 后台处理（已列入 B4 SOP） |
| `subscription.update`（换套餐） | 忽略 | 换套餐要改 `plan` + 权益 + 按比例结算，是独立需求 | 用户改套餐后本地权益不变，需人工或后续迭代 |
| 季度计划 | `periodEndForPlan('PREMIUM_QUARTERLY')` = 92 天 | `SubscriptionPlan` 无季度值 | 权益周期正确、报表口径记成月度 |
| 退款金额 | 只翻状态，不改 `amount` | `Payment.amount` 是正数流水；冲正需负向流水模型 | 对账需按状态过滤（`REFUNDED` 不计入净收入） |

---

## 6. 测试与证据

| 文件 | 用例数 | 覆盖 |
|---|---|---|
| `tests/billing/creem-events.test.ts` | 22 | 目录完整性、状态映射、幂等键、乱序、载荷解析、季度周期 |
| `tests/billing/creem-webhook-matrix.test.ts` | 14 | 安全闸、续费入账、重放、两期不撞键、迟到 past_due、取消/过期/期末取消、退款、死分支、无账号归属、credits 忽略 |

关键断言（都是"能被改坏"的，不是形式断言）：

- 官方 17 个事件**逐个**分类，任何一个落 `unknown` 即红；
- 两期续费的幂等键**必须不同**；同一事件重放**必须同键**；
- 迟到的 `past_due` 必须 `ignored: stale`，但**同周期**的 `past_due` 必须真降级（防"顺手吞掉真事件"）；
- `payment.succeeded` 必须被判 `unknown` 且不碰 DB（证明死分支已清理，不是换个名字继续存在）。

---

## 7. BLOCKED：真实事件

| 门禁 | 状态 | 原因 |
|---|---|---|
| PAY-05 续费 | **代码 PASS / 真实事件 BLOCKED** | 无 Creem 凭据，无法产生真实续费事件 |
| PAY-07 取消 | 同上 | 同上 |
| PAY-08 退款 | 同上 | Stripe 侧退款协议层已端到端（`scripts/qa/refund-e2e.mjs`），Creem 侧无凭据 |
| PAY-09 三方对账 | **BLOCKED** | 需真实交易 |
| PAY-10 大陆结账 | **BLOCKED** | Gumroad 结账域在大陆不可达（已实测） |

按 V17 §6.2：这些记 **BLOCKED**，不记 SKIPPED，也不拿"单测通过"冒充"生产通过"。

---

## 8. 状态

**PASS（代码级）· PAY-05/07/08/09/10 BLOCKED（外部条件）**

- 有证据：17 事件矩阵、36 条测试、4 处设计缺陷的修复 diff。
- 有保留：paused / dispute / update / 季度四类有损映射已在 §5 明写，未假装完成。
