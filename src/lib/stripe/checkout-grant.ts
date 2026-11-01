import type Stripe from "stripe";

/**
 * `checkout.session.completed` 的**授权 + 记账决策**，与 DB 写入分离。
 *
 * ## 为什么要把这段抽出来（2026-10-31 审计发现的缺陷）
 *
 * 原实现（`/api/webhooks/stripe` 的 `handleCheckoutCompleted`）有两个独立缺陷，
 * 都属于「钱算错了但日志一片绿」这一类：
 *
 * ### B-10（P1）首期款被记两遍
 *
 * 原实现无条件 `db.payment.create({ stripePaymentIntentId: session.payment_intent })`。
 * 但**订阅模式**下 `CheckoutSession.payment_intent` 恒为 `null`——首期款的
 * PaymentIntent 挂在发票上（`invoice.payments[].payment.payment_intent`）。
 * 于是同一次扣款会落成两条 `Payment`：
 *
 *   1. `checkout.session.completed` → `Payment{ amount: 19.99, stripePaymentIntentId: null }`
 *   2. `invoice.payment_succeeded`   → `Payment{ amount: 19.99, stripePaymentIntentId: pi_xxx }`
 *
 * 两条都 `status=SUCCEEDED`，而管理台收入是
 * `payment.aggregate({ where: { status: "SUCCEEDED" }, _sum: { amount } })`
 * （`api/admin/dashboard/summary`、`api/admin/analytics`）⇒ **收入恒为真实值的 2 倍**，
 * 且第 1 条没有 PI，事后无法与 Stripe 对账、也无法识别为重复。
 * 另外 Stripe 是 at-least-once 投递，重投一次就再多一条。
 *
 * 修法：**订阅模式的记账权归发票**（`invoice.payment_succeeded` 已经写好、带 PI、
 * 有唯一键判重）。checkout 只负责授权，`invoiceId` 存在时明确不写钱。
 * 仅一次性支付（无 invoice）才在 checkout 内记账，并按 PI 判重。
 *
 * ### B-11（P2）未付款也发 Premium
 *
 * `checkout.session.completed` 在**异步支付方式**（SEPA/银行转账等）下会以
 * `payment_status: "unpaid"` 先到，钱过几天才到（`checkout.session.async_payment_succeeded`）。
 * 原实现不看 `payment_status`，直接 `status: "ACTIVE"` + 写 SUCCEEDED 流水
 * ⇒ 没付钱先拿 Premium；且 `async_payment_failed` 根本没进 switch，
 * 失败后无人回收权限。
 *
 * 修法：只有 `payment_status` 属于「已到账/无需付款」才授权；
 * `unpaid` 直接跳过（留给 async 事件），`async_payment_failed` 单独通知用户。
 *
 * ### B-12（P2）年付的有效期只有 30 天
 *
 * 原实现不管什么套餐一律 `Date.now() + 30d`。年付用户在
 * `customer.subscription.created` 到达前（事件顺序不保证）看到的是
 * 「30 天后到期」，若此后订阅事件丢失则永久错。修法：按套餐给周期，
 * 且订阅事件到达后仍以 Stripe 的 `current_period_end` 为准（既有行为不变）。
 */

export type CheckoutPlan = "PREMIUM_MONTHLY" | "PREMIUM_YEARLY";

const PLAN_PERKS: Record<CheckoutPlan, { weeklyMatchLimit: number; days: number }> = {
  PREMIUM_MONTHLY: { weeklyMatchLimit: 5, days: 30 },
  PREMIUM_YEARLY: { weeklyMatchLimit: 5, days: 365 },
};

/**
 * 只描述本模块真正读取的字段。`Stripe.Checkout.Session` 满足此形状，
 * 单测可直接传普通对象，不必构造 SDK 类型。
 */
export interface CheckoutSessionLike {
  id: string;
  payment_status?: string | null;
  customer?: unknown;
  subscription?: unknown;
  invoice?: unknown;
  payment_intent?: unknown;
  amount_total?: number | null;
  currency?: string | null;
  metadata?: Record<string, string> | null;
}

export interface CheckoutGrant {
  userId: string;
  plan: CheckoutPlan;
  /** Premium 权益快照，授权时一并写入，避免与 plans.ts 双改时漂移。 */
  weeklyMatchLimit: number;
  canInitiateChat: boolean;
  canViewFullProfile: boolean;
  customerId: string | null;
  subscriptionId: string | null;
  /** 非空 ⇒ 记账权归 `invoice.payment_succeeded`，checkout 不写 `Payment`。 */
  invoiceId: string | null;
  paymentIntentId: string | null;
  /** 单位：元（与 `Payment.amount` 一致）。 */
  amount: number;
  currency: string;
  /** 兜底周期结束时间；订阅事件到达后以 Stripe 的为准。 */
  periodEnd: Date;
}

export type CheckoutOutcome =
  | { kind: "grant"; grant: CheckoutGrant }
  /**
   * `no-user`：metadata 缺 userId（老版本客户端 / 手工创建的 session），只记日志；
   * `unpaid`：异步支付未到账，等 `checkout.session.async_payment_succeeded`。
   */
  | { kind: "skip"; reason: "no-user" | "unpaid" };

/** Stripe 的可展开字段既可能是 ID 字符串，也可能是对象。 */
export function idOf(value: unknown): string | null {
  if (typeof value === "string") return value.length > 0 ? value : null;
  if (value && typeof value === "object" && "id" in value) {
    const id = (value as { id?: unknown }).id;
    return typeof id === "string" && id.length > 0 ? id : null;
  }
  return null;
}

