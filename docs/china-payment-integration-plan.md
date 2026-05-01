# LokFeel 中国支付集成方案

> 文档版本: v1.0 | 日期: 2026-04-29 | 作者: 自主优化架构师

---

## 一、现状分析

### 当前支付架构

| 组件 | 技术 | 状态 |
|------|------|------|
| 支付网关 | Stripe | ✅ 已集成 |
| 支付方式 | 信用卡 (card only) | ⚠️ 仅支持国际信用卡 |
| 货币 | USD | ❌ 无CNY |
| 订阅制 | Stripe Subscriptions | ✅ 已实现 |
| 信用卡验证 | SetupIntent | ✅ 已实现 |
| Webhook | 6种事件处理 | ✅ 已实现 |

### 核心问题

| # | 问题 | 影响 |
|---|------|------|
| 1 | **仅支持国际信用卡** | 中国大陆用户几乎无法付费（信用卡普及率<3%） |
| 2 | **仅USD计价** | 中国用户需承担汇率损失+跨境手续费 |
| 3 | **Stripe Checkout `payment_method_types: ["card"]`** | 硬编码只有card，未启用Alipay/WeChat Pay |
| 4 | **无CNY定价** | Premium ¥19.99/月 vs $19.99/月 是完全不同的价位 |

---

## 二、方案对比：三大路径

### 路径A：Stripe 原生扩展（推荐 ✅）

**核心思路**: 在现有 Stripe 架构上直接启用 Alipay + WeChat Pay + UnionPay，最小改动量。

| 支付方式 | Stripe支持 | 订阅制 | 集成难度 | 费率 |
|----------|-----------|--------|---------|------|
| **银联 (UnionPay)** | ✅ 作为卡类型 | ✅ **支持** | 极低 | 2.9%+$0.30 (国际卡+1%) |
| **支付宝 (Alipay)** | ✅ 钱包类型 | ⚠️ 需审批 | 低 | 2.9%+$0.30 |
| **微信支付 (WeChat Pay)** | ✅ 钱包类型 | ❌ **不支持** | 低 | 2.9%+$0.30 |

**优势**:
- 改动量最小（仅改checkout配置 + 添加CNY定价）
- 统一在Stripe Dashboard管理所有支付
- Webhook处理逻辑复用，无需新写
- 银联支持订阅制 → 解决Premium月付/年付的核心需求

**劣势**:
- 微信支付**不支持订阅制**（只能一次性付款）
- 支付宝订阅需Stripe审批（约1-3工作日）
- 费率相对较高（3.9%+，含国际卡附加费）

### 路径B：LemonSqueezy（备选）

**核心思路**: 用LemonSqueezy作为Merchant of Record，自动处理全球税务。

| 支付方式 | 支持 | 订阅制 | 费率 |
|----------|------|--------|------|
| 银联 | ✅ | ✅ | 5%+$0.50 |
| 支付宝 | ✅ | ⚠️ 仅一次性 | 5%+$0.50 |
| 微信支付 | ✅ | ⚠️ 仅一次性 | 5%+$0.50 |

**优势**: 无需企业资质，中国个人开发者可申请；自动处理全球增值税
**劣势**: 费率5%比Stripe高72%；订阅不支持支付宝/微信；无法深度定制UI

### 路径C：支付宝/微信直连 + Stripe双轨（最完整但最复杂）

**核心思路**: 国内用户走支付宝/微信直连API，国际用户走Stripe。

| 组件 | 国内 | 国际 |
|------|------|------|
| 支付网关 | 支付宝开放平台 + 微信支付商户平台 | Stripe |
| 订阅制 | 支付宝周期扣款 + 微信委托代扣 | Stripe Subscriptions |
| 结算 | 人民币直收 | USD/EUR |
| 合规 | 需要ICP备案 + 支付业务许可 | Stripe合规 |

**优势**: 覆盖最全，体验最好，费率最低（0.6%）
**劣势**: 需要中国大陆企业资质 + ICP备案；两套支付系统维护成本翻倍；需独立开发支付页面

---

## 三、推荐方案：路径A — Stripe原生扩展

### 选择理由

