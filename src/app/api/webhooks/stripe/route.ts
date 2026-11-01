export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import Stripe from "stripe";
import { isFemaleGender } from "@/lib/gender-utils";
import { STRIPE_API_VERSION } from "@/lib/stripe/config";
import {
  isPaymentChannelReady,
  missingForChannel,
} from "@/lib/payments/availability";
import { paymentNotConfigured } from "@/lib/payments/not-configured";
import {
  recordInvoicePayment,
  type PaymentRecordPort,
} from "@/lib/stripe/invoice-payment-record";
import {
  decideCheckoutGrant,
  recordCheckoutPayment,
  subscriptionDataFor,
  type CheckoutPaymentPort,
  type CheckoutSessionLike,
} from "@/lib/stripe/checkout-grant";
import {
  nextCancelledAt,
  periodEndOf,
  translateStripeStatus,
} from "@/lib/stripe/subscription-status";

function getStripe() {
  return new Stripe(process.env.STRIPE_SECRET_KEY || "", {
    apiVersion: STRIPE_API_VERSION,
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const signature = request.headers.get("stripe-signature");

    // 🔴 顺序很重要：先判「有没有接入」，再判「请求合不合法」。
    //    反过来写时，未签名的探测请求会先拿到 400，于是「未接入」这个状态
    //    在外部**不可观测** —— 也就无法用一条命令证明"最后一步还没做"。
    //    接入后同一请求会走验签分支（缺签名 ⇒ 400 / 签名错 ⇒ 400），
    //    所以 503 → 400 的转变本身就是「已接入」的判据。
    //
    //    判据用**通道**而不是单个变量：本 handler 在验签之后还会调 Stripe API，
    //    只有 secret 没有 secretKey 时，验签能过、处理阶段却会失败。
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET || "";
    if (!isPaymentChannelReady("stripe.webhook")) {
      console.error(
        `[Webhook] stripe.webhook channel is not configured (missing: ${missingForChannel("stripe.webhook").join(", ")})`,
      );
      return paymentNotConfigured("stripe.webhook", {
        error: "Webhook endpoint is not configured",
      });
    }

    if (!signature) {
      return NextResponse.json({ error: "Missing stripe-signature header" }, { status: 400 });
    }

    let event: Stripe.Event;
    try {
      event = getStripe().webhooks.constructEvent(body, signature, endpointSecret);
    } catch (err) {
      console.error("[Webhook] Signature verification failed:", err);
      return NextResponse.json({ error: "Webhook signature verification failed" }, { status: 400 });
    }

    // ═══ Route events ═══
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        await handleCheckoutCompleted(session);
        break;
      }
      // 异步支付方式（SEPA / 银行转账 …）的钱**晚到**：`completed` 先以
      // `payment_status:"unpaid"` 到达并被跳过，到账后由下面这个事件补授权。
      // 缺了它，异步支付的用户付了钱却永远拿不到 Premium。
      case "checkout.session.async_payment_succeeded": {
        const session = event.data.object as Stripe.Checkout.Session;
        await handleCheckoutCompleted(session);
        break;
      }
      case "checkout.session.async_payment_failed": {
        const session = event.data.object as Stripe.Checkout.Session;
        await handleAsyncPaymentFailed(session);
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionUpdated(subscription);
        break;
      }
      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionDeleted(subscription);
        break;
      }
      case "invoice.payment_succeeded": {
        const invoice = event.data.object as Stripe.Invoice;
        await handleInvoicePaymentSucceeded(invoice);
        break;
      }
      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        await handleInvoicePaymentFailed(invoice);
        break;
      }
      case "setup_intent.succeeded": {
        const setupIntent = event.data.object as Stripe.SetupIntent;
        await handleSetupIntentSucceeded(setupIntent);
        break;
      }
      default:
        console.log(`[Webhook] Unhandled event: ${event.type}`);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("[Webhook] Error:", error);
    return NextResponse.json({ error: "Webhook handler failed" }, { status: 500 });
  }
}

