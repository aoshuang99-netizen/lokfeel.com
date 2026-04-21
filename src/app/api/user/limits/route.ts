import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { user } = await requireAuth();
    const userId = user.id;

    // Get user's subscription status
    const userData = await db.user.findUnique({
      where: { id: userId },
      include: {
        subscriptions: {
          where: {
            status: 'ACTIVE',
          },
          take: 1,
        },
      },
    });

    const isPremium = userData?.subscriptions && userData.subscriptions.length > 0;

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

    // Free user limits
    const maxChats = isPremium ? Infinity : 3;
    const maxMessagesPerChat = isPremium ? Infinity : 2;

    return NextResponse.json({
      isPremium,
      maxChats: isPremium ? -1 : 3,
      currentChats: activeChats,
      messagesSent,
      messagesRemaining: isPremium ? -1 : Math.max(0, maxMessagesPerChat - (messagesSent % maxMessagesPerChat)),
      chatsRemaining: isPremium ? -1 : Math.max(0, maxChats - activeChats),
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