1. **改动量**: 仅需修改5个文件，2天内完成
2. **银联覆盖订阅制**: UnionPay是卡类型，天然支持Stripe Subscriptions
3. **统一管理**: 所有支付在Stripe Dashboard，无需双系统
4. **合规成本低**: 无需中国境内企业资质
5. **当前团队规模**: 1人开发，复杂双轨系统无法维护

### 关键限制与应对

| 限制 | 影响 | 应对策略 |
|------|------|---------|
| 微信支付不支持订阅 | 无法自动月扣 | **年付一次性**：微信/支付宝走一次性年费¥128；银联/信用卡走月付¥19.9 |
| 支付宝订阅需审批 | 1-3天等待 | 先上线银联+微信，支付宝后续加 |
| 费率3.9%+ | 每笔多付1% | CNY定价适当上调覆盖（¥19.9→¥21.9） |

---

## 四、实施细节

### 4.1 定价策略

| 套餐 | USD | CNY (含税) | 折合USD | 备注 |
|------|-----|-----------|---------|------|
| Premium 月付 | $19.99 | ¥138/月 | ~$19.0 | 银联/信用卡订阅 |
| Premium 年付 | $149.99 | ¥998/年 | ~$137.3 | 所有人群，微信/支付宝可一次性 |
| Lady Free | $0 | ¥0 | — | 女性，无需付费 |
| 信用卡验证 | $0 | ¥0 | — | 身份验证，不扣费 |

**汇率策略**: CNY定价采用固定汇率（1USD=7.0CNY），每月调整一次，避免实时汇率波动。

### 4.2 代码修改 — 5个文件

#### 文件1: `src/app/api/payments/checkout/route.ts`

```typescript
// ═══ 修改1: 扩展Plan配置 ═══════════════════════════════
const PLAN_CONFIG = {
  PREMIUM_MONTHLY: {
    name: "LokFeel Premium Monthly",
    nameCN: "LokFeel 高级会员 · 月付",
    description: "Full power for serious seekers — monthly billing",
    amountUSD: 1999,   // $19.99
    amountCNY: 13800,  // ¥138
    interval: "month" as const,
    perks: { weeklyLimit: 5, canInitiateChat: true, canViewFullProfile: true },
  },
  PREMIUM_YEARLY: {
    name: "LokFeel Premium Yearly",
    nameCN: "LokFeel 高级会员 · 年付",
    description: "Full power for serious seekers — yearly billing (save 37%)",
    amountUSD: 14999,  // $149.99
    amountCNY: 99800,  // ¥998
    interval: "year" as const,
    perks: { weeklyLimit: 5, canInitiateChat: true, canViewFullProfile: true },
  },
} as const;

// ═══ 修改2: 扩展Checkout Schema ═════════════════════════
const checkoutSchema = z.object({
  plan: z.enum(["PREMIUM_MONTHLY", "PREMIUM_YEARLY"]),
  currency: z.enum(["usd", "cny"]).default("usd"),
  paymentMethod: z.enum(["card", "alipay", "wechat_pay", "unionpay"]).default("card"),
});

// ═══ 修改3: 动态支付方式 ═══════════════════════════════
function getPaymentMethodTypes(currency: string, paymentMethod: string): string[] {
  if (currency === "cny") {
    // CNY模式: 根据用户选择的支付方式
    switch (paymentMethod) {
      case "alipay":
        return ["alipay"];
      case "wechat_pay":
        return ["wechat_pay"];
      case "unionpay":
        return ["card"]; // UnionPay在Stripe中作为card处理
      default:
        return ["card", "alipay", "wechat_pay"]; // 全部展示
    }
  }
  // USD模式: 保持原有逻辑
  return ["card"];
}

// ═══ 修改4: 创建Checkout Session ═══════════════════════
export async function POST(request: NextRequest) {
  try {
    // ... (auth + validation 不变)

    const { plan, currency, paymentMethod } = parseResult.data;
    const planConfig = PLAN_CONFIG[plan];

    // 决定金额和货币
    const isCNY = currency === "cny";
    const amount = isCNY ? planConfig.amountCNY : planConfig.amountUSD;
    const cur = isCNY ? "cny" : "usd";

    // 决定支付方式
    const paymentMethodTypes = getPaymentMethodTypes(cur, paymentMethod);

    // 微信支付/支付宝仅支持一次性支付 → 强制年付
    const isWalletPayment = paymentMethod === "alipay" || paymentMethod === "wechat_pay";
    const mode = isWalletPayment && isCNY ? "payment" : "subscription";

    const session = await stripe.checkout.sessions.create({
      customer: stripeCustomerId,
      mode,  // subscription 或 payment
      payment_method_types: paymentMethodTypes,
      line_items: [{
        price_data: {
          currency: cur,
          product_data: {
            name: isCNY ? planConfig.nameCN : planConfig.name,
            description: planConfig.description,
            images: [`${appUrl}/og-image.png`],
          },
          unit_amount: amount,
          ...(mode === "subscription" ? {
            recurring: { interval: planConfig.interval },
          } : {}),
        },
        quantity: 1,
      }],
      success_url: `${appUrl}/dashboard/subscription/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/dashboard/subscription/cancel`,
      metadata: {
        userId: user.id,
        plan,
        currency: cur,
        paymentMethod,
        isOneTime: isWalletPayment && isCNY ? "true" : "false",
      },
      // 支付宝需要return_url
      ...(paymentMethod === "alipay" ? {
        payment_method_options: {
          alipay: {
            flow: "payer_action_required",  // 重定向到支付宝
          },
        },
      } : {}),
      // 微信支付需要特殊配置
      ...(paymentMethod === "wechat_pay" ? {} : {}),
      allow_promotion_codes: true,
      billing_address_collection: "auto",
    });

    return success({ checkoutUrl: session.url, sessionId: session.id });
  } catch (error) {
    console.error("[Checkout] Error:", error);
    return serverError("Failed to create checkout session");
  }
}
```

