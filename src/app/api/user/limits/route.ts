import { requireAuth } from "@/lib/auth";
import { handleApiError } from "@/lib/api-handler";
import { db } from "@/lib/db";
import { isFemaleGender } from "@/lib/gender-utils";
import { countMessages, countUserActiveConversations } from "@/lib/im/stats";
import { resolveConversationRef } from "@/lib/im/resolve";
import { countScopedMessages } from "@/lib/im/message-guards";
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

    // Count active chats (conversations with messages in last 7 days)
    //
    // P1-6 阶段 5：本端点整体是删表阻断点（原直读 `ChatRoom` / `Message`）。
    // 三处计数全部改为统一口径，且**必须与真实付费墙判定同源** ——
    // 否则「剩余条数」显示与实际拦截不一致，用户会看到"还剩 1 条"却被拒发。
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const activeChats = await countUserActiveConversations(userId, sevenDaysAgo);

    // Count total messages sent by user in all conversations
    const messagesSent = await countMessages({
      senderId: userId,
      window: { gte: sevenDaysAgo },
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

    // Per-room usage for the FREE plan cap —— 必须与真实门禁同源。
    //
    // 门禁在 `lib/im/message-guards.ts`（`checkSendPermission` → `countScopedMessages`），
    // 因此这里直接复用同一个函数，而不是再写一个"看起来一样"的计数：
    // 两份实现一旦漂移，用户就会看到"还剩 1 条"却发不出去。
    //
    // 入口 `roomId` 可能是 `Conversation.id`（阶段 4 之后常态）也可能是 `ChatRoom.id`
    // （旧书签），先经统一解析器归一化。解析失败时回退为"把入参当 ChatRoom id"，
    // 与改造前行为一致 —— 不存在的 id 得到 0 条，显示满额，不会误报"已用尽"。
    let scopedMessagesUsed = 0;
    if (roomId && limits.maxMessagesPerMatch !== -1) {
      const ref = await resolveConversationRef(roomId, userId);
      scopedMessagesUsed = await countScopedMessages(userId, {
        chatRoomId: ref?.chatRoomId ?? roomId,
        conversationId: ref?.conversationId ?? null,
      });
    }

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
          ? Math.max(0, limits.maxMessagesPerMatch - scopedMessagesUsed)
          : limits.maxMessagesPerMatch,
      chatsRemaining: limits.maxChats === -1 ? -1 : Math.max(0, limits.maxChats - activeChats),
    });
  });
}