export function isCheckoutPlan(value: unknown): value is CheckoutPlan {
  return value === "PREMIUM_MONTHLY" || value === "PREMIUM_YEARLY";
}

/**
 * `payment_status` 允许授权的取值：
 *   - `paid`：已到账；
 *   - `no_payment_required`：100% 优惠码 / 试用首期，Stripe 明确表示不需要付款。
 * 其余（`unpaid`）一律不授权。
 */
function isSettled(paymentStatus: string | null | undefined): boolean {
  return paymentStatus === "paid" || paymentStatus === "no_payment_required";
}

export function decideCheckoutGrant(
  session: CheckoutSessionLike,
  now: Date = new Date()
): CheckoutOutcome {
  const userId = session.metadata?.userId?.trim();
  if (!userId) return { kind: "skip", reason: "no-user" };

  if (!isSettled(session.payment_status)) {
    return { kind: "skip", reason: "unpaid" };
  }

  const plan: CheckoutPlan = isCheckoutPlan(session.metadata?.plan)
    ? (session.metadata?.plan as CheckoutPlan)
    : "PREMIUM_MONTHLY";
  const perks = PLAN_PERKS[plan];

  return {
    kind: "grant",
    grant: {
      userId,
      plan,
      weeklyMatchLimit: perks.weeklyMatchLimit,
      canInitiateChat: true,
      canViewFullProfile: true,
      customerId: idOf(session.customer),
      subscriptionId: idOf(session.subscription),
      invoiceId: idOf(session.invoice),
      paymentIntentId: idOf(session.payment_intent),
      // Stripe 的金额单位是「分」，且 `amount_total` 可能为 null（$0 试用）。
      amount: (session.amount_total ?? 0) / 100,
      currency: (session.currency || "usd").toLowerCase(),
      periodEnd: new Date(now.getTime() + perks.days * 24 * 60 * 60 * 1000),
    },
  };
}

/** 只依赖真正用到的方法，便于单测注入假实现。 */
export interface CheckoutPaymentPort {
  findUnique(args: {
    where: { stripePaymentIntentId: string };
    select?: { id: true };
  }): Promise<{ id: string } | null>;
  update(args: {
    where: { id: string };
    data: Record<string, unknown>;
  }): Promise<unknown>;
  create(args: { data: Record<string, unknown> }): Promise<unknown>;
}

export type CheckoutPaymentResult =
  /** 订阅模式：钱由发票事件记，这里不写。 */
  | { action: "deferred-to-invoice"; invoiceId: string }
  | { action: "created"; paymentIntentId: string | null }
  | { action: "updated"; paymentIntentId: string };

/**
 * 把 checkout 的收款落成 `Payment`。**订阅模式必须 defer**——这是 B-10 的修法本体。
 *
 * 一次性支付走 PI 判重（`stripePaymentIntentId` 是 `@unique`）：
 * 命中就 update（把可能残留的 FAILED 纠正为 SUCCEEDED），未命中才 create，
 * 与 `recordInvoicePayment` 保持同一套语义。
 *
 * 残余风险（已知、可接受）：既无 invoice 又无 PI 的 session 无法判重，
 * 重投会多一条。实践中 `payment` 模式且已到账必有 PI，此分支仅兜底并告警。
 */
export async function recordCheckoutPayment(
  ports: { payments: CheckoutPaymentPort },
  grant: CheckoutGrant,
  description: string
): Promise<CheckoutPaymentResult> {
  if (grant.invoiceId) {
    return { action: "deferred-to-invoice", invoiceId: grant.invoiceId };
  }

  const data: Record<string, unknown> = {
    userId: grant.userId,
    amount: grant.amount,
    currency: grant.currency,
    status: "SUCCEEDED",
    description,
  };

  if (grant.paymentIntentId) {
    const existing = await ports.payments.findUnique({
      where: { stripePaymentIntentId: grant.paymentIntentId },
      select: { id: true },
    });

    if (existing) {
      await ports.payments.update({
        where: { id: existing.id },
        data: { ...data, stripePaymentIntentId: grant.paymentIntentId },
      });
      return { action: "updated", paymentIntentId: grant.paymentIntentId };
    }
    data.stripePaymentIntentId = grant.paymentIntentId;
  }

  await ports.payments.create({ data });
  return { action: "created", paymentIntentId: grant.paymentIntentId };
}

/** 写入 `Subscription` 的字段快照。显式声明形状，让 route 侧保留 Prisma 的类型检查。 */
export interface SubscriptionWriteData {
  plan: CheckoutPlan;
  status: "ACTIVE";
  stripeCustomerId: string | null;
  /** 一次性支付没有订阅 ID；Prisma 接受 undefined（字段可空）。 */
  stripeSubscriptionId: string | undefined;
  weeklyMatchLimit: number;
  canInitiateChat: boolean;
  canViewFullProfile: boolean;
  startsAt: Date;
  stripeCurrentPeriodEnd: Date;
  cancelledAt: null;
}

/** 便于 handler 直接落库的订阅字段（形状对齐 `prisma/schema/billing`）。 */
export function subscriptionDataFor(grant: CheckoutGrant): SubscriptionWriteData {
  return {
    plan: grant.plan,
    status: "ACTIVE",
    stripeCustomerId: grant.customerId,
    stripeSubscriptionId: grant.subscriptionId || undefined,
    weeklyMatchLimit: grant.weeklyMatchLimit,
    canInitiateChat: grant.canInitiateChat,
    canViewFullProfile: grant.canViewFullProfile,
    startsAt: new Date(),
    stripeCurrentPeriodEnd: grant.periodEnd,
    cancelledAt: null,
  };
}

export type { Stripe };
