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
async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const userId = session.metadata?.userId;
  const plan = session.metadata?.plan as "PREMIUM_MONTHLY" | "PREMIUM_YEARLY" | undefined;

  if (!userId) {
    console.error("[Webhook] No userId in checkout session metadata");
    return;
  }

  const customerId = session.customer as string;
  const subscriptionId = session.subscription as string;

  // ═══ Plan perks ═══
  const planPerks: Record<string, { weeklyLimit: number; canInitiateChat: boolean; canViewFullProfile: boolean }> = {
    PREMIUM_MONTHLY: { weeklyLimit: 5, canInitiateChat: true, canViewFullProfile: true },
    PREMIUM_YEARLY: { weeklyLimit: 5, canInitiateChat: true, canViewFullProfile: true },
  };

  const perks = planPerks[plan || "PREMIUM_MONTHLY"];
  const effectivePlan = plan || "PREMIUM_MONTHLY";

  // ═══ Upsert subscription ═══
  const existingSub = await db.subscription.findFirst({ where: { userId } });

  const subData = {
    plan: effectivePlan as "PREMIUM_MONTHLY" | "PREMIUM_YEARLY",
    status: "ACTIVE" as const,
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscriptionId || undefined,
    weeklyMatchLimit: perks.weeklyLimit,
    canInitiateChat: perks.canInitiateChat,
    canViewFullProfile: perks.canViewFullProfile,
    startsAt: new Date(),
    stripeCurrentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    cancelledAt: null,
  };

  if (existingSub) {
    await db.subscription.update({
      where: { id: existingSub.id },
      data: subData,
    });
    console.log(`[Webhook] Updated subscription for user ${userId} → ${effectivePlan}`);
  } else {
    await db.subscription.create({ data: { userId, ...subData } });
    console.log(`[Webhook] Created subscription for user ${userId} → ${effectivePlan}`);
  }

  // ═══ Create payment record ═══
  await db.payment.create({
    data: {
      userId,
      stripePaymentIntentId: (session.payment_intent as string) || undefined,
      amount: (session.amount_total || 0) / 100,
      currency: session.currency || "usd",
      status: "SUCCEEDED",
      description: `LokFee! ${effectivePlan === "PREMIUM_YEARLY" ? "Yearly" : "Monthly"} Premium`,
    },
  });

  // ═══ Notification ═══
  await db.notification.create({
    data: {
      userId,
      type: "SYSTEM_ANNOUNCEMENT",
      title: "Premium Activated! 🎉",
      body: `Your LokFee! ${effectivePlan === "PREMIUM_YEARLY" ? "Yearly" : "Monthly"} Premium is now active. Enjoy unlimited matching!`,
      data: JSON.stringify({ plan: effectivePlan }),
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

  const statusMap: Record<string, "ACTIVE" | "CANCELLED" | "EXPIRED" | "PAST_DUE" | "TRIALING"> = {
    active: "ACTIVE",
    trialing: "TRIALING",
    past_due: "PAST_DUE",
    canceled: "CANCELLED",
    unpaid: "EXPIRED",
  };

  // Detect plan from price ID
  const priceId = subscription.items.data[0]?.price.id;
  const detectedPlan = userSubscription.plan;
  // Could map priceId to plan type here if needed

  await db.subscription.update({
    where: { id: userSubscription.id },
    data: {
      plan: detectedPlan,
      status: statusMap[subscription.status] || "ACTIVE",
      stripeCurrentPeriodEnd: (subscription as any).current_period_end
        ? new Date((subscription as any).current_period_end * 1000)
        : null,
      stripePriceId: priceId,
      cancelledAt: subscription.cancel_at_period_end ? new Date() : null,
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
