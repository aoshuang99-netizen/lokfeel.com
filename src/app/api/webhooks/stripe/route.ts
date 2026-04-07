export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import Stripe from "stripe";

function getStripe() {
  return new Stripe(process.env.STRIPE_SECRET_KEY || "", {
    apiVersion: "2024-12-18.acacia",
  });
}

const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET || "";

export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const signature = request.headers.get("stripe-signature");

    if (!signature) {
      return NextResponse.json(
        { error: "Missing stripe-signature header" },
        { status: 400 }
      );
    }

    let event: Stripe.Event;

    try {
      event = getStripe().webhooks.constructEvent(body, signature, endpointSecret);
    } catch (err) {
      console.error("Webhook signature verification failed:", err);
      return NextResponse.json(
        { error: "Webhook signature verification failed" },
        { status: 400 }
      );
    }

    // Handle the event
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

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Webhook error:", error);
    return NextResponse.json(
      { error: "Webhook handler failed" },
      { status: 500 }
    );
  }
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const userId = session.metadata?.userId;
  const plan = session.metadata?.plan as "PREMIUM_MONTHLY" | "PREMIUM_YEARLY" | "LIFETIME" | undefined;

  if (!userId) {
    console.error("No userId in checkout session metadata");
    return;
  }

  const customerId = session.customer as string;
  const subscriptionId = session.subscription as string;

  // Get plan details
  const subscriptionPerks: Record<string, { weeklyLimit: number; canInitiateChat: boolean; canViewFullProfile: boolean }> = {
    PREMIUM_MONTHLY: { weeklyLimit: 10, canInitiateChat: true, canViewFullProfile: true },
    PREMIUM_YEARLY: { weeklyLimit: 15, canInitiateChat: true, canViewFullProfile: true },
    LIFETIME: { weeklyLimit: 20, canInitiateChat: true, canViewFullProfile: true },
  };

  const perks = subscriptionPerks[plan || "PREMIUM_MONTHLY"];

  // Create or update subscription (upsert by stripeCustomerId)
  const existingSub = await db.subscription.findFirst({ where: { userId } });
  
  const subData = {
    plan: (plan || "PREMIUM_MONTHLY") as "FREE" | "PREMIUM_MONTHLY" | "PREMIUM_YEARLY",
    status: "ACTIVE" as const,
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscriptionId || undefined,
    weeklyMatchLimit: perks.weeklyLimit,
    canInitiateChat: perks.canInitiateChat,
    canViewFullProfile: perks.canViewFullProfile,
    stripeCurrentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  };
  
  if (existingSub) {
    await db.subscription.update({
      where: { id: existingSub.id },
      data: { ...subData, cancelledAt: null },
    });
  } else {
    await db.subscription.create({ data: { userId, ...subData } });
  }

  // Create payment record
  await db.payment.create({
    data: {
      userId,
      stripePaymentIntentId: session.payment_intent as string || undefined,
      amount: (session.amount_total || 0) / 100, // Convert from cents
      currency: session.currency || "usd",
      status: "SUCCEEDED",
      description: `Nexus ${plan || "Premium"} subscription`,
    },
  });

  // Create notification
  await db.notification.create({
    data: {
      userId,
      type: "SYSTEM_ANNOUNCEMENT",
      title: "订阅成功！",
      body: `您已成功订阅Nexus ${plan === "LIFETIME" ? "终身" : plan === "PREMIUM_YEARLY" ? "年度" : "月度"}高级会员`,
      data: JSON.stringify({ plan }),
    },
  });
}

async function handleSubscriptionUpdated(subscription: Stripe.Subscription) {
  const customerId = subscription.customer as string;

  // Find user by customer ID
  const userSubscription = await db.subscription.findFirst({
    where: { stripeCustomerId: customerId },
  });

  if (!userSubscription) {
    console.error("No subscription found for customer:", customerId);
    return;
  }

  // Update subscription status
  const statusMap: Record<string, "ACTIVE" | "CANCELLED" | "EXPIRED" | "PAST_DUE" | "TRIALING"> = {
    active: "ACTIVE",
    trialing: "TRIALING",
    past_due: "PAST_DUE",
    canceled: "CANCELLED",
    unpaid: "EXPIRED",
  };

  await db.subscription.update({
    where: { id: userSubscription.id },
    data: {
      status: statusMap[subscription.status] || "ACTIVE",
      stripeCurrentPeriodEnd: (subscription as any).current_period_end
        ? new Date((subscription as any).current_period_end * 1000)
        : null,
      stripePriceId: subscription.items.data[0]?.price.id,
      cancelledAt: subscription.cancel_at_period_end ? new Date() : null,
    },
  });
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  const customerId = subscription.customer as string;

  const userSubscription = await db.subscription.findFirst({
    where: { stripeCustomerId: customerId },
  });

  if (!userSubscription) {
    return;
  }

  await db.subscription.update({
    where: { id: userSubscription.id },
    data: {
      status: "CANCELLED",
      endsAt: new Date(),
    },
  });

  // Notify user
  await db.notification.create({
    data: {
      userId: userSubscription.userId,
      type: "SUBSCRIPTION_EXPIRED",
      title: "订阅已取消",
      body: "您的Nexus高级会员订阅已取消。您将保留高级功能至本期结束。",
    },
  });
}

async function handleInvoicePaymentSucceeded(invoice: Stripe.Invoice) {
  const customerId = invoice.customer as string;

  const userSubscription = await db.subscription.findFirst({
    where: { stripeCustomerId: customerId },
  });

  if (!userSubscription) {
    return;
  }

  // Create payment record
  await db.payment.create({
    data: {
      userId: userSubscription.userId,
      stripePaymentIntentId: (invoice as any).payment_intent as string || undefined,
      amount: (invoice.amount_paid || 0) / 100,
      currency: invoice.currency || "usd",
      status: "SUCCEEDED",
      description: `Nexus ${userSubscription.plan} subscription renewal`,
    },
  });
}

async function handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
  const customerId = invoice.customer as string;

  const userSubscription = await db.subscription.findFirst({
    where: { stripeCustomerId: customerId },
  });

  if (!userSubscription) {
    return;
  }

  // Update subscription to past due
  await db.subscription.update({
    where: { id: userSubscription.id },
    data: {
      status: "PAST_DUE",
    },
  });

  // Create payment record
  await db.payment.create({
    data: {
      userId: userSubscription.userId,
      stripePaymentIntentId: (invoice as any).payment_intent as string || undefined,
      amount: (invoice.amount_due || 0) / 100,
      currency: invoice.currency || "usd",
      status: "FAILED",
      description: `Nexus ${userSubscription.plan} subscription payment failed`,
    },
  });

  // Notify user
  await db.notification.create({
    data: {
      userId: userSubscription.userId,
      type: "SUBSCRIPTION_EXPIRED",
      title: "支付失败",
      body: "您的订阅扣款失败，请更新支付方式以继续享受高级会员特权。",
    },
  });
}