#### 文件2: `src/app/api/webhooks/stripe/route.ts`

```typescript
// ═══ 新增事件: checkout.session.completed 处理CNY支付 ═══
// 修改 handleCheckoutCompleted 以处理一次性付款（微信/支付宝年付）

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const userId = session.metadata?.userId;
  const plan = session.metadata?.plan as string | undefined;
  const isOneTime = session.metadata?.isOneTime === "true";
  const currency = session.metadata?.currency || "usd";

  if (!userId) return;

  const customerId = session.customer as string;
  const subscriptionId = session.subscription as string;

  // ... 现有订阅逻辑不变 ...

  // ═══ 新增: 一次性CNY支付处理 ═══
  if (isOneTime && !subscriptionId) {
    // 微信/支付宝一次性年付 → 手动创建/更新订阅记录
    const effectivePlan = plan || "PREMIUM_YEARLY";

    const existingSub = await db.subscription.findFirst({ where: { userId } });

    const subData = {
      plan: effectivePlan as "PREMIUM_YEARLY",
      status: "ACTIVE" as const,
      stripeCustomerId: customerId,
      stripeSubscriptionId: undefined, // 一次性支付无subscription
      weeklyMatchLimit: 5,
      canInitiateChat: true,
      canViewFullProfile: true,
      startsAt: new Date(),
      stripeCurrentPeriodEnd: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1年后到期
      cancelledAt: null,
    };

    if (existingSub) {
      await db.subscription.update({ where: { id: existingSub.id }, data: subData });
    } else {
      await db.subscription.create({ data: { userId, ...subData } });
    }

    // 记录支付
    await db.payment.create({
      data: {
        userId,
        stripePaymentIntentId: (session.payment_intent as string) || undefined,
        amount: (session.amount_total || 0) / 100,
        currency: currency,
        status: "SUCCEEDED",
        description: `LokFeel Premium Yearly (CNY one-time via ${session.metadata?.paymentMethod})`,
      },
    });
  }
}
```

#### 文件3: `src/components/payment/CardVerificationWall.tsx`

```typescript
// ═══ 修改: 支持中国支付方式的验证墙 ═══
// 新增中国用户可选择的支付验证方式

interface CardVerificationWallProps {
  onSuccess?: () => void;
  variant?: "modal" | "inline";
  title?: string;
  description?: string;
  /** 新增: 用户地区 */
  userRegion?: "international" | "china";
}
```

#### 文件4: `src/app/api/payments/verify-card/route.ts`

