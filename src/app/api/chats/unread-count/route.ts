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

    if (roomIds.length === 0) {
      return NextResponse.json({
        unreadCount: 0,
        totalChats: 0,
      });
    }

    // 统计所有未读消息数
    const unreadCount = await prisma.message.count({
      where: {
        senderId: { not: userId },
        isRead: false,
        roomId: { in: roomIds },
      },
    });

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