// ═══ Checkout Completed — Grant Premium ═════════════════════
// 授权与记账的判定全部交给 `checkout-grant.ts`（纯函数，可单测）。
// 这里只做 DB 写入，**不再**自己拼金额/周期，以免与发票链路写出两套口径。
async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const outcome = decideCheckoutGrant(session as unknown as CheckoutSessionLike);

  if (outcome.kind === "skip") {
    if (outcome.reason === "no-user") {
      console.error("[Webhook] No userId in checkout session metadata:", session.id);
    } else {
      // unpaid 不是错误：异步支付方式的正常第一跳，等 async_payment_succeeded。
      console.log(
        `[Webhook] Checkout ${session.id} not settled yet (payment_status=${session.payment_status}); awaiting async payment`
      );
    }
    return;
  }

  const { grant } = outcome;

  // ═══ Upsert subscription ═══
  const existingSub = await db.subscription.findFirst({ where: { userId: grant.userId } });
  // 同套餐重复事件（Stripe at-least-once 重投）不再重复发通知；
  // 升级/换套餐仍然会通知。
  const alreadyOnThisPlan =
    existingSub?.status === "ACTIVE" && existingSub?.plan === grant.plan;

  const subData = subscriptionDataFor(grant);

  if (existingSub) {
    await db.subscription.update({ where: { id: existingSub.id }, data: subData });
    console.log(`[Webhook] Updated subscription for user ${grant.userId} → ${grant.plan}`);
  } else {
    await db.subscription.create({ data: { userId: grant.userId, ...subData } });
    console.log(`[Webhook] Created subscription for user ${grant.userId} → ${grant.plan}`);
  }

  // ═══ Payment record ═══
  // 订阅模式的记账权归 `invoice.payment_succeeded`（带 PI、有唯一键判重），
  // 这里 defer；只有一次性支付才在此落账。详见 checkout-grant.ts 的 B-10 注释。
  const paymentDescription = `LokFee! ${grant.plan === "PREMIUM_YEARLY" ? "Yearly" : "Monthly"} Premium`;
  const recorded = await recordCheckoutPayment(
    { payments: db.payment as unknown as CheckoutPaymentPort },
    grant,
    paymentDescription
  );

  if (recorded.action === "deferred-to-invoice") {
    console.log(
      `[Webhook] Payment for ${session.id} deferred to invoice ${recorded.invoiceId} (avoids double counting)`
    );
  }

  // ═══ Notification ═══
  if (!alreadyOnThisPlan) {
    await db.notification.create({
      data: {
        userId: grant.userId,
        type: "SYSTEM_ANNOUNCEMENT",
        title: "Premium Activated! 🎉",
        body: `Your LokFee! ${grant.plan === "PREMIUM_YEARLY" ? "Yearly" : "Monthly"} Premium is now active. Enjoy unlimited matching!`,
        data: JSON.stringify({ plan: grant.plan }),
      },
    });
  }
}

// ═══ Async payment failed ═══════════════════════════════════
// 异步支付的第二跳是「失败」时，`checkout.session.completed` 早已被跳过，
// 因此这里不降权（本来就没授权），只通知用户去换个付款方式。
async function handleAsyncPaymentFailed(session: Stripe.Checkout.Session) {
  const userId = session.metadata?.userId;
  if (!userId) {
    console.warn("[Webhook] Async payment failed without userId:", session.id);
    return;
  }

  await db.notification.create({
    data: {
      userId,
      type: "SUBSCRIPTION_EXPIRED",
      title: "Payment Failed",
      body: "We could not complete your payment. Please try again with another payment method to activate Premium.",
      data: JSON.stringify({ sessionId: session.id, reason: "async_payment_failed" }),
    },
  });
}

// ═══ Subscription Updated ═══════════════════════════════════
async function handleSubscriptionUpdated(subscription: Stripe.Subscription) {
  const customerId = subscription.customer as string;

  const userSubscription = await db.subscription.findFirst({
    where: { stripeCustomerId: customerId },
  });

  if (!userSubscription) {
    console.error("[Webhook] No subscription found for customer:", customerId);
    return;
  }

  // 🔴 B-14：原来这里是 `statusMap[...] || "ACTIVE"`，只映射 5 个状态，
  //    把 Stripe 的 `incomplete` / `incomplete_expired` / `paused` 一律当 ACTIVE
  //    ⇒ 没收到钱也发 Premium（且 incomplete_expired 是终态，永不被纠正）。
  //    改为显式映射 + fail closed，详见 `lib/stripe/subscription-status.ts`。
  const translation = translateStripeStatus(subscription.status);
  if (translation.unknown) {
    // webhook 必须回 200（否则 Stripe 无限重投），因此只告警不改协议：
    // 未知状态按「不发权益」处理，等下一条件正常事件覆盖。
    console.warn(
      `[Webhook] Unknown Stripe subscription status "${translation.raw}" for customer ${customerId} — treated as ${translation.status} (no entitlement)`,
    );
  }

  // Detect plan from price ID
  const priceId = subscription.items.data[0]?.price.id;
  const detectedPlan = userSubscription.plan;
  // Could map priceId to plan type here if needed

  // 读不到周期就**不写**（不要退回 now+30d，那是 B-12 同类错误）：
  // `stripeCurrentPeriodEnd` 是到期判据，猜一个比不写更危险。
  const periodEnd = periodEndOf(subscription);

  await db.subscription.update({
    where: { id: userSubscription.id },
    data: {
      plan: detectedPlan,
      status: translation.status,
      ...(periodEnd
        ? {
            stripeCurrentPeriodEnd: periodEnd,
            // `endsAt` 与 `stripeCurrentPeriodEnd` 同步：全仓只有
            // `/api/profile/[userId]` 用 `endsAt > now` 判权，而 Stripe 订阅
            // 从创建到续费**从不写 endsAt**（只有 `subscription.deleted` 才写）。
            // 结果付费用户在资料页被当成免费用户 —— 两套判权口径的根源就在这。
            ...(translation.entitled ? { endsAt: periodEnd } : {}),
          }
        : {}),
      stripePriceId: priceId,
      // 无权状态（incomplete / expired / paused）不抹掉历史取消记录
      cancelledAt: nextCancelledAt(
        userSubscription.cancelledAt,
        translation,
        Boolean(subscription.cancel_at_period_end),
      ),
    },
  });
}

