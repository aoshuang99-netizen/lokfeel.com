export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth/auth";
import { success, badRequest, serverError, forbidden } from "@/lib/api-response";
import { handleApiError } from "@/lib/api-handler";
import { createPingPongClient } from "@/lib/pingpong";

// ═══ Checkout Schema ════════════════════════════════════════
const checkoutSchema = z.object({
  plan: z.enum(["PREMIUM_MONTHLY", "PREMIUM_YEARLY"]),
});

// ═══ Plan Config ════════════════════════════════════════
const PLAN_CONFIG = {
  PREMIUM_MONTHLY: {
    name: "LokFee! Premium Monthly",
    description: "Full power for serious seekers — monthly billing",
    amount: 1999, // $19.99
    currency: "USD",
    interval: "month" as const,
  },
  PREMIUM_YEARLY: {
    name: "LokFee! Premium Yearly",
    description: "Full power for serious seekers — yearly billing (save 37%)",
    amount: 14999, // $149.99/year
    currency: "USD",
    interval: "year" as const,
  },
} as const;

// ═══ POST /api/payments/pingpong/checkout ════════════════════
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

    if (userProfile?.gender === "FEMALE") {
      return NextResponse.json(
        { error: "Women already have premium-level access for free via Lady Free plan" },
        { status: 403 }
      );
    }

    // ═══ Guard: Check if already has active premium ═══
    const existingSub = await db.subscription.findFirst({
      where: { userId: user.id, status: "ACTIVE" },
    });

    if (existingSub) {
      return NextResponse.json(
        { error: "You already have an active Premium subscription" },
        { status: 400 }
      );
    }

    // ═══ Check PingPong configuration ═══
    if (!process.env.PINGPONG_API_KEY || !process.env.PINGPONG_MERCHANT_ID) {
      console.error("[PingPong Checkout] Configuration missing");
      return NextResponse.json(
        { error: "Payment system is not configured. Please try again later." },
        { status: 503 }
      );
    }

    // ═══ Create PingPong Checkout Session ═══
    const pingpong = createPingPongClient();
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://app.lokfeel.com";

    // Generate unique merchant transaction ID
    const merchantTransactionId = `lokfeel_${user.id}_${Date.now()}`;

    try {
      const session = await pingpong.createCheckoutSession({
        merchantTransactionId,
        amount: planConfig.amount,
        currency: planConfig.currency,
        description: planConfig.name,
        successUrl: `${appUrl}/dashboard/subscription/success?provider=pingpong&transaction_id=${merchantTransactionId}`,
        cancelUrl: `${appUrl}/dashboard/subscription/cancel`,
        planId: process.env[`PINGPONG_${plan}_PLAN_ID`] || undefined,
        customerEmail: user.email || undefined,
      });

      if (process.env.NODE_ENV === 'development') {
        console.log(`[PingPong Checkout] Created session for user ${user.id}, plan: ${plan}, transaction: ${merchantTransactionId}`);
      }

      // ═══ Save pending transaction to database ═══
      await db.payment.create({
        data: {
          userId: user.id,
          amount: planConfig.amount / 100, // Convert cents to dollars
          currency: planConfig.currency,
          status: "PENDING",
          description: `LokFee! Premium - ${planConfig.name}`,
          metadata: JSON.stringify({
            provider: "pingpong",
            merchantTransactionId,
            plan,
          }),
        },
      });

      // ═══ Return checkout URL ═══
      if (session.code === 0 && session.data?.checkoutUrl) {
        return success({
          checkoutUrl: session.data.checkoutUrl,
          transactionId: merchantTransactionId,
        });
      } else {
        throw new Error(session.message || "Failed to create checkout session");
      }

    } catch (apiError: any) {
      console.error("[PingPong Checkout] API Error:", apiError);
      return serverError(`Payment gateway error: ${apiError.message}`);
    }
  });
}