```typescript
// ═══ 修改: 支持银联卡验证 ═══
const setupIntent = await stripe.setupIntents.create({
  customer: stripeCustomerId,
  payment_method_types: ["card"], // UnionPay卡自动通过card类型处理
  usage: "off_session",
  metadata: {
    userId: user.id,
    purpose: "card_verification",
  },
});
// 无需改动 — 银联卡在Stripe中就是card类型，自动支持
```

#### 文件5: 新增 `src/components/payment/ChinaPaymentSelector.tsx`

```typescript
"use client";

import { useState } from "react";
import { CreditCard, Smartphone, Wallet, QrCode } from "lucide-react";

interface ChinaPaymentSelectorProps {
  plan: "PREMIUM_MONTHLY" | "PREMIUM_YEARLY";
  onSelect: (method: { currency: string; paymentMethod: string }) => void;
}

const PAYMENT_OPTIONS = [
  {
    id: "unionpay",
    icon: CreditCard,
    label: "银联卡",
    description: "支持借记卡/信用卡，可月付",
    supportsSubscription: true,
    color: "#E21836",
  },
  {
    id: "alipay",
    icon: Wallet,
    label: "支付宝",
    description: "扫码支付，仅年付",
    supportsSubscription: false,
    color: "#1677FF",
  },
  {
    id: "wechat_pay",
    icon: Smartphone,
    label: "微信支付",
    description: "扫码支付，仅年付",
    supportsSubscription: false,
    color: "#07C160",
  },
  {
    id: "card",
    icon: CreditCard,
    label: "国际信用卡",
    description: "Visa/Mastercard/Amex",
    supportsSubscription: true,
    color: "#1A1F71",
  },
];

export function ChinaPaymentSelector({ plan, onSelect }: ChinaPaymentSelectorProps) {
  const [selected, setSelected] = useState<string | null>(null);

  const filteredOptions = plan === "PREMIUM_MONTHLY"
    ? PAYMENT_OPTIONS.filter(o => o.supportsSubscription)
    : PAYMENT_OPTIONS;

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-bold text-foreground">选择支付方式</h3>
      <div className="space-y-3">
        {filteredOptions.map((option) => (
          <button
            key={option.id}
            onClick={() => setSelected(option.id)}
            className={`w-full p-4 rounded-xl border-2 transition-all flex items-center gap-4
              ${selected === option.id
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/50"}`}
          >
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: `${option.color}15` }}
            >
              <option.icon className="w-5 h-5" style={{ color: option.color }} />
            </div>
            <div className="text-left flex-1">
              <p className="font-medium text-foreground">{option.label}</p>
              <p className="text-xs text-foreground-muted">{option.description}</p>
            </div>
            {selected === option.id && (
              <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                <div className="w-2 h-2 rounded-full bg-white" />
              </div>
            )}
          </button>
        ))}
      </div>
      <button
        disabled={!selected}
        onClick={() => {
          if (!selected) return;
          const isInternational = selected === "card";
          onSelect({
            currency: isInternational ? "usd" : "cny",
            paymentMethod: selected,
          });
        }}
        className="btn-primary w-full py-3"
      >
        确认支付
      </button>
    </div>
  );
}
```

### 4.3 Stripe Dashboard 配置

**步骤1: 启用支付方式**（5分钟）

1. 登录 [Stripe Dashboard](https://dashboard.stripe.com)
2. Settings → Payment methods
3. 依次启用:
   - ✅ Alipay → 点击"Turn on"
   - ✅ WeChat Pay → 点击"Turn on"
   - ✅ China UnionPay → 已自动包含在"Cards"中（Stripe自动识别银联卡号62开头）
4. 无需代码改动，Checkout/Elements自动展示

**步骤2: 申请支付宝订阅**（1-3工作日）

1. 联系Stripe Support: https://support.stripe.com/contact
2. 说明: "Request Alipay recurring payments for subscription business"
3. 提供业务描述: "Social dating platform with monthly/yearly subscriptions"
4. 审批通过后，Alipay可用于Stripe Subscriptions

**步骤3: 配置Webhook**（无需改动）

当前Webhook已处理 `checkout.session.completed`，CNY一次性支付和USD订阅支付走同一个handler。

### 4.4 Prisma Schema 修改

```prisma
model Payment {
  id              String           @id @default(cuid())
  userId          String
  user            User             @relation(fields: [userId], references: [id], onDelete: Cascade)
  
  stripePaymentIntentId String?     @unique
  amount          Float            // 原始金额
  currency        String           @default("usd")  // ← 新增: 支持 "cny"
  status          PaymentStatus    @default(PENDING)
  
  // 新增: 支付方式追踪
  paymentMethod   String?          // "card", "alipay", "wechat_pay", "unionpay"
  isOneTime       Boolean          @default(false)  // 是否一次性付款(微信/支付宝)
  
  description     String?
  metadata        String?          @db.Text  // JSON
  
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  
  @@index([userId])
  @@index([currency])     // 新增: 按货币查询
  @@index([paymentMethod]) // 新增: 按支付方式统计
}

