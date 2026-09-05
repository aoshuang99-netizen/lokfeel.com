import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db as prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/chats/unread-count
 * 获取用户所有聊天的未读消息总数
 */
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;

    // 获取用户的所有聊天室ID
    const chatRooms = await prisma.chatRoom.findMany({
      where: {
        members: {
          some: {
            userId: userId,
          },
        },
      },
      select: {
        id: true,
      },
    });

    const roomIds = chatRooms.map(r => r.id);

    // 统计旧聊天系统的未读消息数
    const legacyUnread = roomIds.length > 0 ? await prisma.message.count({
      where: {
        senderId: { not: userId },
        isRead: false,
        roomId: { in: roomIds },
      },
    }) : 0;

    // BUG-628: also count the NEW IM system (conversation.unreadCountA/B).
    // unreadCountA is the receiver-A counter, unreadCountB is the receiver-B counter.
    // A user may be userA in some conversations and userB in others, so we sum both
    // columns across all conversations they participate in.
    const convAgg = await prisma.conversation.aggregate({
      where: { OR: [{ userAId: userId }, { userBId: userId }] },
      _sum: { unreadCountA: true, unreadCountB: true },
    });
    const imUnread =
      (convAgg._sum.unreadCountA || 0) + (convAgg._sum.unreadCountB || 0);

    const unreadCount = legacyUnread + imUnread;

    return NextResponse.json({
      unreadCount,
      totalChats: roomIds.length,
    });

  } catch (error) {
    console.error("Unread count API error:", error);
    return NextResponse.json(
      { error: "Failed to fetch unread count" },
      { status: 500 }
    );
  }
}
