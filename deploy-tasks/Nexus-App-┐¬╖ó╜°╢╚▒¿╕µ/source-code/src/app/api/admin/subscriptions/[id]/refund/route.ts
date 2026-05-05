import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Stripe from "stripe";

// Initialize Stripe only if secret key is available
const stripe = process.env.STRIPE_SECRET_KEY 
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

// POST /api/admin/subscriptions/[id]/refund - Process refund for a subscription
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    
    // Check admin permission
    if (!session?.user || (session.user as any)?.role !== "SUPER_ADMIN") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!stripe) {
      return NextResponse.json({ error: "Stripe not configured" }, { status: 500 });
    }

    const { id } = await params;
    const body = await request.json();
    const { amount, reason, type } = body;

    // Validate refund type
    if (type && !["full", "partial"].includes(type)) {
      return NextResponse.json({ error: "Invalid refund type" }, { status: 400 });
    }

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

    // Get Stripe subscription to find the payment intent
    const stripeSubscription = await stripe.subscriptions.retrieve(
      subscription.stripeSubscriptionId
    );

    if (!stripeSubscription) {
      return NextResponse.json({ error: "Stripe subscription not found" }, { status: 404 });
    }

    // Get the latest invoice
    const latestInvoice = stripeSubscription.latest_invoice as Stripe.Invoice;
    
    if (!latestInvoice || !latestInvoice.payment_intent) {
      return NextResponse.json({ error: "No payment found to refund" }, { status: 400 });
    }

    // Calculate refund amount
    let refundAmount: number;
    if (type === "full" || !amount) {
      // Full refund - refund the entire amount
      refundAmount = latestInvoice.amount_paid;
    } else {
      // Partial refund - validate amount
      refundAmount = Math.round(amount * 100); // Convert to cents
      if (refundAmount > latestInvoice.amount_paid) {
        return NextResponse.json({ error: "Refund amount exceeds payment amount" }, { status: 400 });
      }
    }

    // Create refund in Stripe
    const refund = await stripe.refunds.create({
      payment_intent: latestInvoice.payment_intent as string,
      amount: refundAmount,
      reason: reason || "requested_by_customer",
    });

    // Update subscription status in database
    await prisma.subscription.update({
      where: { id },
      data: {
        status: refund.status === "succeeded" ? "refunded" : subscription.status,
        cancelledAt: new Date(),
      },
    });

    // Log the refund action
    await prisma.auditLog.create({
      data: {
        action: "REFUND",
        entityType: "Subscription",
        entityId: id,
        userId: (session.user as any)?.id || session.user?.email || "unknown",
        metadata: {
          refundId: refund.id,
          amount: refundAmount / 100,
          reason: reason || "requested_by_customer",
          stripeSubscriptionId: subscription.stripeSubscriptionId,
          userId: subscription.userId,
          userEmail: subscription.user?.email,
        },
      },
    });

    return NextResponse.json({
      success: true,
      refund: {
        id: refund.id,
        amount: refundAmount / 100,
        status: refund.status,
        created: refund.created,
        paymentIntent: latestInvoice.payment_intent,
      },
    });
  } catch (error) {
    console.error("Refund error:", error);
    return NextResponse.json({ error: "Failed to process refund" }, { status: 500 });
  }
}
