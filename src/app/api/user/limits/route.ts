import { requireAuth } from "@/lib/auth";
import { handleApiError } from "@/lib/api-handler";
import { db } from "@/lib/db";
import { isFemaleGender } from "@/lib/gender-utils";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return handleApiError(async () => {
    const { user } = await requireAuth();
    const userId = user.id;
    const roomId = new URL(request.url).searchParams.get("roomId");

    // Get user's subscription status and gender
    const userData = await db.user.findUnique({
      where: { id: userId },
      include: {
        profile: {
          select: { gender: true },
        },
        subscriptions: {
          where: {
            status: 'ACTIVE',
          },
          take: 1,
        },
      },
    });

    const premiumPlans = ['PREMIUM_MONTHLY', 'PREMIUM_YEARLY', 'LIFETIME'];
    const isPremium = (userData?.subscriptions ?? []).some((s: any) => premiumPlans.includes(s.plan));
    const isFemale = isFemaleGender(userData?.profile?.gender);

    // Plan determination: Premium > Lady Free > Basic Free
    const planId = isPremium ? "PREMIUM" : isFemale ? "LADY_FREE" : "FREE";

    // Count active chats (rooms with messages in last 7 days)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const activeChats = await db.chatRoom.count({
      where: {
        members: {
          some: { userId },
        },
        messages: {
          some: {
            createdAt: { gte: sevenDaysAgo },
          },
        },
      },
    });

    // Count total messages sent by user in all rooms
    const messagesSent = await db.message.count({
      where: {
        senderId: userId,
        createdAt: { gte: sevenDaysAgo },
      },
    });

    // Count Super Likes used this week (senderAction = SUPER_LIKE in last 7 days)
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const superLikesUsed = await db.match.count({
      where: {
        senderId: userId,
        senderAction: "SUPER_LIKE",
        createdAt: { gte: weekAgo },
      },
    });

    // Limits by plan
    const PLAN_LIMITS = {
      FREE: {
        maxChats: 3,
        maxMessagesPerMatch: 2,
        weeklyMatches: 3,
        superLikeLimit: 1,      // ★ New: Free gets 1 Super Like / week
        canSeeWhoLikedMe: false,
        advancedFilters: false,
        readReceipts: false,
        incognitoMode: false,
        vaultControl: "readonly" as const,
        matchExplanation: "basic" as const,
      },
      LADY_FREE: {
        maxChats: -1, // unlimited
        maxMessagesPerMatch: -1, // unlimited
        weeklyMatches: 5,
        superLikeLimit: 5,      // ★ New: Lady Free gets 5 Super Likes / week
        canSeeWhoLikedMe: true,
        advancedFilters: true,
        readReceipts: true,
        incognitoMode: true,
        vaultControl: "full" as const,
        matchExplanation: "full" as const,
      },
      PREMIUM: {
        maxChats: -1, // unlimited
        maxMessagesPerMatch: -1, // unlimited
        weeklyMatches: 5,
        superLikeLimit: -1,    // ★ New: Premium gets unlimited Super Likes
        canSeeWhoLikedMe: true,
        advancedFilters: true,
        readReceipts: true,
        incognitoMode: true,
        vaultControl: "readonly" as const,
        matchExplanation: "full" as const,
      },
    };

    const limits = PLAN_LIMITS[planId as keyof typeof PLAN_LIMITS];

    return NextResponse.json({
      planId,
      isPremium,
      isFemale,
      ...limits,
      superLikesUsed: superLikesUsed,
      superLikesRemaining: limits.superLikeLimit === -1 ? -1 : Math.max(0, limits.superLikeLimit - superLikesUsed),
      currentChats: activeChats,
      messagesSent,
      // Per-room remaining for FREE plan (matches the real gate in
      // /api/chat/[id]/messages: 2 messages per conversation). Without a
      // roomId (e.g. dashboard summary) we return the plan cap as a hint.
      // BUG FIX: removed the modulo expression which made remaining cycle
      // between 1 and 2 and never reach 0.
      messagesRemaining: limits.maxMessagesPerMatch === -1
        ? -1
        : roomId
          ? Math.max(0, limits.maxMessagesPerMatch - (await db.message.count({ where: { roomId, senderId: userId } })))
          : limits.maxMessagesPerMatch,
      chatsRemaining: limits.maxChats === -1 ? -1 : Math.max(0, limits.maxChats - activeChats),
    });
  });
}
