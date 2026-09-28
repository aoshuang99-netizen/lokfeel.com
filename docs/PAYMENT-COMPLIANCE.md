# 支付通道合规与架构（P0-1）

> 状态：**设计方案 / 待验证** · 2026-09-27
> 关联：`src/lib/creem.ts`（代码中已标注合规提示）

## ⚠️ 首要声明

本文档中的**条款解读基于公开检索的二手来源，尚未经过法务复核**。

在依据本文档做出任何商业决策前，**必须**自行完成以下动作：

- [ ] 逐字阅读并留存各支付通道的《服务条款》《可接受使用政策》《受限业务清单》原文快照（含抓取日期）
- [ ] 向通道方**书面**（邮件/工单，留痕）确认你的具体业务场景是否被接受
- [ ] 取得费率、结算周期、拒付政策、保证金要求的书面报价
- [ ] 由法律顾问复核结论

本文档的作用是**指出风险位置与架构方向**，不是法律意见。

---

## 1. 核心风险

当前项目使用三套并存的支付集成：

| 通道 | 代码位置 | 角色 |
|---|---|---|
| **Creem** | `src/lib/creem.ts`、`api/payments/creem/*`、`api/webhooks/creem` | 主力 |
| **Stripe** | `api/webhooks/stripe`、`api/payments/portal` | 遗留 |
| **PingPong** | `src/lib/pingpong.ts` | 中国方案 |

**问题**：公开检索到的条款信息显示，Creem 的服务条款禁止**任何形式的色情/成人内容**，并禁止**「交友网站服务」**类业务；Stripe 将成人内容列为**禁止类**（无审批通道），在线交友列为**限制类**（须联系销售）。

若该解读成立，则**当前主力通道与产品定位存在条款级冲突**。

### 1.1 为什么这是"一票否决"级问题

```
支付通道不可用
   ↓
客户无法收款（无论自托管还是云托管）
   ↓
平台产品价值归零
   ↓
已付费客户要求退款 + 纠纷
   ↓
品牌与开源信誉受损
```

这不是"以后优化"的问题，而是**在开源发布前必须解决的前提**。

---

## 2. 架构改造方向：支付无关化

### 2.1 目标

让业务代码**不知道**具体用哪个支付通道。

### 2.2 现状问题

业务逻辑直接依赖 Creem 的字段与流程：

```ts
// 现状：业务代码直接 import 具体通道
import { CREEM_PLAN_CONFIG, getCreemClient } from '@/lib/creem';
```

### 2.3 目标形态

```
业务层（订单、订阅、权益）
        ↓  只依赖接口
  PaymentProvider 接口
        ↓
  ┌────────┬─────────┬──────────┬─────────┐
  │ Creem  │ Stripe  │ CCBill   │ Segpay  │  …可插拔
  └────────┴─────────┴──────────┴─────────┘
```

### 2.4 接口设计草案

```ts
/** 支付通道统一接口 —— 业务层只依赖这个 */
export interface PaymentProvider {
  readonly id: string;

  /** 创建一个结账会话，返回可跳转的 URL */
  createCheckout(input: {
    planId: PlanId;
    tenantId: string;
    customerEmail: string;
    successUrl: string;
    cancelUrl: string;
    metadata?: Record<string, string>;
  }): Promise<{ url: string; externalId: string }>;

  /** 校验并解析回调，返回归一化事件 */
  parseWebhook(raw: Buffer, headers: Record<string, string>):
    Promise<NormalizedWebhookEvent>;

  /** 取消订阅 */
  cancelSubscription(externalId: string): Promise<void>;

  /** 退款（若通道支持） */
  refund?(externalId: string, amountCents?: number): Promise<void>;
}

/** 归一化事件 —— 屏蔽各通道字段差异 */
export type NormalizedWebhookEvent =
  | { type: 'subscription.created';  externalId: string; planId: PlanId; tenantId?: string; currentPeriodEnd?: Date }
  | { type: 'subscription.renewed';  externalId: string; currentPeriodEnd?: Date }
  | { type: 'subscription.canceled'; externalId: string }
  | { type: 'payment.succeeded';     externalId: string; amountCents: number; currency: string }
  | { type: 'payment.failed';        externalId: string; reason?: string }
  | { type: 'dispute.created';       externalId: string; amountCents: number };
```

**关键收益**：`parseWebhook` 返回归一化事件后，业务层的订阅状态机只有一份实现，不会因通道不同而有行为差异。

---

## 3. 通道选型建议

### 3.1 分场景选通道

