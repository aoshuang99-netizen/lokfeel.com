import { NextRequest, NextResponse } from "next/server";
import { withPermission } from "@/lib/with-permission";
import { prisma } from "@/lib/prisma";
import Stripe from "stripe";

// Initialize Stripe only if secret key is available
const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

// GET /api/admin/subscriptions/[id] - Get subscription details
export const GET = withPermission("payment.view")(async (request: NextRequest, context: any) => {
  try {
    const { id } = await context.params;

    // Get subscription from database
    const subscription = await prisma.subscription.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
      },
    });

    if (!subscription) {
      return NextResponse.json({ error: "Subscription not found" }, { status: 404 });
    }

    return NextResponse.json({ subscription });
  } catch (error) {
    console.error("Get subscription error:", error);
    return NextResponse.json({ error: "Failed to get subscription" }, { status: 500 });
  }
});

// POST /api/admin/subscriptions/[id] - Process refund
export const POST = withPermission("payment.refund", { dangerous: true })(async (request: NextRequest, context: any) => {
  try {
    const { id } = await context.params;
    const body = await request.json();
    const { amount, reason } = body;

    if (!stripe) {
      return NextResponse.json({ error: "Stripe not configured" }, { status: 500 });
    }

    // Get subscription from database
    const subscription = await prisma.subscription.findUnique({
      where: { id },
    });

    if (!subscription) {
      return NextResponse.json({ error: "Subscription not found" }, { status: 404 });
    }

    if (!subscription.stripeSubscriptionId) {
      return NextResponse.json({ error: "No Stripe subscription ID found" }, { status: 400 });
    }

    // Get Stripe subscription to find the payment intent
    const stripeSubscription = await stripe.subscriptions.retrieve(
      subscription.stripeSubscriptionId
    );

    if (!stripeSubscription) {
      return NextResponse.json({ error: "Stripe subscription not found" }, { status: 404 });
    }

    // Get the latest invoice
    const latestInvoice = stripeSubscription.latest_invoice as any;

    if (!latestInvoice || !latestInvoice.payment_intent) {
      return NextResponse.json({ error: "No payment found to refund" }, { status: 400 });
    }

    // Calculate refund amount (in cents)
    const refundAmount = amount
      ? Math.round(amount * 100)
      : latestInvoice.amount_paid;

    // Create refund in Stripe
    const refund = await stripe.refunds.create({
      payment_intent: (latestInvoice as any).payment_intent as string,
      amount: refundAmount,
      reason: reason || "requested_by_customer",
    });

    // Update subscription status in database
    await prisma.subscription.update({
      where: { id },
      data: {
        status: refund.status === "succeeded" ? "CANCELLED" : subscription.status,
        cancelledAt: new Date(),
      },
    });

    return NextResponse.json({
      success: true,
      refund: {
        id: refund.id,
        amount: refundAmount / 100,
        status: refund.status,
        created: refund.created,
      },
    });
  } catch (error) {
    console.error("Refund error:", error);
    return NextResponse.json({ error: "Failed to process refund" }, { status: 500 });
  }
});