model Subscription {
  // ... 现有字段不变 ...
  
  // 新增: CNY支付相关
  paymentMethod     String?          // "card", "alipay", "wechat_pay", "unionpay"
  currency          String           @default("usd")  // 订阅货币
  isOneTimePayment  Boolean          @default(false)  // 一次性年付标记
  
  @@index([currency])
}
```

Migration SQL:
```sql
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "paymentMethod" TEXT;
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "isOneTime" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS "Payment_currency_idx" ON "Payment"("currency");
CREATE INDEX IF NOT EXISTS "Payment_paymentMethod_idx" ON "Payment"("paymentMethod");

ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "paymentMethod" TEXT;
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "currency" TEXT NOT NULL DEFAULT 'usd';
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "isOneTimePayment" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS "Subscription_currency_idx" ON "Subscription"("currency");
```

---

## 五、用户体验流程

### 5.1 中国用户支付流程

```
┌──────────────────────────────────────────────────────────────┐
│                    中国用户订阅流程                            │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  [订阅页面]                                                   │
│     │                                                        │
│     ├─ 月付 ¥138/月 ──→ 银联卡/国际信用卡 ──→ Stripe订阅      │
│     │                                        自动月扣         │
│     │                                                        │
│     └─ 年付 ¥998/年 ──→ 选择支付方式 ─┬─ 银联卡 ──→ Stripe订阅│
│                                       ├─ 支付宝 ──→ 一次性付款│
│                                       ├─ 微信   ──→ 一次性付款│
│                                       └─ 信用卡 ──→ Stripe订阅│
│                                                              │
│  [信用卡验证墙]                                               │
│     │                                                        │
│     └─ 银联卡62开头 ──→ 自动识别 ──→ SetupIntent验证           │
│        (同现有信用卡流程)                                       │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 5.2 国际用户支付流程（不变）

```
信用卡 → Stripe Checkout → 月付/年付订阅 → Webhook → 激活Premium
```

---

## 六、费率与成本分析

### 6.1 每笔交易成本对比

| 支付方式 | Stripe费率 | 每笔¥138月付成本 | 每笔¥998年付成本 | 实际到账(年付) |
|----------|-----------|-----------------|-----------------|--------------|
| 银联卡(国内) | 2.9%+$0.30 + 1%国际 | ¥5.69 | ¥38.91 | ¥959.09 |
| 支付宝 | 2.9%+$0.30 | ¥4.31 | ¥29.41 | ¥968.59 |
| 微信支付 | 2.9%+$0.30 | ¥4.31 | ¥29.41 | ¥968.59 |
| 国际信用卡 | 2.9%+$0.30 | $6.09 | $46.79 | $1,102.20 |

### 6.2 与直连支付宝/微信对比

| 对比项 | Stripe (路径A) | 直连 (路径C) |
|--------|---------------|-------------|
| 费率 | 3.9%+ | 0.6% |
| ¥998年付成本 | ¥38.91 | ¥5.99 |
| 年付实际到账 | ¥959.09 | ¥992.01 |
| 集成成本 | 2天 | 2-4周 |
| 维护成本 | 低(1人) | 高(2套系统) |
| 合规成本 | $0 | ¥5,000+ (企业+ICP) |
| **1,000笔年付节省** | — | ¥32,920 |
| **达到盈亏平衡** | — | 需~2,000笔/月 |

