export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth/auth";
import { success, badRequest, serverError, forbidden } from "@/lib/api-response";
import {
  getCreemClient,
  CREEM_PLAN_CONFIG,
  createCreemCheckout,
} from "@/lib/creem";

// ── Checkout Schema ───────────────────────────────────

const checkoutSchema = z.object({
  plan: z.enum(["PREMIUM_MONTHLY", "PREMIUM_YEARLY"]),
});

// ── POST /api/payments/creem/checkout ─────────────────────

export async function POST(request: NextRequest) {
  try {
    // ── 1. Authenticate ───────────────────────────────
    let user;
    try {
      ({ user } = await requireAuth());
    } catch {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const parseResult = checkoutSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parseResult.error.issues },
        { status: 400 },
      );
    }

    const { plan } = parseResult.data;
    const planConfig = CREEM_PLAN_CONFIG[plan];

    // ── 2. Guard: Female users get Lady Free ─────────────────
    const userProfile = await db.profile.findFirst({
      where: { userId: user.id },
      select: { gender: true },
    });

    if (userProfile?.gender === "FEMALE") {
      return NextResponse.json(
        { error: "Women already have premium-level access for free via Lady Free plan" },
        { status: 403 },
      );
    }

    // ── 3. Guard: Check existing active subscription ───────
    const existingSub = await db.subscription.findFirst({
      where: { userId: user.id, status: "ACTIVE" },
    });

    if (
      existingSub &&
      (existingSub.plan === "PREMIUM_MONTHLY" || existingSub.plan === "PREMIUM_YEARLY")
    ) {
      return NextResponse.json(
        { error: "You already have an active Premium subscription" },
        { status: 400 },
      );
    }

    // ── 4. Guard: Creem API key configured ────────────────
    if (!process.env.CREEM_API_KEY) {
      console.error("[Creem Checkout] CREEM_API_KEY not configured");
      return NextResponse.json(
        { error: "Payment system is not configured. Please try again later." },
        { status: 503 },
      );
    }

    // ── 5. Get user email for Creem customer ───────────────
    const userRecord = await db.user.findUnique({
      where: { id: user.id },
      select: { email: true, name: true },
    });
    if (!userRecord) return badRequest("User not found");

    // ── 6. Create Creem checkout session ─────────────────
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://app.lokfeel.com";

    const productId =
      plan === "PREMIUM_MONTHLY"
        ? process.env.CREEM_MONTHLY_PRODUCT_ID
        : process.env.CREEM_YEARLY_PRODUCT_ID;

    if (!productId) {
      console.error(`[Creem Checkout] Missing product ID for plan: ${plan}`);
      return NextResponse.json(
        { error: "Product not configured. Please contact support." },
        { status: 503 },
      );
    }

    const checkout = await createCreemCheckout({
      userId: user.id,
      userEmail: userRecord.email!,
      plan,
    });

    // ── 7. Return checkout URL ───────────────────────────
    return NextResponse.json({
      success: true,
      checkoutUrl: checkout.checkoutUrl,
      checkoutId: checkout.checkoutId,
    });

  } catch (error: any) {
    console.error("[Creem Checkout] Error:", error);
    return NextResponse.json(
      { error: `Checkout failed: ${error.message}` },
      { status: 500 },
    );
  }
}
