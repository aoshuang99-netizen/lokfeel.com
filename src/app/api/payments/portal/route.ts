export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth/auth"
import { success, badRequest, serverError } from "@/lib/api-response";
import Stripe from "stripe";

export async function POST(request: NextRequest) {
  try {
    

    const { user } = await requireAuth();

    // Get user's subscription
    const subscription = await db.subscription.findFirst({
      where: { userId: user.id },
    });

    if (!subscription?.stripeCustomerId) {
      return badRequest("No Stripe customer found. Please subscribe first.");
    }

    // Initialize Stripe
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
      apiVersion: "2024-12-18.acacia",
    });

    // Create customer portal session
    const session = await stripe.billingPortal.sessions.create({
      customer: subscription.stripeCustomerId,
      return_url: `${process.env.NEXT_PUBLIC_APP_URL}/subscription`,
    });

    return success({ portalUrl: session.url });
  } catch (error) {
    console.error("Error creating portal session:", error);
    return serverError("Failed to create portal session");
  }
}
