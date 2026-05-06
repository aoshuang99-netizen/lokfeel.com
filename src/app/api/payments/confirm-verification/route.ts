export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth/auth";
import { success, serverError, badRequest } from "@/lib/api-response";
import { handleApiError } from "@/lib/api-handler";
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

    // Check Stripe config
    if (!process.env.STRIPE_SECRET_KEY) {
      return NextResponse.json(
        { error: "Payment system is not configured" },
        { status: 503 }
      );
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: "2026-03-25.dahlia",
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

    console.log(`[ConfirmVerification] User ${user.id} card verified successfully`);

    return success({
      cardVerified: true,
      message: "Card verified successfully. You now have full access.",
    });
  });
}
