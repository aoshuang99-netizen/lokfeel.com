import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { user } = await requireAuth();
    const userId = user.id;

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

    const isPremium = userData?.subscriptions && userData.subscriptions.length > 0;
    const gender = userData?.profile?.gender?.toLowerCase() || "";
    const isFemale = gender === "woman" || gender === "female" || gender === "trans_woman";

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

    // Limits by plan
    const PLAN_LIMITS = {
      FREE: {
        maxChats: 3,
        maxMessagesPerMatch: 2,
        weeklyMatches: 3,
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
      currentChats: activeChats,
      messagesSent,
      messagesRemaining: limits.maxMessagesPerMatch === -1 ? -1 : Math.max(0, limits.maxMessagesPerMatch - (messagesSent % limits.maxMessagesPerMatch)),
      chatsRemaining: limits.maxChats === -1 ? -1 : Math.max(0, limits.maxChats - activeChats),
    });
  } catch (error: any) {
    if (error.message === 'Unauthorized') {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Error fetching user limits:", error);
    return NextResponse.json(
      { error: "Failed to fetch user limits" },
      { status: 500 }
    );
  }
}