// ═══ Subscription Deleted ═══════════════════════════════════
async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  const customerId = subscription.customer as string;

  const userSubscription = await db.subscription.findFirst({
    where: { stripeCustomerId: customerId },
  });

  if (!userSubscription) return;

  // Downgrade to FREE (or LADY_FREE if female)
  const userProfile = await db.profile.findFirst({
    where: { userId: userSubscription.userId },
    select: { gender: true },
  });

  // DB maps registrations to the modern WOMAN convention, so almost no rows
  // hold the legacy "FEMALE". Use isFemaleGender() to cover both conventions.
  const female = isFemaleGender(userProfile?.gender);
  const newPlan = female ? "LADY_FREE" : "FREE";
  const newLimit = female ? 5 : 3;

  await db.subscription.update({
    where: { id: userSubscription.id },
    data: {
      plan: newPlan as any,
      status: "CANCELLED",
      weeklyMatchLimit: newLimit,
      canInitiateChat: female,
      canViewFullProfile: female,
      endsAt: new Date(),
    },
  });

  await db.notification.create({
    data: {
      userId: userSubscription.userId,
      type: "SUBSCRIPTION_EXPIRED",
      title: "Subscription Cancelled",
      body: female
        ? "Your Premium subscription has ended, but you still have Lady Free access with premium-level features."
        : "Your Premium subscription has ended. Upgrade again anytime to get full access.",
    },
  });
}

// ═══ Invoice Payment Succeeded ══════════════════════════════
async function handleInvoicePaymentSucceeded(invoice: Stripe.Invoice) {
  const customerId = invoice.customer as string;

  const userSubscription = await db.subscription.findFirst({
    where: { stripeCustomerId: customerId },
  });

  if (!userSubscription) return;

  await recordInvoicePayment(
    { stripe: getStripe(), payments: db.payment as unknown as PaymentRecordPort },
    {
      userId: userSubscription.userId,
      invoice,
      amount: (invoice.amount_paid || 0) / 100,
      status: "SUCCEEDED",
      description: `LokFee! ${userSubscription.plan} renewal`,
    }
  );

  console.log(`[Webhook] Renewal payment recorded for user ${userSubscription.userId}`);
}

// ═══ Invoice Payment Failed ═════════════════════════════════
async function handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
  const customerId = invoice.customer as string;

  const userSubscription = await db.subscription.findFirst({
    where: { stripeCustomerId: customerId },
  });

  if (!userSubscription) return;

  await db.subscription.update({
    where: { id: userSubscription.id },
    data: { status: "PAST_DUE" },
  });

  await recordInvoicePayment(
    { stripe: getStripe(), payments: db.payment as unknown as PaymentRecordPort },
    {
      userId: userSubscription.userId,
      invoice,
      amount: (invoice.amount_due || 0) / 100,
      status: "FAILED",
      description: `LokFee! ${userSubscription.plan} payment failed`,
    }
  );

  await db.notification.create({
    data: {
      userId: userSubscription.userId,
      type: "SUBSCRIPTION_EXPIRED",
      title: "Payment Failed",
      body: "Your subscription payment failed. Please update your payment method to keep your Premium access.",
    },
  });
}

// ═══ Handle setup_intent.succeeded ═══════════════════════════
// Marks User.cardVerified = true when card verification (SetupIntent) succeeds
async function handleSetupIntentSucceeded(setupIntent: Stripe.SetupIntent) {
  const userId = setupIntent.metadata?.userId;

  if (!userId) {
    console.warn("[Webhook] SetupIntent succeeded but no userId in metadata:", setupIntent.id);
    return;
  }

  // Only process if purpose is card_verification
  if (setupIntent.metadata?.purpose !== "card_verification") {
    return;
  }

  await db.user.update({
    where: { id: userId },
    data: {
      cardVerified: true,
      cardVerifiedAt: new Date(),
    },
  });

  console.log(`[Webhook] Card verified for user ${userId} via SetupIntent ${setupIntent.id}`);
}
