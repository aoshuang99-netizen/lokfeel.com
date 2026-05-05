import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Stripe from "stripe";

// Initialize Stripe only if secret key is available
const stripe = process.env.STRIPE_SECRET_KEY 
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

// GET /api/admin/subscriptions/[id] - Get subscription details
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    
    // Check admin permission
    if (!session?.user || (session.user as any)?.role !== "SUPER_ADMIN") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

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
}

// POST /api/admin/subscriptions/[id]/refund - Process refund
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
    const { amount, reason } = body;

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

    // Log the refund action using AdminAudit model
    await prisma.adminAudit.create({
      data: {
        actorId: (session.user as any)?.id || "",
        category: "PAYMENT" as any,
        action: "subscription.refund",
        targetType: "Subscription",
        targetId: id,
        details: JSON.stringify({
          refundId: refund.id,
          amount: refundAmount,
          reason: reason || "requested_by_customer",
          stripeSubscriptionId: subscription.stripeSubscriptionId,
        }),
        reason: reason || "Refund processed",
        ipAddress: request.headers.get("x-forwarded-for") || undefined,
        userAgent: request.headers.get("user-agent") || undefined,
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
}