| 部署场景 | 建议通道 | 理由 |
|---|---|---|
| 内容中立的社群平台（自托管，部署方自有账户） | 主流通道（Stripe / Paddle / Creem 等）| 条款可接受；费率低（~3%） |
| 成人向场景 | 高风险管理方（CCBill / Segpay 类） | 主流通道明确不接受；这些通道专为此类业务存在 |
| 中国境内运营 | 本地通道（PingPong / 微信支付 / 支付宝） | 合规与结算需求 |
| 部署方自有通道 | **BYO Gateway**（推荐） | 交易风险与合规责任留在部署方 |

### 3.2 强烈建议：BYO Gateway 优先

对开源产品而言，**最正确的架构是让部署方自带支付通道**：

- 项目方**不参与资金流转**，不承担支付合规责任
- 部署方用自己已获批的通道账户，条款问题由部署方与其通道方解决
- 开源版**不内置任何通道凭证**，也不预设默认通道

代价：部署门槛上升（需要自己申请通道）。缓解方式：提供通道接入文档与配置向导，以及"无支付模式"让你可以先把平台跑起来。

---

## 4. 实施步骤

### 阶段 1：定义接口（1 周）

- [ ] 定义 `PaymentProvider` 接口与 `NormalizedWebhookEvent` 类型
- [ ] 把现有 Creem 逻辑包装为 `CreemProvider implements PaymentProvider`
- [ ] 业务层改为依赖接口（当前只有 `api/payments/creem/checkout` 与 webhook 两处消费 `CREEM_PLAN_CONFIG`）
- [ ] 为接口写契约测试（同一组用例跑遍所有 provider）

### 阶段 2：接入新通道（2–4 周）

- [ ] 按第 3 节选型，接入至少一个可承接目标场景的通道
- [ ] 补齐 `dispute.created`（拒付）事件处理 —— 高风险通道拒付率显著更高
- [ ] 回调幂等：同一事件重复投递不得重复变更订阅状态

### 阶段 3：剥离硬绑定（1–2 周）

- [ ] 从核心仓库移除通道凭证读取逻辑，改由部署方配置
- [ ] `.env.example` 中不预设任何通道为默认
- [ ] 文档明确：开源版不含支付凭证，部署方自行配置

### 阶段 4：合规文档化（1 周）

- [ ] 保存各通道条款原文快照（含抓取日期）到 `docs/legal/`
- [ ] 记录书面确认结果
- [ ] 明确不同场景该用哪个通道

---

## 5. 待验证清单（Go/No-Go 前提）

在投入架构改造前，**必须先拿到答案**：

| # | 问题 | 状态 | 结论 |
|---|---|---|---|
| 1 | Creem 是否接受在线交友类业务？ | ⬜ 待验证 | 检索显示"禁止交友网站服务"，需条文原文确认 |
| 2 | Stripe 对成人内容/交友的当前政策与是否存在例外审批？ | ⬜ 待验证 | 检索显示为禁止类/限制类 |
| 3 | 至少一家高风险管理方是否愿意承接目标场景？费率与要求？ | ⬜ 待验证 | **最关键的一项** |
| 4 | 高风险通道的拒付率与保证金要求是否可承受？ | ⬜ 待验证 | 行业参考：成人品类拒付率约 2.1%–3.4% |
| 5 | BYO Gateway 模式下，部署方获得通道的难度有多大？ | ⬜ 待验证 | 决定自托管可用性 |
| 6 | 多通道并行时，订阅状态机如何避免分支爆炸？ | ✅ 已设计 | 见第 2.4 节归一化事件 |

**若第 1、3 项的答案均为"不接受"，则本方案需要重新评估商业模式（例如完全转向 BYO Gateway + 内容中立定位，不承接成人向收款）。**

---

## 6. 与代码的对应关系

| 代码位置 | 现状 | 目标 |
|---|---|---|
| `src/lib/creem.ts` | 直接定义套餐与价格 | 只实现 `PaymentProvider`，价格取自 `src/config/plans.ts` ✅ 已完成 |
| `src/config/plans.ts` | 新增 | 单一价格源（已完成） |
| `src/app/api/payments/creem/checkout/route.ts` | 直接依赖 Creem | 改为依赖 `PaymentProvider` 接口 |
| `src/app/api/webhooks/{creem,stripe}` | 各自解析 | 归一化后交由统一状态机处理 |
| `src/lib/pingpong.ts` | 独立实现 | 包装为 `PingPongProvider` |

---

*最后更新：2026-09-27 · 本文档需随法务复核结果更新*
