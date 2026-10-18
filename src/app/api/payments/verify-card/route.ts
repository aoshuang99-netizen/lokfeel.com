export const dynamic = 'force-dynamic';
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth/auth";
import { success, serverError, badRequest } from "@/lib/api-response";
import { handleApiError } from "@/lib/api-handler";
import { STRIPE_API_VERSION } from "@/lib/stripe/config";
import { isPaymentChannelReady } from "@/lib/payments/availability";
import { paymentNotConfigured } from "@/lib/payments/not-configured";
import Stripe from "stripe";

// ═══ POST /api/payments/verify-card ═════════════════════════════
// Creates a Stripe SetupIntent to verify a credit card WITHOUT charging.
// Used for: Free users + Lady Free users who need card verification.
// After successful setup, marks User.cardVerified = true.
export async function POST(request: NextRequest) {
  return handleApiError(async () => {
    const { user } = await requireAuth();

    // Already verified?
    const userRecord = await db.user.findUnique({
      where: { id: user.id },
      select: { id: true, email: true, name: true, cardVerified: true },
    });

    if (!userRecord) return badRequest("User not found");
    if (userRecord.cardVerified) {
      return success({ message: "Card already verified", clientSecret: null });
    }

    // Check Stripe config —— 统一走 payment availability（503 + PAYMENT_NOT_CONFIGURED）
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!isPaymentChannelReady("stripe.card") || !stripeKey) {
      console.error("[VerifyCard] stripe.card channel is not configured");
      return paymentNotConfigured("stripe.card", {
        error: "Payment system is not configured. Please try again later.",
      });
    }

    const stripe = new Stripe(stripeKey, {
      apiVersion: STRIPE_API_VERSION,
    });

    // Get or create Stripe customer
    const existingSub = await db.subscription.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    });

    let stripeCustomerId = existingSub?.stripeCustomerId;

    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: userRecord.email,
        name: userRecord.name || undefined,
        metadata: { userId: user.id, verification: "card_verify" },
      });
      stripeCustomerId = customer.id;

      // Update subscription with stripeCustomerId if exists
      if (existingSub) {
        await db.subscription.update({
          where: { id: existingSub.id },
          data: { stripeCustomerId },
        });
      }
    }

    // Create SetupIntent — verifies card without charge
    const setupIntent = await stripe.setupIntents.create({
      customer: stripeCustomerId,
      // stripe 23 移除了 SetupIntentCreateParams.payment_method_types，
      // 等价替代是 allowed_payment_method_types（同为「允许列表」语义）。
      allowed_payment_method_types: ["card"],
      usage: "off_session", // Allow future charges if they upgrade
      metadata: {
        userId: user.id,
        purpose: "card_verification",
      },
    });

    if (process.env.NODE_ENV === 'development') {
      console.log(`[VerifyCard] Created SetupIntent for user ${user.id}, customer: ${stripeCustomerId}`);
    }

    return success({
      clientSecret: setupIntent.client_secret,
      setupIntentId: setupIntent.id,
      stripeCustomerId,
    });
  });
}
