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

// ═══ POST /api/payments/confirm-verification ═══════════════════
// Called after user completes Stripe SetupIntent (card verified).
// Marks User.cardVerified = true.
export async function POST(request: NextRequest) {
  return handleApiError(async () => {
    const { user } = await requireAuth();

    const body = await request.json();
    const { setupIntentId } = body;

    if (!setupIntentId) {
      return badRequest("setupIntentId is required");
    }

    // Check Stripe config —— 统一走 payment availability（503 + PAYMENT_NOT_CONFIGURED）
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!isPaymentChannelReady("stripe.card") || !stripeKey) {
      return paymentNotConfigured("stripe.card", {
        error: "Payment system is not configured",
      });
    }

    const stripe = new Stripe(stripeKey, {
      apiVersion: STRIPE_API_VERSION,
    });

    // Verify SetupIntent succeeded
    const setupIntent = await stripe.setupIntents.retrieve(setupIntentId);

    if (setupIntent.status !== "succeeded") {
      return badRequest(`Card verification not completed. Status: ${setupIntent.status}`);
    }

    // Verify this SetupIntent belongs to this user
    if (setupIntent.metadata?.userId !== user.id) {
      return badRequest("SetupIntent does not belong to this user");
    }

    // Mark user as card verified
    await db.user.update({
      where: { id: user.id },
      data: {
        cardVerified: true,
        cardVerifiedAt: new Date(),
      },
    });

    if (process.env.NODE_ENV === 'development') {
      console.log(`[ConfirmVerification] User ${user.id} card verified successfully`);
    }

    return success({
      cardVerified: true,
      message: "Card verified successfully. You now have full access.",
    });
  });
}