**结论**: 月付费用户<2,000时，Stripe更经济；>2,000时可考虑迁移到直连。

---

## 七、风险与合规

### 7.1 法律合规

| 风险项 | 级别 | 说明 | 应对 |
|--------|------|------|------|
| 跨境支付合规 | 🟡 | 中国居民年度购汇额度$50,000 | CNY定价避免用户购汇 |
| ICP备案 | 🔴 | 如果面向中国大陆用户运营 | 当前app.lokfeel.com在Vercel无需备案；如果用国内域名则需 |
| 支付业务许可 | 🟡 | 非支付机构不得从事资金清算 | Stripe作为持牌机构处理，LokFeel仅作为商户 |
| 税务 | 🟡 | 中国增值税/服务税 | Stripe不代扣中国税；需自行申报或使用LemonSqueezy |

### 7.2 技术风险

| 风险项 | 级别 | 说明 | 应对 |
|--------|------|------|------|
| 微信/支付宝无法自动续费 | 🔴 | 到期后不会自动扣款 | 到期前7天发送通知，引导用户手动续费 |
| 一次性年付无cancel机制 | 🟡 | 用户无法中途取消获退款 | 实现7天无理由退款策略 |
| 银联3DS验证 | 🟡 | 部分银联卡需3DS认证 | Stripe自动处理3DS流程 |
| 支付宝审批不通过 | 🟡 | 少数业务类别被拒 | 优先保证银联+微信，支付宝降级为可选 |

---

## 八、实施时间线

| 阶段 | 任务 | 时间 | 依赖 |
|------|------|------|------|
| **Day 1 上午** | Stripe Dashboard启用Alipay+WeChat Pay+UnionPay | 30min | Stripe账号 |
| **Day 1 上午** | 修改checkout/route.ts添加CNY+多支付方式 | 2h | — |
| **Day 1 下午** | 修改webhook处理一次性CNY付款 | 2h | — |
| **Day 1 下午** | Prisma migration + 新增字段 | 1h | — |
| **Day 2 上午** | 开发ChinaPaymentSelector组件 | 3h | — |
| **Day 2 上午** | 集成到订阅页面 | 1h | — |
| **Day 2 下午** | E2E测试（银联/支付宝/微信） | 2h | Stripe测试模式 |
| **Day 2 下午** | 部署到生产 | 1h | — |
| **Day 3** | 联系Stripe申请支付宝订阅审批 | 异步 | Stripe Support |

---

## 九、后续演进路径

```
Phase 1 (当前): Stripe原生扩展
  ├── 银联 ✅ (订阅制)
  ├── 微信支付 ✅ (一次性年付)
  ├── 支付宝 ✅ (一次性年付，订阅待审批)
  └── 成本: ¥0 额外

Phase 2 (用户>5,000): 双轨混合
  ├── 国际用户: Stripe (USD)
  ├── 中国用户: 直连支付宝/微信 (CNY, 0.6%费率)
  └── 成本: 需中国大陆企业 + ¥5,000/年

Phase 3 (用户>50,000): 本地化部署
  ├── 阿里云/腾讯云部署
  ├── 全量接入支付宝+微信+银联
  ├── CNY直收，自动开票
  └── 成本: ¥20,000/月 (服务器+支付通道+合规)
```

---

## 十、决策建议

**Frank，这是我的结论：**

### 立即执行（Day 1-2）

1. ✅ **Stripe Dashboard启用三件套**（5分钟）
2. ✅ **修改checkout支持CNY+多支付方式**（核心改动）
3. ✅ **银联卡作为主推**（唯一支持月订阅的中国支付方式）

### 本周完成

4. ✅ 支付宝/微信仅支持年付（¥998一次性）
5. ✅ 7天无理由退款策略
6. ✅ 联系Stripe申请支付宝订阅审批

### 暂缓

7. ⏸ 直连支付宝/微信（用户>5,000时再评估）
8. ⏸ 中国大陆ICP备案（决定主攻国内市场时再启动）
9. ⏸ LemonSqueezy双轨（如果Stripe审批不过再考虑）

**核心逻辑**: 银联卡能覆盖80%的中国付费场景（借记卡+信用卡，支持月付），微信/支付宝作为年付补充。最小改动，最快上线。
