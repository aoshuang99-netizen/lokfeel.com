export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/auth";
import { success, serverError } from "@/lib/api-response";
import { handleApiError } from "@/lib/api-handler";
import { db } from "@/lib/db";

// ═══ GET /api/payments/status ════════════════════════════════
// Returns user's current subscription and payment status
export async function GET(request: NextRequest) {
  return handleApiError(async () => {
    const { user } = await requireAuth();

    const [subscription, profile, recentPayments] = await Promise.all([
      db.subscription.findFirst({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
      }),
      db.profile.findFirst({
        where: { userId: user.id },
        select: { gender: true },
      }),
      db.payment.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
    ]);

    // Get cardVerified status from User
    const userRecord = await db.user.findUnique({
      where: { id: user.id },
      select: { cardVerified: true },
    });

    const isFemale = profile?.gender === "FEMALE";
    const effectivePlan = subscription?.plan || (isFemale ? "LADY_FREE" : "FREE");
    const isActive = subscription?.status === "ACTIVE";
    const isPremium = effectivePlan === "PREMIUM_MONTHLY" || effectivePlan === "PREMIUM_YEARLY";
    const isLadyFree = effectivePlan === "LADY_FREE";
    const hasStripeCustomer = !!subscription?.stripeCustomerId;

    return success({
      plan: effectivePlan,
      isActive,
      isPremium,
      isLadyFree,
      isFemale,
      hasStripeCustomer,
      cardVerified: userRecord?.cardVerified ?? false,
      subscription: subscription ? {
        id: subscription.id,
        plan: subscription.plan,
        status: subscription.status,
        startsAt: subscription.startsAt,
        endsAt: subscription.endsAt,
        cancelledAt: subscription.cancelledAt,
        stripeCurrentPeriodEnd: subscription.stripeCurrentPeriodEnd,
      } : null,
      recentPayments: recentPayments.map(p => ({
        id: p.id,
        amount: p.amount,
        currency: p.currency,
        status: p.status,
        description: p.description,
        createdAt: p.createdAt,
      })),
    });
  });
}
