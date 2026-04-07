export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth/auth"
import { success, badRequest, serverError } from "@/lib/api-response";
import Stripe from "stripe";

const checkoutSchema = z.object({
  plan: z.enum(["PREMIUM_MONTHLY", "PREMIUM_YEARLY", "LIFETIME"]),
});

export async function POST(request: NextRequest) {
  try {
    

    const { user } = await requireAuth();
    const body = await request.json();

    const parseResult = checkoutSchema.safeParse(body);
    if (!parseResult.success) {
      return badRequest("Invalid request body", parseResult.error.issues);
    }

    const { plan } = parseResult.data;

    // Initialize Stripe
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
      apiVersion: "2024-12-18.acacia",
    });

    // Get or create Stripe customer
    let subscription = await db.subscription.findFirst({
      where: { userId: user.id },
    });

    let stripeCustomerId = subscription?.stripeCustomerId;

    if (!stripeCustomerId) {
      const userRecord = await db.user.findUnique({
        where: { id: user.id },
      });

      if (!userRecord) {
        return badRequest("User not found");
      }

      const customer = await stripe.customers.create({
        email: userRecord.email,
        name: userRecord.name || undefined,
        metadata: {
          userId: user.id,
        },
      });

      stripeCustomerId = customer.id;
    }

    // Price IDs (from Stripe Dashboard)
    const priceIds: Record<string, string> = {
      PREMIUM_MONTHLY: process.env.STRIPE_PREMIUM_MONTHLY_PRICE_ID || "price_monthly",
      PREMIUM_YEARLY: process.env.STRIPE_PREMIUM_YEARLY_PRICE_ID || "price_yearly",
      LIFETIME: process.env.STRIPE_LIFETIME_PRICE_ID || "price_lifetime",
    };

    // Get user's name for display
    const userRecord = await db.user.findUnique({
      where: { id: user.id },
    });

    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      customer: stripeCustomerId,
      mode: plan === "LIFETIME" ? "payment" : "subscription",
      payment_method_types: ["card"],
      line_items: plan === "LIFETIME"
        ? [{
            price_data: {
              currency: "usd",
              product_data: {
                name: "Nexus Lifetime Premium",
                description: "One-time payment for lifetime premium access",
              },
              unit_amount: 29900, // $299.00
            },
            quantity: 1,
          }]
        : [{
            price: priceIds[plan],
            quantity: 1,
          }],
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}/subscription/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/subscription/cancel`,
      metadata: {
        userId: user.id,
        plan,
      },
      subscription_data: plan !== "LIFETIME" ? {
        metadata: {
          userId: user.id,
          plan,
        },
      } : undefined,
    });

    return success({ checkoutUrl: session.url });
  } catch (error) {
    console.error("Error creating checkout session:", error);
    return serverError("Failed to create checkout session");
  }
}
