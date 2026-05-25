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
  CreemPlan,
} from "@/lib/creem";

// ── Checkout Schema ──────────────────────────────
// 支持两种方式：plan（兼容旧版）或 productId（动态）
const checkoutSchema = z.object({
  plan: z.enum(["PREMIUM_MONTHLY", "PREMIUM_YEARLY"]).optional(),
  productId: z.string().min(1).optional(),
}).refine(data => {
  // 必须有其中一个
  if (!data.plan && !data.productId) {
    return { message: "Must provide either 'plan' or 'productId'" };
  }
  return true;
});

// ── POST /api/payments/creem/checkout ──────────────────────
export async function POST(request: NextRequest) {
  try {
    // ── 1. Authenticate ──────────────────────────────
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

    const { plan, productId } = parseResult.data;

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

    // ── 3. Guard: Check existing active subscription ─────
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

    // ── 4. Guard: Creem API key configured ─────────────────
    if (!process.env.CREEM_API_KEY) {
      console.error("[Creem Checkout] CREEM_API_KEY not configured");
      return NextResponse.json(
        { error: "Payment system is not configured. Please try again later." },
        { status: 503 },
      );
    }

    // ── 5. Resolve productId ──────────────────────────────
    let resolvedProductId: string;

    if (productId) {
      // 方式1：直接使用前端传来的 productId（动态）
      resolvedProductId = productId;
    } else if (plan) {
      // 方式2：根据 plan 从环境变量读取（兼容旧版）
      resolvedProductId =
        plan === "PREMIUM_MONTHLY"
          ? process.env.CREEM_MONTHLY_PRODUCT_ID!
          : process.env.CREEM_YEARLY_PRODUCT_ID!;
    } else {
      return badRequest("Missing plan or productId");
    }

    if (!resolvedProductId) {
      throw new Error(
        `CREEM_${plan === "PREMIUM_MONTHLY" ? "MONTHLY" : "YEARLY"}_PRODUCT_ID is not configured`,
      );
    }

    // ── 6. Get user email for Creem customer ─────────────
    const userRecord = await db.user.findUnique({
      where: { id: user.id },
      select: { email: true, name: true },
    });
    if (!userRecord) return badRequest("User not found");

    // ── 7. Create Creem checkout session ─────────────────
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.lokfeel.com";

    const creem = getCreemClient();
    const checkout = await creem.checkouts.create({
      productId: resolvedProductId,
      requestId: `order_${user.id}_${Date.now()}`,
      successUrl: `${appUrl}/dashboard/subscription/success?provider=creem`,
      customer: { email: userRecord.email },
      metadata: {
        userId: user.id,
        plan: plan ?? "dynamic",
        productId: resolvedProductId,
      },
    });

    return NextResponse.json({
      success: true,
      checkoutUrl: (checkout as any).checkoutUrl || (checkout as any).checkout_url,
      checkoutId: checkout.id,
    });

  } catch (error: any) {
    console.error("[Creem Checkout] Error:", error);
    return NextResponse.json(
      { error: `Checkout failed: ${error.message}` },
      { status: 500 },
    );
  }
}
