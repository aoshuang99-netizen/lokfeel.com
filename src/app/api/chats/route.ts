import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db as prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/chats
 * 获取用户的聊天列表
 */
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;

    // 获取用户的所有聊天室
    const chatRooms = await prisma.chatRoom.findMany({
      where: {
        members: {
          some: {
            userId: userId,
          },
        },
      },
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                profile: {
                  select: {
                    age: true,
                    avatar: true,
                  },
                },
              },
            },
          },
        },
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            content: true,
            createdAt: true,
            senderId: true,
            messageType: true,
          },
        },
        match: {
          select: {
            sender: {
              select: {
                id: true,
                name: true,
              },
            },
            receiver: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
      orderBy: { updatedAt: "desc" },
    });

    // 获取未读消息数
    const unreadCounts = await prisma.message.groupBy({
      by: ['roomId'],
      where: {
        senderId: { not: userId },
        isRead: false,
        roomId: { in: chatRooms.map(c => c.id) },
      },
      _count: {
        id: true,
      },
    });

    const unreadMap = new Map(unreadCounts.map(u => [u.roomId, u._count.id]));

    // 格式化聊天列表
    const formattedChats = chatRooms.map((room) => {
      // 找到对方用户
      const otherMember = room.members.find(m => m.userId !== userId);
      const otherUser = otherMember?.user;
      const lastMessage = room.messages[0];
      const isVaultExpired = room.vaultExpiry ? new Date(room.vaultExpiry) < new Date() : false;

      return {
        id: room.id,
        otherUser: {
          id: otherUser?.id || "unknown",
          name: otherUser?.name || "Someone",
          age: otherUser?.profile?.age || 0,
          avatar: otherUser?.profile?.avatar || null,
        },
        lastMessage: lastMessage
          ? {
              content: lastMessage.messageType === "SYSTEM" 
                ? lastMessage.content 
                : lastMessage.content,
              timestamp: lastMessage.createdAt.toISOString(),
              isFromMe: lastMessage.senderId === userId,
            }
          : null,
        unreadCount: unreadMap.get(room.id) || 0,
        vaultExpiry: room.vaultExpiry?.toISOString() || null,
        isVaultExpired,
        createdAt: room.createdAt.toISOString(),
        updatedAt: room.updatedAt.toISOString(),
      };
    });

    return NextResponse.json({
      chats: formattedChats,
    });

  } catch (error) {
    console.error("Chats API error:", error);
    return NextResponse.json(
      { error: "Failed to fetch chats" },
      { status: 500 }
    );
  }
}
