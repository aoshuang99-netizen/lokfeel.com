export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth/auth";
import { success, badRequest, serverError, forbidden } from "@/lib/api-response";
import { handleApiError } from "@/lib/api-handler";
import Stripe from "stripe";
import { isFemaleGender } from "@/lib/gender-utils";

// ═══ Checkout Schema ═══════════════════════════════════════════
const checkoutSchema = z.object({
  plan: z.enum(["PREMIUM_MONTHLY", "PREMIUM_YEARLY"]),
});

// ═══ Plan Config ═══════════════════════════════════════════════
const PLAN_CONFIG = {
  PREMIUM_MONTHLY: {
    name: "LokFee! Premium Monthly",
    description: "Full power for serious seekers — monthly billing",
    amount: 1999, // $19.99
    interval: "month" as const,
    perks: { weeklyLimit: 5, canInitiateChat: true, canViewFullProfile: true },
  },
  PREMIUM_YEARLY: {
    name: "LokFee! Premium Yearly",
    description: "Full power for serious seekers — yearly billing (save 37%)",
    amount: 14999, // $149.99/year = $12.50/month
    interval: "year" as const,
    perks: { weeklyLimit: 5, canInitiateChat: true, canViewFullProfile: true },
  },
} as const;

export async function POST(request: NextRequest) {
  return handleApiError(async () => {
    const { user } = await requireAuth();

    const body = await request.json();

    const parseResult = checkoutSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parseResult.error.issues },
        { status: 400 }
      );
    }

    const { plan } = parseResult.data;
    const planConfig = PLAN_CONFIG[plan];

    // ═══ Guard: Female users already have Lady Free ═══
    const userProfile = await db.profile.findFirst({
      where: { userId: user.id },
      select: { gender: true },
    });

    if (isFemaleGender(userProfile?.gender)) {
      return NextResponse.json(
        { error: "Women already have premium-level access for free via Lady Free plan" },
        { status: 403 }
      );
    }

    // ═══ Guard: Check if already has active premium ═══
    const existingSub = await db.subscription.findFirst({
      where: { userId: user.id, status: "ACTIVE" },
    });

    if (existingSub && (existingSub.plan === "PREMIUM_MONTHLY" || existingSub.plan === "PREMIUM_YEARLY")) {
      return NextResponse.json(
        { error: "You already have an active Premium subscription" },
        { status: 400 }
      );
    }

    // ═══ Check Stripe configuration ═══
    if (!process.env.STRIPE_SECRET_KEY) {
      console.error("[Checkout] STRIPE_SECRET_KEY not configured");
      return NextResponse.json(
        { error: "Payment system is not configured. Please try again later." },
        { status: 503 }
      );
    }

    // ═══ Initialize Stripe ═══
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: "2026-03-25.dahlia",
    });

    // ═══ Get or create Stripe customer ═══
    let stripeCustomerId = existingSub?.stripeCustomerId;

    if (!stripeCustomerId) {
      const userRecord = await db.user.findUnique({ where: { id: user.id } });
      if (!userRecord) return badRequest("User not found");

      const customer = await stripe.customers.create({
        email: userRecord.email,
        name: userRecord.name || undefined,
        metadata: { userId: user.id },
      });
      stripeCustomerId = customer.id;
    }

    // ═══ Create Checkout Session ═══
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://app.lokfeel.com";

    // Use price_data for dynamic pricing (no need to create products in Stripe Dashboard)
    const session = await stripe.checkout.sessions.create({
      customer: stripeCustomerId,
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [{
        price_data: {
          currency: "usd",
          product_data: {
            name: planConfig.name,
            description: planConfig.description,
            images: [`${appUrl}/og-image.png`],
          },
          unit_amount: planConfig.amount,
          recurring: { interval: planConfig.interval },
        },
        quantity: 1,
      }],
      success_url: `${appUrl}/dashboard/subscription/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/dashboard/subscription/cancel`,
      metadata: {
        userId: user.id,
        plan,
      },
      subscription_data: {
        metadata: {
          userId: user.id,
          plan,
        },
      },
      allow_promotion_codes: true,
      billing_address_collection: "auto",
    });

    if (process.env.NODE_ENV === 'development') {
      console.log(`[Checkout] Created session for user ${user.id}, plan: ${plan}, session: ${session.id}`);
    }

    return success({ checkoutUrl: session.url, sessionId: session.id });
  });
}
