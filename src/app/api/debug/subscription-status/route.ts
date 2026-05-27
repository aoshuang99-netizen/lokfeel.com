/**
 * Debug: Get current user's subscription status
 * 
 * GET /api/debug/subscription-status
 * Returns the current user's subscription record (for testing panel)
 */

export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/auth";
import { db } from "@/lib/db";

// Only allow in development/test — block in production
const BLOCKED = process.env.VERCEL_ENV === "production";

export async function GET(request: NextRequest) {
  if (BLOCKED) {
    return NextResponse.json({ error: "Not available in production" }, { status: 403 });
  }

  try {
    const { user } = await requireAuth();

    const subscription = await db.subscription.findFirst({
      where: { userId: user.id },
    });

    const userRecord = await db.user.findUnique({
      where: { id: user.id },
      select: { isBot: true, email: true, name: true },
    });

    const profile = await db.profile.findFirst({
      where: { userId: user.id },
      select: { gender: true },
    });

    return NextResponse.json({
      userId: user.id,
      email: user.email,
      isBot: userRecord?.isBot ?? false,
      subscription: subscription ? {
        id: subscription.id,
        plan: subscription.plan,
        status: subscription.status,
        weeklyMatchLimit: subscription.weeklyMatchLimit,
        canInitiateChat: subscription.canInitiateChat,
        canViewFullProfile: subscription.canViewFullProfile,
        stripeCustomerId: subscription.stripeCustomerId,
        stripeSubscriptionId: subscription.stripeSubscriptionId,
        createdAt: subscription.createdAt,
        cancelledAt: subscription.cancelledAt,
      } : null,
      profile: profile ? {
        gender: profile.gender,
      } : null,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 401 });
  }
}
